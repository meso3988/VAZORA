import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Safe display of a stored Officer answer. The stored text is never changed.
 *
 *   - Only an allow-list of block/inline elements is rendered; anything else
 *     (raw HTML, scripts, iframes, MDX) is dropped by skipHtml/allowedElements.
 *   - Links the model wrote are shown as plain text, never as anchors: a
 *     model-written URL is not a trusted citation. Validated citations are
 *     rendered separately by the thread from server-checked records.
 *   - Images are reduced to their alt text.
 */
const ALLOWED = [
  "p", "br", "strong", "em", "del", "code", "pre", "blockquote", "hr",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tr", "th", "td",
  "a", "img",
];

const components: Components = {
  a: ({ children }) => <span data-md-link-text>{children}</span>,
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  h1: ({ children }) => <p className="text-base font-semibold">{children}</p>,
  h2: ({ children }) => <p className="text-[15px] font-semibold">{children}</p>,
  h3: ({ children }) => <p className="text-sm font-semibold">{children}</p>,
  h4: ({ children }) => <p className="text-sm font-semibold">{children}</p>,
  h5: ({ children }) => <p className="text-sm font-semibold">{children}</p>,
  h6: ({ children }) => <p className="text-sm font-semibold">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 ps-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 ps-5">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="border-s-2 border-line ps-3 text-muted">{children}</blockquote>,
  code: ({ children }) => <code className="rounded-sm bg-fg/5 px-1 font-mono text-[12px]">{children}</code>,
  pre: ({ children }) => <pre className="overflow-x-auto rounded-sm bg-fg/5 p-2 text-[12px]">{children}</pre>,
  table: ({ children }) => (
    <div className="-mx-1 overflow-x-auto" data-md-table>
      <table className="w-full min-w-[480px] border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-line px-2 py-1.5 text-start align-bottom font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-line/60 px-2 py-1.5 text-start align-top">{children}</td>,
};

export function OfficerMarkdown({ text }: { text: string }) {
  return (
    <div dir="auto" data-md className="flex flex-col gap-2 text-sm leading-relaxed [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        allowedElements={ALLOWED}
        unwrapDisallowed
        urlTransform={() => ""}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
