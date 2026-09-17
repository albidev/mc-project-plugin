import type { Commit } from './types.ts'

export interface GitGraphOptions {
  selectedHash?: string
}

export interface GitGraphTransition {
  from: number
  to: number
  parent: string
}

export interface GitGraphRow {
  hash: string
  shortHash: string
  subject: string
  refs: string[]
  graph: string
  lanes: number
  lanesAfter: number
  position: number
  transitions: GitGraphTransition[]
  selected: boolean
  isMerge: boolean
  unresolvedParents: string[]
  commit: Commit
}

function refsFor(commit: Commit): string[] {
  if (Array.isArray(commit.refs)) return [...commit.refs]
  return commit.refs ? [commit.refs] : []
}

function graphLine(before: string[], position: number, transitions: GitGraphTransition[]): string {
  const width = Math.max(
    before.length,
    position + 1,
    ...transitions.map((transition) => transition.from + 1),
    ...transitions.map((transition) => transition.to + 1),
  )
  const cells = Array.from({ length: Math.max(width, 1) }, () => '|')
  cells[position] = '*'
  for (const transition of transitions) {
    if (transition.from === transition.to) continue
    cells[transition.to] = transition.to > transition.from ? '\\' : '/'
  }
  return cells.join(' ')
}

function advanceLanes(
  before: string[],
  position: number,
  parents: string[],
): { lanes: string[]; transitions: GitGraphTransition[]; convergence: boolean } {
  const lanes = before.length > 0 ? [...before] : []
  if (lanes.length === 0) lanes.push('')
  const sourcePosition = position
  const transitions: GitGraphTransition[] = []
  const primary = parents[0]
  if (!primary) {
    lanes.splice(position, 1)
    return { lanes, transitions, convergence: false }
  }

  const existingPrimary = lanes.findIndex((hash, lane) => lane !== position && hash === primary)
  if (existingPrimary >= 0) {
    transitions.push({ from: sourcePosition, to: existingPrimary, parent: primary })
    lanes.splice(position, 1)
    position = existingPrimary > position ? existingPrimary - 1 : existingPrimary
  } else {
    lanes[position] = primary
    transitions.push({ from: sourcePosition, to: sourcePosition, parent: primary })
  }

  let convergence = existingPrimary >= 0
  let extraOffset = 0
  for (const parent of parents.slice(1)) {
    const existing = lanes.findIndex((hash, lane) => lane !== position && hash === parent)
    if (existing >= 0) {
      transitions.push({ from: sourcePosition, to: existing, parent })
      lanes.splice(existing, 1)
      if (existing < position) position -= 1
      convergence = true
    } else {
      const target = position + 1 + extraOffset
      lanes.splice(target, 0, parent)
      transitions.push({ from: sourcePosition, to: target, parent })
      extraOffset += 1
    }
  }

  return { lanes, transitions, convergence }
}

export function buildGitGraph(commits: Commit[], options: GitGraphOptions = {}): GitGraphRow[] {
  const hashes = new Set(commits.map((commit) => commit.hash))
  let lanes: string[] = []

  return commits.map((commit) => {
    let position = lanes.indexOf(commit.hash)
    if (position < 0) {
      position = lanes.length
      lanes.push(commit.hash)
    }
    const before = [...lanes]
    const parents = commit.parents ?? []
    const isMerge = commit.merge === true || parents.length > 1
    const next = advanceLanes(before, position, parents)
    const row: GitGraphRow = {
      hash: commit.hash,
      shortHash: commit.shortHash ?? commit.hash.slice(0, 7),
      subject: commit.subject,
      refs: refsFor(commit),
      graph: graphLine(before, position, next.transitions),
      lanes: before.length,
      lanesAfter: next.lanes.length,
      position,
      transitions: next.transitions,
      selected: options.selectedHash === commit.hash,
      isMerge,
      unresolvedParents: parents.filter((parent) => !hashes.has(parent)),
      commit,
    }
    lanes = next.lanes
    return row
  })
}
