import React from 'react'
import { ExternalLink, GitPullRequest } from 'lucide-react'
import type { Issue, PullRequest } from '../types'
import { safeHttpsUrl } from '../models'

function relAge(iso?: string): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const elapsed = Date.now() - t
  if (elapsed < 60_000) return 'now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`
  const hours = Math.floor(elapsed / 3_600_000)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(months / 12)}y`
}

/**
 * GitHub list rows (sidebar accordions Issues / Pull requests, mockup v4):
 * the whole card is the external link (opens issue/PR in a new tab), so the
 * row carries no in-app Details affordance. Row = #num · (draft badge) ·
 * title · age · external-link icon.
 */
export function GitHubFooter({
  issues,
  pullRequests,
  status,
  bare,
}: {
  issues: Issue[]
  pullRequests: PullRequest[]
  status: string
  bare?: boolean
}) {
  if (!issues.length && !pullRequests.length) return null
  const wrap = bare ? 'min-w-0 py-0.5' : 'grid min-w-0 gap-2'
  const rowCls = bare
    ? 'gh-item-row'
    : 'flex min-h-11 items-center gap-3 border-b border-border px-3 text-xs hover:bg-surface-sunken/40'
  const issueRow = (issue: Issue) => {
    const href = safeHttpsUrl(issue.url, { kind: 'issue', number: issue.number, repository: issue.repository })
    const age = relAge(issue.created_at)
    const inner = (
      <>
        <span className="num num-issue">#{issue.number}</span>
        <span className="ititle">{issue.title}</span>
        {age && <span className="iage">{age}</span>}
        <ExternalLink size={13} className="ext" />
      </>
    )
    return href ? (
      <a key={issue.number} href={href} target="_blank" rel="noreferrer" title={issue.title} className={rowCls}>
        {inner}
      </a>
    ) : (
      <div key={issue.number} title={issue.title} className={rowCls}>
        {inner}
      </div>
    )
  }
  const prRow = (pr: PullRequest) => {
    const href = safeHttpsUrl(pr.url, { kind: 'pull', number: pr.number, repository: pr.repository })
    const age = relAge(pr.created_at)
    const inner = (
      <>
        <span className="num num-pr">#{pr.number}</span>
        {pr.draft && <span className="pr-draft">draft</span>}
        <span className="ititle">{pr.title}</span>
        {age && <span className="iage">{age}</span>}
        <ExternalLink size={13} className="ext" />
      </>
    )
    return href ? (
      <a
        key={pr.number}
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open pull request #${pr.number}`}
        title={pr.title}
        className={rowCls}
      >
        {inner}
      </a>
    ) : (
      <div key={pr.number} title={pr.title} className={rowCls}>
        {inner}
      </div>
    )
  }
  return (
    <div data-testid="github-section" className={wrap}>
      {issues.length > 0 && (
        <section
          data-testid="github-issues"
          className={
            bare ? undefined : 'border-border bg-surface-raised min-w-0 rounded-[var(--control-radius)] border'
          }
        >
          {!bare && (
            <div className="border-border flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold">
              <span className="text-warning">●</span>Open issues{' '}
              <span className="cp-11 text-text-subtle ml-auto">{status}</span>
            </div>
          )}
          {issues.map(issueRow)}
        </section>
      )}
      {pullRequests.length > 0 && (
        <section
          data-testid="github-pull-requests"
          className={
            bare ? undefined : 'border-border bg-surface-raised min-w-0 rounded-[var(--control-radius)] border'
          }
        >
          {!bare && (
            <div className="border-border flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold">
              <GitPullRequest size={15} className="text-accent" />
              Open pull requests
            </div>
          )}
          {pullRequests.map(prRow)}
        </section>
      )}
    </div>
  )
}
