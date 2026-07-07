import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Cpu,
  Download,
  FileText,
  GitBranch,
  ImagePlus,
  LayoutDashboard,
  Loader2,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Mic,
  Paperclip,
  Search,
  Send,
  Settings,
  ShieldCheck,
  UserRound,
  Video,
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
    detail: "请描述现场看到的异常现象，系统将整理为诊断输入。",
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
  ["TEMP/FAN LED", "告警", "保留告警状态", "前面板告警灯点亮或蜂鸣提示"],
  ["风扇转速", "< 500 rpm", "建议作为高优先级条件", "风扇转速偏低，优先检查滤网、风道和风扇"],
  ["系统温度", "> 55°C", "触发散热异常判断", "触发散热异常判断"],
  ["CPU 温度", "> 70°C", "判断过热风险", "结合系统温度判断过热风险"],
];

const generatedDiagnosisPlan = [
  "解析现场异常描述与告警信号",
  "匹配 ACP-4000 / IPC-610 散热结构",
  "检索 TEMP/FAN、风扇转速和温度阈值",
  "生成散热异常诊断结论与检修向导",
];

const quickPrompts = [
  "工控机高温告警怎么办？",
  "PLC 通信中断如何排查？",
  "电源模块指示灯异常",
  "滤网堵塞如何处理？",
];

const modalityActions = [
  { label: "添加材料", icon: Paperclip },
  { label: "图片", icon: ImagePlus },
  { label: "视频", icon: Video },
];

const defaultUser = {
  name: "李师傅",
  role: "一线检修人员",
  site: "某输气场站",
  team: "站控运维一班",
};

function classNames(...items) {
  return items.filter(Boolean).join(" ");
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(defaultUser);
  const [navOpen, setNavOpen] = useState(false);
  const [activePage, setActivePage] = useState("workbench");
  const [stage, setStage] = useState("home");
  const [health, setHealth] = useState("连接中");
  const [scenario, setScenario] = useState(null);
  const [homeDraft, setHomeDraft] = useState("");
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
  const [intakeSelections, setIntakeSelections] = useState({});
  const [thresholdValues, setThresholdValues] = useState(
    Object.fromEntries(thresholdInputs.map(([label, value]) => [label, value]))
  );
  const [autoRecognizing, setAutoRecognizing] = useState(false);
  const [autoRecognized, setAutoRecognized] = useState(false);

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
    if (stage === "home") return 0;
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

  function updateIntakeSelection(label, value) {
    setIntakeSelections((current) => ({ ...current, [label]: value }));
  }

  function autoFillIntakeSelections() {
    setAutoRecognizing(true);
    window.setTimeout(() => {
      setIntakeSelections(Object.fromEntries(equipmentOptionGroups.map((group) => [group.label, group.options[0]])));
      setAutoRecognizing(false);
      setAutoRecognized(true);
    }, 850);
  }

  function updateThresholdValue(label, value) {
    setThresholdValues((current) => ({ ...current, [label]: value }));
  }

  function applyThresholdSuggestion(label, value) {
    setThresholdValues((current) => ({ ...current, [label]: value }));
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
    if (pageId === "workbench" && !diagnosis && !record && stage !== "input") {
      setStage("home");
    }
  }

  function enterIntakeFromHome(value = homeDraft) {
    const nextInput = value.trim() || defaultInput;
    setInput(nextInput);
    setActivePage("workbench");
    setStage("input");
    setActiveIntakeStep(0);
  }

  function jumpToPhase(phaseIndex) {
    setActivePage("workbench");
    if (phaseIndex === 0) setStage(stage === "home" ? "home" : "input");
    if (phaseIndex === 1 && diagnosis) setStage(stage === "analysis" ? "analysis" : "diagnosis");
    if (phaseIndex === 2 && diagnosis) setStage("guide");
    if (phaseIndex === 3 && record) setStage("record");
  }

  function handleLogin(user) {
    setCurrentUser(user);
    setIsAuthenticated(true);
    setActivePage("workbench");
    setStage("home");
  }

  function handleLogout() {
    setIsAuthenticated(false);
    setActivePage("workbench");
    setStage("home");
    setHomeDraft("");
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
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
            <h1>
              {activePage === "graph"
                ? "知识图谱"
                : activePage === "records"
                  ? "检修记录"
                : activePage === "settings"
                  ? "设置"
                  : stage === "home"
                    ? "智能诊断入口"
                    : "智能诊断台"}
            </h1>
          </div>
          <div className="topbar-meta">
            <span><MapPin size={16} /> {currentUser.site || scenario?.site || "某输气场站"} · {currentUser.team}</span>
            <span><UserRound size={16} /> {currentUser.name} · {currentUser.role}</span>
            <span className={classNames("health-pill", health === "后端已连接" && "ok")}>{health}</span>
            <button className="topbar-logout" onClick={handleLogout} title="退出登录">
              <LogOut size={15} />
              退出
            </button>
          </div>
        </header>

        {activePage === "graph" ? (
          <KnowledgeGraphPage graph={graph} evidence={evidence} />
        ) : activePage === "records" ? (
          <RecordPage record={record} onBuildRecord={buildRecord} />
        ) : activePage === "settings" ? (
          <SettingsPage currentUser={currentUser} onSave={setCurrentUser} />
        ) : stage === "home" ? (
          <HomeStage
            draft={homeDraft}
            userName={currentUser.name}
            onDraft={setHomeDraft}
            onSubmit={() => enterIntakeFromHome()}
            onQuickPrompt={(prompt) => setHomeDraft(prompt)}
            onUseQuickPrompt={enterIntakeFromHome}
          />
        ) : (
          <section className="stage-layout">
            <div className="stage-card">
              {stage === "input" && (
                <InputStage
                  input={input}
                  loading={loading}
                  activeStep={activeIntakeStep}
                  selections={intakeSelections}
                  thresholdValues={thresholdValues}
                  autoRecognizing={autoRecognizing}
                  autoRecognized={autoRecognized}
                  onInput={setInput}
                  onAutoFill={autoFillIntakeSelections}
                  onSelectionChange={updateIntakeSelection}
                  onThresholdChange={updateThresholdValue}
                  onApplyThresholdSuggestion={applyThresholdSuggestion}
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

function LoginPage({ onLogin }) {
  const [account, setAccount] = useState("lishifu");
  const [password, setPassword] = useState("");

  function submitLogin(event) {
    event.preventDefault();
    onLogin(defaultUser);
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-brand">
          <div className="brand-mark static">
            <Zap size={24} />
          </div>
          <div>
            <p className="eyebrow">站控慧眼</p>
            <h1>工控设备检修助手</h1>
          </div>
        </div>

        <form className="login-form" onSubmit={submitLogin}>
          <label className="login-field">
            <span>账号</span>
            <input
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              placeholder="请输入账号"
              autoComplete="username"
            />
          </label>
          <label className="login-field">
            <span>密码</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              type="password"
              autoComplete="current-password"
            />
          </label>

          <button className="login-submit" type="submit">
            登录
            <ChevronRight size={18} />
          </button>
        </form>
      </section>
    </main>
  );
}

function HomeStage({ draft, userName, onDraft, onSubmit, onQuickPrompt, onUseQuickPrompt }) {
  return (
    <section className="home-stage">
      <div className="home-copy">
        <p className="eyebrow">智能诊断入口</p>
        <h2>早上好{userName}</h2>
        <p>描述现场现象，系统会先整理异常信息，再进入步骤式诊断流程。</p>
      </div>

      <div className="home-console">
        <div className="home-input-box">
          <textarea
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            placeholder="描述现场现象，例如：工控机温度告警、风扇声音异常、前面板风扇转速很低..."
          />
          <div className="home-input-actions">
            <div className="home-tools">
              {modalityActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button key={action.label} type="button" title={action.label}>
                    <Icon size={16} />
                    <span>{action.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="home-submit-actions">
              <button className="home-voice-button" type="button" aria-label="语音输入" title="语音输入">
                <Mic size={18} />
              </button>
              <button className="home-send-button" onClick={onSubmit} aria-label="开始异常接入">
                <Send size={19} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="quick-prompt-area">
        <span>或试试这些常见问题</span>
        <div>
          {quickPrompts.map((prompt, index) => (
            <button
              key={prompt}
              onClick={() => {
                onQuickPrompt(prompt);
                if (index === 0) onUseQuickPrompt(prompt);
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function InputStage({
  input,
  loading,
  activeStep,
  selections,
  thresholdValues,
  autoRecognizing,
  autoRecognized,
  onInput,
  onAutoFill,
  onSelectionChange,
  onThresholdChange,
  onApplyThresholdSuggestion,
  onSelectStep,
  onStart,
}) {
  const isLastStep = activeStep === intakeTasks.length - 1;
  const selectedValues = equipmentOptionGroups.map((group) => selections[group.label]).filter(Boolean);

  return (
    <div className="stage-content input-stage">
      <div className="stage-copy">
        <p className="eyebrow">异常接入 · 第 {activeStep + 1} / {intakeTasks.length} 步</p>
        <h2>{intakeTasks[activeStep].title}</h2>
        <p>{intakeTasks[activeStep].detail}</p>
      </div>

      {activeStep === 0 && (
        <div className="intake-step-screen">
          <section className="symptom-input-card">
            <textarea
              value={input}
              onChange={(event) => onInput(event.target.value)}
              placeholder="例如：站控柜内工控机温度告警，风扇声音异常，前面板风扇转速很低。"
            />
            <section className="intake-collection-card">
              <strong>本步采集</strong>
              <span>现场描述</span>
              <span>告警状态</span>
              <span>设备声音</span>
              <span>现场材料</span>
            </section>
          </section>
          <div className="intake-side-note primary-visual">
            <section className="site-location-card">
              <div className="section-heading compact">
                <h3>位置提示</h3>
                <span>系统识别</span>
              </div>
              <div className="site-map-preview">
                <div className="cabinet-outline primary" />
                <div className="cabinet-outline secondary" />
                <div className="location-pulse" />
                <div className="location-label">
                  <strong>站控柜 A01</strong>
                  <span>工控机区域</span>
                </div>
              </div>
              <p>后续诊断将优先围绕该区域组织检修步骤。</p>
            </section>
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
                  <select
                    value={selections[group.label] || ""}
                    aria-label={group.label}
                    onChange={(event) => onSelectionChange(group.label, event.target.value)}
                  >
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
            <strong>自动识别</strong>
            <p>根据现场描述模拟识别设备型号、位置、角色和关联告警。</p>
            <button className="primary-button" onClick={onAutoFill} disabled={autoRecognizing}>
              {autoRecognizing ? <Loader2 size={16} className="spin" /> : <Zap size={16} />}
              {autoRecognizing ? "识别中" : "自动识别并补充"}
            </button>
            <div className="recognized-panel">
              <span>{autoRecognized ? "已识别" : "待识别"}</span>
              {selectedValues.length > 0 ? (
                selectedValues.map((value) => <p key={value}>{value}</p>)
              ) : (
                <p>暂无补充项，请手动选择或点击自动识别。</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeStep === 2 && (
        <div className="threshold-edit-grid">
          {thresholdInputs.map(([label, value, suggestion, detail]) => (
            <article className="threshold-edit-card" key={label}>
              <span>{label}</span>
              <input
                value={thresholdValues[label] || ""}
                aria-label={label}
                onChange={(event) => onThresholdChange(label, event.target.value)}
              />
              <div className="suggestion-line">
                <small>系统建议：{suggestion}</small>
                <button onClick={() => onApplyThresholdSuggestion(label, value)}>采用建议值</button>
              </div>
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
            <p>{selections["设备型号"] || "待选择"}</p>
          </section>
          <section>
            <span>关键阈值</span>
            <p>{Object.entries(thresholdValues).map(([label, value]) => `${label} ${value}`).join(" · ")}</p>
          </section>
          <section>
            <span>系统将生成的诊断任务</span>
            <div className="generated-task-list">
              {generatedDiagnosisPlan.map((task) => (
                <p key={task}><Check size={14} /> {task}</p>
              ))}
            </div>
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
  const streamedItems = [
    ["读取现场描述：温度告警、风扇声音异常、前面板风扇转速偏低。", "识别设备上下文：ACP-4000 / IPC-610 工控机。", "初步判断进入散热异常诊断路径。"],
    ["检索 KB-001：ACP-4000 / IPC-610 散热系统结构。", "命中 KB-003：风扇 <500 rpm 告警阈值。", "命中 KB-004：系统温度与 CPU 温度判断条件。"],
    ["校验操作前置条件：断电、挂牌、防静电。", "确认拆检顺序：风道、滤网、风扇、恢复验证。", "形成可进入检修向导的安全边界。"],
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
                  {running && (
                    <div className="stream-lines">
                      {(streamedItems[index] || []).map((item, lineIndex) => (
                        <span style={{ animationDelay: `${lineIndex * 520}ms` }} key={item}>{item}</span>
                      ))}
                    </div>
                  )}
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
  const [selectedNode, setSelectedNode] = useState("工控机");
  const graphNodes = [
    { name: "输气场站", type: "场景", detail: "油气管道场站业务环境，包含站控柜与现场运维对象。", position: [12, 46] },
    { name: "站控柜", type: "设备容器", detail: "站控柜 A01，承载工控机及相关监控设备。", position: [28, 28] },
    { name: "工控机", type: "核心设备", detail: "研华 ACP-4000 / IPC-610 工控机，本次散热异常诊断对象。", position: [45, 46] },
    { name: "高温告警", type: "故障现象", detail: "由 TEMP/FAN、系统温度、CPU 温度等信号共同触发的异常现象。", position: [62, 24] },
    { name: "风道堵塞", type: "可能原因", detail: "进出风道被遮挡或积尘导致散热效率下降。", position: [76, 43] },
    { name: "滤网积尘", type: "可能原因", detail: "门滤网或风扇滤网积尘，导致进风阻力增大。", position: [64, 68] },
    { name: "风扇异常", type: "可能原因", detail: "风扇低速、停转、异响或 FAN1/FAN2 接线异常。", position: [40, 72] },
    { name: "恢复验证", type: "检修闭环", detail: "完成清理和恢复后，连续观察告警、温度、风扇转速和数据上传。", position: [84, 68] },
  ];
  const activeNode = graphNodes.find((node) => node.name === selectedNode) || graphNodes[2];
  const relatedEdges = graph.filter((edge) => edge.source === selectedNode || edge.target === selectedNode);
  const relatedKeywords = new Set([selectedNode, ...relatedEdges.flatMap((edge) => [edge.source, edge.target])]);
  const relatedEvidence = evidence.filter((item) => {
    const text = `${item.title} ${item.step}`;
    return Array.from(relatedKeywords).some((keyword) => text.includes(keyword) || keyword.includes("工控机"));
  });
  const visibleEvidence = relatedEvidence.length > 0 ? relatedEvidence : evidence.slice(0, 4);

  return (
    <section className="graph-page">
      <div className="graph-canvas panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">知识图谱</p>
            <h2>工控机散热异常子图</h2>
          </div>
          <span className="health-pill ok">{graph.length} 条关系</span>
        </div>
        <div className="node-map">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points="12,46 28,28 45,46 62,24 76,43" />
            <polyline points="45,46 64,68 84,68" />
            <polyline points="45,46 40,72" />
          </svg>
          {graphNodes.map((node) => (
            <button
              key={node.name}
              className={classNames(
                "graph-node",
                node.type === "故障现象" && "danger-node",
                selectedNode === node.name && "active"
              )}
              style={{ left: `${node.position[0]}%`, top: `${node.position[1]}%` }}
              onClick={() => setSelectedNode(node.name)}
            >
              <span>{node.type}</span>
              {node.name}
            </button>
          ))}
        </div>
        <div className="graph-legend">
          <span>场景</span>
          <span>设备</span>
          <span>故障</span>
          <span>原因</span>
          <span>验证</span>
        </div>
      </div>
      <aside className="panel graph-side">
        <div className="node-detail-card">
          <p className="eyebrow">当前节点</p>
          <h2>{activeNode.name}</h2>
          <span>{activeNode.type}</span>
          <p>{activeNode.detail}</p>
        </div>
        <div className="relation-list">
          <div className="section-heading compact">
            <h3>关联关系</h3>
            <span>{relatedEdges.length} 条</span>
          </div>
          {(relatedEdges.length > 0 ? relatedEdges : graph.slice(0, 6)).map((edge, index) => (
            <div className="relation-row" key={`${edge.source}-${edge.target}-${index}`}>
              <strong>{edge.source}</strong>
              <span>{edge.relation}</span>
              <strong>{edge.target}</strong>
            </div>
          ))}
        </div>
        <div className="evidence-mini">
          <div className="section-heading compact">
            <h3>知识条目</h3>
            <span>{visibleEvidence.length} 条</span>
          </div>
          {visibleEvidence.map((item) => (
            <article key={item.id}>
              <span>{item.id}</span>
              <strong>{item.title}</strong>
              <p>{item.step}</p>
            </article>
          ))}
        </div>
      </aside>
    </section>
  );
}

function RecordPage({ record, onBuildRecord }) {
  const generatedRecord = record && {
    id: record.record_id,
    title: "站控柜 A01 工控机散热异常检修",
    equipment: record.equipment,
    fault: record.fault,
    status: record.expert_status,
    time: "今天 10:42",
    maintainer: "李师傅",
    duration: "42 分钟",
    conclusion: record.conclusion,
    tags: ["本次流程", "待归档"],
    checks: [
      `已完成 ${record.completed_steps.length || 0} 项检修步骤`,
      record.safety_confirmed ? "安全条件已确认" : "安全确认待补充",
      "支持打印作业卡和提交专家审核",
    ],
  };
  const records = [
    generatedRecord,
    {
      id: "REC-ACP4000-HIS-001",
      title: "站控柜 A01 工控机散热异常检修",
      equipment: "研华 ACP-4000 / IPC-610",
      fault: "TEMP/FAN 告警、风扇转速偏低",
      status: "已审核",
      time: "2026-07-04 09:36",
      maintainer: "李师傅",
      duration: "38 分钟",
      conclusion: "清理滤网和前面板风道后，风扇转速恢复，系统温度下降，告警解除。",
      tags: ["散热异常", "已回流知识库"],
      checks: ["完成断电挂牌与防静电确认", "完成滤网清理和风道检查", "恢复上电后连续观察 15 分钟"],
    },
    {
      id: "REC-IPC610-20260703",
      title: "站控工控机风扇异响排查",
      equipment: "IPC-610 工控机",
      fault: "风扇异响、局部温度升高",
      status: "已归档",
      time: "2026-07-03 16:18",
      maintainer: "王工",
      duration: "25 分钟",
      conclusion: "确认风扇积尘并完成清理，未发现接线松动。",
      tags: ["风扇检查", "低风险"],
      checks: ["检查 FAN1/FAN2 接线", "清理风扇叶片积尘", "记录恢复后转速"],
    },
    {
      id: "REC-STATION-A01-0702",
      title: "站控柜通风状态巡检",
      equipment: "站控柜 A01",
      fault: "例行巡检",
      status: "已归档",
      time: "2026-07-02 11:20",
      maintainer: "赵师傅",
      duration: "18 分钟",
      conclusion: "柜体通风良好，未发现进出风口遮挡。",
      tags: ["巡检", "无异常"],
      checks: ["确认柜门滤网状态", "检查柜内线缆遮挡", "记录环境温湿度"],
    },
  ].filter(Boolean);
  const [searchFault, setSearchFault] = useState("");
  const [detailRecordId, setDetailRecordId] = useState(null);
  const filteredRecords = records.filter((item) => item.fault.includes(searchFault.trim()));
  const selectedRecord = records.find((item) => item.id === detailRecordId);

  if (selectedRecord) {
    return (
      <section className="records-page">
        <div className="records-panel detail-mode">
          <div className="record-detail-topbar">
            <button className="ghost-button" onClick={() => setDetailRecordId(null)}>
              <ChevronLeft size={16} />
              返回记录列表
            </button>
            <div className="records-actions">
              <button className="ghost-button" onClick={() => window.print()}>
                <Download size={16} />
                导出
              </button>
            </div>
          </div>

          <article className="record-detail full-page">
            <div className="record-detail-head">
              <div>
                <span className={classNames("record-status", selectedRecord.status === "待审核" && "pending")}>
                  {selectedRecord.status}
                </span>
                <h3>{selectedRecord.title}</h3>
                <p>{selectedRecord.id}</p>
              </div>
              <ClipboardList size={30} />
            </div>

            <div className="record-meta-grid">
              <section>
                <span>设备</span>
                <strong>{selectedRecord.equipment}</strong>
              </section>
              <section>
                <span>故障</span>
                <strong>{selectedRecord.fault}</strong>
              </section>
              <section>
                <span>处理人</span>
                <strong>{selectedRecord.maintainer}</strong>
              </section>
              <section>
                <span>耗时</span>
                <strong>{selectedRecord.duration}</strong>
              </section>
            </div>

            <section className="record-conclusion">
              <div className="section-heading compact">
                <h3>本次维修主要内容</h3>
                <span><CalendarClock size={14} /> {selectedRecord.time}</span>
              </div>
              <p>{selectedRecord.conclusion}</p>
            </section>

            <section className="record-checks">
              <h3>关键确认项</h3>
              {selectedRecord.checks.map((check) => (
                <p key={check}><Check size={15} /> {check}</p>
              ))}
            </section>

            <div className="record-tags">
              {selectedRecord.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          </article>
        </div>
      </section>
    );
  }

  return (
    <section className="records-page">
      <div className="records-panel">
        <div className="records-head">
          <div>
            <p className="eyebrow">检修记录</p>
            <h2>记录台账</h2>
            <p>查看检修闭环、审核状态和关键处理结论。</p>
          </div>
          <div className="records-actions">
            <button className="ghost-button" onClick={() => window.print()}>
              <Download size={16} />
              导出
            </button>
            <button className="primary-button" onClick={onBuildRecord}>
              <FileText size={16} />
              生成演示记录
            </button>
          </div>
        </div>

        <div className="record-filter-row">
          <label>
            <Search size={15} />
            <input
              value={searchFault}
              onChange={(event) => setSearchFault(event.target.value)}
              placeholder="搜索故障，例如：风扇、温度、滤网..."
            />
          </label>
          <span>共 {filteredRecords.length} 条</span>
        </div>

        <div className="record-list-full" aria-label="检修记录列表">
          {filteredRecords.length > 0 ? (
            filteredRecords.map((item) => (
              <button
                key={item.id}
                className="record-row-item"
                onClick={() => setDetailRecordId(item.id)}
              >
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.time}</span>
                </div>
                <p>{item.fault}</p>
                <span>{item.equipment}</span>
                <span>{item.maintainer}</span>
                <span className={classNames("record-status", item.status === "待审核" && "pending")}>{item.status}</span>
                <ChevronRight size={18} />
              </button>
            ))
          ) : (
            <div className="record-empty">未找到相关故障记录。</div>
          )}
        </div>
      </div>
    </section>
  );
}

function SettingsPage({ currentUser, onSave }) {
  const [form, setForm] = useState({
    name: currentUser.name,
    site: currentUser.site,
    team: currentUser.team,
    role: currentUser.role,
    deviceScope: "站控柜 A01 · 工控机",
    notification: "仅高优先级告警",
    voiceMode: "仅检修步骤播报",
    exportFormat: "PDF 作业卡",
    expertMode: "异常结论后可提交专家审核",
    autoSaveRecord: true,
    showSafetyConfirm: true,
  });
  const [saved, setSaved] = useState(false);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }

  function saveSettings(event) {
    event.preventDefault();
    onSave({
      ...currentUser,
      name: form.name.trim() || currentUser.name,
      site: form.site.trim() || currentUser.site,
      team: form.team.trim() || currentUser.team,
      role: form.role,
    });
    setSaved(true);
  }

  return (
    <section className="settings-page">
      <form className="settings-panel" onSubmit={saveSettings}>
        <div className="settings-head">
          <div>
            <p className="eyebrow">个人与工作环境</p>
            <h2>日常使用设置</h2>
          </div>
          <button className="primary-button" type="submit">保存设置</button>
        </div>

        <div className="settings-grid">
          <section className="settings-section">
            <div className="section-heading compact">
              <h3>账号资料</h3>
              {saved && <span className="saved-badge">已保存</span>}
            </div>
            <label className="settings-field">
              <span>显示姓名</span>
              <input value={form.name} onChange={(event) => updateField("name", event.target.value)} />
            </label>
            <label className="settings-field">
              <span>当前身份</span>
              <select value={form.role} onChange={(event) => updateField("role", event.target.value)}>
                <option>一线检修人员</option>
                <option>专家审核人员</option>
                <option>运维管理员</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <div className="section-heading compact">
              <h3>场站与班组</h3>
              <span>同步顶部栏</span>
            </div>
            <label className="settings-field">
              <span>所属场站</span>
              <input value={form.site} onChange={(event) => updateField("site", event.target.value)} />
            </label>
            <label className="settings-field">
              <span>班组</span>
              <input value={form.team} onChange={(event) => updateField("team", event.target.value)} />
            </label>
          </section>

          <section className="settings-section">
            <div className="section-heading compact">
              <h3>默认设备范围</h3>
              <span>诊断入口默认使用</span>
            </div>
            <label className="settings-field">
              <span>设备范围</span>
              <select value={form.deviceScope} onChange={(event) => updateField("deviceScope", event.target.value)}>
                <option>站控柜 A01 · 工控机</option>
                <option>站控柜全部工控设备</option>
                <option>当前场站全部设备</option>
              </select>
            </label>
            <div className="settings-note">当前 MVP 主流程仍固定为 ACP-4000 / IPC-610 工控机散热异常。</div>
          </section>

          <section className="settings-section">
            <div className="section-heading compact">
              <h3>通知与语音</h3>
              <span>现场使用偏好</span>
            </div>
            <label className="settings-field">
              <span>告警通知</span>
              <select value={form.notification} onChange={(event) => updateField("notification", event.target.value)}>
                <option>仅高优先级告警</option>
                <option>全部告警</option>
                <option>关闭通知</option>
              </select>
            </label>
            <label className="settings-field">
              <span>语音播报</span>
              <select value={form.voiceMode} onChange={(event) => updateField("voiceMode", event.target.value)}>
                <option>仅检修步骤播报</option>
                <option>诊断结论与检修步骤播报</option>
                <option>关闭语音播报</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <div className="section-heading compact">
              <h3>作业卡与专家协同</h3>
              <span>检修闭环</span>
            </div>
            <label className="settings-field">
              <span>导出格式</span>
              <select value={form.exportFormat} onChange={(event) => updateField("exportFormat", event.target.value)}>
                <option>PDF 作业卡</option>
                <option>Word 作业卡</option>
                <option>打印版记录</option>
              </select>
            </label>
            <label className="settings-field">
              <span>专家协同</span>
              <select value={form.expertMode} onChange={(event) => updateField("expertMode", event.target.value)}>
                <option>异常结论后可提交专家审核</option>
                <option>检修完成后提交专家审核</option>
                <option>仅人工需要时提交</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <div className="section-heading compact">
              <h3>流程确认</h3>
              <span>安全习惯</span>
            </div>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={form.showSafetyConfirm}
                onChange={(event) => updateField("showSafetyConfirm", event.target.checked)}
              />
              <span>检修向导中始终显示安全确认</span>
            </label>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={form.autoSaveRecord}
                onChange={(event) => updateField("autoSaveRecord", event.target.checked)}
              />
              <span>检修完成后自动生成记录</span>
            </label>
          </section>
        </div>
      </form>
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
