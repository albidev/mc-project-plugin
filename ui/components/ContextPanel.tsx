import React from 'react';
import { Clock3, FileText, GitCommitHorizontal, UserRound } from 'lucide-react';
import type { CommitDetail, Focus, Snapshot } from '../types';
import { GitLogBreadcrumb, GitLogTerminal } from './GitLogTerminal';
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
    <div data-testid="context-diff" className="mc-project-diff-scroll min-h-0 min-w-0 max-h-full max-w-full flex-1 overflow-x-auto overflow-y-scroll overscroll-contain bg-[#08090c] px-1 py-0.5">
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

function CommitInspector({ detail, loading }: { detail?: unknown; loading?: boolean }) {
  if (loading) return <aside data-testid="context-commit-inspector" className="min-h-0 h-full min-w-0 border-t border-border bg-[#0b0c10] p-4 xl:border-l xl:border-t-0" role="status">Loading commit detail…</aside>;
  if (!detail || typeof detail !== 'object') return <aside data-testid="context-commit-inspector" className="min-h-0 h-full min-w-0 border-t border-border bg-[#0b0c10] p-4 xl:border-l xl:border-t-0"><div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center text-text-muted"><GitCommitHorizontal size={22} className="text-accent" /><p className="text-xs">Select a commit to inspect its details.</p></div></aside>;
  const commit = detail as CommitDetail;
  return (
    <aside data-testid="context-commit-inspector" className="flex min-h-0 h-full min-w-0 flex-col overflow-hidden border-t border-border bg-[#0b0c10] xl:border-l xl:border-t-0">
      <div data-testid="context-commit-scroll" className="min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto p-4">
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

  const contextual = isFile ? snapshot.fileDiffs[focus.value] : isBranch ? snapshot.branchLogs[focus.value] : detail;
  const branchCapability = isBranch ? snapshot.capabilities.branchLogs : undefined;
  const branchEntries = isBranch && Array.isArray(contextual) ? contextual : undefined;
  const showingBranchCommit = Boolean(isBranch && selectedCommitHash && branchEntries?.some((entry) => entry.hash === selectedCommitHash));
  const selectedBranchCommit = branchEntries?.find((entry) => entry.hash === selectedCommitHash);
  const selectedBranchHash = (selectedCommitHash && branchEntries?.some((entry) => entry.hash === selectedCommitHash) ? selectedCommitHash : undefined) ?? branchEntries?.find((entry) => entry.hash === snapshot.head)?.hash ?? branchEntries?.[0]?.hash;
  const rightLabel = focus?.value ?? snapshot.project_id;

  return (
    <section data-testid="context-section" className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[var(--control-radius)] border border-border bg-surface-raised md:h-full md:min-h-0">
      {isFile && <GitLogBreadcrumb label="DIFF" branch={focus.value} />}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#08090c]">
        {isCommit ? <><GitLogBreadcrumb label="COMMIT" branch={(detail && typeof detail === 'object' && 'hash' in detail ? String(detail.hash).slice(0, 7) : rightLabel)} commitMessage={detail && typeof detail === 'object' && 'subject' in detail ? String(detail.subject) : undefined} /><CommitInspector detail={detail} loading={loading} /></> : loading && !isBranch ? <div className="p-4 font-mono text-xs text-text-muted" role="status">Loading detail…</div> : isBranch ? showingBranchCommit ? <><GitLogBreadcrumb branch={focus.value} commitMessage={selectedBranchCommit?.subject} onBranchClick={() => onSelectCommit?.(undefined)} /><CommitInspector detail={detail} loading={loading} /></> : <div data-testid="context-branch-log" className="flex min-h-[520px] min-w-0 flex-col md:h-full md:min-h-0">{branchCapability?.status === 'error' || branchCapability?.status === 'unavailable' ? <div className="p-4"><StatusStates state="error" label="branch log" /></div> : branchEntries === undefined || branchEntries.length === 0 ? <div className="p-4"><StatusStates state="empty" label="branch log" /></div> : <><div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:h-full">{branchCapability?.status === 'stale' && <div role="status" className="border-b border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">Branch history is stale; showing last-known-good data.</div>}<GitLogTerminal branch={focus.value} commits={branchEntries} selectedHash={selectedBranchHash} onSelectCommit={onSelectCommit ?? (() => undefined)} /></div></>}</div> : contextual !== undefined ? isFile && typeof contextual === 'string' ? <DiffViewer diff={contextual} /> : <pre data-testid={focus?.kind === 'commit' ? 'context-commit-detail' : 'context-detail'} className="m-0 max-h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-text-muted">{typeof contextual === 'string' ? contextual : JSON.stringify(contextual, null, 2)}</pre> : <div className="p-4 font-mono text-xs text-text-muted" role="status">No context data is available for this selection.</div>}
      </div>
    </section>
  );
}
