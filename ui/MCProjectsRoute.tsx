import React from 'react';
import { projectsApi } from './api';
import { canMutate } from './models'; import { createRouteController, selectorOptions } from './routeBehavior';
import type { Snapshot } from './types';
import { ProjectSelector } from './components/ProjectSelector';
import { SidebarSections } from './components/SidebarSections';
import { ContextPanel } from './components/ContextPanel';
import { StatusStates } from './components/StatusStates';

function CapabilityNotice({ name, capability }: { name: string; capability?: Snapshot['capabilities'][string] }) { if (!capability || capability.status === 'ready' || capability.status === 'empty') return null; const label = capability.status === 'stale' ? 'stale; last-known-good data shown' : capability.status === 'error' ? 'error; capability unavailable' : 'unavailable'; return <div role="status" className="rounded border border-warning/40 bg-warning/10 px-2 py-1 cp-11 text-warning">{name}: {label}</div>; }

export default function MCProjectsRoute() {
  const controller = React.useRef(createRouteController(projectsApi)).current;
  const route = React.useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const [branchValue, setBranchValue] = React.useState('');
  React.useEffect(() => { void controller.mount(); return () => controller.unmount(); }, [controller]);
  const { catalog, activeId, snapshot, focus, detail, detailLoading, loading, error, selectorOpen, mutation, mutationBusy, mutationMessage, selectedCommitHash } = route;
  const active = catalog.find((project) => project.project_id === activeId);
  const selectProject = controller.selectProject;
  const selectFocus = controller.selectFocus;
  const selectPullRequest = controller.selectPullRequest;
  const mutate = (kind: 'switch' | 'create', value: string) => { if (!snapshot || !canMutate(snapshot) || mutationBusy) return; void controller.mutate(kind, value).then(() => setBranchValue('')); };
  const handleBranchSwitch = (name: string) => mutate('switch', name);
  const handleBranchCreate = (name: string) => mutate('create', name);
  if (error && !snapshot) return <main className="flex h-full min-h-0 w-full flex-col overflow-y-auto overflow-x-hidden bg-surface text-text"><StatusStates state="error" label="projects" /></main>;
  if (loading && !snapshot) return <main className="flex h-full min-h-0 w-full flex-col overflow-y-auto overflow-x-hidden bg-surface text-text"><StatusStates state="loading" label="projects" /></main>;
  if (!active || !snapshot) return <main className="flex h-full min-h-0 w-full flex-col overflow-y-auto overflow-x-hidden bg-surface text-text"><StatusStates state="empty" label="projects" /></main>;
  const mutationAllowed = Boolean(snapshot && canMutate(snapshot) && !mutationBusy);
  return <main data-testid="mc-projects-route" className="flex h-full max-h-full min-h-0 w-full max-w-full min-w-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain bg-surface text-text md:overflow-hidden"><header id="mc-project-header" className="flex min-h-9 shrink-0 items-center gap-2 px-4 py-1 sm:px-5"><ProjectSelector active={active} projects={selectorOptions(catalog, active.project_id)} open={selectorOpen} onToggle={controller.toggleSelector} onSelect={selectProject} activeBranch={snapshot.branches.local.find((b) => b.current)?.name} activeChanged={snapshot.workingTree.files?.length} /></header>{loading && <div className="shrink-0 border-b border-border px-4 py-1 cp-11 text-text-muted" role="status">Refreshing; last-known-good data is shown.</div>}{error && <div className="shrink-0 border-b border-border px-4 py-1 cp-11 text-warning" role="status">Refresh unavailable; showing last-known-good data.</div>}<div className="grid min-h-0 flex-1 md:overflow-hidden md:grid-cols-[minmax(200px,17%)_minmax(0,1fr)]"><aside id="mc-project-sidebar" className="min-w-0 space-y-2 border-b border-border bg-surface-sunken/30 p-2 md:min-h-0 md:overflow-y-auto md:border-b-0"><CapabilityNotice name="working tree" capability={snapshot.capabilities.workingTree as Snapshot['capabilities'][string]} /><CapabilityNotice name="branches" capability={snapshot.capabilities.branches as Snapshot['capabilities'][string]} /><CapabilityNotice name="commits" capability={snapshot.capabilities.commits as Snapshot['capabilities'][string]} /><CapabilityNotice name="branch logs" capability={snapshot.capabilities.branchLogs as Snapshot['capabilities'][string]} /><CapabilityNotice name="GitHub" capability={snapshot.capabilities.github as Snapshot['capabilities'][string]} /><SidebarSections snapshot={snapshot} focus={focus} mutationMessage={mutationMessage} mutationBusy={mutationBusy} onSelectFile={(path) => void selectFocus({ kind: 'file', value: path })} onSelectBranch={(name) => void selectFocus({ kind: 'branch', value: name })} onSelectCommit={(hash) => void selectFocus({ kind: 'commit', value: hash })} onPullRequest={(number) => void selectPullRequest(number)} onSwitch={handleBranchSwitch} onCreate={handleBranchCreate} /></aside><div id="mc-project-context-column" className="min-w-0 min-h-0 overflow-hidden md:h-full"><ContextPanel focus={focus} snapshot={snapshot} detail={detail} loading={detailLoading} selectedCommitHash={selectedCommitHash} onSelectCommit={(hash) => void controller.selectCommit(hash)} lastUpdated={snapshot.observedAt} onRefresh={() => void controller.refresh()} /></div></div></main>;
}
