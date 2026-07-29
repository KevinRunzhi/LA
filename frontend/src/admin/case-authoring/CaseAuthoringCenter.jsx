import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileJson,
  GitBranch,
  Loader2,
  Play,
  RefreshCcw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { caseAuthoringApi } from "../../api/caseAuthoringClient";
import { loadPlatformSession } from "../../api/platformTransport";
import "./case-authoring-center.css";

const MODULES = ["registry", "manifest", "intake", "diagnosis", "guide", "assistant", "output", "feedbackAndGraph"];
const LABELS = {
  registry: "路由注册",
  manifest: "案例清单",
  intake: "接诊",
  diagnosis: "诊断",
  guide: "检修向导",
  assistant: "步骤问答",
  output: "记录/作业卡",
  feedbackAndGraph: "知识与图谱",
};

export default function CaseAuthoringCenter() {
  const session = useMemo(loadPlatformSession, []);
  const [data, setData] = useState({ catalog: [], drafts: [], releases: [] });
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(null);
  const [moduleName, setModuleName] = useState("manifest");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [version, setVersion] = useState("1.1.0");
  const [suggestion, setSuggestion] = useState(null);

  async function loadLists() {
    if (!session) return;
    const [catalog, drafts, releases] = await Promise.all([
      caseAuthoringApi.catalog(),
      caseAuthoringApi.drafts(),
      caseAuthoringApi.releases(),
    ]);
    setData({ catalog: catalog.items, drafts: drafts.items, releases: releases.items });
  }

  async function openDraft(id, nextModule = moduleName) {
    const value = await caseAuthoringApi.draft(id);
    setSelectedId(id);
    setDraft(value);
    setModuleName(nextModule);
    setSource(JSON.stringify(value.modules[nextModule], null, 2));
  }

  useEffect(() => {
    loadLists().catch(showError);
  }, []);

  useEffect(() => {
    if (draft?.modules?.[moduleName]) {
      setSource(JSON.stringify(draft.modules[moduleName], null, 2));
    }
  }, [moduleName]);

  function showError(nextError) {
    setMessage("");
    setError(`${nextError.message}${nextError.requestId ? ` · ${nextError.requestId}` : ""}`);
  }

  async function action(name, callback, success) {
    setBusy(name);
    setError("");
    setMessage("");
    try {
      const result = await callback();
      if (result?.id?.startsWith("CDR-")) await openDraft(result.id);
      else if (selectedId) await openDraft(selectedId);
      await loadLists();
      setMessage(success);
      return result;
    } catch (nextError) {
      showError(nextError);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function saveModule() {
    let content;
    try {
      content = JSON.parse(source);
    } catch (parseError) {
      setError(`JSON 无法解析：${parseError.message}`);
      return;
    }
    await action(
      "save",
      () => caseAuthoringApi.updateModule(draft.id, moduleName, draft.revision, content),
      `${LABELS[moduleName]}模块已保存，revision 已更新`,
    );
  }

  if (!session) {
    return <main className="case-authoring-empty"><GitBranch/><h1>案例配置与发布中心</h1><p>当前为录制兼容会话。使用专家或管理员平台账号登录后，可配置、校验、审核并发布 Agent 案例包。</p></main>;
  }

  return (
    <main className="case-authoring-center">
      <header className="case-authoring-head">
        <div><span>CASE FACTORY</span><h1>案例配置与 Agent 发布</h1><p>草稿经确定性校验与专家审核后，编译为 Agent 可读取的标准 JSON 包。</p></div>
        <button onClick={() => loadLists()}><RefreshCcw/>刷新</button>
      </header>
      {(error || message) && <div className={`case-authoring-notice ${error ? "error" : ""}`}>{error ? <AlertTriangle/> : <Check/>}{error || message}</div>}
      <div className="case-authoring-layout">
        <aside className="case-authoring-catalog">
          <h2>案例来源</h2>
          {data.catalog.map((item) => <article key={item.caseId}><strong>{item.identity.shortTitle || item.identity.title}</strong><span>{item.caseId} · V{item.packageVersion}</span><button disabled={busy} onClick={() => action("clone", () => caseAuthoringApi.createDraft(item.caseId), "案例草稿已创建")}><GitBranch/>克隆为草稿</button></article>)}
          <h2>草稿</h2>
          {data.drafts.map((item) => <button className={`case-draft-item ${selectedId === item.id ? "active" : ""}`} key={item.id} onClick={() => openDraft(item.id)}><span>{item.title}</span><small>{item.status} · r{item.revision}</small></button>)}
          <h2>发布版本</h2>
          {data.releases.map((item) => <article className="case-release-item" key={item.id}><strong>{item.caseId} · V{item.version}</strong><span>{item.status} · {item.packageSha256.slice(0, 10)}</span>{item.status !== "active" && <button onClick={() => action("activate", () => caseAuthoringApi.activate(item.id), "历史案例版本已重新激活")}><Play/>激活</button>}</article>)}
        </aside>

        {!draft ? <section className="case-authoring-welcome"><FileJson/><h2>选择或克隆一个案例</h2><p>内置案例不会被修改，所有编辑首先进入数据库草稿。</p></section> : <section className="case-authoring-workspace">
          <header><div><span>{draft.caseId}</span><h2>{draft.title}</h2><p>状态 {draft.status} · revision {draft.revision}</p></div><div><button disabled={busy || !["draft","rejected"].includes(draft.status)} onClick={saveModule}><Save/>保存模块</button><button disabled={busy || !["draft","rejected"].includes(draft.status)} onClick={() => action("validate", () => caseAuthoringApi.validate(draft.id), "当前 revision 校验完成")}><ShieldCheck/>校验</button></div></header>
          <nav>{MODULES.map((name) => <button className={moduleName === name ? "active" : ""} key={name} onClick={() => setModuleName(name)}>{LABELS[name]}</button>)}</nav>
          <textarea spellCheck="false" value={source} readOnly={!["draft","rejected"].includes(draft.status)} onChange={(event) => setSource(event.target.value)}/>
          <div className="case-authoring-validation">
            <h3>最近校验</h3>
            {!draft.latestValidation ? <p>尚未校验当前草稿。</p> : <>
              <strong className={draft.latestValidation.status}>{draft.latestValidation.status}</strong>
              <span>revision {draft.latestValidation.revision} · {draft.latestValidation.packageSha256?.slice(0, 16) || "无 package hash"}</span>
              {draft.latestValidation.errors.map((item) => <p className="validation-error" key={`${item.code}-${item.message}`}>{item.code}：{item.message}</p>)}
              {draft.latestValidation.warnings.map((item) => <p key={JSON.stringify(item)}>{item.code}：{item.caseId || ""}</p>)}
            </>}
          </div>
          <footer>
            <button disabled={busy || !["draft","rejected"].includes(draft.status)} onClick={() => action("suggest", async () => { const value = await caseAuthoringApi.suggest(draft.id, moduleName === "registry" || moduleName === "manifest" ? "diagnosis" : moduleName, `${draft.title} ${LABELS[moduleName]}`); setSuggestion(value); return value; }, "已生成有证据引用的编制建议")}><Sparkles/>证据建议</button>
            <button disabled={busy || !["draft","rejected"].includes(draft.status)} onClick={() => action("submit", () => caseAuthoringApi.submit(draft.id, draft.revision), "草稿已提交审核")}><Send/>提交审核</button>
            <button disabled={busy || draft.status !== "ready_for_review"} onClick={() => action("approve", () => caseAuthoringApi.review(draft.id, "approved", "模块结构、证据引用和 Agent 合同已核对"), "案例草稿已批准")}><Check/>批准</button>
            <button disabled={busy || draft.status !== "ready_for_review"} onClick={() => action("reject", () => caseAuthoringApi.review(draft.id, "rejected", "请根据校验和证据意见修改"), "案例草稿已驳回")}><AlertTriangle/>驳回</button>
            <label>发布版本<input value={version} onChange={(event) => setVersion(event.target.value)}/></label>
            <button disabled={busy || draft.status !== "approved"} onClick={() => action("publish", () => caseAuthoringApi.publish(draft.id, version), "案例已发布，运行时 Agent 注册表已刷新")}><Play/>发布</button>
          </footer>
          {suggestion && <section className="case-suggestion"><h3><Sparkles/>Agent 编制建议</h3><strong>{suggestion.suggestion.summary}</strong><p>{suggestion.suggestion.recommendedAction}</p><span>关联证据 {suggestion.evidence.length} 条：{suggestion.suggestion.evidenceIds.join("、") || "当前无匹配证据"}</span></section>}
        </section>}
      </div>
      {busy && <div className="case-authoring-busy"><Loader2 className="spin"/>正在执行 {busy}…</div>}
    </main>
  );
}
