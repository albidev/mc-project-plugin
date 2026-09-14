import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import MCProjectsRoute from '../MCProjectsRoute.tsx';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../tests/fixtures/contracts/snapshot-real-backend.json', import.meta.url)), 'utf8'));
const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function installDom() {
  const window = new Window({ url: 'http://localhost/mc-project-plugin' });
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const computed = window.getComputedStyle(this);
    const height = Number.parseFloat(computed.minHeight) || Number.parseFloat(computed.height) || 0;
    return height ? { ...originalRect.call(this), height, bottom: height, toJSON: () => ({ height }) } : originalRect.call(this);
  };
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, DOMException: window.DOMException, getComputedStyle: window.getComputedStyle.bind(window) });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return window;
}

function response(data: unknown) { return new Response(JSON.stringify({ ok: true, data, meta: { schemaVersion: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }

async function mountedRoute(snapshot = fixture.data, allowReadBack = false) {
  const window = installDom();
  let snapshotReads = 0;
  window.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/catalog')) return response([{ project_id: 'demo', name: 'Demo', enabled: true, remote: 'origin', default_branch: 'main' }, { project_id: 'other', name: 'Other', enabled: true, remote: 'origin', default_branch: 'main' }]);
    if (url.includes('/snapshot?')) { snapshotReads += 1; return snapshotReads > 1 && !allowReadBack ? Promise.reject(new Error('offline')) : response(snapshot); }
    if (url.includes('/commit?')) return response({ hash: fixture.data.head, subject: 'Initial', author: 'Test', date: '2026-09-14T10:00:00+00:00', files: [{ path: 'src/app.ts', additions: 1, deletions: 0 }], diff: 'commit detail from backend' });
    if (url.includes('/pull-request?')) return response({ number: 1, title: 'Fix route', url: 'https://github.com/example/repo/pull/1', description: 'loaded from backend', author: 'Test', labels: [], reviewers: [], assignees: [], head: 'feature/ui', base: 'main', head_repository: 'example/repo', base_repository: 'example/repo', checks: [], created_at: '2026-09-14T10:00:00+00:00', updated_at: '2026-09-14T11:00:00+00:00', draft: false });
    throw new Error(`unexpected request ${url}`);
  };
  globalThis.fetch = window.fetch;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(MCProjectsRoute)); await sleep(100); });
  return { host, root, window };
}

async function click(host: HTMLElement, selector: string) {
  const element = host.querySelector<HTMLElement>(selector); assert.ok(element, `missing ${selector}`);
  await act(async () => { element.click(); await sleep(); });
}
function text(host: HTMLElement) { return host.textContent ?? ''; }

test('mounts the route and exercises real rendered files, branches, context, PR detail, guard, and overflow DOM', { concurrency: false }, async () => {
  const { host, root } = await mountedRoute();
  try {
    assert.ok(host.querySelector('[data-testid="mc-projects-route"]'));
    assert.match(text(host), /diff --git a\/src\/app\.ts/);
    assert.ok(host.querySelector('[role="treeitem"][aria-selected="true"]'));
    assert.equal(host.querySelectorAll('[role="tree"] [role="treeitem"]').length, 2);
    const route = host.querySelector<HTMLElement>('[data-testid="mc-projects-route"]'); assert.ok(route);
    assert.equal(getComputedStyle(route).overflowY, 'auto');
    assert.equal(getComputedStyle(route).overflowX, 'hidden');
    assert.equal(host.querySelectorAll<HTMLElement>('[data-testid="mc-projects-route"] *').length > 0, true);
    for (const element of host.querySelectorAll<HTMLElement>('[data-testid="mc-projects-route"] *')) assert.notEqual(getComputedStyle(element).overflowY, 'auto');
    assert.equal(host.querySelector<HTMLElement>('[data-testid="branch-switch"]')?.getAttribute('disabled'), '');
    const treeItems = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    assert.equal(treeItems.length, 2);
    for (const item of treeItems) {
      assert.ok(item.getBoundingClientRect().height >= 44, `treeitem ${item.dataset.treePath} must render a 44px hit area`);
      assert.equal(item.dataset.hitAreaMin, '44');
    }
    const mutationControls = [...host.querySelectorAll<HTMLElement>('[data-testid="mutation-section"] button')];
    assert.deepEqual(mutationControls.map((control) => control.textContent), ['Switch', 'Create']);
    for (const control of mutationControls) {
      assert.ok(control.getBoundingClientRect().height >= 44, `${control.textContent} must render a 44px hit area`);
      assert.equal(control.dataset.hitAreaMin, '44');
    }

    const folder = host.querySelector<HTMLElement>('[data-tree-path="src"]'); assert.ok(folder);
    await act(async () => { folder.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); await sleep(); });
    assert.equal(host.querySelectorAll('[role="tree"] [role="treeitem"]').length, 1);
    await act(async () => { folder.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await sleep(); });
    assert.equal(host.querySelectorAll('[role="tree"] [role="treeitem"]').length, 2);
    const file = host.querySelector<HTMLElement>('[data-tree-path="src/app.ts"]'); assert.ok(file);
    await act(async () => { file.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(); });
    assert.match(text(host), /File diff/);

    await click(host, 'button[aria-expanded="false"]');
    assert.ok(host.querySelector('[role="option"]'));
    assert.doesNotMatch(text(host), /Selected projectOther/);
    await click(host, 'button[aria-pressed="false"]');
    assert.match(text(host), /origin\/main/);
    assert.match(text(host), /File diff/);
    await click(host, 'button[aria-pressed="false"]');
    await click(host, 'button[data-branch-name="main"]');
    assert.match(text(host), /Branch log · main/);
    assert.match(text(host), /Initial/);

    await click(host, '[data-commit-hash]');
    assert.match(text(host), /commit detail from backend/);

    await click(host, '[data-testid="pr-detail-1"]');
    await act(async () => { await sleep(100); });
    assert.match(text(host), /loaded from backend/);
    assert.ok(host.querySelector('a[href="https://github.com/example/repo/pull/1"][target="_blank"]'));
    assert.ok(host.querySelector('a[href="https://github.com/example/repo/issues/2"][target="_blank"]'));
    assert.equal(host.querySelectorAll('main').length, 1);
    assert.equal(host.querySelectorAll('main > div [class*="overflow-y-auto"]').length, 0);
  } finally { await act(async () => root.unmount()); }
});

test('renders mobile order and verifies enabled mutation POST plus snapshot read-back', { concurrency: false }, async () => {
  const clean = structuredClone(fixture.data);
  clean.workingTree.files = [];
  clean.capabilities.workingTree.value.files = [];
  const { host, root, window } = await mountedRoute(clean, true);
  let mutationCalls = 0;
  const originalFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/branch/switch')) { mutationCalls += 1; assert.equal(init?.method, 'POST'); return response({ verified: true, generation: 2 }); }
    return originalFetch(input, init);
  };
  globalThis.fetch = window.fetch;
  try {
    const route = host.querySelector('[data-testid="mc-projects-route"]'); assert.ok(route);
    const sections = ['files-section', 'branches-section', 'mutation-section', 'context-section', 'github-section'];
    assert.deepEqual(sections.map((id) => Boolean(host.querySelector(`[data-testid="${id}"]`))), [true, true, true, true, true]);
    const positions = sections.map((id) => [...host.querySelectorAll('[data-testid]')].findIndex((node) => node.getAttribute('data-testid') === id));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Branch name"]'); assert.ok(input);
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, 'feature/test'); input.dispatchEvent(new window.Event('input', { bubbles: true })); input.dispatchEvent(new window.Event('change', { bubbles: true })); await sleep(); });
    assert.equal(input.value, 'feature/test');
    const switchButton = host.querySelector<HTMLButtonElement>('[data-testid="branch-switch"]'); assert.ok(switchButton);
    assert.equal(switchButton.disabled, false);
    await act(async () => { switchButton.click(); await sleep(100); });
    assert.equal(mutationCalls, 1);
    assert.match(text(host), /Read-back confirmed/);
    for (const item of host.querySelectorAll<HTMLElement>('[data-testid="files-section"], [data-testid="branches-section"]')) assert.ok(item.className.includes('min-w-0'));
  } finally { await act(async () => root.unmount()); }
});

test('renders capability notice and retains last-good DOM after a failed refresh', { concurrency: false }, async () => {
  const stale = structuredClone(fixture.data);
  stale.capabilities.github.status = 'stale'; stale.capabilities.github.stale = true; stale.github.status = 'stale';
  const { host, root } = await mountedRoute(stale);
  try {
    assert.match(text(host), /GitHub: stale; last-known-good data shown/);
    assert.match(text(host), /diff --git a\/src\/app\.ts/);
    await click(host, 'header button');
    await act(async () => { await sleep(100); });
    assert.match(text(host), /Refresh unavailable; showing last-known-good data/);
    assert.match(text(host), /diff --git a\/src\/app\.ts/);
  } finally { await act(async () => root.unmount()); }
});
