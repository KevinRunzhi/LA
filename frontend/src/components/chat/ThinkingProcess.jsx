import { Check, Loader2 } from "lucide-react";

export function ThinkingProcess({ title = "检修诊断过程", thinkingText, statuses, visibleCount, active }) {
  return (
    <section className="thinking-process">
      <div className="thinking-process-head">
        <div>
          <span>诊断生成过程</span>
          <strong>{title}</strong>
        </div>
        {active ? (
          <span className="thinking-status active"><Loader2 size={14} className="spin" /> 生成中</span>
        ) : (
          <span className="thinking-status done"><Check size={14} /> 已完成</span>
        )}
      </div>

      {thinkingText && (
        <div className="thinking-line">
          <Loader2 size={14} className="spin" />
          <p>{thinkingText}</p>
        </div>
      )}

      <div className="retrieval-status-list">
        {statuses.slice(0, visibleCount).map((item) => (
          <article className="retrieval-status-card" key={item.title}>
            <Check size={14} />
            <div>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
