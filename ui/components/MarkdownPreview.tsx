import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** External http(s) links open in a new tab; relative links render as text (repo files need auth tokens). */
function MarkdownLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  if (href && /^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  }
  return <span>{children}</span>
}

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div data-testid="md-preview" className="bg-surface min-w-0 overflow-auto p-4 text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MarkdownLink }}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
