import React from 'react';
import type { Commit } from '../types';

function relTime(iso: string | undefined): string {
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

export function CommitTimeline({ commits, onSelect, selectedCommitHash }: { commits: Commit[]; onSelect: (hash: string) => void; selectedCommitHash?: string }) {
  return <div data-testid="commits-section" className="min-w-0 py-0.5">
    {commits.map((commit) => {
      const date = commit.authoredAt ?? commit.date;
      const refs = Array.isArray(commit.refs) ? commit.refs : commit.refs ? [commit.refs] : [];
      const isSelected = selectedCommitHash === commit.hash;
      return <button type="button" data-commit-hash={commit.hash} aria-selected={isSelected} key={commit.hash} onClick={() => onSelect(commit.hash)} className={`commit-row ${isSelected ? 'selected' : ''} group flex w-full cursor-pointer items-start gap-2 cp-11 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent`}>
        <span className="min-w-0 flex-1">
          {/* One subject line, ellipsized: keeps every row the same height.
           * Second line: hash + branch refs (max 2 + +N). Third line: date
           * and author, both muted. No rail/dots in the sidebar: HISTORY owns
           * the graph; this list owns readability (#17). */}
          <span className="commit-subject block truncate text-text">{commit.subject}{commit.merge || (commit.parents?.length ?? 0) > 1 ? ' · merge' : ''}</span>
          <span className="commit-meta mt-0.5 flex min-w-0 items-center gap-1.5 cp-10 text-text-muted">
            <span className="commit-hash shrink-0 font-mono text-accent">{commit.shortHash ?? commit.hash.slice(0, 7)}</span>
            {refs.slice(0, 2).map((ref) => <span key={ref} title={ref} className="commit-ref max-w-24 truncate rounded border border-border px-1 py-px cp-9 leading-tight text-accent">{ref}</span>)}
            {refs.length > 2 && <span className="shrink-0 text-text-subtle">+{refs.length - 2}</span>}
            {commit.parents && commit.parents.length > 1 && <span className="shrink-0 text-text-subtle">· {commit.parents.length} parents</span>}
          </span>
          <span className="commit-byline mt-0.5 flex min-w-0 items-center gap-1.5 cp-10 text-text-subtle">
            <time dateTime={date} title={date}>{relTime(date)}</time>
            <span className="min-w-0 truncate">{commit.author}</span>
          </span>
        </span>
      </button>;
    })}
  </div>;
}
