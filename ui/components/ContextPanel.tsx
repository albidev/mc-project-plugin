import React from 'react';
import { Clock3, FileText, GitCommitHorizontal, UserRound } from 'lucide-react';
import type { CommitDetail, Focus, Snapshot } from '../types';
import { GitLogTerminal } from './GitLogTerminal';
import { StatusStates } from './StatusStates';
import './ContextPanel.css';

type DiffLineType = 'hunk' | 'added' | 'removed' | 'context';

function classifyDiffLine(line: string): DiffLineType {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'added';
  if (line.startsWith('-') && !line.startsWith('---')) return 'removed';
  return 'context';
}

const MONO = '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

function DiffView({ diff, surface = true }: { diff: string; surface?: boolean }) {
  if (!surface) {
    return (
      <pre style={{ fontFamily: MONO }} className="m-0 min-w-0 whitespace-pre-wrap break-all px-2 py-1 text-[11px] leading-[1.05]">
        {diff.split('\n').map((line, index) => {
          const type = classifyDiffLine(line);
          const color = type === 'hunk' ? 'text-accent' : type === 'added' ? 'text-[#00e676]' : type === 'removed' ? 'text-[#ff5570]' : 'text-slate-300';
          return <span key={`${index}-${line}`} data-diff-line-type={type} className={`block ${color}`}>{line}</span>;
        })}
      </pre>
    );
  }
  return (
    <div data-testid="context-diff" tabIndex={0} className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-auto overflow-y-scroll overscroll-contain bg-[#08090c] px-1.5 py-1 focus:outline-none">
      <pre style={{ fontFamily: MONO }} className="m-0 min-w-max whitespace-pre text-[11px] leading-[1.05]">
        {diff.split('\n').map((line, index, lines) => {
          const type = classifyDiffLine(line);
          const color = type === 'hunk' ? 'text-accent' : type === 'added' ? 'text-[#00e676]' : type === 'removed' ? 'text-[#ff5570]' : 'text-slate-300';
          return <React.Fragment key={`${index}-${line}`}><span data-diff-line-type={type} className={`block ${color}`}>{line}</span>{index < lines.length - 1 ? '\n' : ''}</React.Fragment>;
        })}
      </pre>
    </div>
  );
}

function CommitDetailView({ detail, loading }: { detail?: unknown; loading?: boolean }) {
  if (loading) return <div data-testid="context-commit-inspector" className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#08090c] p-3 font-mono text-xs text-text-muted" role="status">Loading commit detail…</div>;
  if (!detail || typeof detail !== 'object') return (
    <div data-testid="context-commit-inspector" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden bg-[#08090c] p-3 text-center text-text-muted">
      <GitCommitHorizontal size={22} className="text-accent" />
      <p className="text-xs">Select a commit to inspect its details.</p>
    </div>
  );
  const commit = detail as CommitDetail;
  return (
    <div data-testid="context-commit-inspector" className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#08090c]">
      <div data-testid="context-commit-scroll" tabIndex={0} className="min-h-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto px-3 py-2 focus:outline-none">
        <div data-testid="context-commit-detail"><h3 className="break-words text-sm font-semibold leading-snug text-text">{commit.subject}</h3><div className="mt-1 grid grid-cols-1 gap-0.5 text-[11px] text-text-muted"><span className="inline-flex items-center gap-1.5"><UserRound size={12} className="text-fuchsia-300" />{commit.author}</span><span className="inline-flex items-center gap-1.5"><Clock3 size={12} className="text-sky-300" />{commit.date}</span><span className="break-all font-mono text-[10px] text-text-subtle">{commit.hash}</span></div></div>
        <section>
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted"><FileText size={12} />Changed files <span className="text-text-subtle">{commit.files.length}</span></div>
          <div className="divide-y divide-[#1a1c22]">
            {commit.files.length === 0 ? <p className="px-1 py-2 text-xs text-text-muted">No file changes reported.</p> : commit.files.map((file) => (
              <div key={file.path} className="flex items-center justify-between gap-3 px-1 py-1 text-[11px]"><span className="min-w-0 truncate font-mono text-text" title={file.path}>{file.path}</span><span className="shrink-0 font-mono text-[10px]"><span className="text-[#00e676]">+{file.additions}</span><span className="ml-2 text-[#ff5570]">-{file.deletions}</span></span></div>
            ))}
          </div>
        </section>
        {commit.diff && <details className="overflow-hidden" open><summary className="cursor-pointer border-y border-[#1a1c22] px-1 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Diff preview</summary><DiffView diff={commit.diff} surface={false} /></details>}
      </div>
    </div>
  );
}

export function ContextBreadcrumb({ label, branch, commitMessage, commitCount, onBranchClick }: { label: 'DIFF' | 'HISTORY' | 'COMMIT' | 'CONTEXT'; branch: string; commitMessage?: string; commitCount?: number; onBranchClick?: () => void }) {
  return <div data-testid="context-breadcrumb" className="flex h-8 min-h-8 max-h-8 shrink-0 min-w-0 items-center gap-1.5 overflow-hidden border-b border-[#3a4152] bg-[#1e2330] px-2 font-mono text-[12px] leading-none">
    <span className="shrink-0 font-semibold tracking-[0.1em] text-[#b794f6]">{label}</span><span className="text-slate-500">/</span>
    {onBranchClick
      ? <span data-testid="context-breadcrumb-branch" role="link" tabIndex={0} onClick={onBranchClick} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onBranchClick(); } }} className="min-w-0 cursor-pointer truncate text-left text-slate-300 hover:text-white hover:underline focus:outline-none focus-visible:underline" title={branch}>{branch}</span>
      : <span className="min-w-0 truncate text-slate-300" title={branch}>{branch}</span>}
    {commitMessage && <><span className="text-slate-600">/</span><span data-testid="context-breadcrumb-message" className="min-w-0 truncate text-slate-400" title={commitMessage}>{commitMessage}</span></>}
    {commitCount !== undefined && <span className="ml-auto shrink-0 text-slate-500">{commitCount} commits</span>}
  </div>;
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

  const branchCommitDetail = Boolean(isBranch && showingBranchCommit);
  const detailSubject = detail && typeof detail === 'object' && 'subject' in detail ? String(detail.subject) : undefined;
  const label: 'DIFF' | 'HISTORY' | 'COMMIT' | 'CONTEXT' = isFile ? 'DIFF' : isCommit || branchCommitDetail ? 'COMMIT' : isBranch ? 'HISTORY' : 'CONTEXT';
  const breadcrumbBranch = isFile ? focus.value : isCommit ? (detail && typeof detail === 'object' && 'hash' in detail ? String(detail.hash).slice(0, 7) : rightLabel) : isBranch ? focus.value : rightLabel;
  const breadcrumbMessage = isCommit ? detailSubject : branchCommitDetail ? selectedBranchCommit?.subject : undefined;

  const logUnavailable = branchCapability?.status === 'error' || branchCapability?.status === 'unavailable';
  const logEmpty = branchEntries === undefined || branchEntries.length === 0;

  return (
    <section data-testid="context-section" className="flex min-h-[520px] min-w-0 flex-col overflow-hidden bg-[#08090c] md:h-full md:min-h-0">
      <ContextBreadcrumb label={label} branch={breadcrumbBranch} commitMessage={breadcrumbMessage} commitCount={label === 'HISTORY' ? branchEntries?.length : undefined} onBranchClick={branchCommitDetail ? () => onSelectCommit?.(undefined) : undefined} />

      <div data-testid="context-body" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#08090c]">
        {isCommit || branchCommitDetail
          ? <CommitDetailView detail={detail} loading={loading} />
          : isFile && typeof contextual === 'string'
            ? <DiffView diff={contextual} />
            : isBranch
              ? <div data-testid="context-branch-log" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  {logUnavailable ? <div className="p-4"><StatusStates state="error" label="branch log" /></div>
                    : logEmpty ? <div className="p-4"><StatusStates state="empty" label="branch log" /></div>
                      : <>
                          {branchCapability?.status === 'stale' && <div role="status" className="border-b border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">Branch history is stale; showing last-known-good data.</div>}
                          <GitLogTerminal branch={focus.value} commits={branchEntries} selectedHash={selectedBranchHash} onSelectCommit={onSelectCommit ?? (() => undefined)} />
                        </>}
                </div>
              : loading
                ? <div className="p-4 font-mono text-xs text-text-muted" role="status">Loading detail…</div>
                : contextual !== undefined
                  ? <pre data-testid="context-detail" className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-text-muted">{typeof contextual === 'string' ? contextual : JSON.stringify(contextual, null, 2)}</pre>
                  : <div className="p-4 font-mono text-xs text-text-muted" role="status">No context data is available for this selection.</div>}
      </div>
    </section>
  );
}
