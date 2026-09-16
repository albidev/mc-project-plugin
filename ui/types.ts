export interface PluginManifest {
  id: string; name: string; description: string; version: string; enabled: boolean; routePath: string;
  navItem: { to: string; label: string; icon: string; order?: number };
  endpoints: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; handler: string; authRequired?: boolean }[];
}

export type CapabilityStatus = 'ready' | 'empty' | 'stale' | 'unavailable' | 'error';
export interface Capability<T> { status: CapabilityStatus; stale: boolean; source: 'local_git' | 'github'; observedAt: string; generation: number; errorCode?: string | null; staleSince?: string | null; value: T; }
export interface ProjectSummary { project_id: string; name: string; enabled: boolean; remote: string; default_branch: string; }
export interface FileEntry { path: string; status?: string; oldPath?: string; }
export interface WorkingTree { files: FileEntry[]; }
export interface ProjectBranch { name: string; current?: boolean; tracking?: string | null; remoteAlias?: string | null; repository?: string | null; relation?: 'up-to-date' | 'ahead' | 'behind' | 'diverged' | 'no-upstream'; ahead?: number; behind?: number; }
export interface Commit { hash: string; shortHash?: string; subject: string; author?: string; authoredAt?: string; date?: string; merge?: boolean; refs?: string[] | string; parents?: string[]; }
export interface CommitDetailFile { path: string; additions: number; deletions: number; binary: boolean; }
export interface CommitDetail { hash: string; subject: string; author: string; date: string; files: CommitDetailFile[]; diff: string; }
export interface PullRequest { number: number; title: string; url?: string; author?: string; head?: string; base?: string; head_repository?: string | null; base_repository?: string | null; repository?: string; created_at?: string; draft?: boolean; description?: string; labels?: string[]; checks?: string; }
export interface PullRequestCheck { name: string; status: string; conclusion?: string | null; }
export interface PullRequestDetail { number: number; title: string; url: string; description: string; author: string; labels: string[]; reviewers: string[]; assignees: string[]; head: string; base: string; head_repository: string | null; base_repository: string; checks: PullRequestCheck[]; created_at: string; updated_at: string; draft: boolean; }
export interface Issue { number: number; title: string; url?: string; repository?: string; labels?: string[]; author?: string; created_at?: string; updatedAt?: string; }
export interface Snapshot {
  schemaVersion: number; project_id: string; project: { name: string; repository?: string | null }; snapshotId: string;
  head?: string | null; observedAt: string; refreshing: boolean; lastUpdated?: string | null;
  capabilities: Record<string, Capability<unknown>>; workingTree: WorkingTree;
  fingerprints: Record<string, string>; branches: { local: ProjectBranch[]; remote: ProjectBranch[]; remoteAlias: string; repository?: string | null }; commits: Commit[];
  fileDiffs: Record<string, string>; branchLogs: Record<string, Commit[]>;
  focusDefaults?: { kind: FocusKind; value?: string | null }; github: { status: string; pullRequests: PullRequest[]; issues: Issue[] };
  warnings?: string[]; localStatus?: string; processInstanceId?: string; registryEpoch?: number; localGeneration?: number; contextIdentity?: string;
}
export type FocusKind = 'file' | 'branch' | 'commit';
export type Focus = { kind: FocusKind; value: string };
