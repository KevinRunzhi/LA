import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Cpu, ExternalLink, FileCheck2, FileText, GitBranch, History, Loader2, Network, Plus, RefreshCcw, Save, Search, Send, Settings, ShieldCheck, Sparkles, Trash2, UserRound, Users, Wrench, X } from "lucide-react";
import { presentationApi } from "./presentationApi";
import IndustrialKnowledgeGraphPage from "./knowledge-graph/IndustrialKnowledgeGraphPage";
import "./admin.css";
import "./portal.css";

const CASE_ID = "CASE-ACP4000-001";
const VERIFY_INPUT = "同型号站控工控机出现 TEMP/FAN 告警，风扇转速 420 rpm；清理滤网后转速仍未恢复。";
const EXPERT_PROFILE_STORAGE_KEY = "la-expert-profile-v2";
const defaultExpertProfile = {
  name: "王海峰",
  title: "高级工控设备检修工程师",
  organization: "国家管网集团山东德州分输站 · 设备技术组",
  specialties: ["工控机", "站控系统", "散热系统", "工业通信"],
  equipmentScope: "全部工控设备",
  contact: "站内分机 806",
};
const roleNames = { engineer: "工程师 · 李师傅", expert: "王海峰", admin: "系统管理员" };
const statusNames = { awaiting_engineer_confirmation: "待工程师确认", pending_expert_review: "待专家审核", archived_with_knowledge: "已通过并沉淀知识" };

function normalizeExpertProfile(value) {
  const profile = value && typeof value === "object" ? value : {};
  return {
    ...defaultExpertProfile,
    ...profile,
    specialties: Array.isArray(profile.specialties)
      ? profile.specialties.filter((item) => typeof item === "string" && item.trim()).slice(0, 5)
      : defaultExpertProfile.specialties,
  };
}

function loadExpertProfile() {
  if (typeof window === "undefined") return defaultExpertProfile;
  try {
    return normalizeExpertProfile(JSON.parse(window.localStorage.getItem(EXPERT_PROFILE_STORAGE_KEY)));
  } catch {
    return defaultExpertProfile;
  }
}

function StatusBadge({ status }) { return <span className={`admin-status status-${status}`}>{statusNames[status] || status}</span>; }

export default function AdminShell({ portalRole = "engineer", initialPage = "workbench", onLogout, onExitToWorkbench }) {
  const [state, setState] = useState(null);
  const [cases, setCases] = useState([]);
  const [knowledge, setKnowledge] = useState([]);
  const [manuals, setManuals] = useState([]);
  const [users, setUsers] = useState([]);
  const [fullCase, setFullCase] = useState(null);
  const [engineerSync, setEngineerSync] = useState(null);
  const [engineerSnapshot, setEngineerSnapshot] = useState(null);
  const [page, setPage] = useState(initialPage);
  const [selectedCase, setSelectedCase] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [graphKnowledgeId, setGraphKnowledgeId] = useState(null);
  const [expertProfile, setExpertProfile] = useState(loadExpertProfile);
  const adminNavItems = portalRole === "expert"
    ? [["workbench","专家工作台",FileCheck2],["history","全部案例",History],["knowledge","检修知识库",BookOpen],["knowledge-graph","知识图谱",Network],["settings","专家设置",Settings]]
    : [["workbench","我的案例",FileCheck2],["history","历史案例",History],["knowledge","检修知识库",BookOpen],["knowledge-graph","知识图谱",Network]];

  async function loadAll(nextPage) {
    setError("");
    try {
      const [nextState, nextCases, nextKnowledge, nextManuals, nextUsers, nextFullCase, nextSync, nextSnapshot] = await Promise.all([presentationApi.state(), presentationApi.cases(), presentationApi.knowledge(), presentationApi.manuals(), presentationApi.users(), presentationApi.caseDetail(CASE_ID), presentationApi.engineerSyncStatus(), presentationApi.engineerSnapshot()]);
      setState(nextState); setCases(nextCases); setKnowledge(nextKnowledge); setUsers(nextUsers); setFullCase(nextFullCase);
      setManuals(nextManuals);
      setEngineerSync(nextSync); setEngineerSnapshot(nextSnapshot);
      if (nextPage) setPage(nextPage);
    } catch (nextError) { setError(nextError.message); }
  }

  useEffect(() => {
    let active = true;
    presentationApi.switchRole(portalRole)
      .then(() => active && loadAll())
      .catch((nextError) => active && setError(nextError.message));
    return () => { active = false; };
  }, [portalRole]);

  useEffect(() => { setPage(initialPage); }, [initialPage]);

  async function action(run, message, nextPage) {
    setBusy(true); setError(""); setNotice("");
    try { await run(); await loadAll(nextPage); setNotice(message); }
    catch (nextError) { setError(nextError.message); }
    finally { setBusy(false); }
  }

  function saveExpertProfile(nextProfile) {
    const normalized = normalizeExpertProfile(nextProfile);
    try {
      window.localStorage.setItem(EXPERT_PROFILE_STORAGE_KEY, JSON.stringify(normalized));
      setExpertProfile(normalized);
      setError("");
      setNotice("专家资料已保存");
    } catch {
      setNotice("");
      setError("浏览器无法保存专家资料，请检查本地存储权限。");
    }
  }

  if (!state || !fullCase) return error ? <div className="admin-load-failed"><AlertTriangle size={28}/><span>案例回流服务暂时未连接</span><h2>工作台加载失败</h2><p>{error}</p><button className="admin-primary" onClick={() => loadAll()}><RefreshCcw size={14}/>重新加载</button></div> : <div className="admin-loading"><Loader2 className="spin" /> 正在载入案例回流工作台…</div>;

  const dynamicKnowledge = knowledge.find((item) => item.id === "KB-008");
  const archived = cases.filter((item) => item.dataLevel === "summary").length + (state.caseStatus === "archived_with_knowledge" ? 1 : 0);
  const pending = state.caseStatus === "pending_expert_review" ? 1 : 0;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand"><i><BookOpen size={18}/></i><div><p>知识回流控制台</p><h2>案例经验沉淀中心</h2></div></div>
        <div className="admin-sidebar-caption">工作菜单</div>
        <nav>{adminNavItems.map(([id,label,Icon]) => <button className={page === id ? "active" : ""} onClick={() => setPage(id)} key={id}><Icon size={17}/><span>{label}</span><ChevronRight size={14}/></button>)}</nav>
        <div className="admin-sidebar-account"><div><UserRound size={16}/><span>当前账号<strong>{portalRole === "expert" ? expertProfile.name : roleNames[portalRole]}</strong>{portalRole === "expert" && <small>{expertProfile.title}</small>}</span></div>{portalRole === "engineer" && onExitToWorkbench && <button onClick={onExitToWorkbench}>返回诊断台</button>}{portalRole !== "expert" && <button onClick={() => setConfirmReset(true)} disabled={busy}><RefreshCcw size={14}/>重置演示</button>}{onLogout && <button className="danger" onClick={onLogout}>退出登录</button>}</div>
      </aside>
      <section className="admin-main-area">
      {(notice || error) && <div className={`admin-toast ${error ? "error" : "success"}`}>{error ? <AlertTriangle size={14}/> : <Check size={14}/>} {error || notice}</div>}
      {page !== "expert-review" && page !== "settings" && <CaseFlowGuide page={page} state={state} portalRole={portalRole} onBack={page !== "workbench" ? () => setPage("workbench") : null} />}
      {page === "workbench" && portalRole === "engineer" && <EngineerCaseHome state={state} data={fullCase} sync={engineerSync} busy={busy} onSync={() => action(presentationApi.engineerSyncLatest, "本地知识已同步到最新版本", "knowledge-graph")} onEngineer={() => setPage("engineer-confirm")} onKnowledge={() => setPage("knowledge-result")} onExit={onExitToWorkbench} onLogout={onLogout} />}
      {page === "workbench" && portalRole === "expert" && <Workbench state={state} cases={cases} pending={pending} archived={archived} knowledgeCount={knowledge.length} role={state.activeRole} onEngineer={() => setPage("engineer-confirm")} onReview={() => setPage("expert-review")} onKnowledge={() => setPage("knowledge-result")} onCase={(item) => { setSelectedCase(item); setPage("case-detail"); }} />}
      {page === "engineer-confirm" && <EngineerConfirmation data={fullCase} state={state} busy={busy} onBack={() => setPage("workbench")} onSubmit={(result) => action(() => presentationApi.submitCase(CASE_ID, result), `案例 ${CASE_ID} 已提交专家审核`, "submit-success")} />}
      {page === "submit-success" && <SubmitSuccess onSwitch={onLogout} />}
      {page === "expert-review" && <ExpertReviewFlow data={fullCase} state={state} busy={busy} onBack={() => setPage("workbench")} onSave={(draft) => action(() => presentationApi.saveExpertDraft(CASE_ID, draft), "专家修改草稿已保存", "expert-review")} onPublish={(draft) => action(() => presentationApi.publishCase(CASE_ID, draft), "案例已通过，知识 V1.1 已发布", "knowledge-result")} />}
      {page === "knowledge-result" && <KnowledgeResult state={state} knowledge={dynamicKnowledge} data={fullCase} expertName={expertProfile.name} onLibrary={() => setPage("knowledge")} onVerify={portalRole === "engineer" ? () => setPage("verify") : null} />}
      {page === "verify" && <KnowledgeVerifyV2 state={state} busy={busy} onBack={() => setPage("knowledge-result")} />}
      {page === "history" && <HistoryCasesV2 cases={cases} onOpen={(item) => { setSelectedCase(item); setPage("case-detail"); }} />}
      {page === "case-detail" && <ReadonlyCase item={selectedCase} onBack={() => setPage("history")} />}
      {page === "knowledge" && <KnowledgeLibrary items={knowledge} manuals={manuals} onDynamic={() => setPage("knowledge-result")} onGraph={(knowledgeId) => { setGraphKnowledgeId(knowledgeId); setPage("knowledge-graph"); }} />}
      {page === "knowledge-graph" && <IndustrialKnowledgeGraphPage
        state={state}
        portalRole={portalRole}
        initialKnowledgeId={graphKnowledgeId}
        engineerSnapshot={engineerSnapshot}
        engineerSync={engineerSync}
        busy={busy}
        onReview={() => setPage("expert-review")}
        onSync={() => action(presentationApi.engineerSyncLatest, "V1.1 已同步，本地图谱和现场问答已更新", "knowledge-graph")}
        onVerify={() => setPage("verify")}
      />}
      {page === "settings" && portalRole === "expert" && <ExpertSettingsPage profile={expertProfile} onSave={saveExpertProfile} onReset={() => setConfirmReset(true)} resetDisabled={busy} />}
      {page === "people" && <PeoplePage users={users} />}
      </section>
      {confirmReset && <div className="presentation-reset-backdrop"><section><RefreshCcw size={24}/><span>录制状态重置</span><h2>恢复案例与知识初始状态？</h2><p>将恢复 CASE-ACP4000-001 待工程师确认、KB-008 V1.0 和发布前图谱。历史展示数据不会变化。</p><div><button className="admin-secondary" onClick={() => setConfirmReset(false)}>取消</button><button className="admin-primary" onClick={async () => { setConfirmReset(false); await action(presentationApi.reset, "演示已恢复：案例待确认，知识 V1.0", "workbench"); }}>确认重置</button></div></section></div>}
    </div>
  );
}

function ExpertSettingsPage({ profile, onSave, onReset, resetDisabled }) {
  const [form, setForm] = useState(profile);
  const [specialtiesInput, setSpecialtiesInput] = useState(profile.specialties.join("、"));
  const [validationError, setValidationError] = useState("");
  const parsedSpecialties = specialtiesInput.split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
  const dirty = JSON.stringify({ ...form, specialties: parsedSpecialties }) !== JSON.stringify(profile);

  useEffect(() => {
    setForm(profile);
    setSpecialtiesInput(profile.specialties.join("、"));
  }, [profile]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setValidationError("");
  }

  function updateSpecialties(value) {
    setSpecialtiesInput(value);
    setValidationError("");
  }

  function submit(event) {
    event.preventDefault();
    const nextProfile = {
      ...form,
      name: form.name.trim(),
      title: form.title.trim(),
      organization: form.organization.trim(),
      contact: form.contact.trim(),
      specialties: parsedSpecialties,
    };
    if (!nextProfile.name || !nextProfile.title || !nextProfile.organization) {
      setValidationError("请填写显示姓名、专业职称和所属机构。");
      return;
    }
    if (nextProfile.specialties.length > 5) {
      setValidationError("擅长领域最多填写 5 项。");
      return;
    }
    onSave(nextProfile);
  }

  return (
    <main className="admin-page expert-settings-page">
      <form className="expert-settings-form" onSubmit={submit}>
        <header className="expert-settings-head">
          <div><span>EXPERT PROFILE</span><h1>专家资料设置</h1><p>维护专家门户中展示的个人信息和专业范围。</p></div>
          <div className="expert-settings-actions">
            <button type="button" className="admin-secondary" onClick={() => { setForm({ ...defaultExpertProfile, specialties: [...defaultExpertProfile.specialties] }); setSpecialtiesInput(defaultExpertProfile.specialties.join("、")); setValidationError(""); }}><RefreshCcw size={14}/>恢复默认</button>
            <button type="submit" className="admin-primary" disabled={!dirty}><Save size={14}/>保存资料</button>
          </div>
        </header>

        {validationError && <div className="expert-settings-error" role="alert"><AlertTriangle size={14}/>{validationError}</div>}
        <div className="expert-settings-status"><i className={dirty ? "dirty" : "saved"}/><span>{dirty ? "有未保存修改" : "资料已保存"}</span></div>

        <div className="expert-settings-layout">
          <section className="expert-settings-fields">
            <div className="expert-settings-section-head"><UserRound size={17}/><div><h2>基本资料</h2><p>这些信息将显示在专家侧栏和审核身份区域。</p></div></div>
            <div className="expert-settings-grid">
              <label><span>显示姓名 <em>必填</em></span><input maxLength={20} value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="例如：王工"/></label>
              <label><span>专业职称 <em>必填</em></span><input maxLength={30} value={form.title} onChange={(event) => updateField("title", event.target.value)} placeholder="例如：高级设备检修专家"/></label>
              <label className="wide"><span>所属机构/团队 <em>必填</em></span><input maxLength={40} value={form.organization} onChange={(event) => updateField("organization", event.target.value)} placeholder="例如：山东德州分输站 · 设备技术组"/></label>
            </div>

            <div className="expert-settings-divider"/>
            <div className="expert-settings-section-head"><Wrench size={17}/><div><h2>专业能力</h2><p>用于说明专家擅长的故障方向和审核边界。</p></div></div>
            <div className="expert-settings-grid">
              <label className="wide"><span>擅长领域 <small>使用顿号或逗号分隔，最多 5 项</small></span><input value={specialtiesInput} onChange={(event) => updateSpecialties(event.target.value)} placeholder="工控机、散热系统、电源"/></label>
              <label><span>审核设备范围</span><select value={form.equipmentScope} onChange={(event) => updateField("equipmentScope", event.target.value)}><option>工控机与站控柜</option><option>PLC 与控制系统</option><option>全部工控设备</option></select></label>
              <label><span>联系方式 <small>选填</small></span><input maxLength={50} value={form.contact} onChange={(event) => updateField("contact", event.target.value)} placeholder="电话或工作邮箱"/></label>
            </div>
          </section>

          <aside className="expert-profile-preview">
            <span>账号摘要</span>
            <div className="expert-profile-avatar">{form.name.trim().slice(0, 1) || "专"}</div>
            <h2>{form.name.trim() || "未填写姓名"}</h2>
            <p>{form.title.trim() || "未填写专业职称"}</p>
            <dl><div><dt>登录账号</dt><dd>expert</dd></div><div><dt>所属机构</dt><dd>{form.organization.trim() || "—"}</dd></div><div><dt>设备范围</dt><dd>{form.equipmentScope}</dd></div><div><dt>账号状态</dt><dd className="active">正常</dd></div></dl>
            <section><strong>专业方向</strong><div>{parsedSpecialties.length ? parsedSpecialties.slice(0, 5).map((item) => <i key={item}>{item}</i>) : <small>尚未填写</small>}</div></section>
            <footer><ShieldCheck size={14}/><span>资料仅保存在当前浏览器，不改变专家权限。</span></footer>
            <button type="button" className="expert-profile-reset" onClick={onReset} disabled={resetDisabled}><RefreshCcw size={12}/>重置演示数据</button>
          </aside>
        </div>
      </form>
    </main>
  );
}

function CaseFlowGuide({ page, state, portalRole, onBack }) {
  const steps = [
    ["工程师确认", state.engineerSubmitted],
    ["专家审核", state.expertApproved],
    ["知识发布", state.knowledgePublished],
    ...(portalRole === "engineer" ? [["应用验证", state.feedbackVerified]] : []),
  ];
  const activeIndex = portalRole === "engineer" && page === "verify" ? 3
    : page === "engineer-confirm" || (!state.engineerSubmitted && portalRole === "engineer") ? 0
    : page === "expert-review" || (!state.expertApproved && portalRole === "expert") ? 1
      : portalRole === "engineer" && state.feedbackVerified ? 3 : 2;
  return (
    <section className="case-flow-guide">
      <div className="case-flow-context">{onBack ? <button onClick={onBack}><ChevronRight size={13}/>返回当前账号首页</button> : <span>案例回流主线</span>}<strong>CASE-ACP4000-001</strong></div>
      <div className="case-flow-steps">{steps.map(([label, done], index) => <div className={done ? "done" : index === activeIndex ? "active" : ""} key={label}><i>{done ? <Check size={12}/> : index + 1}</i><span>{label}</span>{index < steps.length - 1 && <b/>}</div>)}</div>
      <p>{activeIndex === 0 ? "确认实际检修结果并提交专家" : activeIndex === 1 ? "专家核验证据并修订知识" : activeIndex === 2 ? "查看知识版本与图谱变化" : "用相似异常确认知识已生效"}</p>
    </section>
  );
}

function EngineerCaseHome({ state, data, sync, busy, onSync, onEngineer, onKnowledge, onExit, onLogout }) {
  const pending = state.caseStatus === "pending_expert_review";
  const published = state.knowledgePublished;
  const hasUpdate = sync?.status === "update_available";
  return (
    <main className="admin-page engineer-case-home">
      <section className={`engineer-sync-banner ${hasUpdate ? "update" : "current"}`}><div><Network size={19}/><span><small>工程师本地知识</small><strong>KB-008 · V{sync?.local_version || "1.0"}</strong><p>{hasUpdate ? `专家已发布 V${sync.latest_version}，同步后本地图谱和现场问答将更新。` : "当前本地知识、知识图谱和现场问答使用同一版本。"}</p></span></div>{hasUpdate ? <button disabled={busy} onClick={onSync}>{busy?<Loader2 className="spin" size={14}/>:<RefreshCcw size={14}/>}同步 V{sync.latest_version}</button> : <em><Check size={13}/>已是最新</em>}</section>
      <section className="engineer-task-hero">
        <div><span>当前唯一任务</span><h1>{published ? "查看案例回流结果" : pending ? "案例已提交专家审核" : "确认本次检修案例"}</h1><p>{published ? "专家已完成审核并发布知识 V1.1，可以查看最终变化。" : pending ? "工程师操作已完成。请退出账号，再使用 expert 登录专家工作台。" : "系统已经把刚才的诊断、检修步骤和恢复结果整理成案例草稿。"}</p></div>
        <StatusBadge status={state.caseStatus}/>
      </section>
      <section className="engineer-task-card">
        <header><div><small>CASE-ACP4000-001</small><h2>{data.incident.title}</h2></div><span>{data.incident.site} · {data.incident.cabinet}</span></header>
        <div className="engineer-task-summary"><Fact label="现场异常" value={data.incident.description}/><Fact label="诊断结论" value={data.diagnosis.conclusion}/><Fact label="知识目标" value={`KB-008 · 当前 V${state.knowledgeVersion}`}/></div>
        <div className="engineer-next-action"><div><strong>下一步</strong><p>{published ? "查看专家发布的知识和图谱关系" : pending ? "退出工程师账号并登录专家账号" : "核对最终原因、实际处理和恢复参数"}</p></div>{published ? <button className="admin-primary" onClick={onKnowledge}>查看知识更新结果 <ArrowRight size={15}/></button> : pending ? <button className="admin-primary" onClick={onLogout}>退出并登录专家账号 <ArrowRight size={15}/></button> : <button className="admin-primary" onClick={onEngineer}>开始确认案例 <ArrowRight size={15}/></button>}</div>
      </section>
      <button className="engineer-exit-link" onClick={onExit}>暂不处理，返回智能诊断台</button>
    </main>
  );
}

function Workbench({ state, cases, pending, archived, knowledgeCount, role, onEngineer, onReview, onKnowledge, onCase }) {
  const dynamic = cases.find((item) => item.id === CASE_ID);
  const recent = cases.filter((item) => item.dataLevel === "summary").slice(0, 4);
  return <main className="admin-page admin-workbench">
    <section className="admin-hero"><div><span>CASE FEEDBACK LOOP</span><h1>{role === "expert" ? "专家案例审核工作台" : role === "admin" ? "案例与知识运行概览" : "检修案例回流工作台"}</h1><p>将一线检修事实转化为可追溯、可复用的设备知识。</p></div><div className="admin-hero-version"><small>当前动态知识</small><strong>KB-008 · V{state.knowledgeVersion}</strong><em>{state.knowledgePublished ? "已关联 CASE-ACP4000-001" : "等待案例回流"}</em></div></section>
    <section className="admin-metrics">{[["全部案例",cases.length,"本地演示数据"],["待专家审核",pending,"当前业务待办"],["已归档",archived,"可供工程师查阅"],["知识条目",knowledgeCount,`KB-008 V${state.knowledgeVersion}`]].map(([label,value,note],i)=><article style={{"--metric-index":i}} key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</section>
    <div className="admin-dashboard-grid"><section className="admin-focus-case"><header><div><span>当前完整案例</span><h3>{dynamic.title}</h3></div><StatusBadge status={state.caseStatus}/></header><div className="admin-case-facts"><p><span>设备</span><strong>{dynamic.equipment}</strong></p><p><span>场站</span><strong>{dynamic.site}</strong></p><p><span>工程师</span><strong>{dynamic.engineer}</strong></p><p><span>知识目标</span><strong>KB-008 · 风扇检查与更换</strong></p></div><div className="admin-focus-path"><span className={state.engineerSubmitted ? "done" : "active"}>工程师确认</span><i/><span className={state.expertApproved ? "done" : state.engineerSubmitted ? "active" : ""}>专家审核</span><i/><span className={state.knowledgePublished ? "done" : ""}>知识发布</span></div>{role === "engineer" && state.caseStatus === "awaiting_engineer_confirmation" && <button className="admin-primary" onClick={onEngineer}>确认现场结果 <ArrowRight size={15}/></button>}{role === "expert" && state.caseStatus === "pending_expert_review" && <button className="admin-primary" onClick={onReview}>进入专家审核 <ArrowRight size={15}/></button>}{state.knowledgePublished && <button className="admin-primary" onClick={onKnowledge}>查看知识更新结果 <ArrowRight size={15}/></button>}{role === "admin" && <p className="admin-readonly-note"><ShieldCheck size={13}/>管理员仅查看运行状态，不能修改专业内容。</p>}</section><section className="admin-recent"><header><div><span>历史沉淀</span><h3>最近归档案例</h3></div><button onClick={()=>{}}>10 条摘要</button></header>{recent.map(item=><button className="admin-recent-row" onClick={()=>onCase(item)} key={item.id}><div><small>{item.id} · {item.site}</small><strong>{item.title}</strong></div><span>{item.faultType}</span><ChevronRight size={14}/></button>)}</section></div>
  </main>;
}

function EngineerConfirmation({ data, state, busy, onBack, onSubmit }) {
  const empty = { finalCause:"",actualResolution:"",recoveryResult:"",fanSpeedRpm:"",systemTemperatureC:"",cpuTemperatureC:"",observationMinutes:"",residualRisk:"" };
  const [form, setForm] = useState(state.engineerResult || empty);
  const ready = ["finalCause","actualResolution","recoveryResult","fanSpeedRpm","systemTemperatureC","cpuTemperatureC","observationMinutes"].every(key => form[key] !== "" && form[key] != null);
  return <main className="admin-page"><PageBack onBack={onBack} label="返回回流工作台"/><section className="admin-detail-head"><div><span>工程师案例确认</span><h1>{data.incident.title}</h1><p>系统已归集现场事实、Agent 诊断、执行步骤和恢复验证。</p></div><StatusBadge status={state.caseStatus}/></section><div className="admin-confirm-grid"><section className="admin-readonly-evidence"><h3>自动归集事实</h3><Fact label="现场异常" value={data.incident.description}/><Fact label="诊断方向" value={data.diagnosis.direction}/><Fact label="判断依据" value={data.diagnosis.evidence.join(" · ")}/><Fact label="实际步骤" value={data.execution.steps.join(" → ")}/></section><section className="admin-result-form"><header><div><span>需要工程师确认</span><h3>实际检修结果</h3></div><button onClick={()=>setForm(data.engineerResultTemplate)}><Sparkles size={13}/>一键采用现场结果</button></header><label>最终故障原因<textarea value={form.finalCause} onChange={e=>setForm({...form,finalCause:e.target.value})}/></label><label>实际处理<textarea value={form.actualResolution} onChange={e=>setForm({...form,actualResolution:e.target.value})}/></label><label>恢复结果<input value={form.recoveryResult} onChange={e=>setForm({...form,recoveryResult:e.target.value})}/></label><div className="admin-form-row">{[["恢复转速 rpm","fanSpeedRpm"],["系统温度 °C","systemTemperatureC"],["CPU 温度 °C","cpuTemperatureC"],["观察分钟","observationMinutes"]].map(([label,key])=><label key={key}>{label}<input type="number" value={form[key]} onChange={e=>setForm({...form,[key]:Number(e.target.value)})}/></label>)}</div><label>遗留风险<input value={form.residualRisk} onChange={e=>setForm({...form,residualRisk:e.target.value})}/></label><button className="admin-primary" disabled={!ready || busy} onClick={()=>onSubmit(form)}>{busy?<Loader2 className="spin" size={15}/>:<Send size={15}/>}提交专家审核</button></section></div></main>;
}

function SubmitSuccess({ onSwitch }) { return <main className="admin-page admin-success-page"><div className="admin-success-mark"><Check size={32}/></div><span>提交成功</span><h1>案例 CASE-ACP4000-001 已提交专家审核</h1><p>现场事实、实际处理结果和恢复参数已锁定。请退出工程师账号，再使用专家账号登录审核。</p><button className="admin-primary" onClick={onSwitch}>退出并登录专家账号 <ArrowRight size={15}/></button></main>; }

const knowledgeFieldLabels = {
  equipment: "适用设备", symptoms: "异常现象", conditions: "判断条件", causes: "故障原因",
  checks: "检查顺序", resolution: "处理方法", safety: "安全要求", recovery: "恢复标准", exclusions: "不适用范围",
};

function ExpertReviewFlow({ data, state, busy, onBack, onSave, onPublish }) {
  const saved = state.expertDraft;
  const result = state.engineerResult || data.engineerResultTemplate;
  const feedbackPackage = state.feedbackPackage;
  const uploadedSteps = feedbackPackage?.completedSteps?.map((item) => item.title || item).join(" → ") || data.execution.steps.join(" → ");
  const uploadedMaterials = feedbackPackage?.materials?.length
    ? feedbackPackage.materials.map((item) => item.name).join("、")
    : "本次未附加现场材料";
  const initialDraft = saved || {
    caseResult: { finalCause: result.finalCause, actualResolution: result.actualResolution, recoveryResult: result.recoveryResult, knowledgeValue: "形成风扇老化判断与更换条件，供同型号设备复用" },
    knowledge: {
      equipment: "研华 ACP-4000 / IPC-610 站控工控机", symptoms: "TEMP/FAN 告警，风扇转速持续低于 500 rpm",
      conditions: "清理滤网与风道后，风扇转速仍未恢复", causes: "滤网积尘叠加风扇老化",
      checks: "核对告警 → 查看转速 → 清理风道 → 复测 → 判断是否更换",
      resolution: "清理滤网与风道；低速未恢复时更换老化风扇并核对接线",
      safety: "断电、挂牌并落实防静电措施", recovery: "TEMP/FAN 告警解除，转速恢复且温度稳定观察 15 分钟",
      exclusions: "清理后转速已正常，或告警由传感器/接线故障引起",
    },
    relations: data.graphChanges.map((edge, index) => ({ ...edge, id: index + 1, changeType: "新增", confirmed: true })),
    reviewDecision: "修正后通过",
  };
  const [step, setStep] = useState(saved?.reviewStep || 0);
  const [draft, setDraft] = useState(initialDraft);
  const [publishingStage, setPublishingStage] = useState(0);
  const steps = ["审核并修正案例", "修正知识与图谱", "确认并发布"];
  const setCase = (key, value) => setDraft({ ...draft, caseResult: { ...draft.caseResult, [key]: value } });
  const setKnowledge = (key, value) => setDraft({ ...draft, knowledge: { ...draft.knowledge, [key]: value } });
  const setRelation = (id, key, value) => setDraft({ ...draft, relations: draft.relations.map((item) => item.id === id ? { ...item, [key]: value } : item) });
  const removeRelation = (id) => setDraft({ ...draft, relations: draft.relations.filter((item) => item.id !== id) });
  const addRelation = () => setDraft({ ...draft, relations: [...draft.relations, { id: Date.now(), source: "", relation: "关联", target: "", changeType: "新增", confirmed: false }] });
  const annotations = Object.entries(draft.caseResult).filter(([key, value]) => value !== ({ finalCause: result.finalCause, actualResolution: result.actualResolution, recoveryResult: result.recoveryResult }[key] || initialDraft.caseResult[key])).map(([key]) => key);
  const readyCase = Object.values(draft.caseResult).every((value) => String(value).trim());
  const readyKnowledge = Object.values(draft.knowledge).every((value) => String(value).trim()) && draft.relations.length > 0 && draft.relations.every((item) => item.source.trim() && item.relation.trim() && item.target.trim());

  async function publish() {
    setPublishingStage(1);
    for (let stage = 2; stage <= 3; stage += 1) { await new Promise((resolve) => window.setTimeout(resolve, 520)); setPublishingStage(stage); }
    await new Promise((resolve) => window.setTimeout(resolve, 560));
    await onPublish({ ...draft, annotations });
  }

  return <main className="expert-flow-page">
    <header className="expert-flow-header">
      <button onClick={onBack}><ArrowLeft size={14}/>返回专家工作台</button>
      <div><span>CASE-ACP4000-001</span><strong>{data.incident.title}</strong></div>
      <div className="expert-stepper">{steps.map((label,index)=><div className={index < step ? "done" : index === step ? "active" : ""} key={label}><i>{index < step ? <Check size={12}/> : index + 1}</i><span>{label}</span>{index < 2 && <b/>}</div>)}</div>
    </header>
    <div className="expert-flow-layout">
      <section className="expert-flow-main">
        {step === 0 && <div className="expert-stage expert-case-stage">
          <header><span>步骤 1 / 3</span><h1>审核并修正案例</h1><p>先核对不可修改的现场证据，再修正需要进入正式案例的结论。</p></header>
          <div className="expert-case-review-grid">
            <section className="expert-locked-evidence"><h3><ShieldCheck size={15}/>工程师上传证据 · 只读</h3><Fact label="来源记录" value={feedbackPackage?.recordId || data.recordId}/><Fact label="异常描述" value={feedbackPackage?.incident?.description || data.incident.description}/><Fact label="告警与参数" value={feedbackPackage?.diagnosis?.evidence?.join(" · ") || data.diagnosis.evidence.join(" · ")}/><Fact label="Agent 诊断" value={feedbackPackage?.diagnosis?.conclusion || data.diagnosis.conclusion}/><Fact label="已完成步骤" value={uploadedSteps}/><Fact label="恢复验证" value={`风扇 ${result.fanSpeedRpm} rpm · 系统 ${result.systemTemperatureC}℃ · CPU ${result.cpuTemperatureC}℃ · 观察 ${result.observationMinutes} 分钟`}/><Fact label="现场材料" value={uploadedMaterials}/></section>
            <section className="expert-case-form"><div className="expert-decision-row"><span>审核决定</span>{["修正后通过","退回补充","仅归档案例"].map(item=><button className={draft.reviewDecision===item?"active":""} onClick={()=>setDraft({...draft,reviewDecision:item})} key={item}>{item}</button>)}</div><label>最终故障原因<textarea value={draft.caseResult.finalCause} onChange={e=>setCase("finalCause",e.target.value)}/></label><label>实际处理<textarea value={draft.caseResult.actualResolution} onChange={e=>setCase("actualResolution",e.target.value)}/></label><label>恢复结果<input value={draft.caseResult.recoveryResult} onChange={e=>setCase("recoveryResult",e.target.value)}/></label><label>知识沉淀价值<textarea value={draft.caseResult.knowledgeValue} onChange={e=>setCase("knowledgeValue",e.target.value)}/></label></section>
          </div>
        </div>}
        {step === 1 && <div className="expert-stage expert-knowledge-stage">
          <header><span>步骤 2 / 3</span><h1>修正知识与知识图谱</h1><p>把案例经验整理为可检索的结构化知识，并逐条确认图谱关系。</p></header>
          <div className="knowledge-structure-grid">{Object.entries(knowledgeFieldLabels).map(([key,label])=><label key={key}><span>{label}</span><textarea value={draft.knowledge[key]} onChange={e=>setKnowledge(key,e.target.value)}/></label>)}</div>
          <section className="relation-editor"><header><div><span>知识图谱关系</span><h3>关系表与发布预览</h3></div><button onClick={addRelation}><Plus size={13}/>新增关系</button></header>{draft.relations.map(item=><div className="relation-row" key={item.id}><input aria-label="源节点" value={item.source} onChange={e=>setRelation(item.id,"source",e.target.value)}/><input aria-label="关系" value={item.relation} onChange={e=>setRelation(item.id,"relation",e.target.value)}/><input aria-label="目标节点" value={item.target} onChange={e=>setRelation(item.id,"target",e.target.value)}/><select value={item.changeType} onChange={e=>setRelation(item.id,"changeType",e.target.value)}><option>新增</option><option>修改</option><option>删除</option></select><button title="删除关系" onClick={()=>removeRelation(item.id)}><Trash2 size={13}/></button></div>)}<GraphPreview edges={draft.relations.filter(item=>item.changeType!=="删除")} active/></section>
        </div>}
        {step === 2 && <div className="expert-stage expert-publish-stage">
          <header><span>步骤 3 / 3</span><h1>确认修改并发布 V1.1</h1><p>发布前只看变化与影响，避免重要修改被埋在长表单中。</p></header>
          <div className="publish-summary-grid"><article><span>案例审核结果</span><h3>{draft.reviewDecision}</h3><p>{draft.caseResult.finalCause}</p><small>{annotations.length ? `${annotations.length} 项专家修订` : "原案例结论已确认"} · 来源 CASE-ACP4000-001</small></article><article><span>知识版本变化</span><h3>KB-008 · V1.0 → V1.1</h3><p>{draft.knowledge.resolution}</p><small>9 个结构化字段已确认</small></article><article><span>图谱变化</span><h3>{draft.relations.length} 条关系待发布</h3><p>{draft.relations.map(item=>`${item.source} ${item.relation} ${item.target}`).join("；")}</p><small>全部保留案例来源与专家记录</small></article></div>
          <section className="publish-impact"><GitBranch size={18}/><div><strong>发布影响</strong><p>新知识将进入检修知识库，并参与下一次同型号设备的 TEMP/FAN 异常诊断。</p></div></section>
        </div>}
      </section>
      <aside className="expert-flow-aside"><span>案例速览</span><h3>{data.incident.site} · {data.incident.cabinet}</h3><p>{data.incident.equipment}</p><dl><div><dt>发生时间</dt><dd>2026-07-10 10:25</dd></div><div><dt>工程师</dt><dd>李师傅</dd></div><div><dt>告警</dt><dd>{data.incident.alarm}</dd></div><div><dt>恢复转速</dt><dd>{result.fanSpeedRpm} rpm</dd></div></dl><div className="expert-change-log"><strong>专家修改记录</strong><p>{annotations.length ? `${annotations.length} 个案例字段已修正` : "尚未修改案例字段"}</p><small>草稿保存后可刷新继续</small></div></aside>
    </div>
    <footer className="expert-flow-footer"><button className="admin-secondary" disabled={step===0} onClick={()=>setStep(step-1)}><ArrowLeft size={14}/>上一步</button><button className="expert-save" disabled={busy} onClick={()=>onSave({...draft,annotations,reviewStep:step})}><Save size={14}/>保存草稿</button><span>{step===0?"核对案例结论":step===1?"确认知识字段与图谱关系":"最终发布后将生成 V1.1"}</span>{step<2?<button className="admin-primary" disabled={step===0?!readyCase:!readyKnowledge} onClick={()=>setStep(step+1)}>{step===0?"确认案例并提炼知识":"完成知识修正"}<ArrowRight size={14}/></button>:<button className="admin-primary" disabled={busy||publishingStage>0} onClick={publish}><BookOpen size={14}/>确认发布 V1.1</button>}</footer>
    {publishingStage>0&&<div className="knowledge-publish-overlay"><section><Loader2 className="spin" size={24}/><span>专家审核通过</span><h2>正在发布正式检修知识</h2><div>{["归档案例与专家修订","生成知识 KB-008 V1.1","写入图谱并绑定来源"].map((label,index)=><p className={publishingStage>index?"done":"running"} key={label}><Check size={14}/><strong>{label}</strong><small>{index===0?"保留审核决定与修改记录":index===1?"写入结构化检修知识":"关系可追溯至本案例"}</small></p>)}</div></section></div>}
  </main>;
}

function ExpertReviewV2({ data, state, busy, onBack, onGraph, onPublish }) {
  const [conclusion, setConclusion] = useState(state.expertConclusion || data.expertReviewTemplate.systemDraftConclusion);
  const [publishingStage, setPublishingStage] = useState(0);
  const publishingLabels = ["归档检修案例", "生成知识 V1.1", "写入知识图谱"];

  async function publish() {
    if (publishingStage) return;
    setPublishingStage(1);
    await new Promise((resolve) => window.setTimeout(resolve, 520));
    setPublishingStage(2);
    await new Promise((resolve) => window.setTimeout(resolve, 620));
    setPublishingStage(3);
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    await onPublish(conclusion);
  }

  return (
    <main className="admin-page expert-review-v2">
      <PageBack onBack={onBack} label="返回专家工作台" />
      <section className="admin-detail-head">
        <div><span>专家审核 · CASE-ACP4000-001</span><h1>从现场事实中提炼可复用知识</h1><p>按照证据链核验诊断与实际结果，再决定知识和图谱如何更新。</p></div>
        <StatusBadge status={state.caseStatus} />
      </section>

      <div className="expert-review-story">
        <section className="expert-evidence-timeline">
          <header><span>01 / 现场与诊断证据</span><h3>异常事实链</h3></header>
          <article><i>现场</i><div><strong>{data.incident.equipment}</strong><p>{data.incident.description}</p></div></article>
          <article><i>诊断</i><div><strong>{data.diagnosis.direction}</strong><p>{data.diagnosis.evidence.join(" · ")}</p></div></article>
          <article><i>执行</i><div><strong>检修步骤已完成</strong><p>{data.execution.steps.join(" → ")}</p></div></article>
          <GraphPreview edges={[{source:"TEMP/FAN 告警",relation:"指向",target:"散热异常"},{source:"风扇 420 rpm",relation:"支持",target:"风扇低速"}]} active />
        </section>

        <section className="expert-outcome-panel">
          <header><span>02 / 工程师实际结果</span><h3>现场恢复验证</h3></header>
          <Fact label="最终原因" value={state.engineerResult?.finalCause} />
          <Fact label="实际处理" value={state.engineerResult?.actualResolution} />
          <Fact label="恢复结果" value={state.engineerResult?.recoveryResult} />
          <div className="expert-parameter-row"><span>风扇转速<strong>{state.engineerResult?.fanSpeedRpm} rpm</strong></span><span>系统温度<strong>{state.engineerResult?.systemTemperatureC}°C</strong></span><span>CPU 温度<strong>{state.engineerResult?.cpuTemperatureC}°C</strong></span></div>
        </section>

        <section className="expert-knowledge-editor">
          <header><div><span>03 / 专家修订</span><h3>简洁案例与知识变化</h3></div><button onClick={() => setConclusion(data.expertReviewTemplate.expertConclusion)}><Sparkles size={13}/>采用专家建议</button></header>
          <div className="expert-draft-compare"><article><small>系统草稿</small><p>{data.expertReviewTemplate.systemDraftConclusion}</p></article><article><small>专家结论</small><textarea value={conclusion} onChange={(event) => setConclusion(event.target.value)} /></article></div>
          <div className={`graph-change-card ${state.graphDecision}`}><header><GitBranch size={16}/><div><span>知识图谱变更预览</span><strong>将真实检修结果补入 KB-008</strong></div></header><GraphPreview edges={data.graphChanges} active={state.graphDecision === "accepted"}/><small>新关系将保留来源案例 CASE-ACP4000-001</small><div><button className={state.graphDecision === "accepted" ? "accepted" : ""} onClick={() => onGraph("accepted")}><Check size={13}/>接受主要关系</button><button onClick={() => onGraph("rejected")}>不采用</button></div></div>
          <button className="admin-primary" disabled={!conclusion.trim() || state.graphDecision === "pending" || busy || publishingStage > 0} onClick={publish}><BookOpen size={15}/>通过并更新知识</button>
        </section>
      </div>

      {publishingStage > 0 && (
        <div className="knowledge-publish-overlay">
          <section><Loader2 className="spin" size={24}/><span>专家审核通过</span><h2>正在形成正式检修知识</h2><div>{publishingLabels.map((label,index) => <p className={publishingStage > index ? "done" : publishingStage === index ? "running" : ""} key={label}>{publishingStage > index ? <Check size={14}/> : <Loader2 className={publishingStage === index ? "spin" : ""} size={14}/>}<strong>{label}</strong><small>{index === 0 ? "保留现场事实与专家修改记录" : index === 1 ? "KB-008 从 V1.0 更新为 V1.1" : "新增关系并绑定来源案例"}</small></p>)}</div></section>
        </div>
      )}
    </main>
  );
}

function ExpertReview({ data, state, busy, onBack, onGraph, onPublish }) {
  const [conclusion,setConclusion]=useState(state.expertConclusion || data.expertReviewTemplate.systemDraftConclusion);
  return <main className="admin-page"><PageBack onBack={onBack} label="返回专家工作台"/><section className="admin-detail-head"><div><span>专家审核 · CASE-ACP4000-001</span><h1>核验现场事实并提炼检修知识</h1><p>专家可修正专业表述后直接通过，所有修改保留来源案例。</p></div><StatusBadge status={state.caseStatus}/></section><div className="expert-review-grid"><section className="expert-case-column"><h3>工程师实际结果</h3><Fact label="最终原因" value={state.engineerResult?.finalCause}/><Fact label="实际处理" value={state.engineerResult?.actualResolution}/><Fact label="恢复结果" value={state.engineerResult?.recoveryResult}/><div className="expert-parameter-row"><span>转速 <strong>{state.engineerResult?.fanSpeedRpm} rpm</strong></span><span>系统 <strong>{state.engineerResult?.systemTemperatureC}°C</strong></span><span>CPU <strong>{state.engineerResult?.cpuTemperatureC}°C</strong></span></div></section><section className="expert-edit-column"><header><div><span>专家简洁案例</span><h3>修正关键结论</h3></div><button onClick={()=>setConclusion(data.expertReviewTemplate.expertConclusion)}><Sparkles size={13}/>采用专家建议</button></header><label>系统草稿<p>{data.expertReviewTemplate.systemDraftConclusion}</p></label><label>专家结论<textarea value={conclusion} onChange={e=>setConclusion(e.target.value)}/></label><div className={`graph-change-card ${state.graphDecision}`}><header><GitBranch size={16}/><div><span>知识图谱变更建议</span><strong>新增风扇老化判断关系</strong></div></header>{data.graphChanges.map((edge,index)=><p key={index}><b>{edge.source}</b><i>{edge.relation}</i><b>{edge.target}</b></p>)}<small>来源 · CASE-ACP4000-001 · 目标知识 KB-008</small><div><button className={state.graphDecision === "accepted" ? "accepted" : ""} onClick={()=>onGraph("accepted")}><Check size={13}/>接受建议</button><button onClick={()=>onGraph("rejected")}>不采用</button></div></div><button className="admin-primary" disabled={!conclusion.trim() || state.graphDecision === "pending" || busy} onClick={()=>onPublish(conclusion)}>{busy?<Loader2 className="spin" size={15}/>:<BookOpen size={15}/>}通过并更新知识</button></section></div></main>;
}

function KnowledgeResult({ state, knowledge, data, expertName, onLibrary, onVerify }) { const releasedRelations=state.publishedRelations?.length?state.publishedRelations:data.graphChanges; return <main className="admin-page"><section className={`knowledge-release-hero ${state.knowledgePublished ? "published" : "pending"}`}><div className="knowledge-release-icon">{state.knowledgePublished?<Check size={28}/>:<BookOpen size={28}/>}</div><div><span>{state.knowledgePublished?"知识发布完成":"动态知识状态"}</span><h1>KB-008 · {knowledge?.title}</h1><p>{state.knowledgePublished?"真实检修经验已经进入知识库，并可参与后续诊断。":"完成专家审核后将在此展示知识版本变化。"}</p></div><div className="knowledge-version-jump"><small>VERSION</small><strong>V1.0</strong><ArrowRight size={18}/><em>V{state.knowledgeVersion}</em></div></section><div className="knowledge-result-grid"><section><header><span>知识内容变化</span><h3>新增风扇老化判断与更换条件</h3></header><div className="knowledge-diff"><article><small>V1.0</small><p>{knowledge?.baseContent}</p></article><article className="after"><small>V1.1 · 新增</small><p>{knowledge?.publishedContentV11}</p></article></div></section><section><header><span>知识来源</span><h3>可追溯发布记录</h3></header><Fact label="来源案例" value={state.knowledgePublished?CASE_ID:"尚未关联"}/><Fact label="修改专家" value={state.knowledgePublished?expertName:"—"}/><Fact label="发布时间" value={state.publishedAt?new Date(state.publishedAt).toLocaleString("zh-CN"):"—"}/></section><section className="published-graph"><header><span>发布后知识图谱</span><h3>专家确认的 {releasedRelations.length} 条关系已并入诊断路径</h3></header><GraphPreview edges={releasedRelations} active={state.knowledgePublished}/></section></div><div className="admin-page-actions"><button className="admin-secondary" onClick={onLibrary}>查看检修知识库</button>{onVerify && <button className="admin-primary" onClick={onVerify}>验证知识应用 <ArrowRight size={15}/></button>}</div></main>; }

function KnowledgeVerifyV2({ busy, onBack }) {
  const [input, setInput] = useState(VERIFY_INPUT);
  const [result, setResult] = useState(null);
  const [step, setStep] = useState(0);
  const verificationSteps = ["解析设备与告警", "匹配风扇转速条件", "检索知识版本", "追溯来源案例", "生成推荐动作"];

  async function verify() {
    if (step > 0 && step < verificationSteps.length + 1) return;
    setResult(null);
    setStep(1);
    for (let index = 2; index <= verificationSteps.length; index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 360));
      setStep(index);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 420));
    setResult(await presentationApi.verify(input));
    setStep(verificationSteps.length + 1);
  }

  const running = step > 0 && step <= verificationSteps.length && !result;
  return (
    <main className="admin-page">
      <PageBack onBack={onBack} label="返回知识结果" />
      <section className="verify-layout">
        <div className="verify-input"><span>知识回流验证</span><h1>用相似异常验证新知识</h1><p>可以修改下面的异常描述，再检查专家刚刚发布的知识是否参与下一次诊断。</p><label>验证输入<textarea value={input} onChange={(event) => setInput(event.target.value)} /></label><small className="verify-input-help">建议保留设备、TEMP/FAN 告警、风扇转速和清理后状态四类事实。</small><button className="admin-primary" onClick={verify} disabled={!input.trim() || running || busy}>{running ? <Loader2 className="spin" size={15}/> : <Search size={15}/>}开始验证新知识</button></div>
        <div className={`verify-result ${result?.matched ? "matched" : ""}`}>
          {!result && !running && <div className="verify-placeholder"><Cpu size={30}/><strong>等待验证</strong><p>系统将依次解析设备、告警、阈值、知识版本和来源案例。</p></div>}
          {running && <div className="verification-trace"><span>知识检索 Agent</span><h3>正在验证回流知识</h3>{verificationSteps.map((label,index) => <p className={step > index ? "done" : step === index ? "running" : ""} key={label}>{step > index ? <Check size={13}/> : <Loader2 className={step === index ? "spin" : ""} size={13}/>}<strong>{label}</strong></p>)}</div>}
          {result?.matched && <><div className="verify-hit"><Check size={18}/><div><span>成功命中专家发布的新知识</span><strong>{result.knowledgeId} · V{result.version}</strong></div></div><div className="verification-knowledge-source"><span>本次结果直接读取发布版本</span><strong>专家结构化知识 + publishedRelations</strong></div><Fact label="来源案例" value={result.sourceCaseId}/><Fact label="命中异常" value={result.matchedSymptoms}/><Fact label="新增判断" value={result.assessment}/><Fact label="推荐动作" value={result.recommendation}/><div className="verification-extra-grid"><Fact label="安全要求" value={result.safety}/><Fact label="恢复标准" value={result.recovery}/><Fact label="不适用范围" value={result.exclusions}/></div><section className="verification-graph-path"><header><span>本次诊断采用的实际图谱路径</span><strong>{result.graphPath.length} 条专家发布关系</strong></header><GraphPreview edges={result.graphPath} active/></section></>}
          {result && !result.matched && <div className="verify-placeholder"><AlertTriangle size={28}/><strong>当前知识仍为 V{result.version}</strong><p>{result.message}</p></div>}
        </div>
      </section>
    </main>
  );
}

function KnowledgeVerify({ state, busy, onBack }) { const [result,setResult]=useState(null); const [running,setRunning]=useState(false); async function verify(){setRunning(true);try{setResult(await presentationApi.verify(VERIFY_INPUT));}finally{setRunning(false);}} return <main className="admin-page"><PageBack onBack={onBack} label="返回知识结果"/><section className="verify-layout"><div className="verify-input"><span>知识回流验证</span><h1>用相似异常验证新知识</h1><p>无需重新走完整检修流程，只验证发布后的知识是否被诊断检索。</p><label>验证输入<textarea value={VERIFY_INPUT} readOnly/></label><button className="admin-primary" onClick={verify} disabled={running || busy}>{running?<Loader2 className="spin" size={15}/>:<Search size={15}/>}验证知识应用</button></div><div className={`verify-result ${result?.matched?"matched":""}`}>{!result?<div className="verify-placeholder"><Cpu size={30}/><strong>等待验证</strong><p>系统将依次解析设备、告警、阈值、知识版本和来源案例。</p></div>:result.matched?<><div className="verify-hit"><Check size={18}/><div><span>成功命中新知识</span><strong>{result.knowledgeId} · V{result.version}</strong></div></div><Fact label="来源案例" value={result.sourceCaseId}/><Fact label="新增判断" value={result.assessment}/><Fact label="推荐动作" value={result.recommendation}/><GraphPreview edges={result.graphPath} active/></>:<div className="verify-placeholder"><AlertTriangle size={28}/><strong>当前知识仍为 V{result.version}</strong><p>{result.message}</p></div>}</div></section></main>; }

function HistoryCasesV2({ cases, onOpen }) {
  const [query, setQuery] = useState("");
  const [faultType, setFaultType] = useState("全部故障");
  const [site, setSite] = useState("全部场站");
  const [level, setLevel] = useState("全部状态");
  const faultTypes = ["全部故障", ...new Set(cases.map((item) => item.faultType))];
  const sites = ["全部场站", ...new Set(cases.map((item) => item.site))];
  const items = useMemo(() => cases.filter((item) => {
    if (item.dataLevel === "full") return false;
    if (!`${item.id}${item.title}${item.equipment}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (faultType !== "全部故障" && item.faultType !== faultType) return false;
    if (site !== "全部场站" && item.site !== site) return false;
    if (level === "已归档" && item.dataLevel !== "summary") return false;
    if (level === "资料收集中" && item.dataLevel !== "collecting") return false;
    return true;
  }), [cases, faultType, level, query, site]);

  return (
    <main className="admin-page">
      <section className="admin-list-head"><div><span>READONLY ARCHIVE</span><h1>历史检修案例</h1><p>工程师可查阅全部已归档案例，摘要案例不提供修改和重新审核。</p></div><label><Search size={14}/><input placeholder="搜索案例、设备或编号" value={query} onChange={(event) => setQuery(event.target.value)}/></label></section>
      <div className="history-filter-bar"><select value={faultType} onChange={(event) => setFaultType(event.target.value)}>{faultTypes.map((item) => <option key={item}>{item}</option>)}</select><select value={site} onChange={(event) => setSite(event.target.value)}>{sites.map((item) => <option key={item}>{item}</option>)}</select><select value={level} onChange={(event) => setLevel(event.target.value)}><option>全部状态</option><option>已归档</option><option>资料收集中</option></select><span>当前显示 {items.length} 条</span></div>
      <div className="case-archive-grid">{items.map((item) => <button onClick={() => onOpen(item)} key={item.id}><header><small>{item.id}</small><span>{item.dataLevel === "collecting" ? "资料收集中" : "已归档"}</span></header><h3>{item.title}</h3><p>{item.site} · {item.equipment}</p><div><em>{item.faultType}</em><strong>{item.handledAt}</strong></div></button>)}</div>
    </main>
  );
}

function HistoryCases({ cases, onOpen }) { const [query,setQuery]=useState(""); const items=useMemo(()=>cases.filter(item=>item.dataLevel!=="full"&&`${item.id}${item.title}${item.equipment}`.toLowerCase().includes(query.toLowerCase())),[cases,query]); return <main className="admin-page"><section className="admin-list-head"><div><span>READONLY ARCHIVE</span><h1>历史检修案例</h1><p>摘要案例仅用于经验查阅，不提供修改和重新审核。</p></div><label><Search size={14}/><input placeholder="搜索案例、设备或编号" value={query} onChange={e=>setQuery(e.target.value)}/></label></section><div className="case-archive-grid">{items.map(item=><button onClick={()=>onOpen(item)} key={item.id}><header><small>{item.id}</small><span>{item.dataLevel==="collecting"?"资料收集中":"已归档"}</span></header><h3>{item.title}</h3><p>{item.site} · {item.equipment}</p><div><em>{item.faultType}</em><strong>{item.handledAt}</strong></div></button>)}</div></main>; }
function ReadonlyCase({ item, onBack }) { if(!item)return null; return <main className="admin-page"><PageBack onBack={onBack} label="返回历史案例"/><section className="readonly-case-sheet"><header><div><span>{item.id} · 只读归档</span><h1>{item.title}</h1><p>{item.site} · {item.equipment}</p></div><span className="admin-status status-archived_with_knowledge">{item.dataLevel==="collecting"?"资料收集中":"已归档"}</span></header><div className="readonly-case-grid"><Fact label="故障现象 / 类型" value={item.faultType}/><Fact label="最终原因" value={item.cause}/><Fact label="处理方法" value={item.resolution}/><Fact label="恢复结果" value={item.result}/><Fact label="工程师 / 专家" value={`${item.engineer} / ${item.expert}`}/><Fact label="关联知识" value={item.knowledgeTitle}/></div><p className="admin-readonly-note"><ShieldCheck size={13}/>该案例为历史摘要，仅支持查阅。</p></section></main>; }
const knowledgeDetailFields = [
  ["symptoms", "异常现象"], ["causes", "可能原因"], ["checks", "检查顺序"],
  ["actions", "处理建议"], ["safety", "安全要求"], ["recoveryCriteria", "恢复标准"],
  ["exclusions", "适用边界"],
];

const verificationLabels = { official_document: "官方手册已核实", expert_confirmed: "专家已确认", verified_case: "真实案例已验证", collecting: "资料收集中" };
const applicabilityLabels = { exact_model: "指定型号", same_series: "同系列参考", cross_brand_general: "跨品牌通用原则", engineering_inference: "工程推导" };

function KnowledgeLibrary({ items, manuals, onDynamic, onGraph }) {
  const [contentType, setContentType] = useState("knowledge");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const manualsById = useMemo(() => Object.fromEntries(manuals.map((item) => [item.id, item])), [manuals]);
  const faultTypes = useMemo(() => [...new Set(items.map((item) => item.faultType).filter(Boolean))], [items]);
  const manufacturers = useMemo(() => [...new Set(manuals.map((item) => item.manufacturer))], [manuals]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleKnowledge = items.filter((item) => {
    const matchesQuery = !normalizedQuery || `${item.id} ${item.title} ${item.equipment} ${item.faultType}`.toLowerCase().includes(normalizedQuery);
    return matchesQuery && (filter === "all" || item.faultType === filter);
  });
  const visibleManuals = manuals.filter((item) => {
    const matchesQuery = !normalizedQuery || `${item.id} ${item.title} ${item.manufacturer} ${item.publication} ${item.productScope.join(" ")}`.toLowerCase().includes(normalizedQuery);
    return matchesQuery && (filter === "all" || item.manufacturer === filter);
  });

  function switchType(nextType) {
    setContentType(nextType); setFilter("all"); setSelected(null);
  }

  return <main className="admin-page maintenance-library-page">
    <section className="maintenance-library-hero">
      <div><span>MAINTENANCE KNOWLEDGE CENTER</span><h1>检修知识库</h1><p>把真实案例形成的经验、结构化检修知识和厂商原始手册分层管理，所有结论都能回到来源。</p></div>
      <div className="maintenance-library-metrics"><p><strong>{items.length}</strong><span>知识条目</span></p><p><strong>{manuals.length}</strong><span>厂商手册</span></p><p><strong>{new Set(items.flatMap((item) => item.sourceRefs?.map((ref) => ref.documentId) || [])).size}</strong><span>已引用资料</span></p></div>
    </section>
    <section className="maintenance-library-toolbar">
      <div className="maintenance-content-tabs"><button className={contentType === "knowledge" ? "active" : ""} onClick={() => switchType("knowledge")}><BookOpen size={15}/><span>知识条目<small>案例经验与检修方法</small></span><em>{items.length}</em></button><button className={contentType === "manual" ? "active" : ""} onClick={() => switchType("manual")}><FileText size={15}/><span>检修手册<small>厂商原始资料</small></span><em>{manuals.length}</em></button></div>
      <div className="maintenance-library-filters"><label><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={contentType === "knowledge" ? "搜索故障、设备或知识编号" : "搜索厂商、型号或手册编号"}/></label><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">{contentType === "knowledge" ? "全部故障类别" : "全部厂商"}</option>{(contentType === "knowledge" ? faultTypes : manufacturers).map((item) => <option value={item} key={item}>{item}</option>)}</select></div>
    </section>

    {contentType === "knowledge" ? <div className="maintenance-knowledge-grid">{visibleKnowledge.map((item, index) => <button className={`maintenance-knowledge-card ${item.id === "KB-008" ? "dynamic" : ""}`} style={{"--card-index": index}} onClick={() => setSelected({ type: "knowledge", item })} key={item.id}><header><span>{item.id} · V{item.version || "1.0"}</span><em>{item.id === "KB-008" ? "唯一完整案例闭环" : verificationLabels[item.verificationLevel] || "基础知识"}</em></header><div className="maintenance-card-icon"><BookOpen size={18}/></div><h3>{item.title}</h3><p>{item.summary || `${item.equipment}的${item.faultType}检修知识。`}</p><footer><span>{item.faultType}</span><strong>{item.sourceRefs?.length ? `${item.sourceRefs.length} 份手册依据` : item.sourceCaseIds?.length ? "真实案例来源" : "知识库基线"}<ChevronRight size={13}/></strong></footer></button>)}</div>
      : <div className="maintenance-manual-list">{visibleManuals.map((item, index) => <button className={`maintenance-manual-card ${item.editionStatus === "historical" ? "historical" : ""}`} style={{"--card-index": index}} onClick={() => setSelected({ type: "manual", item })} key={item.id}><div className="manual-spine"><FileText size={20}/><span>PDF</span></div><div className="manual-card-main"><header><span>{item.manufacturer}</span><em>{item.publication}</em>{item.editionStatus === "historical" && <b>历史版本</b>}</header><h3>{item.title}</h3><p>{item.productScope.join(" · ")}</p><div>{item.faultDomains.slice(0, 5).map((domain) => <i key={domain}>{domain}</i>)}</div></div><aside><strong>{item.pageCount}</strong><span>页</span><em>{item.relatedKnowledgeCount} 条关联知识</em><ChevronRight size={16}/></aside></button>)}</div>}
    {(contentType === "knowledge" ? visibleKnowledge : visibleManuals).length === 0 && <div className="maintenance-library-empty"><Search size={22}/><strong>没有匹配内容</strong><span>请调整搜索词或筛选条件</span></div>}

    {selected && <div className="maintenance-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="maintenance-detail-drawer">
      <button className="maintenance-detail-close" onClick={() => setSelected(null)} aria-label="关闭详情"><X size={17}/></button>
      {selected.type === "knowledge" ? <KnowledgeLibraryDetail item={selected.item} manualsById={manualsById} onDynamic={onDynamic} onGraph={onGraph}/> : <ManualLibraryDetail item={selected.item} knowledge={items} onKnowledge={(item) => setSelected({ type: "knowledge", item })}/>}
    </aside></div>}
  </main>;
}

function KnowledgeLibraryDetail({ item, manualsById, onDynamic, onGraph }) {
  const sources = item.sourceRefs || [];
  return <div className="maintenance-detail-content"><header><span>{item.id} · V{item.version || "1.0"}</span><em>{verificationLabels[item.verificationLevel] || (item.id === "KB-008" ? "真实案例动态知识" : "知识库基线")}</em><h2>{item.title}</h2><p>{item.summary || `${item.equipment} · ${item.faultType}`}</p></header><div className="maintenance-detail-meta"><p><span>适用设备</span><strong>{item.equipment}</strong></p><p><span>故障类别</span><strong>{item.faultType}</strong></p><p><span>适用范围</span><strong>{applicabilityLabels[item.applicability] || "项目既有知识"}</strong></p></div>{item.content && <section className="maintenance-dynamic-summary"><Sparkles size={16}/><div><strong>当前发布内容</strong><p>{item.content}</p></div></section>}{knowledgeDetailFields.map(([key, label]) => item[key]?.length ? <section className="maintenance-detail-section" key={key}><h3>{label}</h3><ol>{item[key].map((value) => <li key={value}>{value}</li>)}</ol></section> : null)}<section className="maintenance-source-section"><header><div><span>依据与来源</span><h3>{sources.length ? "可追溯到手册页码" : "既有知识来源"}</h3></div><ShieldCheck size={18}/></header>{sources.length ? sources.map((ref) => { const manual = manualsById[ref.documentId]; return <a href={manual?.fileUrl} target="_blank" rel="noreferrer" key={`${ref.documentId}-${ref.pages.join("-")}`}><FileText size={16}/><span><strong>{manual?.title || ref.documentId}</strong><small>{manual?.manufacturer} · PDF 第 {ref.pages.join("、")} 页</small></span><ExternalLink size={13}/></a>; }) : <p>该条目来自项目既有知识基线，后续可继续补充具体手册页码或案例证据。</p>}</section><footer className="maintenance-detail-actions">{item.id === "KB-008" && <button className="admin-secondary" onClick={onDynamic}>查看案例版本变化</button>}<button className="admin-primary" onClick={() => onGraph(item.id)}><Network size={14}/>在知识图谱中定位</button></footer></div>;
}

function ManualLibraryDetail({ item, knowledge, onKnowledge }) {
  const related = knowledge.filter((entry) => item.relatedKnowledgeIds.includes(entry.id));
  return <div className="maintenance-detail-content manual-detail-content"><header><span>{item.manufacturer} · {item.publication}</span><em className={item.editionStatus === "historical" ? "historical" : ""}>{item.editionStatus === "historical" ? "历史版本 · 仅用于旧设备对照" : "厂商原始检修资料"}</em><h2>{item.title}</h2><p>{item.productScope.join(" · ")}</p></header><div className="manual-detail-facts"><p><span>发布日期</span><strong>{item.documentDate}</strong></p><p><span>语言 / 页数</span><strong>{item.language.toUpperCase()} · {item.pageCount} 页</strong></p><p><span>参考等级</span><strong>{applicabilityLabels[item.referencePriority] || item.referencePriority}</strong></p></div><section className="maintenance-detail-section"><h3>覆盖检修领域</h3><div className="manual-domain-cloud">{item.faultDomains.map((domain) => <span key={domain}>{domain}</span>)}</div></section><section className="manual-related-knowledge"><header><span>已加工内容</span><strong>{related.length} 条知识</strong></header>{related.length ? related.map((entry) => <button onClick={() => onKnowledge(entry)} key={entry.id}><BookOpen size={15}/><span><strong>{entry.title}</strong><small>{entry.id} · {entry.faultType}</small></span><ChevronRight size={14}/></button>) : <p>{item.editionStatus === "historical" ? "历史手册只用于旧设备和版本差异核对，不作为当前检修结论的直接来源。" : "该手册已进入资料库，相关知识条目将在后续批次人工复核后补充。"}</p>}</section><section className={`manual-scope-note ${item.editionStatus === "historical" ? "historical" : ""}`}><ShieldCheck size={17}/><div><strong>使用边界</strong><p>{item.editionStatus === "historical" ? "本资料对应历史版设备和结构。现场操作前必须核对铭牌、硬件版本和当前 Ed.6 手册，不得直接套用旧版参数。" : "具体参数、端子、拆装步骤和报警阈值只适用于对应型号；跨型号使用时仅参考通用故障机理和检查方法。"}</p></div></section><footer className="maintenance-detail-actions"><a className="admin-primary" href={item.fileUrl} target="_blank" rel="noreferrer"><FileText size={14}/>打开原始 PDF<ExternalLink size={13}/></a></footer></div>;
}
function PeoplePage({ users }) { return <main className="admin-page"><section className="admin-list-head"><div><span>PEOPLE & ROLES</span><h1>工程师与专家</h1><p>第一版只读展示人员、班组和专业角色。</p></div></section><div className="people-grid">{users.map(user=><article key={user.id}><div><UserRound size={20}/></div><span>{user.id}</span><h3>{user.name}</h3><p>{user.role==="engineer"?`${user.site} · ${user.team}`:user.role==="expert"?"全案例审核 · 知识发布":"账号与组织管理"}</p><em>{user.status==="active"?"正常":"停用"}</em></article>)}</div></main>; }

const engineerBaseRelations = [
  {source:"TEMP/FAN 告警",relation:"发生于",target:"ACP-4000 / IPC-610"},
  {source:"滤网积尘",relation:"影响",target:"设备散热"},
];

function EngineerLocalKnowledgeGraph({ snapshot, sync, busy, onSync, onVerify }) {
  const hasUpdate=sync?.status==="update_available";
  const relations=snapshot?.relations?.length?snapshot.relations:engineerBaseRelations;
  const knowledge=snapshot?.knowledge||{};
  return <main className="admin-page engineer-local-graph">
    <section className="local-graph-head"><div><span>ENGINEER LOCAL KNOWLEDGE</span><h1>我的本地知识图谱</h1><p>这里展示当前真正参与现场问答与诊断的本地知识版本。</p></div><div className="local-version-card"><small>LOCAL VERSION</small><strong>KB-008 · V{snapshot?.version||"1.0"}</strong><em className={hasUpdate?"update":"current"}>{hasUpdate?`发现 V${sync.latest_version}`:"已是最新"}</em></div></section>
    {hasUpdate&&<section className="local-update-callout"><div><RefreshCcw size={20}/><span><strong>专家发布了新的检修知识</strong><p>同步后将更新本地图谱、判断条件和现场问答推荐动作。</p></span></div><button disabled={busy} onClick={onSync}>{busy?<Loader2 className="spin" size={14}/>:<RefreshCcw size={14}/>}同步到 V{sync.latest_version}</button></section>}
    <div className="local-graph-grid"><section className="local-relation-board"><header><div><span>本机当前生效关系</span><h3>{relations.length} 条诊断关系</h3></div><em>读取 SQLite 本地快照</em></header><GraphPreview edges={relations} active/><footer><ShieldCheck size={14}/><span>{hasUpdate?"专家的新关系尚未同步，因此暂不参与现场诊断。":`当前关系已用于工程师现场问答 · 同步时间 ${snapshot?.syncedAt?new Date(snapshot.syncedAt).toLocaleString("zh-CN"):"初始版本"}`}</span></footer></section><aside className="local-knowledge-detail"><span>当前本地知识内容</span><h3>{snapshot?.version==="1.0"?"基础散热检查知识":"专家回流知识"}</h3>{snapshot?.version==="1.0"?<p className="local-v1-content">{knowledge.content||"检查滤网、风道、风扇接线及基础告警参数。"}</p>:<>{[["异常现象","symptoms"],["判断条件","conditions"],["故障原因","causes"],["处理方法","resolution"],["安全要求","safety"],["恢复标准","recovery"]].map(([label,key])=><Fact label={label} value={knowledge[key]} key={key}/>)}</>}<div className="local-source-record"><small>知识来源</small><strong>{snapshot?.sourceCaseId||"系统预置知识"}</strong><span>{snapshot?.publishedBy||"V1.0 基线"}</span></div></aside></div>
    <div className="local-graph-actions"><p>{hasUpdate?"先同步，再验证同一问题的回答变化。":"本地图谱已是最新，可以验证专家知识是否参与问答。"}</p>{!hasUpdate&&<button className="admin-primary" onClick={onVerify}>进入现场知识验证 <ArrowRight size={14}/></button>}</div>
  </main>;
}

const graphNodeMeta = {
  device:{label:"研华 ACP-4000 / IPC-610",type:"设备",tone:"device",x:50,y:47}, alarm:{label:"TEMP/FAN 告警",type:"异常告警",tone:"alarm",x:18,y:22}, speed:{label:"风扇转速低于 500 rpm",type:"监测参数",tone:"metric",x:18,y:67}, dust:{label:"滤网积尘",type:"故障原因",tone:"cause",x:49,y:13},
  aging:{label:"风扇老化",type:"故障原因",tone:"cause",x:79,y:23,changed:true}, clean:{label:"清理滤网与风道",type:"检修动作",tone:"action",x:80,y:57}, replace:{label:"更换老化风扇",type:"检修动作",tone:"action",x:49,y:81,changed:true}, recovered:{label:"告警解除 · 转速恢复",type:"恢复标准",tone:"recovery",x:81,y:84}, source:{label:"CASE-ACP4000-001",type:"来源案例",tone:"source",x:17,y:89,changed:true},
};
const graphLinks = [["alarm","device","发生于",false],["speed","alarm","触发",false],["dust","device","影响散热",false],["device","clean","执行",false],["aging","speed","导致",true],["aging","replace","处理",true],["replace","recovered","恢复",true],["source","aging","证据来源",true]];

function ExpertKnowledgeGraph({ state, data, onReview }) {
  const [view,setView]=useState(state.knowledgePublished?"changes":"current");
  const [selected,setSelected]=useState("device");
  const published=state.knowledgePublished;
  const savedRelations=published?state.publishedRelations:state.expertDraft?.relations;
  const liveRelations=savedRelations?.length?savedRelations:data.graphChanges;
  const graphNodes=Object.fromEntries(Object.entries(graphNodeMeta).filter(([,item])=>!item.changed));
  const positions=[[79,23],[49,81],[81,84],[17,89],[70,72],[31,80],[83,42],[31,32]];
  const findNode=(label)=>Object.keys(graphNodes).find((id)=>graphNodes[id].label===label);
  liveRelations.forEach((relation,index)=>[relation.source,relation.target].forEach((label,side)=>{if(!findNode(label)){const known=Object.values(graphNodeMeta).find((item)=>item.label===label);const [x,y]=positions[(index*2+side)%positions.length];graphNodes[`live-${index}-${side}`]={...(known||{type:"专家新增节点",tone:side?"action":"cause",x,y}),label,changed:true};}}));
  graphNodes.source={...graphNodeMeta.source,changed:true};
  const liveLinks=liveRelations.map((relation)=>[findNode(relation.source),findNode(relation.target),relation.relation,true]);
  const displayLinks=[...graphLinks.filter(([, , ,changed])=>!changed),...liveLinks,...(liveLinks[0]?.[0]?[["source",liveLinks[0][0],"证据来源",true]]:[])];
  const visibleLinks=view==="changes"?displayLinks.filter(([, , ,changed])=>changed):displayLinks;
  const node=graphNodes[selected]||graphNodes.device;
  const related=displayLinks.filter(([from,to])=>from===selected||to===selected).map(([from,to,relation])=>`${graphNodes[from].label} ${relation} ${graphNodes[to].label}`);
  return <main className="admin-page expert-graph-page">
    <section className="graph-page-head"><div><span>EXPERT KNOWLEDGE GRAPH</span><h1>检修知识图谱</h1><p>查看设备、异常、原因、检修动作和案例来源之间的可追溯关系。</p></div><div className="graph-view-switch"><button className={view==="current"?"active":""} onClick={()=>setView("current")}>当前图谱</button><button className={view==="changes"?"active":""} onClick={()=>setView("changes")}>本次更新 <i>{published?`${liveRelations.length} 条`:"待发布"}</i></button></div></section>
    <section className={`graph-release-strip ${published?"published":"pending"}`}><div>{published?<Check size={16}/>:<Loader2 size={16}/>}<span><strong>{published?"KB-008 V1.1 已写入知识图谱":"当前案例关系尚未正式发布"}</strong><small>{published?"新增关系已绑定来源案例 CASE-ACP4000-001":"完成专家审核后，可在“本次更新”中查看正式变化"}</small></span></div>{!published&&state.caseStatus==="pending_expert_review"&&<button onClick={onReview}>进入专家审核 <ArrowRight size={14}/></button>}</section>
    <div className="expert-graph-layout"><section className="knowledge-graph-canvas"><div className="graph-canvas-legend"><span><i className="device"/>设备</span><span><i className="alarm"/>异常</span><span><i className="cause"/>原因</span><span><i className="action"/>检修动作</span><span><i className="recovery"/>恢复</span><span><i className="source"/>来源</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{visibleLinks.map(([from,to,,changed],index)=><line className={changed?published?"changed published":"changed pending":""} x1={graphNodes[from].x} y1={graphNodes[from].y} x2={graphNodes[to].x} y2={graphNodes[to].y} key={`${from}-${to}-${index}`}/>)}</svg>{Object.entries(graphNodes).map(([id,item])=><button className={`knowledge-node ${item.tone} ${item.changed?"changed":""} ${selected===id?"selected":""} ${view==="changes"&&!item.changed?"muted":""}`} style={{left:`${item.x}%`,top:`${item.y}%`}} onClick={()=>setSelected(id)} key={id}><small>{item.type}</small><strong>{item.label}</strong>{item.changed&&<em>{published?"专家已确认":"待发布"}</em>}</button>)}{view==="changes"&&<div className="graph-change-caption"><Sparkles size={14}/><span>{published?"高亮显示专家实际发布的关系":"这些关系来自当前审核草稿，发布后将正式写入图谱"}</span></div>}</section>
      <aside className="graph-node-detail"><span>节点详情</span><div className={`node-detail-icon ${node.tone}`}><Network size={20}/></div><small>{node.type}</small><h2>{node.label}</h2><dl><div><dt>适用设备</dt><dd>ACP-4000 / IPC-610</dd></div><div><dt>知识版本</dt><dd>KB-008 · V{state.knowledgeVersion}</dd></div><div><dt>来源案例</dt><dd>{node.changed?"CASE-ACP4000-001":"设备知识库"}</dd></div><div><dt>审核状态</dt><dd>{node.changed?published?"专家已确认":"等待专家发布":"既有知识"}</dd></div></dl><section><strong>关联关系</strong>{related.map(item=><p key={item}>{item}</p>)}</section>{node.changed&&<footer><GitBranch size={14}/><span>专家账号 · {published?"已发布到正式图谱":"审核草稿"}</span></footer>}</aside></div>
  </main>;
}
function GraphPreview({ edges, active }) { return <div className={`graph-preview ${active?"active":""}`}>{edges.map((edge,index)=><div className="graph-edge" style={{"--edge-index":index}} key={`${edge.source}-${edge.target}`}><span>{edge.source}</span><i>{edge.relation}</i><span>{edge.target}</span></div>)}</div>; }
function Fact({ label, value }) { return <div className="admin-fact"><span>{label}</span><p>{value || "—"}</p></div>; }
function PageBack({ onBack, label }) { return <button className="admin-back" onClick={onBack}><ChevronRight size={14}/>{label}</button>; }
