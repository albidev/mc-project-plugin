import type { Focus, ProjectBranch, ProjectSummary, Snapshot } from './types';
import { ApiError, validMutationResponse } from './api.ts';
import { normalizeCatalog, type FileRow } from './models.ts';

export function selectorOptions(projects: ProjectSummary[], activeId: string): ProjectSummary[] {
  return normalizeCatalog(projects, activeId);
}

export function closeSelectorAfterSelection(open: boolean, selectedId: string, projects: ProjectSummary[]): boolean {
  return open && projects.some((project) => project.project_id === selectedId) ? false : open;
}

export function treeKeyboardAction(row: FileRow, key: string, expanded: boolean): 'next' | 'previous' | 'first' | 'last' | 'expand' | 'collapse' | 'activate' | 'none' {
  if (key === 'ArrowDown') return 'next';
  if (key === 'ArrowUp') return 'previous';
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  if (key === 'ArrowRight' && row.kind === 'folder' && !expanded) return 'expand';
  if (key === 'ArrowLeft' && row.kind === 'folder' && expanded) return 'collapse';
  if ((key === 'Enter' || key === ' ') && row.kind === 'file') return 'activate';
  return 'none';
}

export function branchTabItems(tab: 'local' | 'remote', local: ProjectBranch[], remote: ProjectBranch[]): ProjectBranch[] {
  return tab === 'local' ? local : remote;
}

export function focusMode(focus: Focus | null): 'file-diff' | 'branch-log' | 'commit-detail' | 'empty' {
  return focus?.kind === 'file' ? 'file-diff' : focus?.kind === 'branch' ? 'branch-log' : focus?.kind === 'commit' ? 'commit-detail' : 'empty';
}

export function retainLastGood(previous: Snapshot, next: Snapshot | undefined, failed: boolean): Snapshot {
  return failed || !next ? previous : next;
}

export function routeLayoutContract(): { scrollOwner: 'route'; horizontalOverflow: 'hidden'; mobileOrder: readonly string[] } {
  return { scrollOwner: 'route', horizontalOverflow: 'hidden', mobileOrder: ['selector', 'files', 'branches', 'commits', 'mutation', 'context', 'github'] };
}

type RouteApi = {
  catalog: () => Promise<ProjectSummary[]>;
  snapshot: (projectId: string) => Promise<Snapshot>;
  commit: (projectId: string, commitId: string, snapshot: Snapshot) => Promise<unknown>;
  pullRequest: (projectId: string, number: number, snapshot: Snapshot) => Promise<unknown>;
  switchBranch: (projectId: string, branchName: string) => Promise<unknown>;
  createBranch: (projectId: string, name: string) => Promise<unknown>;
};

export type RouteState = {
  catalog: ProjectSummary[];
  activeId?: string;
  snapshot?: Snapshot;
  focus: Focus | null;
  detail?: unknown;
  detailLoading: boolean;
  loading: boolean;
  error?: ApiError;
  selectorOpen: boolean;
  mutation: boolean;
  mutationMessage: string;
};

const initialState: RouteState = { catalog: [], focus: null, detailLoading: false, loading: true, selectorOpen: false, mutation: false, mutationMessage: '' };
const asError = (cause: unknown) => cause instanceof ApiError ? cause : new ApiError('NETWORK');

export function createRouteController(api: RouteApi) {
  let state: RouteState = { ...initialState };
  let mounted = true;
  let token = 0;
  const listeners = new Set<() => void>();
  const publish = (next: RouteState) => { state = next; listeners.forEach((listener) => listener()); };
  const update = (patch: Partial<RouteState>) => publish({ ...state, ...patch });
  const currentToken = () => token;
  const loadSnapshot = async (id: string, requestToken = currentToken()) => {
    update({ loading: true, error: undefined });
    try {
      const next = await api.snapshot(id);
      if (!mounted || requestToken !== token || id !== state.activeId) return;
      update({ snapshot: next, focus: state.focus ?? next.focusDefaults as Focus | null, loading: false });
    } catch (cause) {
      if (mounted && requestToken === token && id === state.activeId) update({ loading: false, error: asError(cause) });
    }
  };
  const mount = async () => {
    mounted = true;
    const requestToken = ++token;
    try {
      const items = await api.catalog();
      if (!mounted || requestToken !== token) return;
      const first = items[0];
      update({ catalog: items, activeId: first?.project_id, loading: Boolean(first) });
      if (first) await loadSnapshot(first.project_id, requestToken);
      else update({ loading: false });
    } catch (cause) {
      if (mounted && requestToken === token) update({ loading: false, error: asError(cause) });
    }
  };
  const selectProject = (id: string) => {
    if (!state.catalog.some((project) => project.project_id === id)) return Promise.resolve();
    const requestToken = ++token;
    update({ activeId: id, snapshot: undefined, focus: null, detail: undefined, error: undefined, mutation: false, mutationMessage: '', selectorOpen: false });
    return loadSnapshot(id, requestToken);
  };
  const refresh = () => {
    if (!state.activeId) return Promise.resolve();
    const requestToken = ++token;
    return loadSnapshot(state.activeId, requestToken);
  };
  const selectFocus = async (next: Focus) => {
    const current = state.snapshot; const requestToken = token;
    update({ focus: next, detail: undefined });
    if (!current || next.kind !== 'commit') return;
    update({ detailLoading: true });
    try {
      const detail = await api.commit(current.project_id, next.value, current);
      if (mounted && requestToken === token && state.activeId === current.project_id) update({ detail });
    } catch (cause) {
      if (mounted && requestToken === token && state.activeId === current.project_id) update({ error: asError(cause) });
    } finally { if (mounted && requestToken === token) update({ detailLoading: false }); }
  };
  const selectPullRequest = async (number: number) => {
    const current = state.snapshot; const requestToken = token;
    if (!current) return;
    update({ focus: null, detail: undefined, detailLoading: true });
    try {
      const detail = await api.pullRequest(current.project_id, number, current);
      if (mounted && requestToken === token && state.activeId === current.project_id) update({ detail });
    } catch (cause) {
      if (mounted && requestToken === token) update({ error: asError(cause) });
    } finally { if (mounted && requestToken === token) update({ detailLoading: false }); }
  };
  const mutate = async (kind: 'switch' | 'create', value: string) => {
    const current = state.snapshot; const requestToken = token;
    if (!current || !value.trim() || state.mutation) return;
    update({ mutation: true, mutationMessage: '' });
    try {
      const acknowledgement = kind === 'switch' ? await api.switchBranch(current.project_id, value) : await api.createBranch(current.project_id, value);
      if (!validMutationResponse(acknowledgement)) throw new ApiError('INVALID_MUTATION_RESPONSE', 'Mutation acknowledgement was not verified.');
      const readBack = await api.snapshot(current.project_id);
      if (!mounted || requestToken !== token || state.activeId !== current.project_id) return;
      update({ snapshot: readBack, focus: readBack.focusDefaults as Focus | null, mutationMessage: 'Read-back confirmed.', error: undefined });
    } catch (cause) {
      if (mounted && requestToken === token) update({ mutationMessage: `Mutation indeterminate: ${asError(cause).message}`, error: asError(cause) });
    } finally {
      if (mounted && requestToken === token) update({ mutation: false });
    }
  };
  return {
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    mount,
    unmount: () => { mounted = false; ++token; listeners.clear(); },
    selectProject,
    refresh,
    selectFocus,
    selectPullRequest,
    mutate,
    toggleSelector: () => update({ selectorOpen: !state.selectorOpen }),
  };
}
