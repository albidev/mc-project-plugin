import React from 'react';
import { ChevronRight, FilePenLine, GitFork, Clock3, GitBranch } from 'lucide-react';
import type { Snapshot, Focus } from '../types';
import { FilesTree } from './FilesTree';
import { BranchTopology } from './BranchTopology';
import { CommitTimeline } from './CommitTimeline';
import { GitHubFooter } from './GitHubFooter';

function AccSection({ id, title, count, open, onToggle, children, trailing }: { id: string; title: string; count?: number; open: boolean; onToggle: () => void; children: React.ReactNode; trailing?: React.ReactNode }) {
  return <div className={`acc-section ${open ? 'open' : ''}`} data-acc-section={id}>
    <div role="button" tabIndex={0} aria-expanded={open} aria-controls={`${id}-body`} className="acc-head" onClick={(e) => { if ((e.target as HTMLElement).closest('.tabs')) return; onToggle(); }} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !(e.target as HTMLElement).closest('.tabs')) { e.preventDefault(); onToggle(); } }}>
      <span className="chev"><ChevronRight size={12} /></span>
      <span className="label">{title}</span>
      {trailing ?? (count !== undefined && <span className="count">{count}</span>)}
    </div>
    <div id={`${id}-body`} className="acc-body">{children}</div>
  </div>;
}

export function SidebarSections({ snapshot, focus, onSelectFile, onSelectBranch, onSelectCommit, onPullRequest, onSwitch, onCreate, mutationMessage, mutationBusy }: { snapshot: Snapshot; focus: Focus | null; onSelectFile: (p: string) => void; onSelectBranch: (n: string) => void; onSelectCommit: (h: string) => void; onPullRequest: (n: number) => void; onSwitch?: (n: string) => void; onCreate?: (n: string) => void; mutationMessage?: string; mutationBusy?: boolean }) {
  const [open, setOpen] = React.useState<Record<string, boolean>>({ files: true, branches: true, commits: false, issues: false, prs: false });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  return <div className="sidebar-acc">
    <AccSection id="files" title="Files" count={snapshot.workingTree.files?.length ?? 0} open={open.files} onToggle={() => toggle('files')}>
      <FilesTree tree={snapshot.workingTree} selected={focus?.kind === 'file' ? focus.value : undefined} onSelect={onSelectFile} />
    </AccSection>
    <AccSection id="branches" title="Branch topology" open={open.branches} onToggle={() => toggle('branches')} trailing={<span className="tabs"><button className="active" type="button">Local {snapshot.branches.local?.length ?? 0}</button><button type="button">Remote {snapshot.branches.remote?.length ?? 0}</button></span>}>
      <BranchTopology local={snapshot.branches.local} remote={snapshot.branches.remote} onSelect={onSelectBranch} onSwitch={onSwitch} onCreate={onCreate} mutationMessage={mutationMessage} mutationBusy={mutationBusy} />
    </AccSection>
    <AccSection id="commits" title="Commits" count={snapshot.commits?.length ?? 0} open={open.commits} onToggle={() => toggle('commits')}>
      <CommitTimeline commits={snapshot.commits} onSelect={onSelectCommit} />
    </AccSection>
    <AccSection id="issues" title="Issues" count={snapshot.github.issues?.length ?? 0} open={open.issues} onToggle={() => toggle('issues')}>
      <GitHubFooter issues={snapshot.github.issues} pullRequests={[]} status={snapshot.github.status} onPullRequest={onPullRequest} bare />
    </AccSection>
    <AccSection id="prs" title="Pull requests" count={snapshot.github.pullRequests?.length ?? 0} open={open.prs} onToggle={() => toggle('prs')}>
      <GitHubFooter issues={[]} pullRequests={snapshot.github.pullRequests} status={snapshot.github.status} onPullRequest={onPullRequest} bare />
    </AccSection>
  </div>;
}
