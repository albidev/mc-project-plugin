import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGitGraph } from '../gitGraph.ts'
import type { Commit } from '../types.ts'

const commit = (hash: string, parents: string[] = [], extra: Partial<Commit> = {}): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  subject: hash,
  parents,
  ...extra,
})

test('renders an empty graph without rows', () => {
  assert.deepEqual(buildGitGraph([]), [])
})

test('renders root and linear history with one commit lane', () => {
  const rows = buildGitGraph([commit('c', ['b']), commit('b', ['a']), commit('a')])

  assert.deepEqual(
    rows.map((row) => row.hash),
    ['c', 'b', 'a'],
  )
  assert.deepEqual(
    rows.map((row) => row.lanes),
    [1, 1, 1],
  )
  assert.ok(rows.every((row) => row.graph.includes('*')))
  assert.ok(rows.every((row) => !row.graph.includes('\\')))
})

test('renders a merge with parallel lanes and convergence', () => {
  const rows = buildGitGraph([
    commit('merge', ['main', 'feature'], { merge: true }),
    commit('main', ['root']),
    commit('feature', ['root']),
    commit('root'),
  ])

  assert.equal(rows[0].isMerge, true)
  assert.ok(rows[0].graph.includes('\\'), rows[0].graph)
  assert.ok(rows[1].lanes >= 2, rows[1].graph)
  assert.ok(rows[2].graph.includes('*'), rows[2].graph)
  assert.ok(rows[2].graph.includes('/'), rows[2].graph)
  assert.equal(rows[3].unresolvedParents.length, 0)
})

test('renders every connector for a three-parent merge', () => {
  const rows = buildGitGraph([
    commit('octopus', ['one', 'two', 'three'], { merge: true }),
    commit('one'),
    commit('two'),
    commit('three'),
  ])

  assert.match(rows[0].graph, /\\/)
  assert.deepEqual(
    rows[0].transitions
      .filter((transition) => transition.from !== transition.to)
      .map((transition) => [transition.from, transition.to]),
    [
      [0, 1],
      [0, 2],
    ],
  )
  assert.equal(rows[0].lanes, 1)
})

test('renders a split topology when one lane introduces two parents', () => {
  const rows = buildGitGraph([
    commit('tip', ['left', 'right'], { merge: true }),
    commit('left', ['root']),
    commit('right', ['root']),
    commit('root'),
  ])
  assert.ok(rows[0].lanes >= 1)
  assert.ok(rows.some((row) => row.graph.includes('\\\\') || row.graph.includes('/')))
  assert.deepEqual(rows.at(-1)?.unresolvedParents, [])
})

test('preserves refs and marks the selected commit', () => {
  const rows = buildGitGraph([commit('head', [], { refs: ['HEAD -> main', 'origin/main', 'tag: v1.0'] })], {
    selectedHash: 'head',
  })

  assert.deepEqual(rows[0].refs, ['HEAD -> main', 'origin/main', 'tag: v1.0'])
  assert.equal(rows[0].selected, true)
})

test('reports parents that are outside the bounded commit window', () => {
  const rows = buildGitGraph([commit('child', ['missing-parent'])])

  assert.deepEqual(rows[0].unresolvedParents, ['missing-parent'])
  assert.equal(rows[0].lanes, 1)
})
