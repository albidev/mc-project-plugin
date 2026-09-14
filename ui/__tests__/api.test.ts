import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { ApiError, projectsApi, validCommitDetail, validPullRequestDetail, validIssue, validPullRequest } from '../api.ts';

const browser = new Window({ url: 'http://localhost/mc-project-plugin' });
Object.assign(globalThis, { window: browser, DOMException: browser.DOMException });

const commitDetail = { hash: 'a'.repeat(40), subject: 'Initial', author: 'Test', date: '2026-09-14T10:00:00Z', files: [{ path: 'src/app.ts', additions: 1, deletions: 0 }], diff: 'diff --git a/src/app.ts b/src/app.ts' };
const pullRequestDetail = { number: 1, title: 'Fix route', url: 'https://github.com/example/repo/pull/1', description: 'Details', author: 'davide', labels: [], reviewers: [], assignees: [], head: 'feature/ui', base: 'main', head_repository: 'example/repo', base_repository: 'example/repo', checks: [], created_at: '2026-09-14T10:00:00Z', updated_at: '2026-09-14T11:00:00Z', draft: false };
const snapshot = { project: { repository: 'example/repo' }, snapshotId: 'snap-1' } as never;
const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data, meta: { schemaVersion: 1 } }), { status: 200 });

test('detail validators reject unknown, malformed, and unbounded payloads', () => {
  assert.equal(validCommitDetail(commitDetail), true);
  assert.equal(validCommitDetail({ ...commitDetail, extra: true }), false);
  assert.equal(validCommitDetail({ ...commitDetail, files: [{ path: '../escape', additions: 1, deletions: 0 }] }), false);
  assert.equal(validPullRequestDetail(pullRequestDetail, 'example/repo'), true);
  assert.equal(validPullRequestDetail({ ...pullRequestDetail, description: '' }, 'example/repo'), true);
  assert.equal(validPullRequestDetail({ ...pullRequestDetail, description: 0 }, 'example/repo'), false);
  assert.equal(validPullRequestDetail({ ...pullRequestDetail, description: 'x'.repeat(64 * 1024 + 1) }, 'example/repo'), false);
  assert.equal(validPullRequestDetail({ ...pullRequestDetail, url: 'https://evil.example/example/repo/pull/1' }, 'example/repo'), false);
  assert.equal(validPullRequestDetail({ ...pullRequestDetail, extra: 'reject' }, 'example/repo'), false);
  assert.equal(validPullRequestDetail({ ...pullRequestDetail, checks: [{ name: 'ci', status: 'completed', extra: true }] }, 'example/repo'), false);
});

test('list validators reject unsafe or mismatched GitHub links while allowing absent URLs', () => {
  const pull = { number: 7, title: 'PR', url: 'https://github.com/example/repo/pull/7', repository: 'example/repo', created_at: '2026-09-14T10:00:00Z' };
  const issue = { number: 8, title: 'Issue', url: 'https://github.com/example/repo/issues/8', repository: 'example/repo', created_at: '2026-09-14T10:00:00Z' };
  assert.equal(validPullRequest(pull), true);
  assert.equal(validIssue(issue), true);
  assert.equal(validPullRequest({ ...pull, url: 'https://evil.example/example/repo/pull/7' }), false);
  assert.equal(validPullRequest({ ...pull, url: 'https://github.com/example/repo/issues/7' }), false);
  assert.equal(validPullRequest({ ...pull, url: 'https://github.com/other/repo/pull/7' }), false);
  assert.equal(validPullRequest({ ...pull, url: 'https://github.com/example/repo/pull/8' }), false);
  assert.equal(validIssue({ ...issue, url: 'https://github.com/example/repo/issues/8#unsafe' }), false);
  assert.equal(validIssue({ ...issue, url: undefined }), true);
  assert.equal(validPullRequest({ ...pull, repository: undefined }), true);
});

test('detail API methods reject malformed responses as INVALID_RESPONSE', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      return ok(url.includes('/commit?') ? { ...commitDetail, extra: true } : { ...pullRequestDetail, title: '' });
    };
    await assert.rejects(projectsApi.commit('demo', commitDetail.hash, snapshot), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
    await assert.rejects(projectsApi.pullRequest('demo', 1, snapshot), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
  } finally { globalThis.fetch = originalFetch; }
});

test('detail API methods validate and clean accepted responses', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => ok(String(input).includes('/commit?') ? commitDetail : pullRequestDetail);
    const commit = await projectsApi.commit('demo', commitDetail.hash, snapshot);
    const pull = await projectsApi.pullRequest('demo', 1, snapshot);
    assert.deepEqual(commit, commitDetail);
    assert.deepEqual(pull, pullRequestDetail);
  } finally { globalThis.fetch = originalFetch; }
});
