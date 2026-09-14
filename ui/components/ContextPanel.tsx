import React from 'react';
import { ArrowLeftRight, FilePenLine } from 'lucide-react';
import type { Commit, Focus, Snapshot } from '../types';

type DiffLineType = 'hunk' | 'added' | 'removed' | 'context';

function classifyDiffLine(line: string): DiffLineType {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'added';
  if (line.startsWith('-') && !line.startsWith('---')) return 'removed';
  return 'context';
}

function DiffViewer({ diff }: { diff: string }) {
  return (
    <div data-testid="context-diff" className="min-w-0 max-w-full overflow-x-auto rounded border border-[#292b35] bg-[#0d0e13] px-3 py-2">
      <pre className="m-0 min-w-max whitespace-pre font-mono text-[11px] leading-5">
        {diff.split('\n').map((line, index, lines) => {
          const type = classifyDiffLine(line);
          const color = type === 'hunk' ? 'text-violet-300' : type === 'added' ? 'text-emerald-300' : type === 'removed' ? 'text-red-300' : 'text-slate-400';
          return <React.Fragment key={`${index}-${line}`}><span data-diff-line-type={type} className={`block ${color}`}>{line}</span>{index < lines.length - 1 ? '\n' : ''}</React.Fragment>;
        })}
      </pre>
    </div>
  );
}

function BranchLog({ entries }: { entries: Commit[] }) {
  return (
    <div data-testid="context-branch-log" className="space-y-2 text-slate-300">
      {entries.slice(0, 200).map((entry) => {
        const refs = Array.isArray(entry.refs) ? entry.refs.join(', ') : entry.refs;
        const parents = entry.parents?.join(', ');
        return (
          <div key={entry.hash} data-testid="branch-log-entry" className="min-w-0 border-b border-[#292b35] pb-2 last:border-b-0">
            <div className="whitespace-pre-wrap break-words">
              <span className="mr-2 text-amber-300">●</span>
              <span className="text-violet-300">{entry.shortHash ?? entry.hash}</span>
              <span className="ml-2 text-slate-500">({entry.hash})</span>
              {refs && <span className="ml-2 text-emerald-300">[{refs}]</span>}
              {entry.merge !== undefined && <span className="ml-2 text-amber-300">[merge: {String(entry.merge)}]</span>}
              <span className="ml-2">{entry.subject}</span>
            </div>
            {(entry.author || entry.date || entry.authoredAt) && (
              <div className="ml-5 whitespace-pre-wrap break-words text-slate-500">
                {entry.author && <span>Author: {entry.author}</span>}
                {(entry.date || entry.authoredAt) && <span>{entry.author ? ' · ' : ''}Date: {entry.date ?? entry.authoredAt}</span>}
              </div>
            )}
            {parents !== undefined && <div className="ml-5 whitespace-pre-wrap break-words text-slate-500">Parents: {parents || '(root)'}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function ContextPanel({ focus, snapshot, detail, loading }: { focus: Focus | null; snapshot: Snapshot; detail?: unknown; loading?: boolean }) {
  const isFile = focus?.kind === 'file';
  const isBranch = focus?.kind === 'branch';
  const title = isFile ? 'Diff del file selezionato' : isBranch ? `Branch log · ${focus.value}` : focus ? 'Commit detail' : 'Context';
  const contextual = isFile ? snapshot.fileDiffs[focus.value] : isBranch ? snapshot.branchLogs[focus.value] : detail;
  const rightLabel = focus?.value ?? snapshot.project_id;

  return (
    <section data-testid="context-section" className="flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-[var(--control-radius)] border border-border bg-surface-raised">
      <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2 text-sm font-semibold">
        <FilePenLine size={15} className="shrink-0 text-accent" />
        <span className="truncate">{title}</span>
        <span data-testid={isFile ? 'context-file-path' : undefined} className="ml-auto truncate font-mono text-[11px] text-text-muted">{rightLabel}</span>
      </div>
      {isFile && (
        <div className="flex items-center gap-2 border-b border-[#292b35] bg-[#15161d] px-3 py-1.5 font-mono text-[10px] text-text-muted">
          <span className="text-amber-300">Working tree</span>
          <ArrowLeftRight size={13} className="text-slate-500" aria-hidden="true" />
          <span className="rounded border border-[#3a3b46] px-1.5 py-0.5 text-slate-300">HEAD</span>
          <span className="ml-auto text-slate-500">Unified diff</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden bg-[#101116] p-4 font-mono text-[11px] leading-relaxed">
        {loading ? <div className="text-text-muted" role="status">Loading detail…</div> : contextual !== undefined ? isFile && typeof contextual === 'string' ? <DiffViewer diff={contextual} /> : isBranch && Array.isArray(contextual) ? <BranchLog entries={contextual} /> : <pre data-testid="context-detail" className="m-0 whitespace-pre-wrap break-words text-text-muted">{typeof contextual === 'string' ? contextual : JSON.stringify(contextual, null, 2)}</pre> : <div className="text-text-muted" role="status">No context data is available for this selection.</div>}
      </div>
    </section>
  );
}
