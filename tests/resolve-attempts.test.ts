import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildResolveAttempts } from '../src/main/bot/Mixer.ts'

test('non-YouTube source gets a single attempt (cookies as configured)', () => {
  assert.deepEqual(buildResolveAttempts('url', false), [{ cookies: false, client: null }])
  assert.deepEqual(buildResolveAttempts('url', true), [{ cookies: true, client: null }])
  assert.deepEqual(buildResolveAttempts('local', true), [{ cookies: true, client: null }])
})

test('YouTube without cookies: default then android_vr', () => {
  assert.deepEqual(buildResolveAttempts('youtube', false), [
    { cookies: false, client: null },
    { cookies: false, client: 'android_vr' }
  ])
})

test('YouTube with cookies: configured, then drop cookies, then android_vr', () => {
  // The cookie-poisoned-video case: a no-cookies retry sits between the configured attempt
  // and the alternate client, so a video that only serves DRM formats to an authed session
  // still falls through to a plain anonymous stream.
  assert.deepEqual(buildResolveAttempts('youtube', true), [
    { cookies: true, client: null },
    { cookies: false, client: null },
    { cookies: false, client: 'android_vr' }
  ])
})
