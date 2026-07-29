import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, Database, FileSearch,
  GitCompare, Loader2, Network, Play, Search, ShieldCheck, Sparkles, X,
} from "lucide-react";
import { caseGenerationApi } from "../../api/caseGenerationClient";
import { manualKnowledgeApi } from "../../api/manualKnowledgeClient";
import "./case-generation-wizard.css";

const MODULES = ["registry", "manifest", "intake", "diagnosis", "guide", "assistant", "output", "feedbackAndGraph"];
const STEPS = ["任务目标", "选择资料", "确认大纲", "Agent 进度", "差异与证据", "应用结果"];
const ACTIVE_STATUSES = ["created", "snapshotting", "parsing_documents", "extracting_evidence", "classifying_domain", "planning", "generating_modules", "criticizing", "validating", "repairing"];
const STAGE_LABELS = {
  source_snapshot: "来源快照", document_understanding: "文档理解",
  evidence_extraction: "证据提取", evidence_retrieval: "四来源检索",
  evidence_consolidation: "证据归并", fault_domain: "领域判断",
  case_planning: "案例规划", registry_generator: "路由 Agent",
  manifest_generator: "清单 Agent", intake_generator: "接诊 Agent",
  diagnosis_generator: "诊断 Agent", guide_generator: "向导 Agent",
  assistant_generator: "问答 Agent", output_generator: "作业卡 Agent",
  feedbackAndGraph_generator: "知识图谱 Agent", routing_conflict_analysis: "路由冲突分析",
  graph_merge_analysis: "图谱合并分析", assistant_contract_tests: "问答合同测试",
  cross_module_critic: "跨模块审查", targeted_repair: "定向修复",
};

export default function CaseGenerationWizard({ draft, onDraftChanged }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [templates, setTemplates] = useState([]);
  const [sources, setSources] = useState({ manuals: [], cases: [], graph: { nodes: [] }, caseRuns: [] });
  const [recentJobs, setRecentJobs] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [query, setQuery] = useState(draft.title);
  const [generationRange, setGenerationRange] = useState(MODULES);
  const [selected, setSelected] = useState({ manuals: [], cases: [], nodes: [], runs: [] });
  const [manualQuery, setManualQuery] = useState("");
  const [manualPreview, setManualPreview] = useState([]);
  const [job, setJob] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [operationSelections, setOperationSelections] = useState({});
  const [selectedPatch, setSelectedPatch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    Promise.all([caseGenerationApi.templates(), caseGenerationApi.sources(), caseGenerationApi.jobs(20)])
      .then(([nextTemplates, nextSources, nextJobs]) => {
        setTemplates(nextTemplates.items);
        setSources(nextSources);
        setRecentJobs(nextJobs.items.filter((item) => item.draftId === draft.id));
      })
      .catch(showError);
  }, [open, draft.id]);

  useEffect(() => {
    if (!job || !ACTIVE_STATUSES.includes(job.status)) return undefined;
    const timer = window.setInterval(() => refresh(job.id).catch(showError), 1500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (!job) return;
    if (job.status === "awaiting_domain_review" || job.status === "awaiting_outline_review") setStep(3);
    else if (ACTIVE_STATUSES.includes(job.status)) setStep(4);
    else if (["awaiting_patch_review", "partially_applied"].includes(job.status)) setStep(5);
    else if (["completed", "failed"].includes(job.status) && job.patches?.length) setStep(6);
  }, [job?.status]);

  const outline = artifacts.find((item) => item.type === "case_outline");
  const evidenceCatalog = artifacts.find((item) => item.type === "evidence_catalog_final")?.content?.evidence || [];
  const evidenceById = useMemo(
    () => Object.fromEntries(evidenceCatalog.map((item) => [item.evidenceId, item])),
    [evidenceCatalog],
  );
  const activePatch = job?.patches?.find((item) => item.id === selectedPatch) || job?.patches?.[0];
  const activeCandidate = activePatch
    ? artifacts.find((item) => item.id === activePatch.candidateArtifactId)?.content
    : null;

  function showError(nextError) {
    setError(`${nextError.message}${nextError.requestId ? ` · ${nextError.requestId}` : ""}`);
  }

  async function refresh(jobId = job?.id) {
    if (!jobId) return;
    const [nextJob, nextArtifacts] = await Promise.all([
      caseGenerationApi.job(jobId), caseGenerationApi.artifacts(jobId),
    ]);
    setJob(nextJob);
    setArtifacts(nextArtifacts.items);
    if (!selectedPatch && nextJob.patches?.length) setSelectedPatch(nextJob.patches[0].id);
  }

  async function action(name, callback) {
    setBusy(name); setError("");
    try {
      const result = await callback();
      if (result?.id?.startsWith("CGJ-")) await refresh(result.id);
      else if (job) await refresh(job.id);
      return result;
    } catch (nextError) {
      showError(nextError);
      return null;
    } finally {
      setBusy("");
    }
  }

  function toggle(group, id) {
    setSelected((current) => ({
      ...current,
      [group]: current[group].includes(id)
        ? current[group].filter((item) => item !== id)
        : [...current[group], id],
    }));
  }

  async function searchManualPages() {
    if (!manualQuery.trim()) return;
    const result = await action("manual-search", () => manualKnowledgeApi.search(manualQuery, { limit: 20 }));
    if (result) setManualPreview(result.items);
  }

  async function createJob() {
    const selectedManuals = sources.manuals.filter((item) => selected.manuals.includes(item.id));
    const selectedCases = sources.cases.filter((item) => selected.cases.includes(item.caseId));
    const payloadSources = [
      ...selectedManuals.map((item) => ({
        type: "manual", resourceId: item.id,
        pages: manualPreview.filter((page) => page.documentId === item.id).map((page) => page.pageNumber),
      })),
      ...selectedCases.map((item) => ({ type: "case", resourceId: item.caseId })),
      ...(selected.nodes.length ? [{ type: "graph", resourceId: sources.graph.versionId, nodeIds: selected.nodes }] : []),
      ...selected.runs.map((resourceId) => ({ type: "field", resourceId })),
    ];
    if (!payloadSources.length) {
      setError("请至少选择一份手册、历史案例、图谱节点或本人现场记录。");
      return;
    }
    const created = await action("create", () => caseGenerationApi.createJob({
      draftId: draft.id, templateId: templateId || undefined, query,
      generationRange, sources: payloadSources,
    }));
    if (created) {
      await action("queue", () => caseGenerationApi.run(created.id));
      setStep(4);
    }
  }

  async function approveOutline() {
    await action("approve-outline", () => caseGenerationApi.approveOutline(job.id));
    await action("queue-generation", () => caseGenerationApi.run(job.id));
  }

  function toggleOperation(patch, index) {
    setOperationSelections((current) => {
      const defaults = patch.operations.map((_, itemIndex) => itemIndex);
      const values = current[patch.id] || defaults;
      return {
        ...current,
        [patch.id]: values.includes(index)
          ? values.filter((item) => item !== index)
          : [...values, index].sort((a, b) => a - b),
      };
    });
  }

  async function acceptAndApply(patch) {
    const indexes = operationSelections[patch.id] || patch.operations.map((_, index) => index);
    if (!indexes.length) {
      setError("至少选择一个字段；若不采用该模块，请点击拒绝。");
      return;
    }
    setBusy(patch.id); setError("");
    try {
      if (patch.status === "proposed") await caseGenerationApi.acceptPatch(patch.id, indexes);
      await caseGenerationApi.applyPatch(patch.id);
      await refresh(job.id);
      await onDraftChanged();
    } catch (nextError) {
      showError(nextError);
    } finally {
      setBusy("");
    }
  }

  if (!open) return <button className="case-generation-open" onClick={() => setOpen(true)}><Sparkles/>从资料自动生成案例</button>;

  return (
    <section className="case-generation-wizard">
      <header><div><span>TRACEABLE CASE FACTORY</span><h3>资料驱动的多 Agent 案例生产线</h3><p>候选内容与发布严格分离，每个字段保留来源、Agent 和审核轨迹。</p></div><button onClick={() => setOpen(false)}><X/></button></header>
      <nav className="generation-stepper">{STEPS.map((label, index) => <button key={label} className={`${step === index + 1 ? "active" : ""} ${step > index + 1 ? "done" : ""}`} onClick={() => (job || index < 2) && setStep(index + 1)}><i>{step > index + 1 ? <Check/> : index + 1}</i><span>{label}</span></button>)}</nav>
      {error && <div className="generation-error"><AlertTriangle/>{error}</div>}

      {step === 1 && <div className="generation-panel generation-target">
        <div className="generation-panel-title"><Sparkles/><div><strong>定义生成边界</strong><small>目标草稿固定为 {draft.caseId} · revision {draft.revision}</small></div></div>
        <label>故障领域<select value={templateId} onChange={(event) => setTemplateId(event.target.value)}><option value="">由 FaultDomain Agent 自动判断</option>{templates.map((item) => <option value={item.id} key={item.id}>{item.title} · {item.version}</option>)}</select></label>
        <label>现场目标<textarea value={query} onChange={(event) => setQuery(event.target.value)}/></label>
        <fieldset><legend>生成范围</legend>{MODULES.map((name) => <label key={name}><input type="checkbox" checked={generationRange.includes(name)} onChange={() => setGenerationRange((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name])}/>{name}</label>)}</fieldset>
        {recentJobs.length > 0 && <section className="generation-history"><strong>恢复本草稿历史任务</strong>{recentJobs.map((item) => <button key={item.id} onClick={() => refresh(item.id)}><span>{item.faultDomain || "自动识别"}<small>{item.status} · {item.progress}%</small></span><ChevronRight/></button>)}</section>}
        <footer><button onClick={() => setStep(2)}>下一步：选择资料<ChevronRight/></button></footer>
      </div>}

      {step === 2 && <div className="generation-panel generation-sources">
        <div className="generation-panel-title"><Database/><div><strong>选择可固化的四类来源</strong><small>任务创建后记录版本与 SHA-256，来源变化不会污染当前任务。</small></div></div>
        <section><h4>入库手册 <em>{selected.manuals.length}</em></h4>{sources.manuals.map((item) => <label className="source-card" key={item.id}><input type="checkbox" checked={selected.manuals.includes(item.id)} onChange={() => toggle("manuals", item.id)}/><span>{item.title}<small>{item.pageCount} 页 · SHA {item.sha256?.slice(0, 12)}</small></span></label>)}</section>
        <section><h4>历史案例 <em>{selected.cases.length}</em></h4>{sources.cases.map((item) => <label className="source-card" key={item.caseId}><input type="checkbox" checked={selected.cases.includes(item.caseId)} onChange={() => toggle("cases", item.caseId)}/><span>{item.identity.title}<small>{item.caseId} · V{item.packageVersion} · {item.packageHash.slice(0, 10)}</small></span></label>)}</section>
        <section><h4>图谱局部节点 <em>{selected.nodes.length}</em></h4><small>版本 {sources.graph.versionId} · {sources.graph.sha256?.slice(0, 12)}</small>{sources.graph.nodes.slice(0, 30).map((item) => <label className="source-card" key={item.id}><input type="checkbox" checked={selected.nodes.includes(item.id)} onChange={() => toggle("nodes", item.id)}/><span>{item.label}<small>{item.type} · {item.id}</small></span></label>)}</section>
        <section><h4>现场 CaseRun <em>{selected.runs.length}</em></h4>{sources.caseRuns.map((item) => <label className="source-card" key={item.id}><input type="checkbox" checked={selected.runs.includes(item.id)} onChange={() => toggle("runs", item.id)}/><span>{item.caseId}<small>{item.status} · r{item.revision} · {item.id}</small></span></label>)}</section>
        <div className="manual-page-search"><Search/><input value={manualQuery} onChange={(event) => setManualQuery(event.target.value)} placeholder="检索手册页码，例如 SMART、接线、凝露"/><button onClick={searchManualPages}>检索页码</button></div>
        {manualPreview.length > 0 && <div className="manual-page-preview">{manualPreview.map((item) => <article key={item.chunkId}><b>P{item.pageNumber}</b><span>{item.excerpt}</span><small>{item.title} · {item.chunkId}</small></article>)}</div>}
        <footer><button onClick={() => setStep(1)}><ChevronLeft/>上一步</button><button disabled={busy} onClick={createJob}>{busy ? <Loader2 className="spin"/> : <FileSearch/>}固化来源并创建任务</button></footer>
      </div>}

      {step === 3 && job && <div className="generation-panel">
        <div className="generation-panel-title"><ShieldCheck/><div><strong>专家闸门</strong><small>领域和大纲未经确认，八模块 Agent 不会启动。</small></div></div>
        {job.currentStage === "awaiting_domain_review" && <section className="generation-domain-review"><AlertTriangle/><h4>领域置信度不足，请明确选择</h4><div>{templates.map((item) => <button key={item.id} onClick={async () => { await action("confirm-domain", () => caseGenerationApi.confirmDomain(job.id, item.id)); await action("queue", () => caseGenerationApi.run(job.id)); }}>{item.title}</button>)}</div></section>}
        {outline && <section className="generation-outline"><span>{outline.content.faultDomain}</span><h4>{outline.content.title}</h4><div className="outline-grid"><article><b>接诊字段</b>{outline.content.intakeFields.map((item) => <small key={item}>{item}</small>)}</article><article><b>可能原因</b>{outline.content.causeCategories.map((item) => <small key={item}>{item}</small>)}</article><article><b>检修步骤</b>{outline.content.steps.map((item, index) => <small key={item}>{index + 1}. {item}</small>)}</article><article><b>问答 / 作业卡 / 图谱</b>{outline.content.assistantTopics.map((item) => <small key={item}>{item}</small>)}</article></div>{outline.content.requiresExpertInput.map((item) => <p key={item}><AlertTriangle/>{item}</p>)}<footer><button onClick={() => action("reject", () => caseGenerationApi.rejectOutline(job.id, "大纲需要补充或调整"))}>退回大纲</button><button onClick={approveOutline}><Check/>批准并启动模块 Agent</button></footer></section>}
      </div>}

      {step === 4 && job && <div className="generation-panel">
        <div className="generation-progress"><span>{job.currentStage}</span><strong>{job.progress}%</strong><i><b style={{ width: `${job.progress}%` }}/></i></div>
        <div className="generation-agents">{job.agentRuns.map((run) => <article key={run.id}><i className={run.status}/><span>{STAGE_LABELS[run.agentType] || run.agentType}<small>{run.provider} · attempt {run.attempt} · {run.durationMs ?? "—"} ms</small></span><em>{run.status}</em>{run.warnings.length > 0 && <p>{run.warnings.join("；")}</p>}{run.requiresExpertInput.length > 0 && <p>{run.requiresExpertInput.join("；")}</p>}</article>)}</div>
        <footer><button onClick={() => refresh()}><Loader2 className={ACTIVE_STATUSES.includes(job.status) ? "spin" : ""}/>刷新进度</button>{job.status === "awaiting_patch_review" && <button onClick={() => setStep(5)}>查看候选差异<ChevronRight/></button>}</footer>
      </div>}

      {step === 5 && job && <div className="generation-panel generation-diff">
        <aside>{job.patches.map((patch) => <button className={activePatch?.id === patch.id ? "active" : ""} key={patch.id} onClick={() => setSelectedPatch(patch.id)}><span>{patch.moduleName}<small>{patch.operations.length} 个字段 · {patch.risk} risk</small></span><em>{patch.status}</em></button>)}</aside>
        {activePatch && <section><header><div><GitCompare/><span><strong>{activePatch.moduleName}</strong><small>base r{activePatch.baseRevision} · {activePatch.evidenceLinks.length} 条血缘</small></span></div><em>{activePatch.status}</em></header><div className="diff-columns"><article><b>当前草稿</b><pre>{JSON.stringify(draft.modules[activePatch.moduleName], null, 2)}</pre></article><article><b>生成候选</b><pre>{JSON.stringify(activeCandidate, null, 2)}</pre></article></div><h4>JSON Pointer 字段选择</h4><div className="operation-list">{activePatch.operations.map((operation, index) => { const checked = (operationSelections[activePatch.id] || activePatch.operations.map((_, itemIndex) => itemIndex)).includes(index); const links = activePatch.evidenceLinks.filter((item) => operation.path.startsWith(item.jsonPointer) || item.jsonPointer.startsWith(operation.path)); return <label key={`${operation.path}-${index}`}><input type="checkbox" checked={checked} disabled={activePatch.status !== "proposed"} onChange={() => toggleOperation(activePatch, index)}/><code>{operation.op} {operation.path || "/"}</code><span>{links.map((link) => { const evidence = evidenceById[link.evidenceId]; return <small key={link.evidenceId}>{evidence ? `${evidence.locator} · P${evidence.pages.join(",")}` : link.evidenceId} · {Math.round(link.confidence * 100)}%</small>; })}</span></label>; })}</div><footer>{activePatch.status === "proposed" && <button onClick={() => action(activePatch.id, () => caseGenerationApi.rejectPatch(activePatch.id))}>拒绝模块</button>}{["proposed", "accepted"].includes(activePatch.status) && <button onClick={() => acceptAndApply(activePatch)}>{busy === activePatch.id ? <Loader2 className="spin"/> : <ChevronRight/>}应用所选字段</button>}</footer></section>}
      </div>}

      {step === 6 && job && <div className="generation-panel generation-result">
        <div className={`result-seal ${job.status}`}><Network/><span><strong>{job.status === "completed" ? "生成内容已通过应用后校验" : "应用后仍有问题"}</strong><small>草稿仍需沿用原有专家审核与不可变发布流程。</small></span></div>
        <dl><div><dt>当前草稿 revision</dt><dd>{draft.revision}</dd></div><div><dt>已应用</dt><dd>{job.patches.filter((item) => item.status === "applied").length}</dd></div><div><dt>未采用</dt><dd>{job.patches.filter((item) => item.status === "rejected").length}</dd></div><div><dt>冲突</dt><dd>{job.patches.filter((item) => item.status === "conflicted").length}</dd></div></dl>
        <section><h4>最终确定性评估</h4>{job.evaluations?.map((item) => <article key={item.id} className={item.passed ? "passed" : "failed"}><i>{item.passed ? <Check/> : <AlertTriangle/>}</i><span>{item.ruleId}<small>{item.evaluatorType} · {item.severity}</small></span></article>)}</section>
        <footer><button onClick={() => { setJob(null); setArtifacts([]); setStep(1); }}><Play/>创建另一任务</button><button onClick={() => setOpen(false)}>返回案例审核与发布</button></footer>
      </div>}
      {busy && <div className="generation-running"><Loader2 className="spin"/>正在执行 {busy}…</div>}
    </section>
  );
}
