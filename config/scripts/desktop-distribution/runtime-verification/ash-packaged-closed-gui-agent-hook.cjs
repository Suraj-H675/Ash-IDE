// Only a marker-verified, private native-X11 AppImage fixture can submit these
// deterministic provider-format lifecycle hooks to the *packaged* hook server.
// This deliberately does not start Claude or use any real provider account.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const [phase, root] = process.argv.slice(2)
assert.ok(phase === 'working' || phase === 'finished' || phase === 'forged', 'supported test phase')
assert.match(root ?? '', /^\/var\/tmp\/ashx11\.[A-Za-z0-9]{6}$/)
const fixture = fs.statSync(root)
assert.equal(fixture.uid, process.getuid())
assert.equal(fixture.mode & 0o777, 0o700)
assert.equal(fs.existsSync(path.join(root, '.ash-desktop-lifecycle-fixture')), true)
assert.equal(process.env.ASH_USER_DATA_PATH, path.join(root, 'profile'))

const terminal = JSON.parse(fs.readFileSync(path.join(root, 'terminal-create.json'), 'utf8')).result
  .terminal
assert.match(terminal.paneKey, /^[0-9a-f-]{36}:[0-9a-f-]{36}$/)
assert.ok(terminal.worktreeId.includes(`${root}/project`), 'private workspace only')

const endpointPath = path.join(root, 'profile', 'agent-hooks', 'endpoint.env')
const endpointStats = fs.statSync(endpointPath)
assert.equal(endpointStats.uid, process.getuid())
assert.equal(endpointStats.mode & 0o777, 0o600)
const endpoint = Object.fromEntries(
  fs
    .readFileSync(endpointPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const split = line.indexOf('=')
      assert.ok(split > 0)
      return [line.slice(0, split), line.slice(split + 1)]
    })
)
assert.match(endpoint.ORCA_AGENT_HOOK_TOKEN, /^[0-9a-f-]{36}$/i)
const port = Number(endpoint.ORCA_AGENT_HOOK_PORT)
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535)

const payload = {
  paneKey: terminal.paneKey,
  tabId: terminal.tabId,
  worktreeId: terminal.worktreeId,
  env: endpoint.ORCA_AGENT_HOOK_ENV,
  version: endpoint.ORCA_AGENT_HOOK_VERSION,
  payload: {
    hook_event_name: phase === 'finished' ? 'Stop' : 'UserPromptSubmit',
    session_id: '11111111-1111-4111-8111-111111111111',
    ...(phase !== 'finished' ? { prompt: 'Private Ash runtime notification fixture' } : {})
  }
}

const timeout = AbortSignal.timeout(3500)
fetch(`http://127.0.0.1:${port}/hook/claude`, {
  method: 'POST',
  signal: timeout,
  headers: {
    'Content-Type': 'application/json',
    'X-Orca-Agent-Hook-Token':
      phase === 'forged' ? 'invalid-test-only-token' : endpoint.ORCA_AGENT_HOOK_TOKEN,
    Connection: 'close'
  },
  body: JSON.stringify(payload)
})
  .then((response) => {
    assert.equal(
      response.status,
      phase === 'forged' ? 403 : 204,
      'real packaged hook server must enforce its private token'
    )
    console.log(
      JSON.stringify({
        ok: true,
        phase,
        authenticatedHookSubmitted: phase !== 'forged',
        ...(phase === 'forged' ? { wrongTokenRejected: true } : {})
      })
    )
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
