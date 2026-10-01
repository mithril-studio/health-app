import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Model output is untrusted: no raw HTML, remote images or executable URLs. */
export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="message-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={["img"]}
        components={{
          h1: ({ children }) => <h2>{children}</h2>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="markdown-table" tabIndex={0}>
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
