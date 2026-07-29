import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  FileSearch,
  Loader2,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import { caseGenerationApi } from "../../api/caseGenerationClient";
import { manualKnowledgeApi } from "../../api/manualKnowledgeClient";
import "./case-generation-wizard.css";

const STAGE_LABELS = {
  source_snapshot: "固化资料来源",
  document_understanding: "理解文档章节",
  evidence_extraction: "提取证据",
  fault_domain: "识别故障领域",
  case_planning: "生成案例大纲",
  registry_generator: "生成路由规则",
  manifest_generator: "生成案例清单",
  intake_generator: "生成接诊模块",
  diagnosis_generator: "生成诊断模块",
  guide_generator: "生成检修向导",
  assistant_generator: "生成步骤问答",
  output_generator: "生成记录与作业卡",
  feedbackAndGraph_generator: "生成知识与图谱",
  cross_module_critic: "跨模块审查",
  targeted_repair: "定向修复",
};

export default function CaseGenerationWizard({ draft, onDraftChanged }) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [manuals, setManuals] = useState([]);
  const [recentJobs, setRecentJobs] = useState([]);
  const [templateId, setTemplateId] = useState("industrial-computer.storage");
  const [documentIds, setDocumentIds] = useState([]);
  const [query, setQuery] = useState(draft.title);
  const [job, setJob] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    Promise.all([
      caseGenerationApi.templates(),
      manualKnowledgeApi.list({ pageSize: 100 }),
      caseGenerationApi.jobs(20),
    ])
      .then(([nextTemplates, nextManuals, nextJobs]) => {
        setTemplates(nextTemplates.items);
        setManuals(nextManuals.items);
        setRecentJobs(nextJobs.items.filter((item) => item.draftId === draft.id));
        if (nextTemplates.items.length && !nextTemplates.items.some((item) => item.id === templateId)) {
          setTemplateId(nextTemplates.items[0].id);
        }
      })
      .catch(showError);
  }, [open]);

  useEffect(() => {
    if (!job || !["created", "snapshotting", "parsing_documents", "extracting_evidence", "classifying_domain", "planning", "generating_modules", "criticizing", "validating", "repairing"].includes(job.status)) return undefined;
    const timer = window.setInterval(() => refresh(job.id).catch(showError), 1500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  const outline = useMemo(
    () => artifacts.find((item) => item.type === "case_outline"),
    [artifacts],
  );

  function showError(nextError) {
    setError(`${nextError.message}${nextError.requestId ? ` · ${nextError.requestId}` : ""}`);
  }

  async function refresh(jobId = job?.id) {
    if (!jobId) return;
    const [nextJob, nextArtifacts] = await Promise.all([
      caseGenerationApi.job(jobId),
      caseGenerationApi.artifacts(jobId),
    ]);
    setJob(nextJob);
    setArtifacts(nextArtifacts.items);
  }

  async function action(name, callback) {
    setBusy(name);
    setError("");
    try {
      const result = await callback();
      if (result?.id?.startsWith("CGJ-")) {
        setJob(result);
        await refresh(result.id);
      } else if (job) {
        await refresh(job.id);
      }
      return result;
    } catch (nextError) {
      showError(nextError);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function createAndAnalyze() {
    if (!documentIds.length) {
      setError("请至少选择一份已经入库的 PDF 手册。");
      return;
    }
    const created = await action("create", () => caseGenerationApi.createJob({
      draftId: draft.id,
      templateId,
      query,
      sources: [
        ...documentIds.map((resourceId) => ({ type: "manual", resourceId })),
        { type: "case", resourceId: draft.baseCaseId || draft.caseId },
      ],
    }));
    if (created) {
      setBusy("analyze");
      try {
        const analyzed = await caseGenerationApi.run(created.id);
        setJob(analyzed);
        await refresh(created.id);
      } catch (nextError) {
        showError(nextError);
      } finally {
        setBusy("");
      }
    }
  }

  async function approveAndGenerate() {
    await action("approve", () => caseGenerationApi.approveOutline(job.id));
    setBusy("generate");
    try {
      const generated = await caseGenerationApi.run(job.id);
      setJob(generated);
      await refresh(job.id);
    } catch (nextError) {
      showError(nextError);
    } finally {
      setBusy("");
    }
  }

  async function acceptAndApply(patch) {
    setBusy(patch.id);
    setError("");
    try {
      if (patch.status === "proposed") await caseGenerationApi.acceptPatch(patch.id);
      await caseGenerationApi.applyPatch(patch.id);
      await refresh(job.id);
      await onDraftChanged();
    } catch (nextError) {
      showError(nextError);
    } finally {
      setBusy("");
    }
  }

  if (!open) {
    return <button className="case-generation-open" onClick={() => setOpen(true)}><Sparkles/>从资料自动生成案例</button>;
  }

  return (
    <section className="case-generation-wizard">
      <header><div><span>MULTI-AGENT GENERATION</span><h3>资料驱动的案例自动生成</h3><p>Agent 只生成候选模块，应用和发布仍由专家决定。</p></div><button onClick={() => setOpen(false)}><X/></button></header>
      {error && <div className="generation-error"><AlertTriangle/>{error}</div>}
      {!job && <div className="generation-setup">
        <label>故障领域模板<select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{templates.map((item) => <option value={item.id} key={item.id}>{item.title} · {item.version}</option>)}</select></label>
        <label>生成目标<textarea value={query} onChange={(event) => setQuery(event.target.value)}/></label>
        <div><strong>选择已入库手册</strong>{manuals.map((item) => <label className="manual-choice" key={item.id}><input type="checkbox" checked={documentIds.includes(item.id)} onChange={(event) => setDocumentIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}/><span>{item.title}<small>{item.pageCount} 页 · {item.faultDomains.join("、") || "未分类"}</small></span></label>)}</div>
        <button disabled={busy} onClick={createAndAnalyze}>{busy ? <Loader2 className="spin"/> : <FileSearch/>}解析资料并生成大纲</button>
        {recentJobs.length > 0 && <section className="generation-history"><strong>本草稿最近任务</strong>{recentJobs.map((item) => <button key={item.id} onClick={() => refresh(item.id)}><span>{item.faultDomain || "待识别"}<small>{item.status} · {item.progress}%</small></span><ChevronRight/></button>)}</section>}
      </div>}
      {job && <div className="generation-job">
        <div className="generation-progress"><span>{job.currentStage}</span><strong>{job.progress}%</strong><i><b style={{width:`${job.progress}%`}}/></i></div>
        <div className="generation-agents">{job.agentRuns.map((run) => <article key={run.id}><i className={run.status}/><span>{STAGE_LABELS[run.agentType] || run.agentType}<small>{run.provider} · {run.durationMs ?? "—"} ms</small></span><em>{run.status}</em></article>)}</div>
        {job.status === "awaiting_outline_review" && outline && <section className="generation-outline"><h4>案例大纲等待确认</h4><strong>{outline.content.title}</strong><div>{outline.content.steps.map((item, index) => <span key={item}>{index + 1}. {item}</span>)}</div>{outline.content.requiresExpertInput.map((item) => <p key={item}><AlertTriangle/>{item}</p>)}<footer><button onClick={() => action("reject", () => caseGenerationApi.rejectOutline(job.id, "大纲需要重新调整"))}>退回大纲</button><button onClick={approveAndGenerate}><Check/>确认大纲并生成八模块</button></footer></section>}
        {job.patches.length > 0 && <section className="generation-patches"><h4>候选模块与选择性应用</h4>{job.patches.map((patch) => <article key={patch.id}><span><strong>{patch.moduleName}</strong><small>{patch.risk} risk · base r{patch.baseRevision} · {patch.evidenceLinks.length} 条证据</small></span><em>{patch.status}</em><div>{patch.status === "proposed" && <button onClick={() => action(patch.id, () => caseGenerationApi.rejectPatch(patch.id))}>拒绝</button>}{["proposed","accepted"].includes(patch.status) && <button disabled={busy} onClick={() => acceptAndApply(patch)}>{busy === patch.id ? <Loader2 className="spin"/> : <ChevronRight/>}接受并应用</button>}</div><details><summary>查看模块差异与证据定位</summary><p>以候选模块替换当前模块；应用前将校验原模块 SHA-256。证据位置：{patch.evidenceLinks.map((item) => item.jsonPointer).filter((item, index, values) => values.indexOf(item) === index).join("、") || "等待专家补证"}</p><pre>{JSON.stringify(patch.operations[0]?.value || {}, null, 2)}</pre></details></article>)}</section>}
        {job.status === "completed" && <div className="generation-complete"><Check/>候选模块处理完成，请返回上方执行案例校验、审核和发布。</div>}
      </div>}
      {busy && <div className="generation-running"><Loader2 className="spin"/>正在执行 {busy}…</div>}
    </section>
  );
}
