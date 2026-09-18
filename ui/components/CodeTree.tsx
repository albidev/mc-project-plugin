import React from 'react'
import { ChevronRight, FileText, Folder } from 'lucide-react'
import { projectsApi } from '../api'
import { treeKeyboardAction } from '../routeBehavior'
import type { TreeEntry } from '../types'

type TreeRow = {
  key: string
  label: string
  path: string
  kind: 'dir' | 'file'
}

function buildRows(entries: TreeEntry[]): TreeRow[] {
  return entries
    .slice()
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
    .map((entry) => ({ key: entry.path, label: entry.name, path: entry.path, kind: entry.type }))
}

export function CodeTree({
  projectId,
  selectedPath,
  onSelectFile,
  api = projectsApi,
}: {
  projectId: string
  selectedPath?: string
  onSelectFile: (path: string) => void
  api?: Pick<typeof projectsApi, 'tree'>
}) {
  // cache[dirPath] = rows of that directory; '' is the workspace root.
  const [cache, setCache] = React.useState<Record<string, TreeRow[]>>({})
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [loadingDir, setLoadingDir] = React.useState<string | undefined>()
  const [errorDirs, setErrorDirs] = React.useState<Record<string, string>>({})
  const [truncatedDirs, setTruncatedDirs] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    let cancelled = false
    setCache({})
    setExpanded({})
    setErrorDirs({})
    setTruncatedDirs({})
    setLoadingDir('')
    api
      .tree(projectId, '')
      .then((tree) => {
        if (cancelled) return
        setCache({ '': buildRows(tree.entries) })
        setTruncatedDirs(tree.truncated ? { '': true } : {})
      })
      .catch(() => {
        if (!cancelled) setErrorDirs({ '': 'Unable to load workspace.' })
      })
      .finally(() => {
        if (!cancelled) setLoadingDir(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, api])

  const loadDir = async (dirPath: string) => {
    if (loadingDir !== undefined) return
    if (cache[dirPath] !== undefined) {
      setExpanded((value) => ({ ...value, [dirPath]: value[dirPath] === false ? true : false }))
      return
    }
    setLoadingDir(dirPath)
    try {
      const tree = await api.tree(projectId, dirPath)
      setCache((value) => ({ ...value, [dirPath]: buildRows(tree.entries) }))
      setTruncatedDirs((value) => ({ ...value, [dirPath]: tree.truncated }))
      setExpanded((value) => ({ ...value, [dirPath]: true }))
    } catch {
      setErrorDirs((value) => ({ ...value, [dirPath]: 'Unable to load.' }))
    } finally {
      setLoadingDir(undefined)
    }
  }

  const toggle = (row: TreeRow) => {
    if (row.kind === 'file') {
      onSelectFile(row.path)
      return
    }
    void loadDir(row.path)
  }

  const focusRow = (index: number) =>
    document.querySelector<HTMLElement>(`[data-code-tree-index="${index}"]`)?.focus()
  const focusRelative = (current: number, delta: number) => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-code-tree-index]')]
      .map((el) => Number(el.getAttribute('data-code-tree-index')))
      .sort((a, b) => a - b)
    const position = rows.indexOf(current)
    if (position < 0) return
    const target = rows[Math.min(Math.max(position + delta, 0), rows.length - 1)]
    if (target !== undefined) focusRow(target)
  }

  const renderRows = (rows: TreeRow[], depth: number): React.ReactNode => {
    return rows.map((row, index) => {
      const isDir = row.kind === 'dir'
      const isOpen = isDir ? expanded[row.path] === true : false
      const children = isDir && isOpen ? cache[row.path] ?? [] : []
      const loading = loadingDir === row.path
      const failed = errorDirs[row.path] !== undefined
      const truncated = truncatedDirs[row.path] === true
      return (
        <React.Fragment key={row.key}>
          <div
            role="treeitem"
            data-testid="code-tree-row"
            data-code-tree-index={index}
            data-tree-path={row.path}
            data-tree-kind={row.kind}
            style={{ minHeight: '24px', height: '24px' }}
            aria-level={depth + 1}
            aria-expanded={isDir ? isOpen : undefined}
            aria-selected={selectedPath === row.path}
            tabIndex={selectedPath === row.path ? 0 : -1}
            onClick={() => toggle(row)}
            onKeyDown={(event) => {
              const action = treeKeyboardAction(
                { kind: row.kind, label: row.label, path: row.path, depth } as never,
                event.key,
                isOpen,
              )
              if (action === 'next') {
                event.preventDefault()
                focusRelative(index, 1)
              } else if (action === 'previous') {
                event.preventDefault()
                focusRelative(index, -1)
              } else if (action === 'expand' || action === 'collapse' || action === 'activate') {
                event.preventDefault()
                toggle(row)
              }
            }}
            className={`cp-11 focus-visible:ring-accent flex items-center gap-1 px-1.5 font-mono outline-none focus-visible:ring-1 focus-visible:ring-inset ${
              selectedPath === row.path ? 'bg-accent/15 text-text' : 'text-text-muted hover:bg-surface-sunken/60'
            }`}
          >
            <span
              style={{ paddingLeft: `${depth * 12}px`, position: 'relative' }}
              className="flex min-w-0 flex-1 items-center gap-1.5"
            >
              {depth > 0 && <span className="tree-guide" aria-hidden="true" style={{ left: `${depth * 12 - 4}px` }} />}
              {isDir ? (
                <>
                  <ChevronRight
                    size={11}
                    className={`text-text-subtle shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  />
                  <Folder size={12} className="text-accent-dim shrink-0" />
                </>
              ) : (
                <FileText size={12} className="text-text-subtle shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              {loading && (
                <span data-testid="code-tree-loading" className="cp-10 text-text-subtle shrink-0">
                  …
                </span>
              )}
            </span>
          </div>
          {isDir && isOpen && failed && (
            <div data-testid="code-tree-error" className="cp-10 text-text-muted pl-6 font-mono">
              Unable to load.
            </div>
          )}
          {isDir && isOpen && !failed && truncated && (
            <div data-testid="code-tree-truncated" className="cp-10 text-text-subtle pl-6 font-mono">
              Showing first 2000 entries
            </div>
          )}
          {isDir && isOpen && !failed && !loading && children.length === 0 && (
            <div data-testid="code-tree-empty" className="cp-10 text-text-subtle pl-6 font-mono">
              empty
            </div>
          )}
          {isDir && isOpen && !failed && children.length > 0 && renderRows(children, depth + 1)}
        </React.Fragment>
      )
    })
  }

  const rootRows = cache[''] ?? []
  if (!cache[''] && loadingDir === undefined) {
    return (
      <div data-testid="code-tree" role="tree" aria-label="Workspace tree" className="min-w-0 p-2">
        <div data-testid="code-tree-error" className="text-text-muted cp-11" role="status">
          {errorDirs[''] ?? 'Unable to load workspace.'}
        </div>
      </div>
    )
  }

  return (
    <div data-testid="code-tree" role="tree" aria-label="Workspace tree" className="min-w-0 py-0.5">
      {renderRows(rootRows, 0)}
    </div>
  )
}
