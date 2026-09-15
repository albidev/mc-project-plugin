import React from 'react';
import { ArrowLeft, ArrowLeftRight, Clock3, FilePenLine, FileText, GitCommitHorizontal, UserRound } from 'lucide-react';
import type { CommitDetail, Focus, Snapshot } from '../types';
import { GitLogTerminal } from './GitLogTerminal';
import { StatusStates } from './StatusStates';

type DiffLineType = 'hunk' | 'added' | 'removed' | 'context';

function classifyDiffLine(line: string): DiffLineType {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'added';
  if (line.startsWith('-') && !line.startsWith('---')) return 'removed';
  return 'context';
}

function DiffViewer({ diff }: { diff: string }) {
  return (
    <div data-testid="context-diff" className="min-w-0 max-w-full overflow-x-auto bg-[#08090c] px-1 py-0.5">
      <pre style={{ fontFamily: '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }} className="m-0 min-w-max whitespace-pre text-[11px] leading-[1.02]">
        {diff.split('\n').map((line, index, lines) => {
          const type = classifyDiffLine(line);
          const color = type === 'hunk' ? 'text-accent' : type === 'added' ? 'text-[#00e676]' : type === 'removed' ? 'text-[#ff5570]' : 'text-slate-300';
          return <React.Fragment key={`${index}-${line}`}><span data-diff-line-type={type} className={`block ${color}`}>{line}</span>{index < lines.length - 1 ? '\n' : ''}</React.Fragment>;
        })}
      </pre>
    </div>
  );
}

function CommitInspector({ detail, loading, onBack }: { detail?: unknown; loading?: boolean; onBack?: () => void }) {
  if (loading) return <aside data-testid="context-commit-inspector" className="min-w-0 border-t border-border bg-[#0b0c10] p-4 xl:border-l xl:border-t-0" role="status">Loading commit detail…</aside>;
  if (!detail || typeof detail !== 'object') return <aside data-testid="context-commit-inspector" className="min-w-0 border-t border-border bg-[#0b0c10] p-4 xl:border-l xl:border-t-0"><div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center text-text-muted"><GitCommitHorizontal size={22} className="text-accent" /><p className="text-xs">Select a commit to inspect its details.</p></div></aside>;
  const commit = detail as CommitDetail;
  return (
    <aside data-testid="context-commit-inspector" className="min-w-0 overflow-hidden border-t border-border bg-[#0b0c10] xl:border-l xl:border-t-0">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">{onBack && <button type="button" aria-label="Back to branch log" onClick={onBack} className="-ml-2 inline-flex min-h-8 min-w-8 items-center justify-center rounded text-text-muted hover:bg-surface-sunken hover:text-text"><ArrowLeft size={15} /></button>}<GitCommitHorizontal size={15} className="shrink-0 text-accent" /><span className="text-xs font-semibold text-text">Commit details</span><span className="ml-auto rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-amber-300">{commit.hash.slice(0, 7)}</span></div>
      <div className="space-y-4 overflow-y-auto p-4">
        <div data-testid="context-commit-detail"><h3 className="break-words text-sm font-semibold leading-snug text-text">{commit.subject}</h3><div className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-text-muted"><span className="inline-flex items-center gap-2"><UserRound size={13} className="text-fuchsia-300" />{commit.author}</span><span className="inline-flex items-center gap-2"><Clock3 size={13} className="text-sky-300" />{commit.date}</span><span className="break-all font-mono text-[10px] text-text-subtle">{commit.hash}</span></div></div>
        <section>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted"><FileText size={13} />Changed files <span className="text-text-subtle">{commit.files.length}</span></div>
          <div className="divide-y divide-border rounded border border-border">
            {commit.files.length === 0 ? <p className="p-3 text-xs text-text-muted">No file changes reported.</p> : commit.files.map((file) => (
              <div key={file.path} className="flex items-center justify-between gap-3 px-3 py-2 text-[11px]"><span className="min-w-0 truncate font-mono text-text" title={file.path}>{file.path}</span><span className="shrink-0 font-mono text-[10px]"><span className="text-[#00e676]">+{file.additions}</span><span className="ml-2 text-[#ff5570]">-{file.deletions}</span></span></div>
            ))}
          </div>
        </section>
        {commit.diff && <details className="overflow-hidden rounded border border-border" open><summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Diff preview</summary><DiffViewer diff={commit.diff} /></details>}
      </div>
    </aside>
  );
}

export function ContextPanel({ focus, snapshot, detail, loading, selectedCommitHash, onSelectCommit }: { focus: Focus | null; snapshot: Snapshot; detail?: unknown; loading?: boolean; selectedCommitHash?: string; onSelectCommit?: (hash?: string) => void }) {
  const isFile = focus?.kind === 'file';
  const isBranch = focus?.kind === 'branch';
  const isCommit = focus?.kind === 'commit';
  const title = isFile ? 'Diff del file selezionato' : isBranch ? `Branch log · ${focus.value}` : focus ? 'Commit detail' : 'Context';
  const contextual = isFile ? snapshot.fileDiffs[focus.value] : isBranch ? snapshot.branchLogs[focus.value] : detail;
  const branchCapability = isBranch ? snapshot.capabilities.branchLogs : undefined;
  const branchEntries = isBranch && Array.isArray(contextual) ? contextual : undefined;
  const showingBranchCommit = Boolean(isBranch && selectedCommitHash && branchEntries?.some((entry) => entry.hash === selectedCommitHash));
  const selectedBranchHash = (selectedCommitHash && branchEntries?.some((entry) => entry.hash === selectedCommitHash) ? selectedCommitHash : undefined) ?? branchEntries?.find((entry) => entry.hash === snapshot.head)?.hash ?? branchEntries?.[0]?.hash;
  const rightLabel = focus?.value ?? snapshot.project_id;

  return (
    <section data-testid="context-section" className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[var(--control-radius)] border border-border bg-surface-raised">
      {!isCommit && <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-4 py-3"><FilePenLine size={15} className="shrink-0 text-accent" /><span className="truncate text-sm font-semibold">{title}</span><span data-testid={isFile ? 'context-file-path' : undefined} className="ml-auto truncate font-mono text-[11px] text-text-muted" title={rightLabel}>{rightLabel}</span></div>}
      {isFile && <div className="flex items-center gap-2 border-b border-border bg-[#0b0c10] px-4 py-2 font-mono text-[10px] text-slate-300"><span className="text-amber-300">Working tree</span><ArrowLeftRight size={13} className="text-slate-500" aria-hidden="true" /><span className="rounded border border-[#3a3b46] px-1.5 py-0.5 text-slate-300">HEAD</span><span className="ml-auto text-slate-500">Unified diff</span></div>}
      <div className="min-h-0 flex-1 bg-[#08090c]">
        {isCommit ? <CommitInspector detail={detail} loading={loading} /> : loading && !isBranch ? <div className="p-4 font-mono text-xs text-text-muted" role="status">Loading detail…</div> : isBranch ? showingBranchCommit ? <CommitInspector detail={detail} loading={loading} onBack={() => onSelectCommit?.(undefined)} /> : <div data-testid="context-branch-log" className="min-h-[520px] min-w-0">{branchCapability?.status === 'error' || branchCapability?.status === 'unavailable' ? <div className="p-4"><StatusStates state="error" label="branch log" /></div> : branchEntries === undefined || branchEntries.length === 0 ? <div className="p-4"><StatusStates state="empty" label="branch log" /></div> : <><div className="min-w-0 overflow-hidden">{branchCapability?.status === 'stale' && <div role="status" className="border-b border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">Branch history is stale; showing last-known-good data.</div>}<GitLogTerminal branch={focus.value} commits={branchEntries} selectedHash={selectedBranchHash} onSelectCommit={onSelectCommit ?? (() => undefined)} /></div></>}</div> : contextual !== undefined ? isFile && typeof contextual === 'string' ? <DiffViewer diff={contextual} /> : <pre data-testid={focus?.kind === 'commit' ? 'context-commit-detail' : 'context-detail'} className="m-0 max-h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-text-muted">{typeof contextual === 'string' ? contextual : JSON.stringify(contextual, null, 2)}</pre> : <div className="p-4 font-mono text-xs text-text-muted" role="status">No context data is available for this selection.</div>}
      </div>
    </section>
  );
}
