import React from 'react'
import { ArrowRightLeft } from 'lucide-react'
import type { ProjectBranch } from '../types'

function branchStateLabel(b: ProjectBranch): string {
  const a = b.ahead ?? 0
  const d = b.behind ?? 0
  if (b.relation === 'up-to-date' || (a === 0 && d === 0 && b.tracking)) return 'synced'
  if (a > 0 && d > 0) return `↑${a} ↓${d}`
  if (a > 0) return `↑ ${a} ahead`
  if (d > 0) return `↓ ${d} behind`
  if (b.relation === 'no-upstream' || !b.tracking) return 'no upstream'
  return 'diverged'
}

function branchStateKey(b: ProjectBranch): 'synced' | 'ahead' | 'behind' | 'noup' {
  const a = b.ahead ?? 0
  const d = b.behind ?? 0
  if (b.relation === 'up-to-date' || (a === 0 && d === 0 && b.tracking)) return 'synced'
  if (a > 0 && d === 0) return 'ahead'
  if (d > 0 && a === 0) return 'behind'
  return 'noup'
}

/**
 * Branch row: current-marker dot at the far left (vertically centred), branch
 * name with its sync state stacked beside it, switch control on the right.
 * The dot is the CURRENT indicator: green when the branch is checked out, muted
 * otherwise, so the sync state stays explicit text and the two never compete.
 */
export function BranchTopology({
  local,
  remote,
  onSelect,
  onSwitch,
  onCreate,
  mutationMessage,
  mutationBusy,
  tab,
  onTabChange,
  createOpen,
  onCreateOpenChange,
}: {
  local: ProjectBranch[]
  remote: ProjectBranch[]
  onSelect: (name: string) => void
  onSwitch?: (name: string) => void
  onCreate?: (name: string) => void
  mutationMessage?: string
  mutationBusy?: boolean
  tab?: 'local' | 'remote'
  onTabChange?: (t: 'local' | 'remote') => void
  createOpen?: boolean
  onCreateOpenChange?: (open: boolean) => void
}) {
  const [innerTab, setInnerTab] = React.useState<'local' | 'remote'>('local')
  const activeTab = tab ?? innerTab
  const setTab = onTabChange ?? setInnerTab
  const [innerCreateOpen, setInnerCreateOpen] = React.useState(false)
  const isCreateOpen = createOpen ?? innerCreateOpen
  const setCreateOpen = onCreateOpenChange ?? setInnerCreateOpen
  const [createName, setCreateName] = React.useState('')
  const current = local.find((b) => b.current)?.name ?? null
  const sortedLocal = React.useMemo(() => {
    if (!current) return local
    return [...local].sort((a, b) => (a.name === current ? -1 : b.name === current ? 1 : 0))
  }, [local, current])
  const items = activeTab === 'local' ? sortedLocal : remote
  const submitCreate = () => {
    const v = createName.trim()
    if (v && onCreate) {
      onCreate(v)
      setCreateName('')
      setCreateOpen(false)
    }
  }
  return (
    <div data-testid="branches-section" className="branch-topology min-w-0">
      {activeTab === 'local' && current && isCreateOpen && (
        <div className="branch-create-modal">
          <input
            aria-label="Branch name"
            value={createName}
            onChange={(e) => setCreateName(e.currentTarget.value)}
            onInput={(e) => setCreateName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate()
              if (e.key === 'Escape') setCreateOpen(false)
            }}
            autoFocus
            className="branch-create-input"
            placeholder="feature/name"
          />
          <button type="button" disabled={!createName.trim()} onClick={submitCreate} className="branch-create-confirm">
            Create
          </button>
        </div>
      )}
      <div className="branch-list">
        {items.map((branch) => (
          <div
            key={branch.name}
            data-branch-name={branch.name}
            className={`branch-row ${branch.current ? 'current' : ''}`}
            onClick={() => onSelect(branch.name)}
            onDoubleClick={() => {
              if (activeTab === 'local' && onSwitch && branch.current !== true) onSwitch(branch.name)
            }}
          >
            <span
              className={`bcurrent-dot ${branch.current ? 'is-current' : ''}`}
              title={branch.current ? 'Current branch' : 'Not checked out'}
              aria-hidden="true"
            />
            <span className="branch-main">
              <span className="bname" title={branch.name}>
                {branch.name}
              </span>
              <span className={`bstate state-${branchStateKey(branch)}`}>{branchStateLabel(branch)}</span>
            </span>
            {activeTab === 'local' && onSwitch && branch.current !== true && (
              <button
                type="button"
                title="Switch to this branch"
                aria-label={`Switch to ${branch.name}`}
                className="bswitch"
                onClick={(e) => {
                  e.stopPropagation()
                  onSwitch(branch.name)
                }}
              >
                <ArrowRightLeft size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {mutationMessage && (
        <div role="status" className="branch-mutation-status" aria-busy={Boolean(mutationBusy)}>
          {mutationMessage}
        </div>
      )}
    </div>
  )
}
