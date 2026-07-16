import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Focus,
  GitBranch,
  Home,
  Loader2,
  Maximize2,
  Minus,
  Network,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { presentationApi } from "../presentationApi";
import {
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  MAX_SCALE,
  MIN_SCALE,
  cameraTransform,
  clamp,
  fitGraphBounds,
  graphPointFromPointer,
  interpolateCamera,
} from "./graphCamera";
import "./knowledge-graph.css";

const typeNames = {
  device: "中心设备",
  domain: "故障领域",
  fault_category: "故障分类",
  fault_mode: "故障模式",
  fault_cause: "故障原因",
  maintenance_cause: "运维原因",
  metric: "监测参数",
  alarm: "异常告警",
  action: "检修动作",
  safety: "安全约束",
  recovery: "恢复标准",
  case: "来源案例",
  knowledge: "知识版本",
};

const domainNames = {
  core: "核心对象",
  environment: "环境工况",
  power: "供电系统",
  hardware: "硬件部件",
  maintenance: "安装与运维",
  monitoring: "监控告警",
  case: "案例来源",
  knowledge: "知识资产",
};

const verificationNames = {
  verified_case: "完整案例验证",
  official_document: "正式资料依据",
  expert_confirmed: "专家已确认",
  presentation_seed: "正式资料依据",
  collecting: "资料待完善",
};

function relatedNodeIds(nodeId, relations) {
  const ids = new Set([nodeId]);
  relations.forEach((relation) => {
    if (relation.source === nodeId) ids.add(relation.target);
    if (relation.target === nodeId) ids.add(relation.source);
  });
  return ids;
}

function wrapLabel(label, max = 9) {
  if (label.length <= max) return [label];
  const splitAt = Math.min(max, Math.ceil(label.length / 2));
  return [label.slice(0, splitAt), label.slice(splitAt)];
}

function nodeSize(node) {
  if (node.type === "device") return { width: 154, height: 66 };
  if (node.type === "domain") return { width: 142, height: 58 };
  if (["case", "knowledge"].includes(node.type)) return { width: 148, height: 56 };
  return { width: 126, height: 48 };
}

function GraphNode({ node, selected, muted, onSelect }) {
  const { width, height } = nodeSize(node);
  const lines = wrapLabel(node.name, node.type === "device" ? 12 : 9);
  const status = node.status === "published" && node.changeType ? "已发布" : node.status === "candidate" ? "待审核" : null;
  return (
    <g
      className={`ikg-svg-node type-${node.type} domain-${node.domain} ${selected ? "selected" : ""} ${muted ? "muted" : ""} ${node.changeType ? "changed" : ""} status-${node.status || "base"}`}
      transform={`translate(${node.layout.x} ${node.layout.y})`}
      role="button"
      tabIndex="0"
      aria-label={`${node.name}，${typeNames[node.type] || node.type}`}
      onClick={(event) => { event.stopPropagation(); onSelect(node.id); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      <rect x={-width / 2} y={-height / 2} width={width} height={height} rx="11" />
      <circle className="ikg-node-signal" cx={-width / 2 + 12} cy={-height / 2 + 12} r="3.5" />
      <text className="ikg-node-type" x={-width / 2 + 22} y={-height / 2 + 15}>{typeNames[node.type] || node.type}</text>
      <text className="ikg-node-label" textAnchor="middle" y={lines.length === 1 ? 10 : 4}>
        {lines.map((line, index) => <tspan x="0" dy={index === 0 ? 0 : 15} key={line}>{line}</tspan>)}
      </text>
      {status && <g className="ikg-node-status" transform={`translate(${width / 2 - 10} ${-height / 2 + 8})`}><circle r="6"/><path d="M-2 0l1.5 1.5L2.5-2"/></g>}
    </g>
  );
}

function GraphEdge({ relation, source, target, emphasized, muted, showLabel, publishing }) {
  const x1 = source.layout.x;
  const y1 = source.layout.y;
  const x2 = target.layout.x;
  const y2 = target.layout.y;
  const curve = Math.min(70, Math.abs(x2 - x1) * 0.12 + Math.abs(y2 - y1) * 0.08);
  const path = `M ${x1} ${y1} C ${x1} ${y1 + curve}, ${x2} ${y2 - curve}, ${x2} ${y2}`;
  const changed = Boolean(relation.changeType || relation.status);
  return (
    <g className={`ikg-svg-edge ${emphasized ? "emphasized" : ""} ${muted ? "muted" : ""} ${changed ? "changed" : ""} status-${relation.status || "base"} ${publishing && changed ? "publishing" : ""}`}>
      <path d={path} markerEnd="url(#ikg-arrow)" />
      {showLabel && <g className="ikg-edge-label" transform={`translate(${(x1 + x2) / 2} ${(y1 + y2) / 2})`}><rect x="-31" y="-10" width="62" height="20" rx="7"/><text textAnchor="middle" y="4">{relation.relation}</text></g>}
    </g>
  );
}

function GraphNodeDetail({ node, relations, nodesById, localSyncPending = false }) {
  if (!node) return null;
  const related = relations.filter((relation) => relation.source === node.id || relation.target === node.id);
  const nodeWaitingForSync = localSyncPending && node.status === "published" && node.changeType;
  return (
    <aside className="ikg-detail-panel" aria-live="polite">
      <div className="ikg-detail-kicker"><Network size={14}/><span>节点详情</span></div>
      <div className={`ikg-detail-symbol domain-${node.domain}`}><Focus size={22}/></div>
      <small>{typeNames[node.type] || node.type}</small>
      <h2>{node.name}</h2>
      <p className="ikg-detail-description">{node.detail}</p>
      <dl>
        <div><dt>所属领域</dt><dd>{domainNames[node.domain] || node.domain}</dd></div>
        <div><dt>可信等级</dt><dd>{verificationNames[node.verificationLevel] || node.verificationLevel}</dd></div>
        <div><dt>知识状态</dt><dd>{nodeWaitingForSync ? "待同步到本地" : node.status === "published" ? "已正式发布" : node.status === "candidate" ? "工程师候选" : "既有知识"}</dd></div>
        <div><dt>知识版本</dt><dd>{node.knowledgeId ? `${node.knowledgeId} · V${node.knowledgeVersion || "1.0"}` : "图谱基线"}</dd></div>
        <div><dt>来源案例</dt><dd>{node.sourceCaseIds?.[0] || "设备知识库"}</dd></div>
      </dl>
      <section className="ikg-related-list">
        <header><strong>关联关系</strong><span>{related.length} 条</span></header>
        {related.length ? related.slice(0, 8).map((relation) => {
          const outgoing = relation.source === node.id;
          const other = nodesById[outgoing ? relation.target : relation.source];
          return <p key={relation.id}><span>{outgoing ? relation.relation : `被${relation.relation}`}</span><strong>{other?.name || "未知节点"}</strong></p>;
        }) : <p className="empty">当前没有直接关系</p>}
      </section>
      {node.changeType && <footer className={`ikg-change-source ${node.status === "published" ? "published" : "candidate"}`}><GitBranch size={15}/><div><strong>{nodeWaitingForSync ? "专家已发布 · 等待本地同步" : node.status === "published" ? "专家已确认并发布" : "工程师候选变更"}</strong><span>{node.sourceCaseIds?.[0] || "CASE-ACP4000-001"}</span></div></footer>}
    </aside>
  );
}

export default function IndustrialKnowledgeGraphPage({
  state,
  portalRole = "expert",
  engineerSnapshot,
  engineerSync,
  initialKnowledgeId = null,
  busy = false,
  onReview,
  onSync,
  onVerify,
}) {
  const [view, setView] = useState(initialKnowledgeId === "KB-008" ? "changes" : "overview");
  const [graph, setGraph] = useState(null);
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [focusedNodeId, setFocusedNodeId] = useState(null);
  const [camera, setCamera] = useState({ cx: GRAPH_WIDTH / 2, cy: GRAPH_HEIGHT / 2, scale: 1 });
  const [query, setQuery] = useState("");
  const [publishingMotion, setPublishingMotion] = useState(false);
  const svgRef = useRef(null);
  const cameraRef = useRef(camera);
  const animationRef = useRef(null);
  const dragRef = useRef(null);
  const isEngineer = portalRole === "engineer";
  const localVersion = engineerSnapshot?.version || engineerSync?.local_version || "1.0";
  const hasLocalUpdate = isEngineer && engineerSync?.status === "update_available";

  useEffect(() => { cameraRef.current = camera; }, [camera]);

  const loadGraph = useCallback(async (nextView) => {
    setError("");
    try {
      const data = await presentationApi.knowledgeGraph(nextView);
      setGraph(data);
      const initialNode = nextView === "overview" && initialKnowledgeId
        ? data.nodes.find((node) => node.knowledgeId === initialKnowledgeId)
        : null;
      const targetIds = nextView === "changes" ? new Set(data.changeNodeIds) : null;
      const relatedIds = initialNode ? relatedNodeIds(initialNode.id, data.relations) : null;
      const targetNodes = targetIds ? data.nodes.filter((node) => targetIds.has(node.id)) : relatedIds ? data.nodes.filter((node) => relatedIds.has(node.id)) : data.nodes;
      const nextCamera = fitGraphBounds(targetNodes, nextView === "changes" ? 150 : initialNode ? 110 : 70);
      setCamera(nextCamera);
      setSelectedNodeId(nextView === "changes" ? data.changeNodeIds[0] : initialNode?.id || data.centerNodeId);
      setFocusedNodeId(initialNode?.id || null);
      const motionKey = data.publishedAt ? `knowledge-graph-motion:${data.publishedAt}` : null;
      if (nextView === "changes" && data.published && motionKey && !window.sessionStorage.getItem(motionKey)) {
        setPublishingMotion(true);
        window.sessionStorage.setItem(motionKey, "played");
        window.setTimeout(() => setPublishingMotion(false), 1100);
      }
    } catch (nextError) {
      setError(nextError.message);
    }
  }, [initialKnowledgeId]);

  useEffect(() => { loadGraph(view); }, [loadGraph, view, state.knowledgePublished, state.updatedAt]);
  useEffect(() => () => window.cancelAnimationFrame(animationRef.current), []);

  const nodesById = useMemo(() => Object.fromEntries((graph?.nodes || []).map((node) => [node.id, node])), [graph]);
  const selectedNode = nodesById[selectedNodeId];
  const focusedIds = useMemo(() => focusedNodeId && graph ? relatedNodeIds(focusedNodeId, graph.relations) : new Set(), [focusedNodeId, graph]);
  const changeIds = useMemo(() => new Set(graph?.changeNodeIds || []), [graph]);

  const animateCamera = useCallback((target, duration = 520) => {
    window.cancelAnimationFrame(animationRef.current);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) { setCamera(target); return; }
    const from = cameraRef.current;
    const startedAt = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      setCamera(interpolateCamera(from, target, progress));
      if (progress < 1) animationRef.current = window.requestAnimationFrame(tick);
    };
    animationRef.current = window.requestAnimationFrame(tick);
  }, []);

  const focusNode = useCallback((nodeId) => {
    if (!graph) return;
    setSelectedNodeId(nodeId);
    setFocusedNodeId(nodeId);
    const ids = relatedNodeIds(nodeId, graph.relations);
    const nodes = graph.nodes.filter((node) => ids.has(node.id));
    animateCamera(fitGraphBounds(nodes, 110), 480);
  }, [animateCamera, graph]);

  const resetCamera = useCallback(() => {
    if (!graph) return;
    const nodes = view === "changes" ? graph.nodes.filter((node) => changeIds.has(node.id)) : graph.nodes;
    animateCamera(fitGraphBounds(nodes, view === "changes" ? 150 : 70), 520);
    setSelectedNodeId(view === "changes" ? graph.changeNodeIds[0] : graph.centerNodeId);
    setFocusedNodeId(null);
  }, [animateCamera, changeIds, graph, view]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") resetCamera();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resetCamera]);

  const zoomBy = useCallback((factor) => {
    const current = cameraRef.current;
    animateCamera({ ...current, scale: clamp(current.scale * factor, MIN_SCALE, MAX_SCALE) }, 260);
  }, [animateCamera]);

  function onWheel(event) {
    event.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const current = cameraRef.current;
    const point = graphPointFromPointer(event, svg, current);
    const nextScale = clamp(current.scale * (event.deltaY > 0 ? 0.9 : 1.1), MIN_SCALE, MAX_SCALE);
    setCamera({
      cx: point.worldX - (point.screenX - GRAPH_WIDTH / 2) / nextScale,
      cy: point.worldY - (point.screenY - GRAPH_HEIGHT / 2) / nextScale,
      scale: nextScale,
    });
  }

  function onPointerDown(event) {
    if (event.button !== 0 || event.target.closest(".ikg-svg-node")) return;
    window.cancelAnimationFrame(animationRef.current);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera: cameraRef.current, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dx = ((event.clientX - drag.x) / rect.width) * GRAPH_WIDTH;
    const dy = ((event.clientY - drag.y) / rect.height) * GRAPH_HEIGHT;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    setCamera({ cx: drag.camera.cx - dx / drag.camera.scale, cy: drag.camera.cy - dy / drag.camera.scale, scale: drag.camera.scale });
  }

  function onPointerUp(event) {
    if (dragRef.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
    }
  }

  function searchNode(event) {
    event.preventDefault();
    const normalized = query.trim().toLowerCase();
    if (!normalized || !graph) return;
    const node = graph.nodes.find((item) => `${item.name}${typeNames[item.type] || ""}${domainNames[item.domain] || ""}`.toLowerCase().includes(normalized));
    if (node) focusNode(node.id);
  }

  if (error) return <main className="admin-page ikg-error"><Network size={30}/><h2>知识图谱加载失败</h2><p>{error}</p><button className="admin-primary" onClick={() => loadGraph(view)}>重新加载</button></main>;
  if (!graph) return <main className="admin-page ikg-loading"><Loader2 className="spin"/><span>正在载入工控机知识图谱…</span></main>;

  const engineerBannerClass = hasLocalUpdate ? "candidate" : state.knowledgePublished ? "published" : "proposed";
  const releaseBannerClass = isEngineer ? engineerBannerClass : graph.published ? "published" : graph.changeStatus;
  const engineerBannerTitle = hasLocalUpdate
    ? `发现知识 V${engineerSync.latest_version}，尚未同步到本地`
    : state.knowledgePublished
      ? `本地知识 V${localVersion} 已同步并参与诊断`
      : `本地知识 V${localVersion} · 当前已是最新`;
  const engineerBannerDetail = hasLocalUpdate
    ? `当前诊断仍使用 V${localVersion} · 可先预览专家发布的图谱变化`
    : state.knowledgePublished
      ? "全局图谱、现场问答与本地 SQLite 快照版本一致"
      : "当前展示全局知识基线，散热案例变更可在右侧视图预览";

  return (
    <main className="admin-page ikg-page">
      <header className="ikg-page-head">
        <div><span>INDUSTRIAL COMPUTER KNOWLEDGE GRAPH</span><h1>工控机知识图谱</h1><p>{isEngineer ? "查看设备知识覆盖、本地生效版本，以及专家发布后的图谱变化。" : "从全局知识网络观察故障领域，并追踪本次案例如何形成正式知识。"}</p></div>
        <div className="ikg-view-switch" role="group" aria-label="图谱视图">
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}><Network size={15}/>全局知识图谱</button>
          <button className={view === "changes" ? "active" : ""} onClick={() => setView("changes")}><GitBranch size={15}/>本次新增与修改 <i>{graph.changeRelationIds.length}</i></button>
        </div>
      </header>

      <section className={`ikg-release-banner ${releaseBannerClass}`}>
        <div>{isEngineer ? hasLocalUpdate ? <RefreshCcw size={17}/> : <ShieldCheck size={17}/> : graph.published ? <Check size={17}/> : <Sparkles size={17}/>}<span><strong>{isEngineer ? engineerBannerTitle : graph.published ? `知识 V${graph.knowledgeVersion} 已正式并入图谱` : graph.changeStatus === "candidate" ? "工程师候选变更等待专家确认" : "当前展示图谱基线与知识建设范围"}</strong><small>{isEngineer ? engineerBannerDetail : graph.published ? `${graph.sourceCaseId} · 专家审核通过` : view === "changes" ? `${graph.changeNodeIds.length} 个候选节点 · ${graph.changeRelationIds.length} 条候选关系` : "点击节点可放大其一跳关系"}</small></span></div>
        {isEngineer && hasLocalUpdate && <button disabled={busy} onClick={onSync}>{busy ? <Loader2 className="spin" size={13}/> : <RefreshCcw size={13}/>}同步到 V{engineerSync.latest_version}</button>}
        {isEngineer && !hasLocalUpdate && state.knowledgePublished && onVerify && <button onClick={onVerify}><ShieldCheck size={13}/>验证知识应用</button>}
        {!isEngineer && !graph.published && state.caseStatus === "pending_expert_review" && <button onClick={onReview}>进入专家审核 <ArrowLeft size={13}/></button>}
      </section>

      <section className="ikg-stat-strip">
        <span><strong>{graph.statistics.nodeCount}</strong>节点</span>
        <span><strong>{graph.statistics.relationCount}</strong>关系</span>
        <span><strong>{graph.statistics.domainCount}</strong>故障领域</span>
        <span><strong>{graph.statistics.knowledgeCount}</strong>正式知识</span>
        <span><strong>{graph.statistics.caseCount}</strong>来源案例</span>
      </section>

      <div className="ikg-workspace">
        <section className="ikg-canvas-shell">
          <div className="ikg-canvas-toolbar">
            <form onSubmit={searchNode}><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索节点或领域"/><button type="submit">定位</button></form>
            <div><button aria-label="缩小" onClick={() => zoomBy(0.85)}><Minus size={15}/></button><span>{Math.round(camera.scale * 100)}%</span><button aria-label="放大" onClick={() => zoomBy(1.18)}><Plus size={15}/></button><button onClick={resetCamera}><Home size={14}/>返回全局</button></div>
          </div>
          <svg
            ref={svgRef}
            className={`ikg-svg ${publishingMotion ? "publishing-motion" : ""}`}
            viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
            role="img"
            aria-label="工控机故障知识图谱，可点击节点查看和放大关联关系"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={() => { setSelectedNodeId(null); setFocusedNodeId(null); }}
          >
            <defs>
              <marker id="ikg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>
              <filter id="ikg-glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            </defs>
            <g className="ikg-scene" transform={cameraTransform(camera)}>
              <g className="ikg-edge-layer">
                {graph.relations.map((relation) => {
                  const source = nodesById[relation.source];
                  const target = nodesById[relation.target];
                  if (!source || !target) return null;
                  const emphasized = focusedNodeId ? focusedIds.has(source.id) && focusedIds.has(target.id) && (source.id === focusedNodeId || target.id === focusedNodeId) : view === "changes" && relation.changeType;
                  const muted = focusedNodeId ? !emphasized : view === "changes" && !relation.changeType;
                  return <GraphEdge relation={relation} source={source} target={target} emphasized={emphasized} muted={muted} showLabel={emphasized || (view === "changes" && relation.changeType)} publishing={publishingMotion} key={relation.id}/>;
                })}
              </g>
              <g className="ikg-node-layer">
                {graph.nodes.map((node) => {
                  const muted = focusedNodeId ? !focusedIds.has(node.id) : view === "changes" && !changeIds.has(node.id);
                  return <GraphNode node={node} selected={selectedNodeId === node.id} muted={muted} onSelect={focusNode} key={node.id}/>;
                })}
              </g>
            </g>
          </svg>
          <div className="ikg-canvas-hint"><Maximize2 size={13}/><span>滚轮缩放 · 拖拽平移 · 点击节点查看一跳关系</span></div>
          <div className="ikg-legend"><span><i className="domain"/>故障领域</span><span><i className="knowledge"/>既有知识</span><span><i className="candidate"/>候选变更</span><span><i className="published"/>正式发布</span></div>
        </section>
        {selectedNode ? <GraphNodeDetail node={selectedNode} relations={graph.relations} nodesById={nodesById} localSyncPending={hasLocalUpdate}/> : <aside className="ikg-detail-panel ikg-detail-empty"><Network size={28}/><h2>选择一个知识节点</h2><p>点击图谱节点后，镜头会自动放大该节点及其一跳关系。</p><button onClick={resetCamera}><Home size={14}/>返回全局视图</button></aside>}
      </div>
    </main>
  );
}
