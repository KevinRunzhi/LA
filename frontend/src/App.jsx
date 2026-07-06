import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Cpu,
  FileText,
  GitBranch,
  ImagePlus,
  LayoutDashboard,
  MapPin,
  Menu,
  MessageCircle,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
  Zap,
} from "lucide-react";
import { api } from "./api/client";
import { defaultInput } from "./data/fallbackDemo";

const navItems = [
  { id: "workbench", label: "工作台", icon: LayoutDashboard },
  { id: "graph", label: "知识图谱", icon: GitBranch },
  { id: "cases", label: "案例回顾", icon: BookOpen },
  { id: "records", label: "检修记录", icon: ClipboardList },
  { id: "settings", label: "设置", icon: Settings },
];

const phaseSteps = [
  {
    title: "异常接入",
    items: ["描述现场现象", "上传入口预留", "触发诊断"],
  },
  {
    title: "分析诊断",
    items: ["补充设备型号", "确认灯态与阈值", "生成诊断结论"],
  },
  {
    title: "检修向导",
    items: ["安全准备", "风道检查", "滤网/风扇检查", "恢复验证"],
  },
  {
    title: "记录与回流",
    items: ["生成检修记录", "专家审核", "知识沉淀"],
  },
];

function classNames(...items) {
  return items.filter(Boolean).join(" ");
}

export default function App() {
  const [navOpen, setNavOpen] = useState(false);
  const [activePage, setActivePage] = useState("workbench");
  const [stage, setStage] = useState("input");
  const [health, setHealth] = useState("连接中");
  const [scenario, setScenario] = useState(null);
  const [input, setInput] = useState(defaultInput);
  const [diagnosis, setDiagnosis] = useState(null);
  const [steps, setSteps] = useState([]);
  const [activeStep, setActiveStep] = useState(0);
  const [evidence, setEvidence] = useState([]);
  const [graph, setGraph] = useState([]);
  const [record, setRecord] = useState(null);
  const [expertReview, setExpertReview] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.health(),
      api.scenario(),
      api.steps(),
      api.evidence(),
      api.graph(),
    ])
      .then(([healthResult, scenarioResult, stepResult, evidenceResult, graphResult]) => {
        setHealth(healthResult.status === "ok" ? "后端已连接" : "后端异常");
        setScenario(scenarioResult);
        setInput(scenarioResult.default_input || defaultInput);
        setSteps(stepResult);
        setEvidence(evidenceResult);
        setGraph(graphResult);
      })
      .catch(() => setHealth("后端未连接"));
  }, []);

  const completedCount = steps.filter((step) => step.completed).length;
  const currentStep = steps[activeStep];

  const activePhase = useMemo(() => {
    if (stage === "input") return 0;
    if (stage === "diagnosis") return 1;
    if (stage === "guide") return 2;
    return 3;
  }, [stage]);

  async function startDiagnosis() {
    setLoading(true);
    try {
      const result = await api.startDiagnosis(input || defaultInput);
      setDiagnosis(result);
      setSteps(await api.steps());
      setActivePage("workbench");
      setStage("diagnosis");
      setActiveStep(0);
    } finally {
      setLoading(false);
    }
  }

  async function enterGuide() {
    setSteps(await api.steps());
    setStage("guide");
    setActiveStep(0);
  }

  async function completeCurrentStep() {
    if (!currentStep) return;
    await api.completeStep(currentStep.id);
    const latestSteps = await api.steps();
    setSteps(latestSteps);
    if (activeStep < latestSteps.length - 1) {
      setActiveStep(activeStep + 1);
    } else {
      const result = await api.generateRecord();
      setRecord(result);
      setStage("record");
    }
  }

  async function buildRecord() {
    const result = await api.generateRecord();
    setRecord(result);
    setStage("record");
  }

  async function approveExpertReview() {
    const result = await api.expertReview();
    setExpertReview(result);
    setDiagnosis(await api.startDiagnosis(input || defaultInput));
    setStage("expert");
  }

  function openNavPage(pageId) {
    setActivePage(pageId);
    if (pageId === "workbench") return;
    setStage("input");
  }

  return (
    <div className={classNames("app-shell", navOpen && "nav-expanded")}>
      <aside className="sidebar">
        <button className="brand-mark" onClick={() => setNavOpen(!navOpen)} title="展开菜单">
          <Zap size={22} />
        </button>
        <button className="nav-toggle" onClick={() => setNavOpen(!navOpen)} title="菜单">
          <Menu size={18} />
          <span>菜单</span>
        </button>
        <nav className="sidebar-nav" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={classNames("nav-icon", activePage === item.id && "active")}
                title={item.label}
                onClick={() => openNavPage(item.id)}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">站控慧眼</p>
            <h1>{activePage === "graph" ? "知识图谱" : "智能诊断台"}</h1>
          </div>
          <div className="topbar-meta">
            <span><MapPin size={16} /> {scenario?.site || "某输气场站"} · {scenario?.cabinet || "站控柜 A01"}</span>
            <span><UserRound size={16} /> 一线检修人员</span>
            <span className={classNames("health-pill", health === "后端已连接" && "ok")}>{health}</span>
          </div>
        </header>

        {activePage === "graph" ? (
          <KnowledgeGraphPage graph={graph} evidence={evidence} />
        ) : activePage === "cases" ? (
          <PlaceholderPage title="案例回顾" text="后续展示相似历史案例、专家经验和检修记录复盘。" />
        ) : activePage === "records" ? (
          <RecordPage record={record} onBuildRecord={buildRecord} />
        ) : activePage === "settings" ? (
          <PlaceholderPage title="设置" text="后续配置设备类型、故障类型、专家 Agent 和演示数据重置。" />
        ) : (
          <section className="stage-layout">
            <div className="stage-card">
              {stage === "input" && (
                <InputStage
                  input={input}
                  loading={loading}
                  onInput={setInput}
                  onStart={startDiagnosis}
                />
              )}
              {stage === "diagnosis" && diagnosis && (
                <DiagnosisStage
                  diagnosis={diagnosis}
                  evidence={evidence}
                  onEnterGuide={enterGuide}
                />
              )}
              {stage === "guide" && currentStep && (
                <GuideStage
                  currentStep={currentStep}
                  activeStep={activeStep}
                  totalSteps={steps.length}
                  onPrev={() => setActiveStep(Math.max(0, activeStep - 1))}
                  onNext={completeCurrentStep}
                  onRecord={buildRecord}
                />
              )}
              {stage === "record" && (
                <RecordStage
                  record={record}
                  onApprove={approveExpertReview}
                  onBackGuide={() => setStage("guide")}
                />
              )}
              {stage === "expert" && (
                <ExpertStage
                  expertReview={expertReview}
                  onRestart={() => setStage("diagnosis")}
                />
              )}
            </div>

            <RightStepPanel
              activePhase={activePhase}
              steps={steps}
              activeStep={activeStep}
              completedCount={completedCount}
              onSelectStep={(index) => {
                if (diagnosis) {
                  setStage("guide");
                  setActiveStep(index);
                }
              }}
            />
          </section>
        )}

        <AssistantChat currentStep={currentStep} diagnosis={diagnosis} />
      </main>
    </div>
  );
}

function InputStage({ input, loading, onInput, onStart }) {
  return (
    <div className="stage-content input-stage">
      <div className="stage-copy">
        <p className="eyebrow">现场接入</p>
        <h2>描述问题和现象</h2>
        <p>先输入一线人员看到的告警、灯态、声音、温度或数据上传异常。图片能力只保留入口，第一版不做真实上传。</p>
      </div>
      <textarea
        value={input}
        onChange={(event) => onInput(event.target.value)}
        placeholder="例如：站控柜内工控机温度告警，风扇声音异常，前面板风扇转速很低。"
      />
      <div className="input-toolbar">
        <button className="ghost-button">
          <ImagePlus size={16} />
          上传图片（预留）
        </button>
        <button className="ghost-button">快速提问</button>
        <button className="primary-button" onClick={onStart} disabled={loading}>
          <Send size={16} />
          {loading ? "诊断中" : "生成诊断结论"}
        </button>
      </div>
    </div>
  );
}

function DiagnosisStage({ diagnosis, evidence, onEnterGuide }) {
  return (
    <div className="stage-content diagnosis-stage">
      <div className="stage-copy">
        <p className="eyebrow">诊断结论</p>
        <h2>{diagnosis.title}</h2>
        <p>{diagnosis.summary}</p>
      </div>
      <div className="diagnosis-grid">
        <div className="risk-box">
          <AlertTriangle size={18} />
          <span>{diagnosis.risk}</span>
        </div>
        <div className="agent-strip">
          {diagnosis.agents.map((agent) => (
            <article key={agent.name}>
              <span>{agent.status}</span>
              <strong>{agent.name}</strong>
              <p>{agent.content}</p>
            </article>
          ))}
        </div>
      </div>
      <div className="evidence-row">
        {evidence.slice(0, 4).map((item) => (
          <article key={item.id}>
            <span>{item.id}</span>
            <strong>{item.title}</strong>
          </article>
        ))}
      </div>
      <div className="stage-actions">
        <button className="primary-button" onClick={onEnterGuide}>
          进入步骤式检修向导 <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function GuideStage({ currentStep, activeStep, totalSteps, onPrev, onNext, onRecord }) {
  return (
    <div className="stage-content guide-stage">
      <div className="stage-copy">
        <p className="eyebrow">检修向导 · 第 {activeStep + 1} / {totalSteps} 步</p>
        <h2>{currentStep.title}</h2>
        <p>{currentStep.description}</p>
      </div>
      <div className="guide-screen">
        <div className="image-placeholder">
          <Cpu size={34} />
          <strong>图片待补充</strong>
          <span>{currentStep.placeholder}</span>
        </div>
        <div className="guide-info">
          <div>
            <strong>检查项</strong>
            <div className="chips">
              {currentStep.checks.map((check) => <span key={check}>{check}</span>)}
            </div>
          </div>
          {currentStep.thresholds.length > 0 && (
            <div className="threshold-box">
              <ShieldCheck size={18} />
              <p>{currentStep.thresholds.join(" · ")}</p>
            </div>
          )}
          <div className="safety-box">
            <ShieldCheck size={18} />
            <p>{currentStep.safety}</p>
          </div>
          <p className="source-line">来源依据：{currentStep.source}</p>
        </div>
      </div>
      <div className="stage-actions">
        <button className="ghost-button" onClick={onPrev}><ChevronLeft size={16} /> 上一步</button>
        <button className="primary-button" onClick={onNext}>完成并继续 <ChevronRight size={16} /></button>
        <button className="ghost-button" onClick={onRecord}>生成检修记录</button>
      </div>
    </div>
  );
}

function RecordStage({ record, onApprove, onBackGuide }) {
  if (!record) {
    return (
      <div className="stage-content">
        <h2>检修记录尚未生成</h2>
        <button className="ghost-button" onClick={onBackGuide}>返回检修向导</button>
      </div>
    );
  }

  return (
    <div className="stage-content record-stage">
      <div className="stage-copy">
        <p className="eyebrow">检修完成记录</p>
        <h2>{record.record_id}</h2>
        <p>{record.conclusion}</p>
      </div>
      <div className="record-grid">
        <article><span>设备</span><strong>{record.equipment}</strong></article>
        <article><span>故障</span><strong>{record.fault}</strong></article>
        <article><span>步骤完成</span><strong>{record.completed_steps.length} 项</strong></article>
        <article><span>专家状态</span><strong>{record.expert_status}</strong></article>
      </div>
      <div className="stage-actions">
        <button className="ghost-button" onClick={() => window.print()}>打印作业卡</button>
        <button className="primary-button" onClick={onApprove}>提交专家审核</button>
      </div>
    </div>
  );
}

function ExpertStage({ expertReview, onRestart }) {
  return (
    <div className="stage-content expert-stage">
      <div className="stage-copy">
        <p className="eyebrow">专家审核回流</p>
        <h2>{expertReview?.tag || "专家修正 · 已审核"}</h2>
        <p>{expertReview?.content}</p>
      </div>
      <div className="expert-note">
        <Wrench size={20} />
        <span>修正内容已写入知识库、图谱关系和专家经验记录。再次触发同类异常时会显示该专家修正。</span>
      </div>
      <div className="stage-actions">
        <button className="primary-button" onClick={onRestart}>再次查看诊断结论</button>
      </div>
    </div>
  );
}

function RightStepPanel({ activePhase, steps, activeStep, completedCount, onSelectStep }) {
  return (
    <aside className="right-step-panel">
      <div className="section-heading compact">
        <h2>诊断流程</h2>
        <span>{completedCount} / {steps.length || 5}</span>
      </div>
      <div className="phase-list">
        {phaseSteps.map((phase, phaseIndex) => (
          <div className={classNames("phase-item", phaseIndex === activePhase && "active", phaseIndex < activePhase && "done")} key={phase.title}>
            <div className="phase-title">
              <span>{phaseIndex < activePhase ? <Check size={14} /> : phaseIndex + 1}</span>
              <strong>{phase.title}</strong>
            </div>
            <div className="sub-step-list">
              {phaseIndex === 2 && steps.length > 0
                ? steps.map((step, index) => (
                    <button
                      key={step.id}
                      className={classNames("sub-step", index === activeStep && "active", step.completed && "done")}
                      onClick={() => onSelectStep(index)}
                    >
                      {step.completed ? "已完成" : `步骤 ${index + 1}`} · {step.title}
                    </button>
                  ))
                : phase.items.map((item) => <span className="sub-step" key={item}>{item}</span>)}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function KnowledgeGraphPage({ graph, evidence }) {
  const nodes = ["输气场站", "站控柜", "工控机", "高温告警", "风道堵塞", "滤网积尘", "风扇异常", "恢复验证"];
  const positions = [
    [12, 46], [28, 28], [45, 46], [62, 24], [76, 43], [64, 68], [40, 72], [84, 68],
  ];

  return (
    <section className="graph-page">
      <div className="graph-canvas panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">知识图谱</p>
            <h2>工控机散热异常子图</h2>
          </div>
          <span className="health-pill ok">节点图样式</span>
        </div>
        <div className="node-map">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points="12,46 28,28 45,46 62,24 76,43" />
            <polyline points="45,46 64,68 84,68" />
            <polyline points="45,46 40,72" />
          </svg>
          {nodes.map((node, index) => (
            <button
              key={node}
              className={classNames("graph-node", index === 3 && "danger-node")}
              style={{ left: `${positions[index][0]}%`, top: `${positions[index][1]}%` }}
            >
              {node}
            </button>
          ))}
        </div>
      </div>
      <aside className="panel graph-side">
        <h2>关系与证据</h2>
        <div className="relation-list">
          {graph.slice(0, 8).map((edge, index) => (
            <div key={`${edge.source}-${edge.target}-${index}`}>
              <strong>{edge.source}</strong>
              <span>{edge.relation}</span>
              <strong>{edge.target}</strong>
            </div>
          ))}
        </div>
        <div className="evidence-mini">
          {evidence.slice(0, 4).map((item) => (
            <article key={item.id}>
              <span>{item.id}</span>
              <strong>{item.title}</strong>
            </article>
          ))}
        </div>
      </aside>
    </section>
  );
}

function RecordPage({ record, onBuildRecord }) {
  return (
    <section className="single-page panel">
      <p className="eyebrow">检修记录</p>
      <h2>{record ? record.record_id : "暂无检修记录"}</h2>
      <p>{record ? record.conclusion : "完成步骤式检修向导后，将在这里生成本次检修记录。"}</p>
      <button className="primary-button" onClick={onBuildRecord}>生成演示记录</button>
    </section>
  );
}

function PlaceholderPage({ title, text }) {
  return (
    <section className="single-page panel">
      <p className="eyebrow">预留页面</p>
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function AssistantChat({ currentStep, diagnosis }) {
  return (
    <aside className="assistant-chat">
      <div className="assistant-head">
        <MessageCircle size={16} />
        <strong>辅助对话</strong>
      </div>
      <div className="assistant-body">
        <p>{diagnosis ? "我可以解释当前诊断结论或步骤依据。" : "先描述现场现象，我会辅助补充信息。"}</p>
        {currentStep && <span>当前步骤：{currentStep.title}</span>}
      </div>
      <div className="assistant-input">
        <input placeholder="追问当前步骤..." />
        <button><Send size={14} /></button>
      </div>
    </aside>
  );
}
