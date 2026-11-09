import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { commandFor, hookConfig, installConfig } from '../packages/kitchen/src/connectors/setup.mjs'
import { mapHooksInstalled, hasMapHook } from '../bin/map-hooks.mjs'

const script = fileURLToPath(new URL('../bin/agenttrail.mjs', import.meta.url))
const mapCommand = `node ${JSON.stringify(script)} hook`
const events = ['PreToolUse', 'PostToolUse', 'Stop', 'SessionStart', 'SubagentStop']

test('Only complete, unrestricted Map command hooks count as installed', () => {
  const own = { matcher: '*', hooks: [{ type: 'command', command: mapCommand }] }
  const config = { hooks: Object.fromEntries(events.map(event => [event, [own]])) }
  assert.equal(mapHooksInstalled(config, mapCommand), true)
  assert.equal(mapHooksInstalled({ hooks: { PreToolUse: [own] } }, mapCommand), false)
  for (const entries of [undefined, {}, [null], [{ command: mapCommand }],
    [{ ...own, matcher: 'Read' }],
    [{ matcher: '*', hooks: [{ type: 'prompt', command: mapCommand }] }],
    [{ matcher: '*', hooks: [{ type: 'command', command: 'echo agenttrail' }] }]]) {
    assert.equal(hasMapHook(entries, mapCommand), false)
  }
  assert.equal(mapHooksInstalled(null, mapCommand), false)
})

// Only the early-exit init --hooks-only path runs: no daemon, discovery,
// HTTP requests, watcher, browser, home-directory state or existing repo writes.
for (const order of ['kitchen-first', 'map-first']) {
  test(`Map and Kitchen coexist (${order})`, async () => {
    assert.ok(process.env.TMPDIR, 'Use the assigned scratch directory')
    const root = await fs.mkdtemp(path.join(process.env.TMPDIR, 'agenttrail-hooks-'))
    const settings = path.join(root, '.claude', 'settings.local.json')
    const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo agenttrail unrelated' }] }
    await fs.mkdir(path.dirname(settings), { recursive: true })
    await fs.writeFile(settings, JSON.stringify({ permissions: { allow: ['Read'] }, hooks: { PreToolUse: [foreign] } }))
    const kitchenCommand = commandFor(process.execPath, path.join(root, 'agenttrail-kitchen', 'bin', 'relay.mjs'), 'claude', path.join(root, 'state'))
    const kitchen = async () => installConfig(await hookConfig(root, 'claude', kitchenCommand))
    const map = () => {
      const result = spawnSync(process.execPath, [script, 'init', '--hooks-only', root], { encoding: 'utf8', timeout: 10000 })
      assert.equal(result.error, undefined)
      assert.equal(result.status, 0, result.stderr)
    }
    if (order === 'kitchen-first') { await kitchen(); map() }
    else { map(); await kitchen() }
    const before = await fs.readFile(settings, 'utf8')
    map()
    assert.equal(await fs.readFile(settings, 'utf8'), before, 'Map installation must be byte-idempotent')
    const cfg = JSON.parse(before)
    assert.deepEqual(cfg.permissions, { allow: ['Read'] })
    assert.deepEqual(cfg.hooks.PreToolUse[0], foreign)
    for (const event of events) {
      const commands = cfg.hooks[event].flatMap(entry => entry.hooks || []).map(hook => hook.command)
      assert.equal(commands.filter(command => command === mapCommand).length, 1, `${event}: exactly one Map relay`)
      assert.equal(commands.filter(command => command === kitchenCommand).length, 1, `${event}: preserve Kitchen relay`)
    }
    // Keep isolated fixture directories as execution evidence; never remove shared data.
  })
}
