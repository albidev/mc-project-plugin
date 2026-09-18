import React from 'react'
import { Check, ChevronDown, FolderGit2 } from 'lucide-react'
import type { ProjectSummary } from '../types'

export function ProjectSelector({
  active,
  projects,
  open,
  onToggle,
  onSelect,
  activeBranch,
  activeChanged,
  activeRepository,
}: {
  active?: ProjectSummary
  projects: ProjectSummary[]
  open: boolean
  onToggle: () => void
  onSelect: (id: string) => void
  activeBranch?: string
  activeChanged?: number
  activeRepository?: string
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) onToggle()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggle()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onToggle])

  const cardBranch = (p: ProjectSummary): string | undefined => {
    if (active && p.project_id === active.project_id) return activeBranch ?? p.default_branch
    return p.default_branch || undefined
  }
  const cardChanged = (p: ProjectSummary): number | undefined => {
    if (active && p.project_id === active.project_id) return activeChanged
    return undefined
  }

  const items = React.useMemo(() => {
    if (!active) return projects
    return [active, ...projects.filter((p) => p.project_id !== active.project_id)]
  }, [active, projects])

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="project-options"
        onClick={onToggle}
        className="focus-visible:ring-accent flex min-h-9 w-full items-center gap-2 rounded-none p-0 text-left focus-visible:ring-1 focus-visible:outline-none focus-visible:ring-inset"
      >
        <span className="bg-accent/15 text-accent grid h-6 w-6 shrink-0 place-items-center rounded-md">
          <FolderGit2 size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="cp-13 text-text block truncate leading-tight font-semibold">
            {active?.name ?? 'No project selected'}
          </span>
          <span className="cp-11 text-text-muted block truncate leading-tight">
            {activeRepository ?? active?.project_id ?? '—'}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={`text-text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          id="project-options"
          className="border-border bg-surface-raised absolute top-full right-0 left-0 z-50 mt-1.5 border p-2"
          role="listbox"
          aria-label="Other projects"
        >
          {items.map((project) => {
            const isActive = Boolean(active && project.project_id === active.project_id)
            const branch = cardBranch(project)
            const changed = cardChanged(project)
            return (
              <button
                type="button"
                role="option"
                key={project.project_id}
                data-value={project.project_id}
                aria-selected={isActive}
                onClick={() => onSelect(project.project_id)}
                className={`proj-card ${isActive ? 'active' : ''}`}
              >
                <span className="picon">
                  <FolderGit2 size={14} />
                </span>
                <span className="min-w-0">
                  <span className="pname block truncate">{project.name}</span>
                  <span className="premote block truncate">{project.repository ?? project.project_id}</span>
                </span>
                <span className="pstate">
                  {changed !== undefined && <span className="pchanged">{changed} changed</span>}
                  {branch && <span className="pbranch cp-mono">{branch}</span>}
                  {isActive && (
                    <span className="pcheck" aria-label="Selected">
                      <Check size={14} />
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
