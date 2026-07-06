import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  ClipboardList,
  Cpu,
  Database,
  FileText,
  GitBranch,
  MapPin,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
  Zap,
} from "lucide-react";
import { api } from "./api/client";
import { defaultInput } from "./data/fallbackDemo";

const flow = [
  "现场描述",
  "信息补充",
  "知识检索与会诊",
  "诊断结论生成",
  "作业卡生成",
  "专家审核回流",
];

function classNames(...items) {
  return items.filter(Boolean).join(" ");
}

export default function App() {
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

  const activeFlowIndex = useMemo(() => {
    if (expertReview) return 5;
    if (record) return 4;
    if (completedCount > 0) return 3;
    if (diagnosis) return 2;
    return 1;
  }, [completedCount, diagnosis, expertReview, record]);

  async function triggerDiagnosis(usePreset = false) {
    setLoading(true);
    try {
      const result = await api.startDiagnosis(usePreset ? defaultInput : input);
      setDiagnosis(result);
      const latestSteps = await api.steps();
      setSteps(latestSteps);
      setActiveStep(0);
    } finally {
      setLoading(false);
    }
  }

  async function completeCurrentStep() {
    if (!currentStep) return;
    await api.completeStep(currentStep.id);
    const latestSteps = await api.steps();
    setSteps(latestSteps);
    if (activeStep < latestSteps.length - 1) {
      setActiveStep(activeStep + 1);
    }
  }

  async function buildRecord() {
    const result = await api.generateRecord();
    setRecord(result);
  }

  async function approveExpertReview() {
    const result = await api.expertReview();
    setExpertReview(result);
    const refreshed = await api.startDiagnosis(input);
    setDiagnosis(refreshed);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">
          <Zap size={22} />
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          <button className="nav-icon active" title="智能诊断台">
            <Sparkles size={20} />
          </button>
          <button className="nav-icon" title="检修记录">
            <ClipboardList size={20} />
          </button>
          <button className="nav-icon" title="知识库">
            <BookOpen size={20} />
          </button>
          <button className="nav-icon" title="知识图谱">
            <GitBranch size={20} />
          </button>
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">站控慧眼</p>
            <h1>智能诊断台</h1>
          </div>
          <div className="topbar-meta">
            <span><MapPin size={16} /> {scenario?.site || "某输气场站"} · {scenario?.cabinet || "站控柜 A01"}</span>
            <span><UserRound size={16} /> 一线检修人员</span>
            <span className={classNames("health-pill", health === "后端已连接" && "ok")}>
              {health}
            </span>
          </div>
        </header>

        <section className="content-grid">
          <div className="main-column">
            <section className="panel diagnosis-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">异常输入</p>
                  <h2>现场描述</h2>
                </div>
                <button className="ghost-button" onClick={() => triggerDiagnosis(true)} disabled={loading}>
                  一键触发主演示异常
                </button>
              </div>

              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="请输入现场现象或补充信息..."
              />

              <div className="input-actions">
                <span className="reserved-action">图片入口已预留</span>
                <span className="reserved-action">语音播报模拟</span>
                <button className="primary-button" onClick={() => triggerDiagnosis(false)} disabled={loading}>
                  <Send size={16} />
                  {loading ? "生成中" : "生成诊断摘要"}
                </button>
              </div>
            </section>

            {diagnosis && (
              <section className="panel summary-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">诊断摘要</p>
                    <h2>{diagnosis.title}</h2>
                  </div>
                  {diagnosis.expert_review_applied && (
                    <span className="review-tag">专家修正 · 已审核</span>
                  )}
                </div>
                <p className="summary-text">{diagnosis.summary}</p>
                <div className="risk-box">
                  <AlertTriangle size={18} />
                  <span>{diagnosis.risk}</span>
                </div>
                {diagnosis.expert_review && (
                  <div className="expert-note">
                    <ShieldCheck size={18} />
                    <span>{diagnosis.expert_review.content}</span>
                  </div>
                )}
                <div className="agent-grid">
                  {diagnosis.agents.map((agent) => (
                    <article className="agent-card" key={agent.name}>
                      <span>{agent.status}</span>
                      <h3>{agent.name}</h3>
                      <p>{agent.content}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {diagnosis && currentStep && (
              <section className="panel guide-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">步骤式检修向导</p>
                    <h2>{currentStep.order}. {currentStep.title}</h2>
                  </div>
                  <span className="progress-text">{completedCount} / {steps.length} 已完成</span>
                </div>

                <div className="guide-layout">
                  <div className="step-list">
                    {steps.map((step, index) => (
                      <button
                        key={step.id}
                        className={classNames(
                          "step-item",
                          index === activeStep && "active",
                          step.completed && "done"
                        )}
                        onClick={() => setActiveStep(index)}
                      >
                        <span>{step.completed ? <Check size={16} /> : step.order}</span>
                        {step.title}
                      </button>
                    ))}
                  </div>

                  <div className="step-detail">
                    <div className="image-placeholder">
                      <Cpu size={30} />
                      <strong>图片待补充</strong>
                      <span>{currentStep.placeholder}</span>
                    </div>
                    <p>{currentStep.description}</p>
                    <div className="chips">
                      {currentStep.checks.map((check) => <span key={check}>{check}</span>)}
                    </div>
                    {currentStep.thresholds.length > 0 && (
                      <div className="threshold-box">
                        <Activity size={18} />
                        <div>
                          <strong>判断阈值</strong>
                          <p>{currentStep.thresholds.join(" · ")}</p>
                        </div>
                      </div>
                    )}
                    <div className="safety-box">
                      <ShieldCheck size={18} />
                      <div>
                        <strong>安全提醒</strong>
                        <p>{currentStep.safety}</p>
                      </div>
                    </div>
                    <p className="source-line">来源依据：{currentStep.source}</p>
                    <div className="guide-actions">
                      <button className="ghost-button" onClick={() => setActiveStep(Math.max(0, activeStep - 1))}>
                        上一步
                      </button>
                      <button className="primary-button" onClick={completeCurrentStep}>
                        标记完成 <ChevronRight size={16} />
                      </button>
                      <button className="ghost-button" onClick={buildRecord}>
                        生成检修记录
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section className="lower-grid">
              <EvidencePanel evidence={evidence} />
              <GraphPanel graph={graph} />
            </section>
          </div>

          <aside className="side-column">
            <section className="panel flow-panel">
              <h2>诊断流程</h2>
              <div className="flow-list">
                {flow.map((item, index) => (
                  <div className={classNames("flow-item", index <= activeFlowIndex && "active")} key={item}>
                    <span>{index < activeFlowIndex ? <Check size={15} /> : index + 1}</span>
                    <div>
                      <strong>{item}</strong>
                      <p>{index < activeFlowIndex ? "已完成" : index === activeFlowIndex ? "进行中" : "待生成"}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {record && (
              <section className="panel record-panel">
                <div className="section-heading compact">
                  <h2>检修记录</h2>
                  <FileText size={18} />
                </div>
                <p>{record.record_id}</p>
                <strong>{record.equipment}</strong>
                <span>{record.fault}</span>
                <div className="record-stats">
                  <span>{record.completed_steps.length} 个步骤完成</span>
                  <span>{record.expert_status}</span>
                </div>
                <p className="muted">{record.conclusion}</p>
                <button className="ghost-button full" onClick={() => window.print()}>
                  浏览器打印作业卡
                </button>
              </section>
            )}

            <section className="panel expert-panel">
              <div className="section-heading compact">
                <h2>专家审核</h2>
                <Wrench size={18} />
              </div>
              <p>沙尘环境下，站控柜工控机滤网维护周期应从季度检查缩短为月度检查。</p>
              <button className="primary-button full" onClick={approveExpertReview}>
                审核通过并回流
              </button>
              {expertReview && <span className="review-tag">{expertReview.tag}</span>}
            </section>
          </aside>
        </section>
      </main>
    </div>
  );
}

function EvidencePanel({ evidence }) {
  return (
    <section className="panel evidence-panel">
      <div className="section-heading compact">
        <h2>证据卡片</h2>
        <Database size={18} />
      </div>
      <div className="evidence-list">
        {evidence.slice(0, 6).map((item) => (
          <article key={item.id}>
            <span>{item.id}</span>
            <strong>{item.title}</strong>
            <p>{item.step}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function GraphPanel({ graph }) {
  return (
    <section className="panel graph-panel">
      <div className="section-heading compact">
        <h2>知识图谱子图</h2>
        <GitBranch size={18} />
      </div>
      <div className="graph-list">
        {graph.slice(0, 7).map((edge, index) => (
          <div key={`${edge.source}-${edge.target}-${index}`}>
            <strong>{edge.source}</strong>
            <span>{edge.relation}</span>
            <strong>{edge.target}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
