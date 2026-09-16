import React from 'react';
import './GitLogTerminal.css';
import { GitLogPaged, type Commit as LibraryCommit, type CustomTableRow } from '@tomplum/react-git-log';
import type { Commit } from '../types.ts';

interface GitLogTerminalProps {
  branch: string;
  commits: Commit[];
  selectedHash?: string;
  onSelectCommit: (hash?: string) => void;
}


type LibraryMeta = {
  shortHash: string;
  refs: string[];
};

type LibraryEntry = LibraryCommit & LibraryMeta;

type LibraryNodeProps = {
  commit: LibraryCommit;
  colour: string;
  rowIndex: number;
  columnIndex: number;
  nodeSize: number;
  isIndexPseudoNode: boolean;
};

// The graph column is rendered by @tomplum/react-git-log with a hard-coded row stride
// (internally `re = 40`): node y = re/2 + rowSpacing + row * re, and the graph grid uses
// `repeat(rows, 40px)`. The table row height must match that stride exactly, otherwise each
// node drifts from its own commit row by (40 - rowHeight) per row.
const LIBRARY_ROW_HEIGHT = 40;

function refClass(ref: string): string {
  if (ref.startsWith('HEAD')) return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300';
  if (/^[A-Za-z][A-Za-z0-9._-]*\/.+/.test(ref)) return 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300';
  if (ref.startsWith('tag:')) return 'border-amber-400/30 bg-amber-400/10 text-amber-300';
  return 'border-violet-400/30 bg-violet-400/10 text-violet-300';
}

function relativeDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const hours = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 3_600_000));
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} days ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', year: 'numeric' }).format(parsed);
}

function toLibraryEntries(branch: string, commits: Commit[]): LibraryEntry[] {
  return commits.map((commit, index) => {
    const refs = Array.isArray(commit.refs) ? [...commit.refs] : commit.refs ? [commit.refs] : [];
    return {
      hash: commit.hash,
      branch,
      parents: commit.parents ?? [],
      children: [],
      message: commit.subject,
      committerDate: commit.date ?? commit.authoredAt ?? new Date(0).toISOString(),
      authorDate: commit.authoredAt,
      author: commit.author ? { name: commit.author } : undefined,
      isBranchTip: index === 0 || refs.some((ref) => ref.startsWith('HEAD')),
      shortHash: commit.shortHash ?? commit.hash.slice(0, 7),
      refs,
    };
  });
}

export function GitLogTerminal({ branch, commits, selectedHash, onSelectCommit }: GitLogTerminalProps) {
  const entries = React.useMemo(() => toLibraryEntries(branch, commits), [branch, commits]);

  const renderRow: CustomTableRow = ({ commit, selected, backgroundColour }) => {
    const meta = commit as LibraryEntry;
    const isSelected = selected || meta.hash === selectedHash;

    return (
      <div
        data-testid="git-log-commit-row"
        data-commit-hash={meta.hash}
        aria-selected={isSelected}
        className={`flex h-10 w-full min-w-0 items-center text-left font-mono text-[11px] ${isSelected ? 'text-white' : 'text-slate-300'}`}
        style={{
          height: LIBRARY_ROW_HEIGHT,
          minHeight: LIBRARY_ROW_HEIGHT,
          maxHeight: LIBRARY_ROW_HEIGHT,
          boxSizing: 'border-box',
        }}
      >
        <div
          className="grid h-6 min-h-6 w-full min-w-0 grid-cols-[7ch_minmax(0,1fr)_14ch_14ch] items-center gap-1.5 hover:bg-[#111923]"
          style={{
            height: 24,
            minHeight: 24,
            maxHeight: 24,
            boxSizing: 'border-box',
            backgroundColor: isSelected ? backgroundColour : 'transparent',
          }}
        >
        {isSelected && <span data-testid="git-log-selected-row" className="sr-only">Selected commit</span>}
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-amber-300">{meta.shortHash}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2 overflow-hidden">
          <span className="flex shrink-0 gap-1 overflow-hidden">
            {meta.refs.map((ref) => (
              <span key={ref} data-testid="git-log-ref" className={`max-w-[24ch] truncate rounded border px-1 py-px text-[10px] leading-tight ${refClass(ref)}`} title={ref}>{ref}</span>
            ))}
          </span>
          <span className="min-w-0 truncate text-[12px] font-medium text-slate-100">{meta.message}</span>
        </span>
        <span className="hidden min-w-0 truncate text-fuchsia-300 xl:block" title={meta.author?.name ?? ''}>{meta.author?.name ?? ''}</span>
        <time className="min-w-0 truncate text-right text-slate-500" dateTime={meta.committerDate} title={meta.committerDate}>{relativeDate(meta.committerDate)}<span className="sr-only"> {meta.committerDate} {meta.author?.name ?? ''}</span></time>
          <span className="sr-only">{meta.hash} {meta.parents.length > 1 ? 'merge: true' : ''} {meta.parents.length ? `Parents: ${meta.parents.join(', ')}` : 'Parents: (root)'}</span>
        </div>
      </div>
    );
  };

  return (
    <section data-testid="git-log-terminal" aria-label={`Git log ${branch}`} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#08090c] text-[11px] text-slate-300 md:h-full">
      <div data-testid="git-log-scroll" tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-auto bg-[#08090c]">
        {entries.length === 0 ? (
          <div role="status" className="px-3 py-4 text-text-muted">No commits available for this branch.</div>
        ) : (
          <GitLogPaged
            entries={entries}
            branchName={branch}
            headCommitHash={entries[0]?.hash ?? ''}
            theme="dark"
            colours={['rgb(56, 189, 248)', 'rgb(244, 114, 182)', 'rgb(250, 204, 21)', 'rgb(52, 211, 153)', 'rgb(167, 139, 250)']}
            rowSpacing={0}
            showGitIndex={false}
            enableSelectedCommitStyling
            enablePreviewedCommitStyling={false}
            classes={{ containerClass: 'min-w-0 w-full' }}
            onSelectCommit={(commit) => onSelectCommit(commit?.hash)}
          >
            <GitLogPaged.GraphHTMLGrid
              nodeSize={20}
              node={({ commit, colour, nodeSize, isIndexPseudoNode }: LibraryNodeProps) => (
                <div
                  id={`commit-node-${commit.hash}`}
                  data-testid={`commit-node-${commit.hash}`}
                  aria-label={commit.hash}
                  style={{
                    width: nodeSize,
                    height: nodeSize,
                    border: `2px solid ${colour}`,
                    borderRadius: '50%',
                    boxSizing: 'border-box',
                    background: isIndexPseudoNode ? 'transparent' : '#08090c',
                    position: 'relative',
                    transform: 'translateX(-2px)',
                    zIndex: 20,
                  }}
                >
                  {commit.parents.length > 1 && <span style={{ position: 'absolute', inset: 3, borderRadius: '50%', background: colour }} />}
                </div>
              )}
              showCommitNodeTooltips={false}
              highlightedBackgroundHeight={24}
            />
            <GitLogPaged.Table row={renderRow} timestampFormat="YYYY-MM-DD HH:mm" />
          </GitLogPaged>        )}
      </div>
    </section>
  );
}
