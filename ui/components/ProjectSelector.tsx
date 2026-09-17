import React from 'react';
import { ChevronDown, FolderGit2 } from 'lucide-react';
import type { ProjectSummary } from '../types';

export function ProjectSelector({ active, projects, open, onToggle, onSelect }: { active?: ProjectSummary; projects: ProjectSummary[]; open: boolean; onToggle: () => void; onSelect: (id: string) => void }) {
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
  return <div ref={containerRef} className="relative min-w-0">
    <button type="button" aria-expanded={open} aria-controls="project-options" onClick={onToggle} className="flex min-h-9 w-full items-center gap-2 rounded-none text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent/15 text-accent"><FolderGit2 size={15} /></span>
      <span className="min-w-0 flex-1"><span className="block truncate cp-13 font-semibold leading-tight text-text">{active?.name ?? 'No project selected'}</span><span className="block truncate cp-11 leading-tight text-text-muted">{active?.remote ?? active?.project_id ?? '—'}</span></span>
      <ChevronDown size={14} className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id="project-options" className="absolute left-0 right-0 top-full z-50 mt-1 w-[min(400px,calc(100vw-40px))] rounded-lg border border-border bg-surface-raised p-1 shadow-lg" role="listbox" aria-label="Other projects">
      {projects.map((project) => <button type="button" role="option" key={project.project_id} onClick={() => onSelect(project.project_id)} className="mt-0.5 flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-xs hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"><FolderGit2 size={14} className="text-text-subtle" /><span className="min-w-0 flex-1 truncate">{project.name}<span className="ml-2 text-text-muted">{project.remote}</span></span></button>)}
    </div>}
  </div>;
}
