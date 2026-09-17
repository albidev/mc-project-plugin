#!/usr/bin/env node
/**
 * Issue #1 — bounded, fail-closed browser verification for the Projects context panel.
 *
 * Usage:
 *   node tests/issue1-browser-verification.mjs --browser chrome --url <route> --viewport 1440x900 --output /tmp/.../chrome
 *
 * The script exits non-zero when readiness, selector cardinality, geometry, scroll
 * ownership, scroll interactivity or commit navigation do not match the approved plan.
 * Output is refused inside the repository; artifacts go to the --output directory only.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_PATH = resolve(REPO_ROOT, 'tests/fixtures/contracts/snapshot-real-backend.json')
const BROWSERS = {
  chrome: { executablePath: '/usr/bin/google-chrome', name: 'chromium' },
  firefox: { executablePath: undefined, name: 'firefox' },
}
const SYSTEM_PROFILE_ERROR = 'Could not find profile folder'
const LONG_COMMITS = 20
const LONG_REFS = ['HEAD -> main', 'origin/main']
const BREADCRUMB_HEIGHT = 32
const GEOMETRY_TOLERANCE = 1
const READY_TIMEOUT_MS = 30_000
const INTERACTION_TIMEOUT_MS = 10_000
const SCROLL_STEP = 600
const DIFF_LINES = 400
const SMOOTH_RETRIES = 5

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const browserKey = arg('browser')
const url = arg('url')
const viewportArg = arg('viewport', '1440x900')
const output = arg('output')
const headed = process.argv.includes('--headed')
if (!browserKey || !BROWSERS[browserKey]) fail(`--browser must be one of ${Object.keys(BROWSERS).join('|')}`)
if (!url) fail('--url is required')
if (!output) fail('--output is required')
if (!/^\d+x\d+$/.test(viewportArg)) fail('--viewport must be WIDTHxHEIGHT')

const [width, height] = viewportArg.split('x').map(Number)
const outDir = resolve(output)
if (outDir === REPO_ROOT || outDir.startsWith(`${REPO_ROOT}${sep}`)) fail('--output must not be inside the repository')
mkdirSync(outDir, { recursive: true })

const failures = []
const metrics = { browser: browserKey, url, viewport: `${width}x${height}`, checks: [], states: {} }
function check(name, condition, detail) {
  const ok = Boolean(condition)
  metrics.checks.push({ name, ok, detail: detail ?? null })
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
  return ok
}
function fail(message) {
  process.stderr.write(`issue1-browser-verification: ${message}\n`)
  process.exit(2)
}

function longSnapshot(base) {
  const snapshot = structuredClone(base.data ?? base)
  const commits = []
  for (let index = 0; index < LONG_COMMITS; index += 1) {
    const hash = (index + 1).toString(16).padStart(2, '0').repeat(20)
    commits.push({
      hash,
      shortHash: hash.slice(0, 7),
      subject: `fixture commit ${String(index).padStart(2, '0')}`,
      author: 'Fixture',
      date: `2026-09-14T${String(10 + Math.floor(index / 6)).padStart(2, '0')}:${String(index % 6).padStart(2, '0')}:00+00:00`,
      merge: false,
      refs: index === 0 ? [...LONG_REFS] : [],
      parents: index === LONG_COMMITS - 1 ? [] : [(index + 2).toString(16).padStart(2, '0').repeat(20)],
    })
  }
  const diffBody = ['diff --git a/src/app.ts b/src/app.ts']
  for (let index = 0; index < DIFF_LINES; index += 1)
    diffBody.push(
      `${index % 3 === 0 ? '+' : index % 3 === 1 ? '-' : ' '}line ${String(index).padStart(4, '0')} ${'x'.repeat(120)}`,
    )
  const diff = diffBody.join('\n')
  snapshot.commits = commits
  snapshot.fileDiffs = { 'src/app.ts': diff }
  snapshot.head = commits[1].hash
  snapshot.branchLogs = { main: commits }
  snapshot.branches = {
    ...snapshot.branches,
    local: [
      {
        name: 'main',
        current: true,
        tracking: 'origin/main',
        remoteAlias: 'origin',
        repository: snapshot.branches?.repository,
        relation: 'up-to-date',
        ahead: 0,
        behind: 0,
      },
    ],
  }
  snapshot.focusDefaults = { kind: 'file', value: 'src/app.ts' }
  const expected = snapshot.capabilities ?? {}
  expected.commits = {
    ...(expected.commits ?? {}),
    status: 'ready',
    stale: false,
    source: 'local_git',
    observedAt: snapshot.observedAt,
    generation: expected.commits?.generation ?? 1,
    value: commits,
    staleSince: null,
  }
  expected.branchLogs = {
    ...(expected.branchLogs ?? {}),
    status: 'ready',
    stale: false,
    source: 'local_git',
    observedAt: snapshot.observedAt,
    generation: expected.branchLogs?.generation ?? 1,
    value: snapshot.branchLogs,
    staleSince: null,
  }
  expected.branches = {
    ...(expected.branches ?? {}),
    status: 'ready',
    stale: false,
    source: 'local_git',
    observedAt: snapshot.observedAt,
    generation: expected.branches?.generation ?? 1,
    value: snapshot.branches,
    staleSince: null,
  }
  snapshot.capabilities = expected
  return snapshot
}

const envelope = (data) => ({
  ok: true,
  data,
  meta: { schemaVersion: 1, requestId: 'issue1-browser', observedAt: '2026-09-14T10:00:00+00:00' },
})

async function measure(page, testId) {
  return measureSelector(page, `[data-testid="${testId}"]`)
}

async function measureSelector(page, selector) {
  return page.evaluate((query) => {
    const element = document.querySelector(query)
    if (!element) return null
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return {
      selector: query,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
      parentTestId: element.parentElement?.getAttribute('data-testid') ?? null,
      focusable: element.tabIndex >= 0,
    }
  }, selector)
}

// The plan names the columns by id (`#mc-project-sidebar`, `#mc-project-context-column`).
const SIDEBAR_SELECTOR = '#mc-project-sidebar'
const CONTEXT_COLUMN_SELECTOR = '#mc-project-context-column'
const measureSidebar = (page) => measureSelector(page, SIDEBAR_SELECTOR)
const measureContextColumn = (page) => measureSelector(page, CONTEXT_COLUMN_SELECTOR)

const countOf = (page, id) =>
  page.evaluate((selector) => document.querySelectorAll(selector).length, `[data-testid="${id}"]`)

// Keyboard-focusable scroll surfaces must show a visible focus ring. Asserting the computed style
// (not the presence of a CSS rule) is what catches the host's unlayered
// `.focus\:outline-none:focus { outline: 2px solid transparent }`, which silently wins the cascade
// against an equally specific plugin rule and blanks the ring.
async function assertFocusRing(page, testId) {
  const ring = await page.evaluate((selector) => {
    const element = document.querySelector(selector)
    if (!element) return null
    element.focus({ focusVisible: true })
    const style = getComputedStyle(element)
    return {
      isFocusVisible: element.matches(':focus-visible'),
      outlineColor: style.outlineColor,
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
    }
  }, `[data-testid="${testId}"]`)
  const visible =
    Boolean(ring) &&
    ring.isFocusVisible &&
    ring.outlineStyle !== 'none' &&
    parseFloat(ring.outlineWidth) > 0 &&
    !/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(,\s*0\s*)?\)$/.test(ring.outlineColor)
  check(
    `${testId} shows a focus-visible ring`,
    visible,
    ring ? `${ring.outlineColor} ${ring.outlineStyle} ${ring.outlineWidth}` : 'element missing',
  )
}

async function expectCounts(page, state, expected) {
  for (const [id, expectedCount] of Object.entries(expected)) {
    const actual = await countOf(page, id)
    check(`${state}/${id}=${expectedCount}`, actual === expectedCount, `actual ${actual}`)
  }
}

async function resetAndMeasure(page, testId) {
  await page.evaluate((id) => {
    const element = document.querySelector(`[data-testid="${id}"]`)
    if (element) element.scrollTo({ top: 0, left: 0 })
  }, testId)
  await page.waitForTimeout(60)
  return measure(page, testId)
}

async function assertScrollable(page, state, testId, { horizontal }) {
  const before = await measure(page, testId)
  check(`${state}/${testId} exists`, before !== null)
  if (!before) return
  check(
    `${state}/${testId} has vertical overflow`,
    before.scrollHeight > before.clientHeight,
    `${before.scrollHeight}/${before.clientHeight}`,
  )
  const box = before.rect
  const centreX = box.x + box.width / 2
  const centreY = box.y + Math.min(box.height / 2, 80)
  const needsHorizontal = horizontal && before.scrollWidth > before.clientWidth
  // The plan requires the dense body to be the horizontal scroll owner when content exceeds the
  // panel: both outcomes are valid, but it must never be a nested/second vertical owner instead.
  metrics.states[`${state}/${testId}/horizontal`] = {
    scrollWidth: before.scrollWidth,
    clientWidth: before.clientWidth,
    needsHorizontal,
  }

  // 1. pointer wheel
  await resetAndMeasure(page, testId)
  await page.mouse.move(centreX, centreY)
  await page.mouse.wheel(0, SCROLL_STEP)
  await waitForScroll(page, testId)
  const wheel = await measure(page, testId)
  check(`${state}/${testId} wheel scrollTop>0`, wheel.scrollTop > 0, `scrollTop ${wheel.scrollTop}`)
  check(
    `${state}/${testId} wheel within bounds`,
    wheel.scrollTop <= Math.max(0, wheel.scrollHeight - wheel.clientHeight),
    `scrollTop ${wheel.scrollTop}`,
  )

  // 2. scrollbar drag
  await resetAndMeasure(page, testId)
  const drag = await dragScrollbar(page, testId)
  if (drag.supported) check(`${state}/${testId} drag scrollTop>0`, drag.scrollTop > 0, `scrollTop ${drag.scrollTop}`)
  else
    metrics.channelUnavailable = [
      ...(metrics.channelUnavailable ?? []),
      { state, testId, channel: 'scrollbar-drag', reason: drag.reason },
    ]

  // 3. keyboard
  await resetAndMeasure(page, testId)
  await page.locator(`[data-testid="${testId}"]`).focus()
  const focused = await page.evaluate(
    (id) => document.activeElement === document.querySelector(`[data-testid="${id}"]`),
    testId,
  )
  check(`${state}/${testId} keyboard focusable`, focused, `activeElement matched ${focused}`)
  if (focused) {
    await page.keyboard.press('PageDown')
    await waitForScroll(page, testId)
    const paged = await measure(page, testId)
    check(`${state}/${testId} PageDown scrollTop>0`, paged.scrollTop > 0, `scrollTop ${paged.scrollTop}`)
  }

  // 4. horizontal (desktop only: the plan requires it for the dense body when content exceeds the panel)
  if (horizontal && width > 480) {
    await resetAndMeasure(page, testId)
    await page.mouse.move(centreX, centreY)
    await page.mouse.wheel(SCROLL_STEP, 0)
    await waitForHorizontalScroll(page, testId)
    const side = await measure(page, testId)
    if (needsHorizontal)
      check(
        `${state}/${testId} horizontal wheel/scrollLeft reachable`,
        side.scrollLeft > 0 || side.clientWidth >= side.scrollWidth,
        `scrollLeft ${side.scrollLeft} ${side.clientWidth}/${side.scrollWidth}`,
      )
    else check(`${state}/${testId} horizontal wheel no-op`, side.scrollLeft === 0, `scrollLeft ${side.scrollLeft}`)
  }
  metrics.states[`${state}/${testId}`] = { before, wheel, paged: null }
}

// Mobile keeps a single page scroll owner: the route. Dense bodies must therefore grow with their
// content instead of becoming competing nested full-height scroll containers.
async function assertMobileNonOwner(page, state, testId) {
  const value = await measure(page, testId)
  check(`${state}/${testId} present`, value !== null)
  if (!value) return
  check(
    `${state}/${testId} is not a nested vertical scroll owner`,
    value.scrollHeight <= value.clientHeight + 1,
    `${value.scrollHeight}/${value.clientHeight}`,
  )
  check(`${state}/${testId} does not scroll internally`, value.scrollTop === 0, `scrollTop ${value.scrollTop}`)
  metrics.states[`mobile/${testId}`] = value
}

async function waitForScroll(page, testId) {
  for (let attempt = 0; attempt < SMOOTH_RETRIES; attempt += 1) {
    await page.waitForTimeout(80)
    const value = await page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.scrollTop ?? 0, testId)
    if (value > 0) return value
  }
  return 0
}

// Horizontal wheel scrolling settles asynchronously (and can be smooth-animated), so a fixed
// sleep makes the assertion timing-dependent: the same build passed and failed across two
// consecutive runs with waitForTimeout(150). Poll the value instead, bounded.
async function waitForHorizontalScroll(page, testId) {
  for (let attempt = 0; attempt < SMOOTH_RETRIES; attempt += 1) {
    await page.waitForTimeout(80)
    const value = await page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.scrollLeft ?? 0, testId)
    if (value > 0) return value
  }
  return page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.scrollLeft ?? 0, testId)
}

async function dragScrollbar(page, testId) {
  // Chromium on Linux uses overlay scrollbars by default: they fade while not hovered, so a pointer
  // drag is not a stable input channel. The drag sub-check is therefore performed only when classic
  // scrollbars are actually laid out; otherwise it is recorded as unavailable with the measured
  // reason (scrollbar-width = offsetWidth - clientWidth), never as a silent pass.
  const gutter = await page.evaluate((id) => {
    const element = document.querySelector(`[data-testid="${id}"]`)
    return element ? element.offsetWidth - element.clientWidth : 0
  }, testId)
  if (gutter < 8) return { supported: false, reason: `overlay/none scrollbar gutter: ${gutter}px` }
  const box = await page.locator(`[data-testid="${testId}"]`).boundingBox()
  const startX = box.x + box.width - 5
  const startY = box.y + 30
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY + 120, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  const value = await page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.scrollTop ?? 0, testId)
  return { supported: true, scrollTop: value }
}

async function main() {
  const { chromium, firefox } = await import('playwright-core')
  const engine = browserKey === 'chrome' ? chromium : firefox
  // Chromium uses the system Chrome (no download); Firefox uses the Playwright-managed build
  // because the system /usr/bin/firefox rejects Playwright's temporary profile ("Could not find profile folder").
  let browser
  try {
    browser = await engine.launch({ executablePath: BROWSERS[browserKey].executablePath, headless: !headed })
  } catch (error) {
    const message = String(error?.message ?? error)
    const transport = BROWSERS[browserKey].executablePath ? 'system executable' : 'Playwright-managed build'
    fail(
      `unable to launch ${browserKey} (${transport}): ${message.split('\n')[0]}${message.includes(SYSTEM_PROFILE_ERROR) ? ' — system Firefox profile incompatibility; install the Playwright build with: node node_modules/playwright-core/cli.js install firefox' : ''}`,
    )
  }
  const context = await browser.newContext({ viewport: { width, height } })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
  const snapshot = longSnapshot(fixture)
  const catalog = [
    {
      project_id: snapshot.project_id,
      name: snapshot.project?.name ?? 'Demo',
      enabled: true,
      remote: 'origin',
      default_branch: 'main',
    },
  ]

  const intercepted = { catalog: 0, snapshot: 0 }
  let commitUnintercepted = 0
  const commitRequests = []
  const pluginEndpointResponses = []
  await page.route('**/api/local/mc-project-plugin/projects/**', async (route) => {
    const request = route.request()
    const requestUrl = new URL(request.url())
    if (request.method() !== 'GET') return route.continue()
    if (requestUrl.pathname.endsWith('/projects/catalog')) {
      intercepted.catalog += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope(catalog)) })
    }
    if (requestUrl.pathname.endsWith('/projects/snapshot')) {
      intercepted.snapshot += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope(snapshot)) })
    }
    if (requestUrl.pathname.endsWith('/projects/commit')) {
      commitRequests.push({ url: request.url(), query: Object.fromEntries(requestUrl.searchParams) })
      return route.continue()
    }
    return route.continue()
  })
  page.on('response', async (response) => {
    const path = new URL(response.url()).pathname
    const endpoint = ['catalog', 'snapshot', 'commit'].find((name) => path.endsWith(`/projects/${name}`))
    if (!endpoint) return
    pluginEndpointResponses.push({ endpoint, status: response.status() })
    if (endpoint !== 'commit') return
    if (response.status() !== 200) {
      commitUnintercepted += 1
      return
    }
    try {
      const body = await response.json()
      const data = body?.data ?? {}
      const validShape =
        body?.ok === true &&
        typeof data.hash === 'string' &&
        /^[0-9a-fA-F]{40}$/.test(data.hash) &&
        typeof data.subject === 'string' &&
        Array.isArray(data.files) &&
        typeof data.diff === 'string'
      if (!validShape) commitUnintercepted += 1
    } catch {
      commitUnintercepted += 1
    }
  })

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT_MS })
  await page.waitForSelector('[data-testid="mc-projects-route"]', { timeout: READY_TIMEOUT_MS })
  await page.waitForSelector('[data-testid="context-section"]', { timeout: READY_TIMEOUT_MS })
  check('catalog intercepted', intercepted.catalog > 0, `count ${intercepted.catalog}`)
  check('snapshot intercepted', intercepted.snapshot > 0, `count ${intercepted.snapshot}`)

  const geometry = {}
  const shellIds = ['mc-projects-route', 'context-section', 'context-breadcrumb', 'context-body']
  const columns = {}

  // Column measurements required by the plan (resolved by id, not by data-testid).
  const captureColumns = async (state) => {
    columns[state] = { sidebar: await measureSidebar(page), contextColumn: await measureContextColumn(page) }
    check(`${state} sidebar measurable by #mc-project-sidebar`, columns[state].sidebar !== null)
    check(`${state} context column measurable by #mc-project-context-column`, columns[state].contextColumn !== null)
  }
  const assertColumnOwnership = (state) => {
    const sidebar = columns[state]?.sidebar
    const column = columns[state]?.contextColumn
    if (sidebar) {
      // Desktop: the left project column owns its own vertical navigation scroll.
      if (width > 480) {
        check(
          `${state} sidebar is an independent vertical scroll owner`,
          ['auto', 'scroll'].includes(sidebar.overflowY),
          `overflowY ${sidebar.overflowY}`,
        )
        check(
          `${state} sidebar is bounded to the viewport`,
          sidebar.rect.height <= height,
          `height ${sidebar.rect.height} viewport ${height}`,
        )
      } else {
        // Mobile: the route is the single page scroll owner; the sidebar must not become a second one.
        check(
          `${state} mobile sidebar is not a nested scroll owner`,
          sidebar.scrollHeight <= sidebar.clientHeight + 1,
          `${sidebar.scrollHeight}/${sidebar.clientHeight}`,
        )
      }
    }
    if (column)
      check(
        `${state} context column is bounded`,
        column.overflowX === 'hidden' && column.overflowY === 'hidden',
        `${column.overflowX}/${column.overflowY}`,
      )
  }

  // --- state: diff
  await page.locator('[data-tree-path="src/app.ts"]').first().click()
  await page.waitForSelector('[data-testid="context-diff"]', { timeout: INTERACTION_TIMEOUT_MS })
  await expectCounts(page, 'diff', {
    'context-section': 1,
    'context-body': 1,
    'context-breadcrumb': 1,
    'context-breadcrumb-branch': 0,
    'context-diff': 1,
    'git-log-terminal': 0,
    'context-commit-detail': 0,
    'git-log-breadcrumb': 0,
  })
  geometry.diff = {
    shell: await measure(page, 'context-section'),
    breadcrumb: await measure(page, 'context-breadcrumb'),
    body: await measure(page, 'context-body'),
  }
  await captureColumns('diff')
  assertColumnOwnership('diff')
  check(
    'diff breadcrumb is not clipped by its box',
    (geometry.diff.breadcrumb?.scrollHeight ?? 0) <= BREADCRUMB_HEIGHT,
    `scrollHeight ${geometry.diff.breadcrumb?.scrollHeight}`,
  )
  await assertFocusRing(page, 'context-diff')
  check(
    'diff breadcrumb height 32',
    geometry.diff.breadcrumb?.rect.height === BREADCRUMB_HEIGHT,
    `height ${geometry.diff.breadcrumb?.rect.height}`,
  )
  check('diff breadcrumb is context-section child', geometry.diff.breadcrumb?.parentTestId === 'context-section')
  check(
    'diff body overflow hidden',
    geometry.diff.body?.overflowX === 'hidden' && geometry.diff.body?.overflowY === 'hidden',
  )
  if (width > 480) {
    // Desktop: the right context panel is bounded to the viewport and does not scroll itself.
    check(
      'diff shell bounded to viewport',
      (geometry.diff.shell?.rect.height ?? 0) <= height,
      `height ${geometry.diff.shell?.rect.height} viewport ${height}`,
    )
    check(
      'diff shell not scrolling',
      geometry.diff.shell?.scrollHeight === geometry.diff.shell?.clientHeight,
      `${geometry.diff.shell?.scrollHeight}/${geometry.diff.shell?.clientHeight}`,
    )
    await assertScrollable(page, 'diff', 'context-diff', { horizontal: true })
  } else {
    await assertMobileNonOwner(page, 'mobile-diff', 'context-diff')
  }
  check(
    'diff shows no duplicate header or back control',
    (await page.locator('text="Diff del file selezionato"').count()) === 0 &&
      (await page.locator('text="Branch log ·"').count()) === 0 &&
      (await page.locator('button[aria-label="Back to branch log"]').count()) === 0,
  )
  await page.screenshot({ path: resolve(outDir, 'diff.png') })

  // --- state: log
  await page.locator('button[data-testid="branches-local"]').first().click()
  await page.locator('button[data-branch-name="main"]').first().click()
  await page.waitForSelector('[data-testid="git-log-terminal"]', { timeout: INTERACTION_TIMEOUT_MS })
  await expectCounts(page, 'log', {
    'context-section': 1,
    'context-body': 1,
    'context-breadcrumb': 1,
    'context-breadcrumb-branch': 0,
    'context-diff': 0,
    'git-log-terminal': 1,
    'git-log-commit-row': LONG_COMMITS,
    'git-log-ref': LONG_REFS.length,
    'context-commit-detail': 0,
    'context-commit-scroll': 0,
  })
  geometry.log = {
    shell: await measure(page, 'context-section'),
    breadcrumb: await measure(page, 'context-breadcrumb'),
    body: await measure(page, 'context-body'),
  }
  await captureColumns('log')
  assertColumnOwnership('log')
  check(
    'log normative cardinalities',
    (await countOf(page, 'git-log-selected-row')) === 1 && (await countOf(page, 'git-log-ref')) === LONG_REFS.length,
  )
  check(
    'log breadcrumb height 32',
    geometry.log.breadcrumb?.rect.height === BREADCRUMB_HEIGHT,
    `height ${geometry.log.breadcrumb?.rect.height}`,
  )
  await assertFocusRing(page, 'git-log-scroll')
  check(
    'log shell same width as diff',
    Math.abs((geometry.log.shell?.rect.width ?? 0) - (geometry.diff.shell?.rect.width ?? 0)) <= GEOMETRY_TOLERANCE,
  )
  if (width > 480) {
    // Desktop: the bounded context panel keeps one identical box across all three states.
    check(
      'log shell same height as diff',
      Math.abs((geometry.log.shell?.rect.height ?? 0) - (geometry.diff.shell?.rect.height ?? 0)) <= GEOMETRY_TOLERANCE,
    )
    check(
      'log shell not scrolling',
      geometry.log.shell?.scrollTop === 0 && geometry.log.shell?.scrollHeight === geometry.log.shell?.clientHeight,
    )
    check(
      'log body not scrolling',
      geometry.log.body?.scrollTop === 0 && geometry.log.body?.scrollHeight === geometry.log.body?.clientHeight,
    )
    await assertScrollable(page, 'log', 'git-log-scroll', { horizontal: true })
  } else {
    // Mobile: the panel grows with its content inside the single route scroll, so the shell height
    // differs per state by design; the invariant is that the shell itself never scrolls internally.
    check(
      'log shell not scrolling on mobile',
      geometry.log.shell?.scrollHeight === geometry.log.shell?.clientHeight,
      `${geometry.log.shell?.scrollHeight}/${geometry.log.shell?.clientHeight}`,
    )
    await assertMobileNonOwner(page, 'mobile-log', 'git-log-scroll')
  }
  check(
    'breadcrumb carries the branch history',
    (await page.locator('[data-testid="context-breadcrumb"]').innerText()).includes('HISTORY'),
  )
  // Regression guard: the graph column is drawn by the library at a fixed 40px stride, so every
  // commit row must be exactly 40px tall and each node must stay centred on its own row.
  const alignment = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="git-log-commit-row"]')]
    const nodes = [...document.querySelectorAll('[id^="commit-node-"]')]
    const pitch = (boxes) => (boxes.length > 1 ? boxes[1].y - boxes[0].y : null)
    const rowBoxes = rows.map((element) => {
      const box = element.getBoundingClientRect()
      return { y: box.y, h: box.height }
    })
    const nodeBoxes = nodes.map((element) => {
      const box = element.getBoundingClientRect()
      return { y: box.y + box.height / 2 }
    })
    return {
      rowPitch: pitch(rowBoxes),
      nodePitch: pitch(nodeBoxes),
      rowHeights: [...new Set(rowBoxes.map((box) => Math.round(box.h)))],
      maxDelta: Math.max(
        ...rowBoxes.map((box, index) => (nodeBoxes[index] ? Math.abs(nodeBoxes[index].y - (box.y + box.h / 2)) : 0)),
      ),
    }
  })
  metrics.logAlignment = alignment
  check(
    'log rows use the library 40px stride',
    alignment.rowHeights.length === 1 && alignment.rowHeights[0] === 40,
    `heights ${JSON.stringify(alignment.rowHeights)}`,
  )
  check(
    'log row pitch equals node pitch',
    alignment.rowPitch !== null &&
      alignment.nodePitch !== null &&
      Math.abs(alignment.rowPitch - alignment.nodePitch) <= GEOMETRY_TOLERANCE,
    `row ${alignment.rowPitch} node ${alignment.nodePitch}`,
  )
  check('log nodes stay aligned to their own row', alignment.maxDelta <= 2, `max delta ${alignment.maxDelta}`)
  // Criterion 9 requires the log body to be scrollable on BOTH axes. The log truncates its rows by
  // design, so its own content never overflows horizontally: the no-op branch alone would leave the
  // horizontal capability unproven. Prove the container really scrolls horizontally by temporarily
  // injecting an overflowing probe (removed immediately), so this asserts a capability rather than
  // a relaxed expectation.
  const horizontalCapability = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="git-log-scroll"]')
    if (!body) return null
    const before = { scrollLeft: body.scrollLeft, clientWidth: body.clientWidth }
    const probe = document.createElement('div')
    probe.setAttribute('data-probe', 'log-horizontal-capability')
    probe.style.cssText = `width:${body.clientWidth + 400}px;height:1px;flex:none;`
    body.appendChild(probe)
    const width = body.scrollWidth
    body.scrollLeft = 200
    const scrolled = body.scrollLeft
    probe.remove()
    body.scrollLeft = 0
    return { before, overflowX: getComputedStyle(body).overflowX, scrollWidth: width, scrolled }
  })
  metrics.logHorizontalCapability = horizontalCapability
  check(
    'log body declares horizontal overflow',
    horizontalCapability?.overflowX === 'auto' || horizontalCapability?.overflowX === 'scroll',
    `overflow-x ${horizontalCapability?.overflowX}`,
  )
  check(
    'log body scrolls horizontally when content overflows',
    (horizontalCapability?.scrolled ?? 0) > 0,
    `scrollLeft ${horizontalCapability?.scrolled} at scrollWidth ${horizontalCapability?.scrollWidth}`,
  )
  await page.screenshot({ path: resolve(outDir, 'log.png') })

  // --- commit detail from branch log + breadcrumb return
  await page.locator('[data-testid="git-log-commit-row"]').nth(1).click()
  await page.waitForSelector('[data-testid="context-commit-detail"]', { timeout: INTERACTION_TIMEOUT_MS })
  await expectCounts(page, 'commit', {
    'context-section': 1,
    'context-body': 1,
    'context-breadcrumb': 1,
    'context-breadcrumb-branch': 1,
    'context-commit-detail': 1,
    'context-commit-scroll': 1,
    'git-log-terminal': 0,
    'git-log-commit-row': 0,
    'context-diff': 0,
  })
  check('commit did not intercept /projects/commit', commitUnintercepted === 0, `bad responses ${commitUnintercepted}`)
  geometry.commit = {
    shell: await measure(page, 'context-section'),
    breadcrumb: await measure(page, 'context-breadcrumb'),
    body: await measure(page, 'context-body'),
  }
  await captureColumns('commit')
  assertColumnOwnership('commit')
  check(
    'commit normative cardinalities',
    (await countOf(page, 'git-log-ref')) === 0 &&
      (await countOf(page, 'git-log-selected-row')) === 0 &&
      (await countOf(page, 'context-diff')) === 0,
  )
  check(
    'commit breadcrumb height 32',
    geometry.commit.breadcrumb?.rect.height === BREADCRUMB_HEIGHT,
    `height ${geometry.commit.breadcrumb?.rect.height}`,
  )
  await assertFocusRing(page, 'context-commit-scroll')
  check(
    'commit breadcrumb is not clipped by its box',
    (geometry.commit.breadcrumb?.scrollHeight ?? 0) <= BREADCRUMB_HEIGHT,
    `scrollHeight ${geometry.commit.breadcrumb?.scrollHeight}`,
  )
  check(
    'commit shell same width as diff',
    Math.abs((geometry.commit.shell?.rect.width ?? 0) - (geometry.diff.shell?.rect.width ?? 0)) <= GEOMETRY_TOLERANCE,
  )
  if (width > 480) {
    check(
      'commit shell same height as diff',
      Math.abs((geometry.commit.shell?.rect.height ?? 0) - (geometry.diff.shell?.rect.height ?? 0)) <=
        GEOMETRY_TOLERANCE,
    )
    check(
      'commit shell not scrolling',
      geometry.commit.shell?.scrollTop === 0 &&
        geometry.commit.shell?.scrollHeight === geometry.commit.shell?.clientHeight,
    )
    await assertScrollable(page, 'commit', 'context-commit-scroll', { horizontal: false })
  } else {
    check(
      'commit shell not scrolling on mobile',
      geometry.commit.shell?.scrollHeight === geometry.commit.shell?.clientHeight,
      `${geometry.commit.shell?.scrollHeight}/${geometry.commit.shell?.clientHeight}`,
    )
    await assertMobileNonOwner(page, 'mobile-commit', 'context-commit-scroll')
  }
  check(
    'commit detail replaces the log',
    (await countOf(page, 'git-log-terminal')) === 0 && (await countOf(page, 'context-commit-detail')) === 1,
  )
  // Issue #12 regression guard, asserted on the rendered DOM of the real route: a binary file must
  // appear in the changed-files list with a `binary` marker, while textual files keep +N/-N.
  // `innerText` splits each row into its own lines (path, then "+N-N"), so the assertions join them.
  const renderedFiles = await page.evaluate(() => {
    const inspector = document.querySelector('[data-testid="context-commit-scroll"]')
    return (inspector?.innerText ?? '')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  })
  metrics.renderedCommitFiles = renderedFiles
  const fileList = renderedFiles.join('|')
  check(
    'rendered commit files include the binary entry',
    /\|assets\/fixture-logo\.png\|binary\|/.test(fileList),
    JSON.stringify(renderedFiles.slice(80, 90)),
  )
  check(
    'rendered commit files keep +N/-N for textual files',
    /\|src\/fixture\/module_000\.ts\|\+\d+-\d+\|/.test(fileList),
    JSON.stringify(renderedFiles.slice(0, 10)),
  )
  check('binary entry renders no numeric diff counts', !/fixture-logo\.png\|\+\d+-\d+/.test(fileList))
  check(
    'every changed file row is rendered',
    renderedFiles.filter((line) => /^src\/fixture\/module_\d+\.ts$/.test(line)).length === 40 &&
      renderedFiles.includes('assets/fixture-logo.png'),
  )
  check('branch breadcrumb segment is the return control', (await countOf(page, 'context-breadcrumb-branch')) === 1)
  await page.screenshot({ path: resolve(outDir, 'commit.png') })

  await page.locator('[data-testid="context-breadcrumb-branch"]').click()
  await page.waitForSelector('[data-testid="git-log-terminal"]', { timeout: INTERACTION_TIMEOUT_MS })
  check(
    'breadcrumb returns to branch log',
    (await countOf(page, 'git-log-terminal')) === 1 && (await countOf(page, 'context-commit-detail')) === 0,
  )

  // Criterion 5 through the keyboard path: the return control is a role=link span, and a manual
  // observation is not reproducible evidence. Re-enter commit detail and activate the control with
  // Enter to assert the a11y path from committed artefacts.
  await page.locator('[data-testid="git-log-commit-row"]').nth(1).click()
  await page.waitForSelector('[data-testid="context-commit-detail"]', { timeout: INTERACTION_TIMEOUT_MS })
  await page.locator('[data-testid="context-breadcrumb-branch"]').focus()
  const focusedTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))
  check(
    'breadcrumb return control is focusable',
    focusedTestId === 'context-breadcrumb-branch',
    `focused ${focusedTestId}`,
  )
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-testid="git-log-terminal"]', { timeout: INTERACTION_TIMEOUT_MS })
  check(
    'breadcrumb returns to branch log via keyboard',
    (await countOf(page, 'git-log-terminal')) === 1 && (await countOf(page, 'context-commit-detail')) === 0,
  )

  // --- commit detail originated from the commit timeline (uses /projects/commit through the fixture dispatcher)
  const commitBefore = commitRequests.length
  await page.locator('[data-commit-hash]').first().click()
  await page.waitForSelector('[data-testid="context-commit-detail"]', { timeout: INTERACTION_TIMEOUT_MS })
  await expectCounts(page, 'timeline-commit', {
    'context-commit-detail': 1,
    'context-breadcrumb-branch': 0,
    'git-log-terminal': 0,
  })
  check(
    'timeline commit calls /projects/commit',
    commitRequests.length > commitBefore,
    `before ${commitBefore} after ${commitRequests.length}`,
  )
  const commitQuery = commitRequests.at(-1)?.query ?? {}
  check(
    'commit request carries required query',
    [
      'project_id',
      'commit',
      'local_generation',
      'processInstanceId',
      'registryEpoch',
      'contextIdentity',
      'snapshotId',
    ].every((key) => commitQuery[key] !== undefined),
    JSON.stringify(commitQuery),
  )
  check('commit request hash is 40 hex', /^[0-9a-fA-F]{40}$/.test(commitQuery.commit ?? ''))
  check(
    'commit response came from the fixture dispatcher',
    commitUnintercepted === 0,
    `invalid commit responses ${commitUnintercepted}`,
  )

  // --- reload repeats the diff interactions
  await page.reload({ waitUntil: 'networkidle', timeout: READY_TIMEOUT_MS })
  await page.waitForSelector('[data-testid="mc-projects-route"]', { timeout: READY_TIMEOUT_MS })
  await page.waitForSelector('[data-testid="context-section"]', { timeout: READY_TIMEOUT_MS })
  if (width > 480) {
    await page.locator('[data-tree-path="src/app.ts"]').first().click()
    await page.waitForSelector('[data-testid="context-diff"]', { timeout: INTERACTION_TIMEOUT_MS })
    await assertScrollable(page, 'diff-after-reload', 'context-diff', { horizontal: true })
  } else {
    const mobileRoute = await measure(page, 'mc-projects-route')
    check(
      'mobile-after-reload route owns vertical scroll',
      mobileRoute.overflowY === 'auto' || mobileRoute.overflowY === 'scroll',
      mobileRoute.overflowY,
    )
    check(
      'mobile-after-reload route has scrollable content',
      mobileRoute.scrollHeight > mobileRoute.clientHeight,
      `${mobileRoute.scrollHeight}/${mobileRoute.clientHeight}`,
    )
    await page.locator('[data-tree-path="src/app.ts"]').first().click()
    await page.waitForSelector('[data-testid="context-diff"]', { timeout: INTERACTION_TIMEOUT_MS })
    await assertMobileNonOwner(page, 'mobile-diff-after-reload', 'context-diff')
    const nestedAfterReload = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="mc-projects-route"] *'))
        .filter((element) => {
          const style = getComputedStyle(element)
          const id = element.getAttribute('data-testid')
          return (
            /(auto|scroll)/.test(style.overflowY) &&
            !['context-diff', 'git-log-scroll', 'context-commit-scroll'].includes(id) &&
            !element.closest('#mc-project-sidebar')
          )
        })
        .filter((element) => element.getBoundingClientRect().height >= window.innerHeight - 1)
        .map((element) => element.getAttribute('data-testid')),
    )
    check(
      'mobile-after-reload no nested full-height scroll owner',
      nestedAfterReload.length === 0,
      JSON.stringify(nestedAfterReload),
    )
  }

  // --- scroll ownership of the whole route (no competing nested owner)
  const nested = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="mc-projects-route"] *'))
      .filter((element) => {
        const style = getComputedStyle(element)
        const scrollable = /(auto|scroll)/.test(style.overflowY)
        const id = element.getAttribute('data-testid')
        return (
          scrollable &&
          !['context-diff', 'git-log-scroll', 'context-commit-scroll'].includes(id) &&
          !element.closest('#mc-project-sidebar')
        )
      })
      .map((element) => ({
        testId: element.getAttribute('data-testid'),
        id: element.id,
        overflowY: getComputedStyle(element).overflowY,
        height: element.getBoundingClientRect().height,
      })),
  )
  check('no competing nested vertical scroll owner', nested.length === 0, JSON.stringify(nested))
  const route = await measure(page, 'mc-projects-route')
  metrics.route = route
  if (width <= 480) {
    check(
      'mobile route owns vertical scroll',
      route.overflowY === 'auto' || route.overflowY === 'scroll',
      route.overflowY,
    )
    check(
      'mobile nested full-height owner absent',
      nested.every((entry) => entry.height < height),
      JSON.stringify(nested),
    )
  } else {
    check('desktop route overflow hidden', route.overflowY === 'hidden', route.overflowY)
    check('desktop right panel bounded', (geometry.diff.shell?.rect.height ?? 0) <= height)
  }
  // A generic "Failed to load resource: the server responded with a status of N" line carries no URL,
  // so it cannot be attributed to this plugin: the disposable host shell loads many unrelated
  // /api/local endpoints that the fixture intentionally does not serve. Such lines are recorded but
  // excluded from the fail-closed gate. Any other error (uncaught exception, plugin assertion, etc.)
  // is attributed to the plugin and fails the run.
  const unattributable = /^Failed to load resource: the server responded with a status of \d+/
  // Host-shell features outside this plugin's scope: the disposable host has no push backend and no
  // notification permission, so its own push-subscription attempt rejects. Recorded, not graded.
  const hostShellErrors = /Error retrieving push subscription|Notification permission|push service/i
  const pluginErrors = consoleErrors.filter(
    (message) => !unattributable.test(message) && !hostShellErrors.test(message),
  )
  metrics.unattributableResourceErrors = consoleErrors.filter((message) => unattributable.test(message))
  metrics.hostShellErrors = consoleErrors.filter((message) => hostShellErrors.test(message))
  metrics.pluginConsoleErrors = pluginErrors

  // Real plugin-scoped network evidence: statuses actually observed for this plugin's endpoints.
  metrics.pluginEndpointResponses = pluginEndpointResponses
  check(
    'plugin catalog/snapshot/commit responses all 200',
    ['catalog', 'snapshot', 'commit'].every((name) =>
      pluginEndpointResponses.some((entry) => entry.endpoint === name && entry.status === 200),
    ),
    JSON.stringify(pluginEndpointResponses),
  )
  check(
    'commit endpoint served by the fixture dispatcher',
    commitUnintercepted === 0 && commitRequests.length > 0,
    `requests ${commitRequests.length} invalid ${commitUnintercepted}`,
  )
  check('no plugin console/page errors', pluginErrors.length === 0, pluginErrors.slice(0, 3).join(' | '))
  const pluginFailures = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="mc-projects-route"] [role="status"]'))
      .map((element) => element.textContent)
      .filter((text) => /unavailable|error|failed/i.test(text ?? '')),
  )
  check('no plugin capability error banners', pluginFailures.length === 0, JSON.stringify(pluginFailures))
  await page.screenshot({ path: resolve(outDir, 'final.png') })

  metrics.geometry = geometry
  metrics.columns = columns
  metrics.intercepted = intercepted
  metrics.commitRequests = commitRequests
  metrics.commitUnintercepted = commitUnintercepted
  metrics.consoleErrors = consoleErrors
  metrics.failures = failures
  writeFileSync(resolve(outDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`)
  await browser.close()

  process.stdout.write(
    `${browserKey} ${viewportArg}: ${metrics.checks.length - failures.length}/${metrics.checks.length} checks passed; artifacts ${outDir}\n`,
  )
  if (failures.length) {
    process.stderr.write(`FAIL\n- ${failures.join('\n- ')}\n`)
    process.exit(1)
  }
  process.stdout.write('PASS\n')
}

main().catch((error) => {
  process.stderr.write(`issue1-browser-verification: ${error?.stack ?? error}\n`)
  process.exit(3)
})
