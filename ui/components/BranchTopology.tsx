import React from 'react';
import { ArrowRightLeft, Plus } from 'lucide-react';
import type { ProjectBranch } from '../types';

function branchStateLabel(b: ProjectBranch): string {
  const a = b.ahead ?? 0;
  const d = b.behind ?? 0;
  if (b.relation === 'up-to-date' || (a === 0 && d === 0 && b.tracking)) return 'synced';
  if (a > 0 && d > 0) return `↑${a} ↓${d}`;
  if (a > 0) return `↑ ${a} ahead`;
  if (d > 0) return `↓ ${d} behind`;
  if (b.relation === 'no-upstream' || !b.tracking) return 'no upstream';
  return 'diverged';
}

function branchStateKey(b: ProjectBranch): 'synced' | 'ahead' | 'behind' | 'noup' {
  const a = b.ahead ?? 0;
  const d = b.behind ?? 0;
  if (b.relation === 'up-to-date' || (a === 0 && d === 0 && b.tracking)) return 'synced';
  if (a > 0 && d === 0) return 'ahead';
  if (d > 0 && a === 0) return 'behind';
  return 'noup';
}

export function BranchTopology({ local, remote, onSelect, onSwitch, onCreate, mutationMessage, mutationBusy }: { local: ProjectBranch[]; remote: ProjectBranch[]; onSelect: (name: string) => void; onSwitch?: (name: string) => void; onCreate?: (name: string) => void; mutationMessage?: string; mutationBusy?: boolean }) {
  const [tab, setTab] = React.useState<'local' | 'remote'>('local');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState('');
  const current = local.find((b) => b.current)?.name ?? null;
  const sortedLocal = React.useMemo(() => {
    if (!current) return local;
    return [...local].sort((a, b) => (a.name === current ? -1 : b.name === current ? 1 : 0));
  }, [local, current]);
  const items = tab === 'local' ? sortedLocal : remote;
  const submitCreate = () => { const v = createName.trim(); if (v && onCreate) { onCreate(v); setCreateName(''); setCreateOpen(false); } };
  return <div data-testid="branches-section" className="min-w-0">
    <div className="branch-tabs-row">
      <button type="button" data-testid="branches-local" className="branch-tab active" onClick={() => setTab('local')} aria-pressed={tab === 'local'}>Local {local.length}</button>
      <button type="button" data-testid="branches-remote" className="branch-tab" onClick={() => setTab('remote')} aria-pressed={tab === 'remote'}>Remote {remote.length}</button>
    </div>
    {tab === 'local' && current && <div className="branch-create-row"><button type="button" className="branch-create" onClick={() => setCreateOpen(true)}><Plus size={11} />Create from {current}</button></div>}
    {createOpen && <div className="branch-create-modal"><input aria-label="Branch name" value={createName} onChange={(e) => setCreateName(e.currentTarget.value)} onInput={(e) => setCreateName(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitCreate(); if (e.key === 'Escape') setCreateOpen(false); }} autoFocus className="branch-create-input" placeholder="feature/name" /><button type="button" disabled={!createName.trim()} onClick={submitCreate} className="branch-create-confirm">Create</button></div>}
    <div className="branch-list">{items.map((branch) => <div key={branch.name} data-branch-name={branch.name} className={`branch-row ${branch.current ? 'current' : ''}`} onClick={() => onSelect(branch.name)} onDoubleClick={() => { if (tab === 'local' && onSwitch && branch.current !== true) onSwitch(branch.name); }}><span className={`dot dot-${branchStateKey(branch)}`} /><span className="bname">{branch.name}</span>{branch.current && <span className="bcurrent">current</span>}<span className={`bstate state-${branchStateKey(branch)}`}>{branchStateLabel(branch)}</span>{tab === 'local' && onSwitch && branch.current !== true && <button type="button" title="Switch to this branch" className="bswitch" onClick={(e) => { e.stopPropagation(); onSwitch(branch.name); }}><ArrowRightLeft size={11} /></button>}</div>)}</div>
    {mutationMessage && <div role="status" className="branch-mutation-status" aria-busy={Boolean(mutationBusy)}>{mutationMessage}</div>}
  </div>;
}
