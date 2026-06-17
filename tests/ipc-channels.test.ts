import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IPC, EVENT_CHANNELS, MAIN_HANDLED_CHANNELS } from '../src/shared/ipc.ts'

test('IPC channel strings are unique', () => {
  const all = Object.values(IPC)
  assert.equal(new Set(all).size, all.length)
})

test('event vs handled channels partition every IPC value exactly', () => {
  const all = Object.values(IPC)
  // disjoint
  for (const c of EVENT_CHANNELS) assert.ok(!MAIN_HANDLED_CHANNELS.includes(c), `${c} in both sets`)
  // every event channel is real
  for (const c of EVENT_CHANNELS) assert.ok(all.includes(c), `${c} is not an IPC channel`)
  // union covers everything
  const union = new Set([...EVENT_CHANNELS, ...MAIN_HANDLED_CHANNELS])
  assert.equal(union.size, all.length)
  for (const c of all) assert.ok(union.has(c), `channel ${c} is uncovered`)
})
