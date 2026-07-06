import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Cpu,
  GitBranch,
  ImagePlus,
  LayoutDashboard,
  Loader2,
  MapPin,
  Menu,
  MessageCircle,
  Send,
  Settings,
  ShieldCheck,
  UserRound,
  Wrench,
  Zap,
} from "lucide-react";
import { api } from "./api/client";
import { defaultInput } from "./data/fallbackDemo";

const navItems = [
  { id: "workbench", label: "工作台", icon: LayoutDashboard },
  { id: "graph", label: "知识图谱", icon: GitBranch },
  { id: "records", label: "检修记录", icon: ClipboardList },
  { id: "settings", label: "设置", icon: Settings },
];

const intakeTasks = [
  {
    title: "描述现场现象",
    value: "温度告警、风扇声音异常",
    detail: "记录一线人员看到的告警、声音、温度和数据上传状态，作为后续诊断输入。",
  },
  {
    title: "补充设备型号",
    value: "研华 ACP-4000 / IPC-610",
    detail: "确认主演示设备为站控柜内工控机整机，不进入 PLC 控制柜完整诊断。",
  },
  {
    title: "确认灯值和阈值",
    value: "TEMP/FAN 告警，风扇转速偏低",
    detail: "重点确认风扇 <500 rpm、系统温度 >55°C、CPU 温度 >70°C 等判断条件。",
  },
  {
    title: "接入信息确认",
    value: "准备触发诊断",
    detail: "确认现场现象、设备型号和阈值信息后，启动多 Agent 分析诊断。",
  },
];

const diagnosisTasks = [
  {
    title: "触发诊断",
    value: "散热异常方向",
    detail: "基于异常接入阶段已确认的信息，启动散热异常方向的预设诊断流程。",
  },
  {
    title: "多 Agent 会诊",
    value: "分析、合规、知识检索",
    detail: "依次完成问题分析、操作合规检查和维修知识检索，形成诊断证据。",
  },
  {
    title: "弹出并生成诊断结论",
    value: "生成整版报告",
    detail: "所有 Agent 完成后，统一输出结构化诊断结论和进入检修向导入口。",
  },
];

const phaseSteps = [
  {
    title: "异常接入",
    items: intakeTasks.map((item) => item.title),
  },
  {
    title: "分析诊断",
    items: diagnosisTasks.map((item) => item.title),
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

const equipmentOptionGroups = [
  {
    label: "设备型号",
    helper: "推荐型号匹配",
    options: ["研华 ACP-4000 / IPC-610", "预留型号选项", "预留型号选项"],
  },
  {
    label: "设备位置",
    helper: "场站位置确认",
    options: ["站控柜 A01 内部工控机", "预留位置选项", "预留位置选项"],
  },
  {
    label: "设备角色",
    helper: "系统角色确认",
    options: ["站控画面与数据采集终端", "预留角色选项", "预留角色选项"],
  },
  {
    label: "关联告警",
    helper: "异常信号确认",
    options: ["TEMP/FAN、蜂鸣、温度升高", "预留告警选项", "预留告警选项"],
  },
];

const thresholdInputs = [
  ["TEMP/FAN LED", "告警", "前面板告警灯点亮或蜂鸣提示"],
  ["风扇转速", "< 500 rpm", "风扇转速偏低，优先检查滤网、风道和风扇"],
  ["系统温度", "> 55°C", "触发散热异常判断"],
  ["CPU 温度", "> 70°C", "结合系统温度判断过热风险"],
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
  const [activeIntakeStep, setActiveIntakeStep] = useState(0);
  const [activeDiagnosisTask, setActiveDiagnosisTask] = useState(0);
  const [evidence, setEvidence] = useState([]);
  const [graph, setGraph] = useState([]);
  const [record, setRecord] = useState(null);
  const [expertReview, setExpertReview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeAgentIndex, setActiveAgentIndex] = useState(-1);
  const [checkedGuideItems, setCheckedGuideItems] = useState({});

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

  const currentStep = steps[activeStep];

  const activePhase = useMemo(() => {
    if (stage === "input") return 0;
    if (stage === "analysis" || stage === "diagnosis") return 1;
    if (stage === "guide") return 2;
    return 3;
  }, [stage]);

  useEffect(() => {
    if (stage !== "analysis" || !diagnosis?.agents?.length) return undefined;

    let index = 0;
    const timers = [];
    setActiveAgentIndex(0);

    function advanceAgent() {
      index += 1;
      if (index < diagnosis.agents.length) {
        setActiveAgentIndex(index);
        timers.push(window.setTimeout(advanceAgent, 3200));
      } else {
        setActiveAgentIndex(diagnosis.agents.length);
        timers.push(window.setTimeout(() => {
          setActiveDiagnosisTask(diagnosisTasks.length - 1);
          setStage("diagnosis");
        }, 700));
      }
    }

    timers.push(window.setTimeout(advanceAgent, 3200));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [diagnosis, stage]);

  async function startDiagnosis() {
    setLoading(true);
    try {
      const result = await api.startDiagnosis(input || defaultInput);
      setDiagnosis(result);
      setSteps(await api.steps());
      setActivePage("workbench");
      setStage("analysis");
      setActiveStep(0);
      setActiveDiagnosisTask(0);
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

  function toggleGuideCheck(stepId, check) {
    setCheckedGuideItems((current) => {
      const checkedSet = new Set(current[stepId] || []);
      if (checkedSet.has(check)) {
        checkedSet.delete(check);
      } else {
        checkedSet.add(check);
      }
      return {
        ...current,
        [stepId]: Array.from(checkedSet),
      };
    });
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
    if (pageId !== "workbench") {
      setStage("input");
    }
  }

  function jumpToPhase(phaseIndex) {
    setActivePage("workbench");
    if (phaseIndex === 0) setStage("input");
    if (phaseIndex === 1 && diagnosis) setStage(stage === "analysis" ? "analysis" : "diagnosis");
    if (phaseIndex === 2 && diagnosis) setStage("guide");
    if (phaseIndex === 3 && record) setStage("record");
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
                  activeStep={activeIntakeStep}
                  onInput={setInput}
                  onSelectStep={setActiveIntakeStep}
                  onStart={startDiagnosis}
                />
              )}
              {stage === "analysis" && diagnosis && (
                <AgentRunStage
                  agents={diagnosis.agents}
                  activeAgentIndex={activeAgentIndex}
                />
              )}
              {stage === "diagnosis" && diagnosis && (
                <DiagnosisStage
                  diagnosis={diagnosis}
                  evidence={evidence}
                  activeTask={activeDiagnosisTask}
                  onSelectTask={setActiveDiagnosisTask}
                  onEnterGuide={enterGuide}
                />
              )}
              {stage === "guide" && currentStep && (
                <GuideStage
                  currentStep={currentStep}
                  activeStep={activeStep}
                  totalSteps={steps.length}
                  checkedItems={checkedGuideItems[currentStep.id] || []}
                  onToggleCheck={(check) => toggleGuideCheck(currentStep.id, check)}
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
              activeIntakeStep={activeIntakeStep}
              stage={stage}
              analysisSubStep={activeDiagnosisTask}
              activeAgentIndex={activeAgentIndex}
              currentStep={currentStep}
              diagnosis={diagnosis}
              onSelectPhase={jumpToPhase}
              onSelectIntake={(index) => {
                setActivePage("workbench");
                setStage("input");
                setActiveIntakeStep(index);
              }}
              onSelectAnalysis={(index) => {
                if (diagnosis) {
                  setActivePage("workbench");
                  setStage("diagnosis");
                  setActiveDiagnosisTask(index);
                }
              }}
              onSelectStep={(index) => {
                if (diagnosis) {
                  setActivePage("workbench");
                  setStage("guide");
                  setActiveStep(index);
                }
              }}
            />
          </section>
        )}
      </main>
    </div>
  );
}

function InputStage({ input, loading, activeStep, onInput, onSelectStep, onStart }) {
  const isLastStep = activeStep === intakeTasks.length - 1;

  return (
    <div className="stage-content input-stage">
      <div className="stage-copy">
        <p className="eyebrow">异常接入 · 第 {activeStep + 1} / {intakeTasks.length} 步</p>
        <h2>{intakeTasks[activeStep].title}</h2>
        <p>{intakeTasks[activeStep].detail}</p>
      </div>

      {activeStep === 0 && (
        <div className="intake-step-screen">
          <textarea
            value={input}
            onChange={(event) => onInput(event.target.value)}
            placeholder="例如：站控柜内工控机温度告警，风扇声音异常，前面板风扇转速很低。"
          />
          <div className="intake-side-note">
            <strong>本步采集</strong>
            <span>现场现象</span>
            <span>告警类型</span>
            <span>图片入口预留</span>
            <button className="ghost-button">
              <ImagePlus size={16} />
              上传图片（预留）
            </button>
          </div>
        </div>
      )}

      {activeStep === 1 && (
        <div className="equipment-option-screen">
          <section className="equipment-option-grid">
            {equipmentOptionGroups.map((group) => (
              <article className="option-group" key={group.label}>
                <label>
                  <span>{group.helper}</span>
                  <strong>{group.label}</strong>
                  <select defaultValue="" aria-label={group.label}>
                    <option value="" disabled>请选择{group.label}</option>
                  {group.options.map((option, index) => (
                    <option value={option} key={`${group.label}-${option}-${index}`}>
                      {option}
                    </option>
                  ))}
                  </select>
                </label>
              </article>
            ))}
          </section>
          <div className="operation-note">
            <strong>确认口径</strong>
            <p>本次演示只诊断站控柜内工控机散热异常，不展开 PLC 控制柜或完整电气系统诊断。</p>
          </div>
        </div>
      )}

      {activeStep === 2 && (
        <div className="threshold-edit-grid">
          {thresholdInputs.map(([label, value, detail]) => (
            <article className="threshold-edit-card" key={label}>
              <span>{label}</span>
              <input defaultValue={value} aria-label={label} />
              <p>{detail}</p>
            </article>
          ))}
        </div>
      )}

      {activeStep === 3 && (
        <div className="intake-summary">
          <section>
            <span>异常描述</span>
            <p>{input || defaultInput}</p>
          </section>
          <section>
            <span>设备型号</span>
            <p>研华 ACP-4000 / IPC-610</p>
          </section>
          <section>
            <span>关键阈值</span>
            <p>TEMP/FAN 告警 · 风扇 &lt;500 rpm · 系统温度 &gt;55°C · CPU 温度 &gt;70°C</p>
          </section>
        </div>
      )}

      <div className="input-toolbar">
        <button
          className="ghost-button"
          onClick={() => onSelectStep(Math.max(0, activeStep - 1))}
          disabled={activeStep === 0}
        >
          <ChevronLeft size={16} />
          上一步
        </button>
        {!isLastStep ? (
          <button
            className="primary-button"
            onClick={() => onSelectStep(Math.min(intakeTasks.length - 1, activeStep + 1))}
          >
            确认并继续 <ChevronRight size={16} />
          </button>
        ) : (
          <button className="primary-button" onClick={onStart} disabled={loading}>
            <Send size={16} />
            {loading ? "诊断中" : "触发诊断"}
          </button>
        )}
      </div>
    </div>
  );
}

function AgentRunStage({ agents, activeAgentIndex }) {
  const messages = [
    "正在解析现场描述、设备型号和故障现象...",
    "正在检索维修指导、阈值和历史知识条目...",
    "正在进行操作合规与安全要求校验...",
  ];
  const progress = Math.min(100, Math.round((Math.max(0, activeAgentIndex) / agents.length) * 100));

  return (
    <div className="stage-content agent-run-stage">
      <div className="stage-copy">
        <p className="eyebrow">分析诊断</p>
        <h2>多 Agent 会诊进行中</h2>
        <p>系统正在按预设演示流程逐项分析。每个 Agent 完成后再进入下一项，全部完成后统一生成诊断结论。</p>
      </div>

      <div className="agent-run-workspace">
        <div className="run-progress-panel">
          <div className="progress-head">
            <strong>诊断执行进度</strong>
            <span>{progress}%</span>
          </div>
          <div className="progress-track">
            <div style={{ width: `${progress}%` }} />
          </div>
          <div className="execution-rail">
            {agents.map((agent, index) => {
              const done = index < activeAgentIndex;
              const running = index === activeAgentIndex;
              return (
                <div className={classNames("rail-step", done && "done", running && "running")} key={agent.name}>
                  <span>{done ? <Check size={14} /> : running ? <Loader2 size={14} className="spin" /> : index + 1}</span>
                  <p>{agent.name}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="agent-run-list">
          {agents.map((agent, index) => {
            const done = index < activeAgentIndex;
            const running = index === activeAgentIndex;
            return (
              <article className={classNames("agent-run-card", done && "done", running && "running")} key={agent.name}>
                <div className="agent-run-status">
                  {done && <Check size={18} />}
                  {running && <Loader2 size={18} className="spin" />}
                  {!done && !running && <span>{index + 1}</span>}
                </div>
                <div>
                  <strong>{agent.name}</strong>
                  <p>{done ? agent.content : running ? messages[index] || "正在分析..." : "等待上一个 Agent 完成"}</p>
                </div>
                <span>{done ? "已完成" : running ? "运行中" : "等待中"}</span>
              </article>
            );
          })}
        </div>
      </div>

      <div className="analysis-waiting">
        <span className="pulse-dot" />
        <p>{activeAgentIndex >= agents.length ? "会诊完成，正在生成整版诊断结论..." : "请稍候，系统正在组织诊断依据。"}</p>
      </div>
    </div>
  );
}

function DiagnosisStage({ diagnosis, evidence, activeTask, onSelectTask, onEnterGuide }) {
  const rankedCauses = [
    ["风道堵塞 / 滤网积尘", "优先级高", "现象与风扇声音异常、转速偏低、高温告警相符。"],
    ["风扇低速或停转", "优先级高", "需核对转速是否低于 500 rpm，并检查 FAN1/FAN2 接线顺序。"],
    ["机柜环境温度或通风条件异常", "待确认", "需确认环境温度是否超过 40°C，进出风口是否被遮挡。"],
  ];
  const isLastTask = activeTask === diagnosisTasks.length - 1;

  return (
    <div className="stage-content diagnosis-stage">
      <div className="stage-copy">
        <p className="eyebrow">分析诊断 · 第 {activeTask + 1} / {diagnosisTasks.length} 步</p>
        <h2>{diagnosisTasks[activeTask].title}</h2>
        <p>{diagnosisTasks[activeTask].detail}</p>
      </div>

      {activeTask === 0 && (
        <div className="diagnosis-step-screen">
          <section className="conclusion-card">
            <div>
              <span className="status-badge">已接收异常接入信息</span>
              <h3>散热异常诊断已触发</h3>
              <p>系统将基于设备型号、灯值阈值和现场现象进入预设多 Agent 会诊流程。</p>
            </div>
            <AlertTriangle size={26} />
          </section>
          <section className="handoff-grid">
            <article><span>设备</span><strong>研华 ACP-4000 / IPC-610</strong></article>
            <article><span>故障方向</span><strong>TEMP/FAN 与高温告警</strong></article>
            <article><span>诊断边界</span><strong>站控柜内工控机散热系统</strong></article>
          </section>
        </div>
      )}

      {activeTask === 1 && (
        <div className="diagnosis-step-screen">
          <section className="agent-strip">
            {diagnosis.agents.map((agent) => (
              <article key={agent.name}>
                <span>已完成</span>
                <strong>{agent.name}</strong>
                <p>{agent.content}</p>
              </article>
            ))}
          </section>

          <section className="evidence-row">
            {evidence.slice(0, 4).map((item) => (
              <article key={item.id}>
                <span>{item.id}</span>
                <strong>{item.title}</strong>
              </article>
            ))}
          </section>
        </div>
      )}

      {activeTask === 2 && (
        <div className="diagnosis-step-screen final-report">
          <section className="conclusion-card">
            <div>
              <span className="status-badge">建议进入检修向导</span>
              <h3>{diagnosis.title}</h3>
              <p>{diagnosis.summary}</p>
              <p>{diagnosis.risk}</p>
            </div>
            <AlertTriangle size={26} />
          </section>

          <section className="cause-ranking">
            <h3>可能原因排序</h3>
            {rankedCauses.map(([name, level, detail]) => (
              <article key={name}>
                <span>{level}</span>
                <strong>{name}</strong>
                <p>{detail}</p>
              </article>
            ))}
          </section>
        </div>
      )}

      <div className="stage-actions">
        <button
          className="ghost-button"
          onClick={() => onSelectTask(Math.max(0, activeTask - 1))}
          disabled={activeTask === 0}
        >
          <ChevronLeft size={16} />
          上一步
        </button>
        {!isLastTask ? (
          <button
            className="primary-button"
            onClick={() => onSelectTask(Math.min(diagnosisTasks.length - 1, activeTask + 1))}
          >
            确认并继续 <ChevronRight size={16} />
          </button>
        ) : (
          <button className="primary-button" onClick={onEnterGuide}>
            进入步骤式检修向导 <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function GuideStage({
  currentStep,
  activeStep,
  totalSteps,
  checkedItems,
  onToggleCheck,
  onPrev,
  onNext,
  onRecord,
}) {
  const completedChecks = currentStep.checks.filter((check) => checkedItems.includes(check)).length;
  const allChecksDone = completedChecks === currentStep.checks.length;
  const checkProgress = Math.round((completedChecks / currentStep.checks.length) * 100);

  return (
    <div className="stage-content guide-stage">
      <div className="stage-copy">
        <p className="eyebrow">检修向导 · 第 {activeStep + 1} / {totalSteps} 步</p>
        <h2>{currentStep.title}</h2>
        <p>{currentStep.description}</p>
      </div>
      <div className="guide-progress">
        <div className="progress-head">
          <strong>本步确认进度</strong>
          <span>{completedChecks} / {currentStep.checks.length}</span>
        </div>
        <div className="progress-track">
          <div style={{ width: `${checkProgress}%` }} />
        </div>
      </div>
      <div className="guide-screen">
        <div className="image-placeholder">
          <Cpu size={34} />
          <strong>图片待补充</strong>
          <span>{currentStep.placeholder}</span>
        </div>
        <div className="guide-info">
          <div>
            <strong>检查项 · {completedChecks} / {currentStep.checks.length}</strong>
            <div className="check-step-list">
              {currentStep.checks.map((check, index) => (
                <button
                  key={check}
                  className={classNames("check-step-item", checkedItems.includes(check) && "checked")}
                  onClick={() => onToggleCheck(check)}
                >
                  <span>{checkedItems.includes(check) ? <Check size={16} /> : index + 1}</span>
                  <p>{check}</p>
                </button>
              ))}
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
        <button className="primary-button" onClick={onNext} disabled={!allChecksDone}>
          完成并继续 <ChevronRight size={16} />
        </button>
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

function isAnalysisStepActive(stage, index, activeAgentIndex, analysisSubStep) {
  if (stage === "analysis") {
    if (index === 0) return activeAgentIndex < 0;
    if (index === 1) return activeAgentIndex >= 0;
    return false;
  }
  if (stage === "diagnosis") return index === analysisSubStep;
  return false;
}

function isAnalysisStepDone(stage, activePhase, index, activeAgentIndex, analysisSubStep) {
  if (activePhase > 1) return true;
  if (stage === "analysis") {
    if (index === 0) return activeAgentIndex >= 0;
    return false;
  }
  if (stage === "diagnosis") return index < analysisSubStep;
  return false;
}

function getAnalysisStepStatus(stage, activePhase, index, activeAgentIndex, analysisSubStep) {
  if (isAnalysisStepDone(stage, activePhase, index, activeAgentIndex, analysisSubStep)) return "已完成";
  if (isAnalysisStepActive(stage, index, activeAgentIndex, analysisSubStep)) {
    return stage === "analysis" && index === 1 ? "运行中" : "当前";
  }
  return "待处理";
}

function getIntakeStepStatus(activePhase, stage, index, activeIntakeStep) {
  if (activePhase > 0) return "已完成";
  if (stage === "input" && index === activeIntakeStep) return "当前";
  if (stage === "input" && index < activeIntakeStep) return "已完成";
  return "待处理";
}

function getVisiblePhaseLimit(stage) {
  if (stage === "input") return 0;
  if (stage === "analysis") return 1;
  if (stage === "diagnosis" || stage === "guide") return 2;
  return 3;
}

function RightStepPanel({
  activePhase,
  steps,
  activeStep,
  activeIntakeStep,
  stage,
  analysisSubStep,
  activeAgentIndex,
  currentStep,
  diagnosis,
  onSelectPhase,
  onSelectIntake,
  onSelectAnalysis,
  onSelectStep,
}) {
  const visiblePhaseLimit = getVisiblePhaseLimit(stage);
  const visiblePhaseSteps = phaseSteps.slice(0, visiblePhaseLimit + 1);

  return (
    <aside className="right-step-panel">
      <section className="flow-box">
        <div className="section-heading compact">
          <h2>诊断流程</h2>
          <span>已生成 {visiblePhaseSteps.length}</span>
        </div>
        <div className="flow-generation-note">
          {visiblePhaseLimit === 0 && "请先完成异常接入，系统将生成后续诊断流程。"}
          {visiblePhaseLimit === 1 && "已根据异常信息生成分析诊断流程。"}
          {visiblePhaseLimit === 2 && "已根据诊断结论生成检修向导。"}
          {visiblePhaseLimit === 3 && "检修记录与知识回流流程已生成。"}
        </div>
        <div className="phase-list">
          {visiblePhaseSteps.map((phase, phaseIndex) => (
            <div className={classNames("phase-item", phaseIndex === activePhase && "active", phaseIndex < activePhase && "done")} key={phase.title}>
              <button className="phase-title" onClick={() => onSelectPhase(phaseIndex)}>
                <span>{phaseIndex < activePhase ? <Check size={14} /> : phaseIndex + 1}</span>
                <strong>{phase.title}</strong>
              </button>
              <div className="sub-step-list">
                {phaseIndex === 0 ? (
                  phase.items.map((item, index) => (
                    <button
                      className={classNames(
                        "sub-step",
                        stage === "input" && index === activeIntakeStep && "active",
                        getIntakeStepStatus(activePhase, stage, index, activeIntakeStep) === "已完成" && "done"
                      )}
                      key={`${item}-${index}`}
                      onClick={() => onSelectIntake(index)}
                    >
                      {getIntakeStepStatus(activePhase, stage, index, activeIntakeStep)} · {item}
                    </button>
                  ))
                ) : phaseIndex === 1 ? (
                  diagnosisTasks.map((task, index) => (
                    <button
                      key={task.title}
                      className={classNames(
                        "sub-step",
                        isAnalysisStepActive(stage, index, activeAgentIndex, analysisSubStep) && "active",
                        isAnalysisStepDone(stage, activePhase, index, activeAgentIndex, analysisSubStep) && "done"
                      )}
                      onClick={() => onSelectAnalysis(index)}
                    >
                      {getAnalysisStepStatus(stage, activePhase, index, activeAgentIndex, analysisSubStep)} · {task.title}
                    </button>
                  ))
                ) : phaseIndex === 2 && steps.length > 0 ? (
                  steps.map((step, index) => (
                    <button
                      key={step.id}
                      className={classNames("sub-step", stage === "guide" && index === activeStep && "active", step.completed && "done")}
                      onClick={() => onSelectStep(index)}
                    >
                      {step.completed ? "已完成" : stage === "guide" && index === activeStep ? "当前" : `步骤 ${index + 1}`} · {step.title}
                    </button>
                  ))
                ) : (
                  phase.items.map((item, index) => (
                    <span className={classNames("sub-step", phaseIndex < activePhase && "done")} key={`${item}-${index}`}>
                      {phaseIndex < activePhase ? "已完成" : "待处理"} · {item}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      <AssistantChat currentStep={currentStep} diagnosis={diagnosis} />
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
