import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pluginManifest from '../manifest.ts'
import hostFixtureManifest from '../../tests/fixtures/host-plugin/ui/manifest.ts'
import HostPluginRoute from '../../tests/fixtures/host-plugin/ui/route.ts'
import type { HostPluginManifest } from '../../tests/fixtures/host-plugin/ui/types.ts'

const typedFixtureManifest: HostPluginManifest = hostFixtureManifest

function endpointContract(manifest: typeof pluginManifest) {
  return manifest.endpoints.map(({ method, path, handler, authRequired }) => ({ method, path, handler, authRequired }))
}

test('frontend manifest and route satisfy the isolated host contract', () => {
  assert.equal(pluginManifest.id, 'mc-project-plugin')
  assert.equal(pluginManifest.name, 'Projects')
  assert.equal(pluginManifest.routePath, '/mc-project-plugin')
  assert.equal(typeof HostPluginRoute, 'function')
  assert.equal(typedFixtureManifest.id, pluginManifest.id)
  assert.equal(typedFixtureManifest.routePath, pluginManifest.routePath)
})

test('frontend endpoint metadata is exactly the backend manifest contract', () => {
  const backendManifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../manifest.json', import.meta.url)), 'utf8'),
  )
  assert.deepEqual(endpointContract(pluginManifest), backendManifest.endpoints)
  assert.deepEqual(endpointContract(typedFixtureManifest as typeof pluginManifest), backendManifest.endpoints)
  assert.ok(typedFixtureManifest.endpoints.every((endpoint) => endpoint.authRequired === true))
})
