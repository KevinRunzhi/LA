import { FileText } from "lucide-react";

export function SourceCard({ source }) {
  return (
    <article className="source-card">
      <FileText size={15} />
      <div>
        <strong>{source.title}</strong>
        <span>{source.detail}</span>
      </div>
    </article>
  );
}
