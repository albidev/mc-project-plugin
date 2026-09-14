import React from 'react';
import { ChevronDown, FolderGit2 } from 'lucide-react';
import type { ProjectSummary } from '../types';

export function ProjectSelector({ active, projects, open, onToggle, onSelect }: { active?: ProjectSummary; projects: ProjectSummary[]; open: boolean; onToggle: () => void; onSelect: (id: string) => void }) {
  return <section className="relative rounded-[var(--control-radius)] border border-border bg-surface-raised px-3 py-2">
    <button type="button" aria-expanded={open} aria-controls="project-options" onClick={onToggle} className="flex min-h-11 w-full items-center gap-3 text-left">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent"><FolderGit2 size={17} /></span>
      <span className="min-w-0 flex-1"><span className="block text-[10px] uppercase tracking-wide text-text-subtle">Selected project</span><span className="block truncate text-sm font-semibold text-text">{active?.name ?? 'No project selected'}</span><span className="block truncate text-[11px] text-text-muted">{active?.remote ?? active?.project_id ?? '—'}</span></span>
      <ChevronDown size={16} className="text-text-muted" />
    </button>
    {open && <div id="project-options" className="mt-2 border-t border-border pt-2" role="listbox" aria-label="Other projects">
      {projects.map((project) => <button type="button" role="option" key={project.project_id} onClick={() => onSelect(project.project_id)} className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs hover:bg-surface-sunken"><FolderGit2 size={14} className="text-text-subtle" /><span className="min-w-0 flex-1 truncate">{project.name}<span className="ml-2 text-text-muted">{project.remote}</span></span></button>)}
    </div>}
  </section>;
}
