import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Gemini answers in markdown: **bold**, "* " bullets, numbered lists,
// sometimes tables or `code`. Shown as plain text, that's the raw asterisks
// you were seeing. react-markdown turns the markdown into real React
// elements (<strong>, <ul>, <table>…).
//
// Safety, which matters more now that the login token lives in localStorage:
// react-markdown does NOT render raw HTML inside the markdown by default, and
// it strips dangerous link targets like `javascript:`. So a PDF that tricks
// the model into writing <script> or a malicious link can't run code here.
// Don't add the `rehype-raw` plugin without a sanitizer.
//
// remark-gfm adds the GitHub extras the model also uses: tables,
// ~~strikethrough~~, task lists and bare URLs turned into links.

// Links open in a new tab, so following one doesn't throw away the chat.
// rel="noopener noreferrer" stops the opened page from controlling this tab.
const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
}

interface MarkdownProps {
  children: string
}

export function Markdown({ children }: MarkdownProps) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
