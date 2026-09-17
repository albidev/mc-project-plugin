import React from 'react'; import { ExternalLink, GitPullRequest } from 'lucide-react'; import type { Issue, PullRequest } from '../types'; import { safeHttpsUrl } from '../models';

export function GitHubFooter({ issues, pullRequests, status, onPullRequest, bare }: { issues: Issue[]; pullRequests: PullRequest[]; status: string; onPullRequest: (number: number) => void; bare?: boolean }) {
  if (!issues.length && !pullRequests.length) return null;
  const wrap = bare ? 'min-w-0 py-0.5' : 'grid min-w-0 gap-2';
  const row = bare ? 'flex items-center gap-2 px-1.5 py-1 text-[11px] hover:bg-surface-sunken/60' : 'flex min-h-11 items-center gap-3 border-b border-border px-3 text-xs hover:bg-surface-sunken/40';
  const numCls = 'font-mono text-warning';
  const numPrCls = 'font-mono text-accent';
  return <div data-testid="github-section" className={wrap}>
    {issues.length > 0 && <section data-testid="github-issues" className={bare ? undefined : 'min-w-0 rounded-[var(--control-radius)] border border-border bg-surface-raised'}>
      {!bare && <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-semibold"><span className="text-warning">●</span>Open issues <span className="ml-auto cp-11 text-text-subtle">{status}</span></div>}
      {issues.map((issue) => { const href = safeHttpsUrl(issue.url, { kind: 'issue', number: issue.number, repository: issue.repository }); return href ? <a key={issue.number} href={href} target="_blank" rel="noreferrer" className={row}><span className={numCls}>#{issue.number}</span><span className="min-w-0 flex-1 truncate">{issue.title}</span><ExternalLink size={13} className="text-text-subtle" /></a> : <div key={issue.number} className={row}><span className={numCls}>#{issue.number}</span><span className="truncate">{issue.title}</span></div>; })}
    </section>}
    {pullRequests.length > 0 && <section data-testid="github-pull-requests" className={bare ? undefined : 'min-w-0 rounded-[var(--control-radius)] border border-border bg-surface-raised'}>
      {!bare && <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-semibold"><GitPullRequest size={15} className="text-accent" />Open pull requests</div>}
      {pullRequests.map((pr) => { const href = safeHttpsUrl(pr.url, { kind: 'pull', number: pr.number, repository: pr.repository }); return href ? <div key={pr.number} className={row}><span className={numPrCls}>#{pr.number}</span><span className="min-w-0 flex-1 truncate">{pr.title}</span><a href={href} target="_blank" rel="noreferrer" aria-label={`Open pull request #${pr.number}`}><ExternalLink size={13} className="text-text-subtle" /></a><button data-testid={`pr-detail-${pr.number}`} type="button" onClick={() => onPullRequest(pr.number)} className="rounded border border-border px-2 py-1 cp-10">Details</button></div> : <button type="button" key={pr.number} onClick={() => onPullRequest(pr.number)} className={row}><span className={numPrCls}>#{pr.number}</span><span className="min-w-0 flex-1 truncate">{pr.title}</span></button>; })}
    </section>}
  </div>;
}
