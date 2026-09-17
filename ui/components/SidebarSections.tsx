import React from 'react'
import { ChevronRight, GitFork, GitBranch, Plus } from 'lucide-react'
import type { Snapshot, Focus } from '../types'
import { FilesTree } from './FilesTree'
import { BranchTopology } from './BranchTopology'
import { CommitTimeline } from './CommitTimeline'
import { GitHubFooter } from './GitHubFooter'

function AccSection({
  id,
  title,
  count,
  open,
  onToggle,
  children,
  trailing,
}: {
  id: string
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  trailing?: React.ReactNode
}) {
  return (
    <div className={`acc-section ${open ? 'open' : ''}`} data-acc-section={id}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        className="acc-head"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('.tabs')) return
          onToggle()
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !(e.target as HTMLElement).closest('.tabs')) {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        <span className="chev">
          <ChevronRight size={12} />
        </span>
        <span className="label">{title}</span>
        {trailing ?? (count !== undefined && <span className="count">{count}</span>)}
      </div>
      <div id={`${id}-body`} className="acc-body">
        <div className="acc-body-inner">{children}</div>
      </div>
    </div>
  )
}

/**
 * Sidebar accordion. The branch section carries its own Local/Remote/Create icon
 * bar INSIDE the accordion body. As header tabs they were buttons, and the host's
 * unlayered `button { min-height: var(--touch-target) }` forced them to 44px
 * inside a 27px header: measured tabs 17px taller than the title, overflowing it.
 */
export function SidebarSections({
  snapshot,
  focus,
  onSelectFile,
  onSelectBranch,
  onSelectCommit,
  onSwitch,
  onCreate,
  mutationMessage,
  mutationBusy,
  selectedCommitHash,
}: {
  snapshot: Snapshot
  focus: Focus | null
  onSelectFile: (p: string) => void
  onSelectBranch: (n: string) => void
  onSelectCommit: (h: string) => void
  onSwitch?: (n: string) => void
  onCreate?: (n: string) => void
  mutationMessage?: string
  mutationBusy?: boolean
  selectedCommitHash?: string
}) {
  const [open, setOpen] = React.useState<Record<string, boolean>>({
    files: true,
    branches: true,
    commits: false,
    issues: false,
    prs: false,
  })
  const [branchTab, setBranchTab] = React.useState<'local' | 'remote'>('local')
  const [createOpen, setCreateOpen] = React.useState(false)
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }))
  const localCount = snapshot.branches.local?.length ?? 0
  const remoteCount = snapshot.branches.remote?.length ?? 0
  const currentBranch = snapshot.branches.local?.find((b) => b.current)?.name ?? null
  return (
    <div className="sidebar-acc">
      <AccSection
        id="files"
        title="Files"
        count={snapshot.workingTree.files?.length ?? 0}
        open={open.files}
        onToggle={() => toggle('files')}
      >
        <FilesTree
          tree={snapshot.workingTree}
          selected={focus?.kind === 'file' ? focus.value : undefined}
          onSelect={onSelectFile}
        />
      </AccSection>
      <AccSection id="branches" title="Branch topology" open={open.branches} onToggle={() => toggle('branches')}>
        <div className="branch-iconbar" role="group" aria-label="Branch view and actions">
          <span className="branch-icon-group">
            <button
              type="button"
              className={`branch-icon-tab ${branchTab === 'local' ? 'active' : ''}`}
              aria-pressed={branchTab === 'local'}
              aria-label={`Local branches (${localCount})`}
              title={`Local branches (${localCount})`}
              onClick={() => setBranchTab('local')}
            >
              <GitBranch size={13} />
              <span className="branch-icon-count">{localCount}</span>
            </button>
            <button
              type="button"
              className={`branch-icon-tab ${branchTab === 'remote' ? 'active' : ''}`}
              aria-pressed={branchTab === 'remote'}
              aria-label={`Remote branches (${remoteCount})`}
              title={`Remote branches (${remoteCount})`}
              onClick={() => setBranchTab('remote')}
            >
              <GitFork size={13} />
              <span className="branch-icon-count">{remoteCount}</span>
            </button>
          </span>
          {currentBranch && onCreate && (
            <button
              type="button"
              className="branch-icon-tab branch-icon-action"
              aria-label={`Create branch from ${currentBranch}`}
              title={`Create a branch from ${currentBranch}`}
              onClick={() => setCreateOpen((v) => !v)}
            >
              <Plus size={13} />
            </button>
          )}
        </div>
        <BranchTopology
          local={snapshot.branches.local}
          remote={snapshot.branches.remote}
          onSelect={onSelectBranch}
          onSwitch={onSwitch}
          onCreate={onCreate}
          mutationMessage={mutationMessage}
          mutationBusy={mutationBusy}
          tab={branchTab}
          onTabChange={setBranchTab}
          createOpen={createOpen}
          onCreateOpenChange={setCreateOpen}
        />
      </AccSection>
      <AccSection
        id="commits"
        title="Commits"
        count={snapshot.commits?.length ?? 0}
        open={open.commits}
        onToggle={() => toggle('commits')}
      >
        <CommitTimeline commits={snapshot.commits} onSelect={onSelectCommit} selectedCommitHash={selectedCommitHash} />
      </AccSection>
      <AccSection
        id="issues"
        title="Issues"
        count={snapshot.github.issues?.length ?? 0}
        open={open.issues}
        onToggle={() => toggle('issues')}
      >
        <GitHubFooter issues={snapshot.github.issues} pullRequests={[]} status={snapshot.github.status} bare />
      </AccSection>
      <AccSection
        id="prs"
        title="Pull requests"
        count={snapshot.github.pullRequests?.length ?? 0}
        open={open.prs}
        onToggle={() => toggle('prs')}
      >
        <GitHubFooter issues={[]} pullRequests={snapshot.github.pullRequests} status={snapshot.github.status} bare />
      </AccSection>
    </div>
  )
}
