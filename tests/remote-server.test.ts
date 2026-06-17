import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RemoteServer } from '../src/main/remote/server.ts'

const TOKEN = 'secret-token'

async function withServer(
  fn: (srv: RemoteServer, base: string) => Promise<void>
): Promise<void> {
  const srv = new RemoteServer(0) // ephemeral port
  await srv.start(TOKEN)
  const base = `http://127.0.0.1:${srv.boundPort()}`
  try {
    await fn(srv, base)
  } finally {
    srv.stop()
  }
}

const post = (base: string, path: string, body: object, token?: string): Promise<Response> =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  })

test('remote server: pairing, auth, and command forwarding end-to-end', async () => {
  await withServer(async (srv, base) => {
    // public page
    assert.equal((await fetch(base + '/')).status, 200)

    // /api/state requires auth
    assert.equal((await fetch(base + '/api/state')).status, 401)

    // wrong pairing code → 401
    const code = srv.newPairingCode(Date.now())
    assert.equal((await post(base, '/api/pair', { code: 'nope' })).status, 401)

    // correct code → the bearer token
    const ok = await post(base, '/api/pair', { code })
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).token, TOKEN)

    // single-use: replaying the code → 401
    assert.equal((await post(base, '/api/pair', { code })).status, 401)

    // authed state works; no-store header set
    const st = await fetch(base + '/api/state', { headers: { authorization: `Bearer ${TOKEN}` } })
    assert.equal(st.status, 200)
    assert.equal(st.headers.get('cache-control'), 'no-store')

    // authed command is forwarded + validated
    let got: unknown = null
    srv.onCommand = (c) => {
      got = c
    }
    assert.equal((await post(base, '/api/cmd', { action: 'next' }, TOKEN)).status, 200)
    assert.deepEqual(got, { action: 'next' })

    // junk command → 400
    assert.equal((await post(base, '/api/cmd', { action: 'rm -rf' }, TOKEN)).status, 400)

    // unauthenticated command → 401 (and must NOT consume the post-auth cmd bucket)
    got = null
    assert.equal((await post(base, '/api/cmd', { action: 'next' })).status, 401)
    assert.equal(got, null)
  })
})

test('remote server: pairing bucket rate-limits brute force', async () => {
  await withServer(async (srv, base) => {
    srv.newPairingCode(Date.now())
    let limited = false
    for (let i = 0; i < 9; i++) {
      // pairBucket capacity is 5 → rapid attempts beyond that get 429
      const r = await post(base, '/api/pair', { code: 'x' })
      if (r.status === 429) limited = true
    }
    assert.ok(limited, 'expected a 429 once the pair bucket is exhausted')
  })
})
