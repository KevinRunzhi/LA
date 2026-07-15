import { createPortal } from "react-dom";
import "../../styles/maintenance-job-card-print.css";

const FALLBACK_TEXT = "未记录";

function text(value) {
  if (value === 0) return "0";
  return value == null || String(value).trim() === "" ? FALLBACK_TEXT : String(value).trim();
}

function statusLabel(caseStatus) {
  if (caseStatus === "archived_with_knowledge") return "已审核并归档";
  if (caseStatus && caseStatus !== "awaiting_engineer_confirmation") return "待专家审核";
  return "检修完成";
}

function formatPrintDate(value) {
  if (!value) return FALLBACK_TEXT;
  return String(value).replaceAll("/", "-");
}

function MetricRow({ label, before, after, result }) {
  return (
    <div className="job-card-table-row">
      <strong>{label}</strong>
      <span>{text(before)}</span>
      <span>{text(after)}</span>
      <em>{result}</em>
    </div>
  );
}

function PageFooter({ recordId, page }) {
  return (
    <footer className="job-card-page-footer">
      <span>站控慧眼 · 工控机故障检修作业卡</span>
      <span>{recordId} · 第 {page} / 2 页</span>
    </footer>
  );
}

export default function MaintenanceJobCardPrint({
  record,
  scenario,
  incidentTime,
  input,
  currentUser,
  result,
  completedSteps,
  materials,
  caseStatus,
  occurredAt,
}) {
  if (typeof document === "undefined" || !record) return null;

  const steps = completedSteps || [];
  const evidence = materials || [];
  const completeCount = steps.filter((step) => step.completed !== false).length;
  const recordId = text(record.record_id);
  const site = text(scenario?.site || currentUser?.site);
  const location = text(scenario?.cabinet || "站控柜 A01");
  const engineer = text(currentUser?.name);
  const team = text(currentUser?.team);
  const summary = `${text(result.finalCause)}。已完成${text(result.actualResolution)}；${text(result.recoveryResult)}。`;

  const documentNode = (
    <main className="maintenance-job-card-print" aria-label="工控机故障检修作业卡">
      <section className="job-card-sheet job-card-sheet-first">
        <header className="job-card-document-head">
          <div className="job-card-brand">
            <span>STATION CONTROL · MAINTENANCE</span>
            <strong>站控慧眼</strong>
          </div>
          <div className="job-card-title">
            <p>检修闭环正式记录</p>
            <h1>工控机故障检修作业卡</h1>
          </div>
          <div className="job-card-document-code">
            <span>记录编号</span>
            <strong>{recordId}</strong>
            <em>{statusLabel(caseStatus)}</em>
          </div>
        </header>

        <section className="job-card-summary">
          <div className="job-card-section-index">01</div>
          <div>
            <span>本次检修结论</span>
            <p>{summary}</p>
          </div>
        </section>

        <section className="job-card-section">
          <header className="job-card-section-head">
            <div><span>02</span><h2>作业基本信息</h2></div>
            <p>设备、位置与责任信息</p>
          </header>
          <div className="job-card-fact-grid">
            <div><span>设备</span><strong>{text(record.equipment)}</strong></div>
            <div><span>场站 / 位置</span><strong>{site} · {location}</strong></div>
            <div><span>故障与告警</span><strong>{text(record.fault)}</strong></div>
            <div><span>发生时间</span><strong>{formatPrintDate(occurredAt)}</strong></div>
            <div><span>检修人员 / 班组</span><strong>{engineer} · {team}</strong></div>
            <div><span>执行完成情况</span><strong>{completeCount} / {steps.length} 项完成</strong></div>
          </div>
        </section>

        <section className="job-card-section">
          <header className="job-card-section-head">
            <div><span>03</span><h2>故障处理闭环</h2></div>
            <p>现场事实与工程师确认结果</p>
          </header>
          <div className="job-card-closure-grid">
            <article className="job-card-closure-wide">
              <span>现场现象</span>
              <p>{text(input || scenario?.default_input)}</p>
            </article>
            <article>
              <span>最终故障原因</span>
              <p>{text(result.finalCause)}</p>
            </article>
            <article>
              <span>实际处理</span>
              <p>{text(result.actualResolution)}</p>
            </article>
            <article className="job-card-closure-wide job-card-closure-result">
              <span>恢复结果</span>
              <p>{text(result.recoveryResult)}</p>
            </article>
          </div>
        </section>

        <section className="job-card-section job-card-metric-section">
          <header className="job-card-section-head">
            <div><span>04</span><h2>处理前后参数对比</h2></div>
            <p>恢复验证数据</p>
          </header>
          <div className="job-card-table">
            <div className="job-card-table-head"><span>验证项</span><span>处理前</span><span>处理后</span><span>结论</span></div>
            <MetricRow label="风扇转速" before="420 rpm" after={`${text(result.fanSpeedRpm)} rpm`} result="恢复" />
            <MetricRow label="系统温度" before="58 ℃" after={`${text(result.systemTemperatureC)} ℃`} result="下降" />
            <MetricRow label="CPU 温度" before="74 ℃" after={`${text(result.cpuTemperatureC)} ℃`} result="下降" />
            <MetricRow label="TEMP/FAN" before="告警" after="已解除" result="通过" />
            <MetricRow label="连续观察" before="-" after={`${text(result.observationMinutes)} 分钟`} result="稳定" />
          </div>
        </section>

        <PageFooter recordId={recordId} page="1" />
      </section>

      <section className="job-card-sheet job-card-sheet-second">
        <header className="job-card-continuation-head">
          <div>
            <span>工控机故障检修作业卡</span>
            <strong>执行摘要与记录追溯</strong>
          </div>
          <p>{recordId}</p>
        </header>

        <section className="job-card-section job-card-step-section">
          <header className="job-card-section-head">
            <div><span>05</span><h2>已完成检修步骤</h2></div>
            <p>{completeCount} / {steps.length} 项</p>
          </header>
          <ol className="job-card-step-list">
            {steps.map((step, index) => (
              <li key={step.id || `${step.title}-${index}`}>
                <i>{String(index + 1).padStart(2, "0")}</i>
                <div>
                  <strong>{text(step.title)}</strong>
                  <span>{text(step.safety || (index === 0 ? "安全条件已确认" : "现场执行并确认完成"))}</span>
                </div>
                <em className={step.completed === false ? "pending" : "complete"}>{step.completed === false ? "未完成" : "已完成"}</em>
              </li>
            ))}
          </ol>
        </section>

        <div className="job-card-second-grid">
          <section className="job-card-section job-card-evidence-section">
            <header className="job-card-section-head compact">
              <div><span>06</span><h2>现场证据摘要</h2></div>
              <p>{evidence.length} 项</p>
            </header>
            {evidence.length ? (
              <ul>{evidence.slice(0, 6).map((item) => <li key={item.id || item.name}><strong>{text(item.name)}</strong><span>{text(item.type)}</span></li>)}</ul>
            ) : (
              <div className="job-card-empty-evidence"><strong>本次未附加现场材料</strong><p>专家复核将以现场事实、执行步骤和恢复参数为依据。</p></div>
            )}
          </section>

          <section className="job-card-section job-card-risk-section">
            <header className="job-card-section-head compact">
              <div><span>07</span><h2>风险与后续建议</h2></div>
              <p>闭环状态</p>
            </header>
            <dl>
              <div><dt>遗留风险</dt><dd>{text(result.residualRisk)}</dd></div>
              <div><dt>后续建议</dt><dd>建议按维护周期复查滤网积尘、风道通畅和风扇转速，异常再次出现时提交专家复核。</dd></div>
              <div><dt>审核状态</dt><dd>{statusLabel(caseStatus)}</dd></div>
            </dl>
          </section>
        </div>

        <section className="job-card-section job-card-trace-section">
          <header className="job-card-section-head">
            <div><span>08</span><h2>记录追溯</h2></div>
            <p>案例与知识关联</p>
          </header>
          <div className="job-card-trace-grid">
            <div><span>来源记录</span><strong>{recordId}</strong></div>
            <div><span>目标案例</span><strong>CASE-ACP4000-001</strong></div>
            <div><span>关联知识</span><strong>KB-008 · 风扇检查与更换</strong></div>
            <div><span>作业时间</span><strong>{formatPrintDate(occurredAt)}</strong></div>
            <div><span>持续时间</span><strong>{text(incidentTime?.duration)}</strong></div>
            <div><span>复发情况</span><strong>{text(incidentTime?.recurrence)}</strong></div>
          </div>
        </section>

        <section className="job-card-signatures">
          <div><span>检修人员签字</span><i /><small>{engineer}</small></div>
          <div><span>复核人员签字</span><i /><small>________________</small></div>
          <div><span>审核日期</span><i /><small>____ 年 __ 月 __ 日</small></div>
        </section>

        <aside className="job-card-document-note">
          本作业卡记录工程师确认后的检修事实与恢复结果。详细操作方法、安全要求和型号参数以现场检修向导及对应设备手册为准。
        </aside>

        <PageFooter recordId={recordId} page="2" />
      </section>
    </main>
  );

  return createPortal(documentNode, document.body);
}
