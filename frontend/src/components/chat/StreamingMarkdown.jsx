function renderInlineMarkdown(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export function StreamingMarkdown({ content }) {
  const lines = content.split("\n");

  return (
    <div className="streaming-markdown">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div className="markdown-spacer" key={`space-${index}`} />;
        if (trimmed.startsWith("### ")) {
          return <h4 key={trimmed}>{renderInlineMarkdown(trimmed.slice(4))}</h4>;
        }
        if (trimmed.startsWith("## ")) {
          return <h3 key={trimmed}>{renderInlineMarkdown(trimmed.slice(3))}</h3>;
        }
        if (/^\d+\.\s/.test(trimmed)) {
          return <p className="markdown-step" key={trimmed}>{renderInlineMarkdown(trimmed)}</p>;
        }
        if (trimmed.startsWith("- ")) {
          return <p className="markdown-bullet" key={trimmed}>{renderInlineMarkdown(trimmed.slice(2))}</p>;
        }
        if (trimmed.startsWith("> ")) {
          return <p className="markdown-risk" key={trimmed}>{renderInlineMarkdown(trimmed.slice(2))}</p>;
        }
        return <p key={trimmed}>{renderInlineMarkdown(trimmed)}</p>;
      })}
    </div>
  );
}
