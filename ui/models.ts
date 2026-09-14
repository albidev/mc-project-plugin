import type { FileEntry, Focus, ProjectBranch, ProjectSummary, Snapshot } from './types';

export interface FileRow { path: string; label: string; depth: number; kind: 'folder' | 'file'; status?: string; }

export function normalizeCatalog(input: ProjectSummary[], activeId?: string): ProjectSummary[] {
  const seen = new Set<string>();
  return input.filter((project) => project.enabled && project.project_id !== activeId && !seen.has(project.project_id) && seen.add(project.project_id));
}

export interface GitHubUrlExpectation {
  kind?: 'pull' | 'issue';
  number?: number;
  repository?: string | null;
}

function repositoryName(value: string): string | undefined {
  const raw = value.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw) ? raw : undefined;
}

export function safeHttpsUrl(value: string | undefined, expectation?: GitHubUrlExpectation): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(pull|issues)\/([1-9][0-9]*)$/);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || !match) return undefined;
    const [, owner, repo, kind, numberText] = match;
    const number = Number(numberText);
    const repository = `${owner}/${repo}`;
    if (expectation?.kind && kind !== (expectation.kind === 'pull' ? 'pull' : 'issues')) return undefined;
    if (expectation?.number !== undefined && number !== expectation.number) return undefined;
    if (expectation?.repository !== undefined && expectation.repository !== null) {
      const expectedRepository = repositoryName(expectation.repository);
      if (!expectedRepository || repository !== expectedRepository) return undefined;
    }
    return url.href;
  } catch { return undefined; }
}

export function flattenFiles(tree: { files?: FileEntry[] }): FileRow[] {
  const rows: FileRow[] = [], folders = new Set<string>();
  for (const file of tree.files ?? []) {
    const parts = file.path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      const path = parts.slice(0, i).join('/');
      if (!folders.has(path)) { folders.add(path); rows.push({ path, label: parts[i - 1], depth: i - 1, kind: 'folder' }); }
    }
    rows.push({ path: file.path, label: parts.at(-1) ?? file.path, depth: Math.max(0, parts.length - 1), kind: 'file', status: file.status });
  }
  return rows;
}

export function canMutate(snapshot: Pick<Snapshot, 'workingTree' | 'capabilities' | 'refreshing'>): boolean {
  if (snapshot.refreshing || snapshot.workingTree.files.length > 0) return false;
  return Object.values(snapshot.capabilities).every((cap) => !cap.stale && cap.status !== 'stale' && cap.status !== 'unavailable' && cap.status !== 'error');
}

export function focusFromSnapshot(snapshot: Pick<Snapshot, 'focusDefaults' | 'workingTree' | 'branches' | 'commits'>): Focus | null {
  const preferred = snapshot.focusDefaults;
  if (preferred?.value) return { kind: preferred.kind, value: preferred.value };
  const file = snapshot.workingTree.files[0]?.path;
  if (file) return { kind: 'file', value: file };
  const branch = snapshot.branches.local[0]?.name;
  if (branch) return { kind: 'branch', value: branch };
  const commit = snapshot.commits[0]?.hash;
  return commit ? { kind: 'commit', value: commit } : null;
}
