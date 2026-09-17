import React from 'react';
import { ChevronRight, Folder } from 'lucide-react';
import { flattenFiles, type FileRow } from '../models'; import { treeKeyboardAction } from '../routeBehavior';
import type { WorkingTree } from '../types';

const STATUS_MAP: Record<string, { label: string; color: string; cls: string }> = {
  M: { label: 'M', color: 'amber', cls: 'status-M' },
  A: { label: 'A', color: 'green', cls: 'status-A' },
  D: { label: 'D', color: 'red', cls: 'status-D' },
  R: { label: 'R', color: 'cyan', cls: 'status-R' },
  '??': { label: '??', color: 'blue-gray', cls: 'status-U' },
};

export function FilesTree({ tree, selected, onSelect }: { tree: WorkingTree; selected?: string; onSelect: (path: string) => void }) {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const rows = flattenFiles(tree);
  const visibleRows = rows.filter((row, index) => row.depth === 0 || rows.slice(0, index).every((parent) => parent.kind !== 'folder' || !row.path.startsWith(`${parent.path}/`) || expanded[parent.path] !== false));
  const toggle = (path: string) => setExpanded((value) => ({ ...value, [path]: value[path] === false }));
  const focusRow = (index: number) => document.querySelector<HTMLElement>(`[data-tree-index="${index}"]`)?.focus();
  const activate = (row: FileRow) => row.kind === 'folder' ? toggle(row.path) : onSelect(row.path);
  return <div data-testid="files-section" role="tree" aria-label="Files" className="min-w-0 py-0.5 [scrollbar-width:thin]">
    {visibleRows.map((row, index) => {
      const status = row.status ? STATUS_MAP[row.status] : undefined;
      return <div key={row.path} data-tree-index={index} data-tree-path={row.path} data-hit-area-min="24" role="treeitem" style={{ minHeight: '24px', height: '24px' }} aria-selected={selected === row.path} aria-level={row.depth + 1} aria-expanded={row.kind === 'folder' ? expanded[row.path] !== false : undefined} tabIndex={selected === row.path || (selected === undefined && index === 0) ? 0 : -1} onClick={() => activate(row)} onKeyDown={(event) => { if (treeKeyboardAction(row, event.key, expanded[row.path] !== false) === 'next') { event.preventDefault(); focusRow(Math.min(index + 1, visibleRows.length - 1)); } else if (event.key === 'ArrowUp') { event.preventDefault(); focusRow(Math.max(index - 1, 0)); } else if (event.key === 'Home') { event.preventDefault(); focusRow(0); } else if (event.key === 'End') { event.preventDefault(); focusRow(visibleRows.length - 1); } else if (event.key === 'ArrowRight' && row.kind === 'folder' && expanded[row.path] === false) { event.preventDefault(); toggle(row.path); } else if (event.key === 'ArrowLeft' && row.kind === 'folder' && expanded[row.path] !== false) { event.preventDefault(); toggle(row.path); } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(row); } }} className={`flex items-center gap-1 px-1.5 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent ${selected === row.path ? 'bg-accent/15 text-text' : 'text-text-muted hover:bg-surface-sunken/60'}`}><span style={{ paddingLeft: `${row.depth * 12}px`, position: 'relative' }} className="flex min-w-0 flex-1 items-center gap-1.5">{row.depth > 0 && <span className="tree-guide" aria-hidden="true" style={{ left: `${row.depth * 12 - 4}px` }} />}{row.kind === 'folder' ? <><ChevronRight size={11} className={`shrink-0 text-text-subtle transition-transform ${expanded[row.path] !== false ? 'rotate-90' : ''}`} /><Folder size={12} className="shrink-0 text-accent-dim" /></> : null}<span className="min-w-0 flex-1 truncate">{row.label}</span>{status && <span className={`status ${status.cls}`}>{status.label}</span>}</span></div>;
    })}
  </div>;
}
