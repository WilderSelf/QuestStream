import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ytdlpFailReason } from '../src/main/bot/Mixer.ts'

test('empty stderr → generic message', () => {
  assert.match(ytdlpFailReason(''), /no audio produced/)
  assert.match(ytdlpFailReason('   \n  '), /no audio produced/)
})

test('cookie-database failure points at the cookies setting', () => {
  const err = "ERROR: could not find firefox cookies database in '/home/u/.mozilla/firefox'"
  const r = ytdlpFailReason(err)
  assert.match(r, /YouTube Cookies/)
  assert.match(r, /cookies database/)
})

test('bot-wall failure suggests cookies', () => {
  const err = 'ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies'
  assert.match(ytdlpFailReason(err), /bot check/)
})

test('HTTP 403 on download points at cookies', () => {
  const err = 'ERROR: unable to download video data: HTTP Error 403: Forbidden'
  const r = ytdlpFailReason(err)
  assert.match(r, /403/)
  assert.match(r, /cookies/i)
})

test('other errors surface yt-dlp’s own message', () => {
  const err = 'ERROR: [youtube] xyz: Video unavailable. This video is private'
  const r = ytdlpFailReason(err)
  assert.match(r, /yt-dlp couldn't fetch audio/)
  assert.match(r, /Video unavailable/)
})

test('prefers the last ERROR line and strips the prefix', () => {
  const err = 'WARNING: something\nERROR: first problem\nERROR: real problem'
  const r = ytdlpFailReason(err)
  assert.match(r, /real problem/)
  assert.doesNotMatch(r, /ERROR:/)
})

test('over-long messages are truncated', () => {
  const err = 'ERROR: ' + 'x'.repeat(500)
  assert.ok(ytdlpFailReason(err).length < 220)
})
