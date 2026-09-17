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

export function CommitTimeline({ commits, onSelect }: { commits: Commit[]; onSelect: (hash: string) => void }) {
  return <div data-testid="commits-section" className="min-w-0 py-0.5">
    {commits.map((commit, i) => {
      const date = commit.authoredAt ?? commit.date;
      const refs = Array.isArray(commit.refs) ? commit.refs : commit.refs ? [commit.refs] : [];
      return <button type="button" data-commit-hash={commit.hash} key={commit.hash} onClick={() => onSelect(commit.hash)} className="flex w-full cursor-pointer items-start gap-2 px-1.5 py-1 text-left cp-11 hover:bg-surface-sunken/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent">
        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${i === 0 ? 'bg-accent' : 'bg-text-subtle'}`} />
        <span className="min-w-0">
          <span className="block truncate text-text">{commit.subject}{commit.merge || (commit.parents?.length ?? 0) > 1 ? ' · merge' : ''}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 cp-10 text-text-muted">
            <span className="font-mono text-accent">{commit.shortHash ?? commit.hash.slice(0, 7)}</span>
            <span className="text-text-subtle">{commit.author}</span>
            <time className="text-text-subtle" dateTime={date} title={date}>{relTime(date)}</time>
            {refs.map((ref) => <span key={ref} title={ref} className="max-w-24 truncate rounded border border-border px-1 py-px text-[9px] leading-tight text-accent">{ref}</span>)}
            {commit.parents && commit.parents.length > 0 && <span className="text-text-subtle">parents: {commit.parents.length}</span>}
          </span>
        </span>
      </button>;
    })}
  </div>;
}
