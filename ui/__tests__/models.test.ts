import test from 'node:test';
import assert from 'node:assert/strict';
import { canMutate, flattenFiles, normalizeCatalog, focusFromSnapshot, safeHttpsUrl } from '../models.ts';

test('normalizes a catalog and removes the active project duplicate', () => {
  const projects = normalizeCatalog([
    { project_id: 'active', name: 'Active', repository: 'org/active', enabled: true },
    { project_id: 'other', name: 'Other', repository: 'org/other', enabled: true },
  ], 'active');
  assert.deepEqual(projects.map((project) => project.project_id), ['other']);
});

test('flattens bounded file trees into keyboard-renderable rows', () => {
  const rows = flattenFiles({ files: [{ path: 'src/app.ts', status: 'M' }, { path: 'README.md', status: '??' }] });
  assert.deepEqual(rows.map((row) => row.path), ['src', 'src/app.ts', 'README.md']);
  assert.equal(rows[1].kind, 'file');
});

test('fails closed for dirty, stale, unavailable, or refreshing snapshots', () => {
  assert.equal(canMutate({ workingTree: { files: [] }, capabilities: {}, refreshing: false }), true);
  assert.equal(canMutate({ workingTree: { files: [{ path: 'x', status: 'M' }] }, capabilities: {}, refreshing: false }), false);
  assert.equal(canMutate({ workingTree: { files: [] }, capabilities: { branches: { stale: true } }, refreshing: false } as any), false);
  assert.equal(canMutate({ workingTree: { files: [] }, capabilities: { branches: { status: 'unavailable' } }, refreshing: false } as any), false);
});

test('uses snapshot focus defaults and falls back to the first available item', () => {
  assert.deepEqual(focusFromSnapshot({ focusDefaults: { kind: 'file', value: 'a.ts' }, workingTree: { files: [{ path: 'b.ts' }] }, branches: { local: [], remote: [] }, commits: [] }), { kind: 'file', value: 'a.ts' });
  assert.deepEqual(focusFromSnapshot({ focusDefaults: { kind: 'file', value: null }, workingTree: { files: [] }, branches: { local: [{ name: 'main' }], remote: [] }, commits: [] }), { kind: 'branch', value: 'main' });
});

test('safe external links accept only matching GitHub pull and issue URLs', () => {
  assert.equal(safeHttpsUrl('https://github.com/org/repo/pull/7', { kind: 'pull', number: 7, repository: 'org/repo' }), 'https://github.com/org/repo/pull/7');
  assert.equal(safeHttpsUrl('https://github.com/org/repo/issues/7', { kind: 'issue', number: 7, repository: 'org/repo' }), 'https://github.com/org/repo/issues/7');
  assert.equal(safeHttpsUrl('https://evil.example/org/repo/pull/7', { kind: 'pull', number: 7, repository: 'org/repo' }), undefined);
  assert.equal(safeHttpsUrl('https://github.com/org/repo/pull/8', { kind: 'pull', number: 7, repository: 'org/repo' }), undefined);
  assert.equal(safeHttpsUrl('https://github.com/other/repo/pull/7', { kind: 'pull', number: 7, repository: 'org/repo' }), undefined);
  assert.equal(safeHttpsUrl('https://github.com/org/repo/pull/7?next=evil', { kind: 'pull', number: 7, repository: 'org/repo' }), undefined);
  assert.equal(safeHttpsUrl('https://user:pass@github.com/org/repo/pull/7', { kind: 'pull', number: 7, repository: 'org/repo' }), undefined);
  assert.equal(safeHttpsUrl(undefined), undefined);
});
