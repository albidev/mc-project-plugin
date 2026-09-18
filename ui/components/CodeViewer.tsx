import React from 'react'
import type { ApiError } from '../api'
import type { FileResponse } from '../types'
import { StatusStates } from './StatusStates'

function lineContent(content: string): string[] {
  return content.split('\n')
}

function CodeViewerBreadcrumb({ path }: { path?: string }) {
  return (
    <div
      data-testid="code-breadcrumb"
      className="border-border-subtle cp-11 flex h-8 max-h-8 min-h-8 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b px-2 font-mono leading-none"
    >
      <span className="text-accent shrink-0 font-semibold tracking-[0.1em]">CODE</span>
      <span className="text-text-subtle">/</span>
      <span className="text-text-muted min-w-0 truncate" title={path}>
        {path ?? '—'}
      </span>
    </div>
  )
}

export function CodeViewer({
  path,
  file,
  loading,
  error,
}: {
  path?: string
  file?: FileResponse
  loading: boolean
  error?: ApiError
}) {
  return (
    <section data-testid="code-section" className="bg-surface flex min-h-0 min-w-0 flex-col overflow-hidden md:h-full">
      <CodeViewerBreadcrumb path={path} />
      <div data-testid="code-viewer" className="bg-surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {loading ? (
          <div className="text-text-muted p-4 font-mono text-xs" role="status">
            Loading file…
          </div>
        ) : error ? (
          <div data-testid="code-viewer-error" className="p-4">
            <StatusStates state="error" label="file" />
          </div>
        ) : file?.binary ? (
          <div data-testid="code-binary" className="text-text-muted p-4 font-mono text-xs" role="status">
            Binary file; preview not available.
          </div>
        ) : file?.content !== undefined ? (
          <div className="code-viewer-scroll min-h-0 flex-1 overflow-auto">
            {file.truncated && (
              <div
                data-testid="code-truncated"
                role="status"
                className="border-warning/40 bg-warning/10 cp-11 text-warning border-b px-3 py-2"
              >
                File truncated (first 262144 bytes shown).
              </div>
            )}
            <pre data-testid="code-content" className="text-text-muted m-0 min-w-max px-2 py-1 font-mono text-xs leading-relaxed whitespace-pre">
              {lineContent(file.content).map((line, index) => (
                <span key={index} className="code-line">
                  {line}
                  {'\n'}
                </span>
              ))}
            </pre>
          </div>
        ) : (
          <div className="text-text-muted p-4 font-mono text-xs" role="status">
            Select a file from the tree.
          </div>
        )}
      </div>
    </section>
  )
}

export { CodeViewerBreadcrumb }
