import React from 'react';
import { Check, ChevronDown, FolderGit2 } from 'lucide-react';
import type { ProjectSummary } from '../types';

export function ProjectSelector({ active, projects, open, onToggle, onSelect, activeBranch, activeChanged }: { active?: ProjectSummary; projects: ProjectSummary[]; open: boolean; onToggle: () => void; onSelect: (id: string) => void; activeBranch?: string; activeChanged?: number }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) onToggle();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onToggle(); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [open, onToggle]);

  const cardBranch = (p: ProjectSummary): string | undefined => {
    if (active && p.project_id === active.project_id) return activeBranch ?? p.default_branch;
    return p.default_branch || undefined;
  };
  const cardChanged = (p: ProjectSummary): number | undefined => {
    if (active && p.project_id === active.project_id) return activeChanged;
    return undefined;
  };

  const items = React.useMemo(() => {
    if (!active) return projects;
    return [active, ...projects.filter((p) => p.project_id !== active.project_id)];
  }, [active, projects]);

  return <div ref={containerRef} className="relative min-w-0">
    <button type="button" aria-expanded={open} aria-controls="project-options" onClick={onToggle} className="flex min-h-9 w-full items-center gap-2 rounded-none p-0 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent/15 text-accent"><FolderGit2 size={13} /></span>
      <span className="min-w-0 flex-1"><span className="block truncate cp-13 font-semibold leading-tight text-text">{active?.name ?? 'No project selected'}</span><span className="block truncate cp-11 leading-tight text-text-muted">{active?.remote ?? active?.project_id ?? '—'}</span></span>
      <ChevronDown size={14} className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id="project-options" className="overlay-w absolute left-0 right-0 top-full z-50 mt-1.5 rounded-lg border border-border bg-surface-raised p-2 shadow-lg" role="listbox" aria-label="Other projects">
      {items.map((project) => {
        const isActive = Boolean(active && project.project_id === active.project_id);
        const branch = cardBranch(project);
        const changed = cardChanged(project);
        return <button type="button" role="option" key={project.project_id} data-value={project.project_id} aria-selected={isActive} onClick={() => onSelect(project.project_id)} className={`proj-card ${isActive ? 'active' : ''}`}>
          <span className="picon"><FolderGit2 size={14} /></span>
          <span className="min-w-0"><span className="pname block truncate">{project.name}</span><span className="premote block truncate">{project.remote}</span></span>
          <span className="pstate">
            {changed !== undefined && <span className="pchanged">{changed} changed</span>}
            {branch && <span className="pbranch cp-mono">{branch}</span>}
            {isActive && <span className="pcheck" aria-label="Selected"><Check size={14} /></span>}
          </span>
        </button>;
      })}
    </div>}
  </div>;
}
