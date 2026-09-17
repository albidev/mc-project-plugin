import React, { useState } from 'react';
import { Clock3, FileText, GitCommitHorizontal, UserRound } from 'lucide-react';
import { Diff, Hunk, parseDiff } from 'react-diff-view';
import type { CommitDetail, Focus, Snapshot } from '../types';
import { GitLogTerminal } from './GitLogTerminal';
import { StatusStates } from './StatusStates';
import 'react-diff-view/style/index.css';
import './ContextPanel.css';

const MONO = '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

function relativeTime(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function countChanges(hunks: readonly { changes: readonly { type: string }[] }[]): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (change.type === 'insert') added += 1;
      else if (change.type === 'delete') deleted += 1;
    }
  }
  return { added, deleted };
}

function formatPath(file: { oldPath?: string; newPath?: string }): string {
  if (file.newPath) return file.newPath;
  if (file.oldPath) return file.oldPath;
  return '';
}

interface DiffBlock { file: ReturnType<typeof parseDiff>[number]; raw: string; }

/** Split a raw git diff into per-file blocks, each carrying its parsed file plus the raw block text. */
function splitDiffBlocks(diff: string): DiffBlock[] {
  return diff.split(/^(?=diff --git)/m)
    .filter((block) => block.trim().length > 0)
    .map((raw) => ({ raw, file: parseDiff(raw)[0] }))
    .filter((block) => block.file);
}

/** True when a parsed file has hunks: only binary files and mode changes end up hunk-less. */
function isHunkless(file: ReturnType<typeof parseDiff>[number]): boolean {
  return file.hunks.length === 0;
}

function noHunkLabel(block: DiffBlock): string {
  const { file, raw } = block;
  if (/Binary files/.test(raw)) return 'binary file';
  if (/old mode|new mode/.test(raw)) return 'mode change';
  if (file.oldMode !== file.newMode) return 'mode change';
  return 'no diff content';
}

function DiffFileList({ blocks, onSelect }: { blocks: DiffBlock[]; onSelect: (block: DiffBlock) => void }) {
  return (
    <div data-testid="diff-file-list" className="sticky top-0 z-20 border-b border-border-subtle bg-surface px-2 py-1">
      {blocks.map((block) => {
        const file = block.file;
        const path = formatPath(file);
        const { added, deleted } = countChanges(file.hunks);
        return (
          <button
            key={path || file.oldPath || file.newPath}
            type="button"
            data-testid="diff-file-list-item"
            data-file-path={path}
            onClick={() => onSelect(block)}
            className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left font-mono cp-11 leading-tight text-text-muted hover:bg-surface-raised hover:text-text"
          >
            <span className="min-w-0 flex-1 truncate">{path}</span>
            {isHunkless(file) ? (
              <span className="shrink-0 cp-10 text-text-subtle">{noHunkLabel(block)}</span>
            ) : (
              <span className="shrink-0 font-mono cp-10">
                <span className="text-positive">+{added}</span>
                <span className="ml-2 text-negative">-{deleted}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function HunklessSection({ block }: { block: DiffBlock }) {
  const file = block.file;
  return (
    <div data-testid="diff-file-section" data-file-path={formatPath(file)} className="border-b border-border-subtle last:border-b-0">
      <div className="flex items-center gap-2 px-2 py-1 font-mono cp-11 leading-tight text-text">
        <span data-testid="diff-file-section-path" className="min-w-0 flex-1 truncate">{formatPath(file)}</span>
        <span className="shrink-0 font-mono cp-10 uppercase tracking-[0.08em] text-text-subtle">{noHunkLabel(block)}</span>
      </div>
    </div>
  );
}

function DiffView({ diff, viewType = 'unified', onViewTypeChange, compact }: { diff: string; viewType?: 'unified' | 'split'; onViewTypeChange?: (view: 'unified' | 'split') => void; compact?: boolean }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  let blocks: DiffBlock[] = [];
  try { blocks = splitDiffBlocks(diff); } catch { /* keep empty so the fallback shows raw text */ }

  const renderHunks = (hunks: ReturnType<typeof parseDiff>[number]['hunks']) => (hs: typeof hunks) => hs.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />);

  const scrollToFile = (block: DiffBlock) => {
    const path = formatPath(block.file);
    const scroller = containerRef.current;
    const target = scroller?.querySelector<HTMLElement>(`[data-testid="diff-file-section"][data-file-path="${path.replace(/"/g, '\\"')}"]`);
    if (!scroller || !target) return;
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top: target.offsetTop - scroller.offsetTop, behavior: 'smooth' });
    }
  };

  if (blocks.length === 0) {
    return (
      <pre data-testid={compact ? undefined : 'context-diff'} tabIndex={compact ? undefined : 0} className={compact ? 'rdv-scope m-0 min-w-0 whitespace-pre-wrap break-all px-2 py-1 cp-11 cp-leading-tight text-text-muted' : 'rdv-scope m-0 min-w-max overflow-x-auto overflow-y-scroll whitespace-pre px-2 py-1 cp-11 cp-leading-tight text-text-muted'}>{diff}</pre>
    );
  }

  return (
    <div ref={containerRef} data-testid={compact ? undefined : 'context-diff'} tabIndex={compact ? undefined : 0} className={compact ? 'rdv-scope min-w-0' : 'rdv-scope flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-x-auto overflow-y-scroll overscroll-contain bg-surface px-1.5 py-1'}>
      {blocks.length > 1 && <DiffFileList blocks={blocks} onSelect={scrollToFile} />}
      {blocks.map((block) => {
        const file = block.file;
        const path = formatPath(file);
        if (isHunkless(file)) return <HunklessSection key={path || file.oldPath} block={block} />;
        return (
          <div key={path || file.oldPath} data-testid="diff-file-section" data-file-path={path} className="border-b border-border-subtle last:border-b-0">
            <div className="flex items-center gap-2 border-b border-border-subtle bg-surface px-2 py-1 font-mono cp-11 leading-tight text-text">
              <span data-testid="diff-file-section-path" className="min-w-0 flex-1 truncate">{path}</span>
              <span className="shrink-0 font-mono cp-10 text-positive">+{countChanges(file.hunks).added}</span>
              <span className="shrink-0 font-mono cp-10 text-negative">-{countChanges(file.hunks).deleted}</span>
            </div>
            <Diff viewType={viewType} diffType={file.type ?? 'modify'} hunks={file.hunks} className="rdv-root">
              {renderHunks(file.hunks)}
            </Diff>
          </div>
        );
      })}
    </div>
  );
}

function CommitDetailView({ detail, loading }: { detail?: unknown; loading?: boolean }) {
  if (loading) return <div data-testid="context-commit-inspector" className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-sunken p-3 font-mono text-xs text-text-muted" role="status">Loading commit detail…</div>;
  if (!detail || typeof detail !== 'object') return (
    <div data-testid="context-commit-inspector" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-hidden bg-surface-sunken p-3 text-center text-text-muted">
      <GitCommitHorizontal size={22} className="text-accent" />
      <p className="text-xs">Select a commit to inspect its details.</p>
    </div>
  );
  const commit = detail as CommitDetail;
  return (
    <div data-testid="context-commit-inspector" className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-sunken">
      <div data-testid="context-commit-scroll" tabIndex={0} className="min-h-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto px-3 py-2">
        <div data-testid="context-commit-detail"><h3 className="break-words text-sm font-semibold leading-snug text-text">{commit.subject}</h3><div className="mt-1 grid grid-cols-1 gap-0.5 cp-11 text-text-muted"><span className="inline-flex items-center gap-1.5"><UserRound size={12} className="text-text-subtle" />{commit.author}</span><span className="inline-flex items-center gap-1.5"><Clock3 size={12} className="text-text-subtle" />{commit.date}</span><span className="break-all font-mono cp-10 text-text-subtle">{commit.hash}</span></div></div>
        <section>
          <div className="mb-1 flex items-center gap-1.5 cp-10 font-semibold uppercase tracking-[0.14em] text-text-muted"><FileText size={12} />Changed files <span className="text-text-subtle">{commit.files.length}</span></div>
          <div className="divide-y divide-border-subtle">
            {commit.files.length === 0 ? <p className="px-1 py-2 text-xs text-text-muted">No file changes reported.</p> : commit.files.map((file) => (
              <div key={file.path} className="flex items-center justify-between gap-3 px-1 py-1 cp-11"><span className="min-w-0 truncate font-mono text-text" title={file.path}>{file.path}</span>{file.binary ? <span className="shrink-0 font-mono cp-10 text-text-subtle">binary</span> : <span className="shrink-0 font-mono cp-10"><span className="text-positive">+{file.additions}</span><span className="ml-2 text-negative">-{file.deletions}</span></span>}</div>
            ))}
          </div>
        </section>
        {commit.diff && <details className="overflow-hidden" open><summary className="cursor-pointer border-y border-border-subtle px-1 py-1 cp-10 font-semibold uppercase tracking-[0.14em] text-text-muted">Diff preview</summary><DiffView diff={commit.diff} compact /></details>}
      </div>
    </div>
  );
}

export function ContextBreadcrumb({ label, branch, commitMessage, commitCount, onBranchClick, lastUpdated, onRefresh, fileCount, viewType = 'unified', onViewTypeChange }: { label: 'DIFF' | 'HISTORY' | 'COMMIT' | 'CONTEXT'; branch: string; commitMessage?: string; commitCount?: number; onBranchClick?: () => void; lastUpdated?: string; onRefresh?: () => void; fileCount?: number; viewType?: 'unified' | 'split'; onViewTypeChange?: (view: 'unified' | 'split') => void }) {
  return <div data-testid="context-breadcrumb" className="flex h-8 min-h-8 max-h-8 shrink-0 min-w-0 items-center gap-2 overflow-hidden border-b border-border-subtle px-2 font-mono cp-11 leading-none">
    <span className="shrink-0 font-semibold tracking-[0.1em] text-accent">{label}</span><span className="text-text-subtle">/</span>
    {onBranchClick
      ? <span data-testid="context-breadcrumb-branch" role="link" tabIndex={0} onClick={onBranchClick} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onBranchClick(); } }} className="min-w-0 cursor-pointer truncate text-left text-text-muted hover:text-text hover:underline focus-visible:underline" title={branch}>{branch}</span>
      : <span className="min-w-0 truncate text-text-muted" title={branch}>{branch}</span>}
    {commitMessage && <><span className="text-text-subtle">/</span><span data-testid="context-breadcrumb-message" className="min-w-0 truncate text-text-muted" title={commitMessage}>{commitMessage}</span></>}
    {(commitCount !== undefined || fileCount !== undefined) && <span className="ml-auto shrink-0 text-text-subtle">{commitCount !== undefined ? `${commitCount} commits` : fileCount !== undefined ? `${fileCount} file${fileCount === 1 ? '' : 's'}` : ''}</span>}
    {onViewTypeChange ? <button data-testid="diff-view-toggle" type="button" onClick={() => onViewTypeChange(viewType === 'unified' ? 'split' : 'unified')} className="shrink-0 rounded-md border border-border px-1.5 py-0.5 cp-10 text-text-muted hover:bg-surface-raised hover:text-text" aria-pressed={viewType === 'split'}>{viewType === 'unified' ? 'Split' : 'Unified'}</button> : <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 cp-10 text-text-muted">Unified</span>}
    {lastUpdated && <span className="shrink-0 font-sans cp-11 text-text-subtle">Last updated {lastUpdated}</span>}
    {onRefresh && <button data-testid="route-refresh" type="button" onClick={onRefresh} className="shrink-0 rounded-md border border-border px-2 py-0.5 cp-11 text-text-muted hover:text-text">↻ Refresh</button>}
  </div>;
}

export function ContextPanel({ focus, snapshot, detail, loading, selectedCommitHash, onSelectCommit, lastUpdated, onRefresh, fileCount }: { focus: Focus | null; snapshot: Snapshot; detail?: unknown; loading?: boolean; selectedCommitHash?: string; onSelectCommit?: (hash?: string) => void; lastUpdated?: string; onRefresh?: () => void; fileCount?: number }) {
  const [viewType, setViewType] = useState<'unified' | 'split'>('unified');
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
    <section data-testid="context-section" className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface md:h-full">
      <ContextBreadcrumb label={label} branch={breadcrumbBranch} commitMessage={breadcrumbMessage} commitCount={label === 'HISTORY' ? branchEntries?.length : undefined} onBranchClick={branchCommitDetail ? () => onSelectCommit?.(undefined) : undefined} lastUpdated={lastUpdated ? relativeTime(lastUpdated) : undefined} onRefresh={onRefresh} fileCount={fileCount} viewType={viewType} onViewTypeChange={setViewType} />

      <div data-testid="context-body" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
        {isCommit || branchCommitDetail
          ? <CommitDetailView detail={detail} loading={loading} />
          : isFile && typeof contextual === 'string'
            ? <DiffView diff={contextual} viewType={viewType} onViewTypeChange={setViewType} />
            : isBranch
              ? <div data-testid="context-branch-log" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  {logUnavailable ? <div className="p-4"><StatusStates state="error" label="branch log" /></div>
                    : logEmpty ? <div className="p-4"><StatusStates state="empty" label="branch log" /></div>
                      : <>
                          {branchCapability?.status === 'stale' && <div role="status" className="border-b border-warning/40 bg-warning/10 px-3 py-2 cp-11 text-warning">Branch history is stale; showing last-known-good data.</div>}
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
