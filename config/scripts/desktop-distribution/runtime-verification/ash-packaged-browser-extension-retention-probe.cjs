// Test-only native probe for Chromium extension retention across the Ash window transfer.
// It observes the test-owned local page through fenced CDP and uses only the trusted renderer bridge
// for extension and settings management. The extension itself asks for loopback access in its popup.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { chromium } = require('playwright-core')

const [stage, root, sourceExtension] = process.argv.slice(2)
if (!['before', 'after'].includes(stage)) {
  throw new Error('Expected before or after')
}

const fixture = path.resolve(root || '')
const privateRoot = fs.realpathSync(process.env.ASH_TEST_PRIVATE_ROOT || '/var/tmp')
const fixtureTarget = fs.realpathSync(fixture)
const fixtureName = path.basename(fixtureTarget)
if (
  path.dirname(fixtureTarget) !== privateRoot ||
  !/^ash(?:x11|wl)\.[a-zA-Z0-9]{6}$/.test(fixtureName) ||
  !/^\/(?:tmp|var\/tmp)\/ash(?:x11|wl)\.[a-zA-Z0-9]{6}$/.test(fixture)
) {
  throw new Error('Refusing extension observation outside the private native fixture')
}
const ownedFixture = fs.statSync(fixtureTarget)
if (
  ownedFixture.uid !== process.getuid() ||
  (ownedFixture.mode & 0o777) !== 0o700 ||
  !fs.existsSync(path.join(fixtureTarget, '.ash-desktop-lifecycle-fixture')) ||
  process.env.ASH_USER_DATA_PATH !== path.join(fixture, 'profile')
) {
  throw new Error('Refusing extension observation without the private Ash profile')
}

const currentNetns = fs.readlinkSync('/proc/self/ns/net')
const expectedNetns = process.env.ASH_TEST_EXPECTED_NETNS
const appPid = Number(process.env.ASH_TEST_APP_PID)
const parentNetnsFd = Number(process.env.ASH_TEST_PARENT_NETNS_FD)
assert.match(expectedNetns || '', /^net:\[[0-9]+\]$/)
assert.equal(parentNetnsFd, 9)
assert.equal(fs.readlinkSync(`/proc/self/fd/${parentNetnsFd}`), expectedNetns)
assert.notEqual(currentNetns, expectedNetns, 'CDP must stay in the private network namespace')
assert.ok(Number.isInteger(appPid) && appPid > 1)
assert.equal(fs.readlinkSync(`/proc/${appPid}/ns/net`), currentNetns)
assert.equal(process.env.ASH_TEST_APP_LOG_PATH, path.join(fixture, 'app.log'))

const identity = JSON.parse(
  fs.readFileSync(path.join(fixture, 'local-browser-identity.json'), 'utf8')
)
assert.match(identity.browserPageId, /^[\w-]{4,}$/)
assert.equal(typeof identity.profileId, 'string')
const ownerReceipt = JSON.parse(
  fs.readFileSync(path.join(fixture, `browser-owner-${stage}.json`), 'utf8')
)
assert.equal(ownerReceipt.ok, true)
assert.equal(ownerReceipt.browserPageId, identity.browserPageId)
assert.equal(ownerReceipt.profileId, identity.profileId)
assert.ok(Number.isInteger(ownerReceipt.webContentsId) && ownerReceipt.webContentsId > 0)
assert.match(ownerReceipt.partition || '', /^persist:/)

const ready = JSON.parse(fs.readFileSync(path.join(fixture, 'local-browser-ready.json'), 'utf8'))
assert.ok(Number.isInteger(ready.port) && ready.port > 0 && ready.port <= 65535)
const origin = `http://127.0.0.1:${ready.port}`
const fixturePath = path.resolve(__dirname, 'fixtures/br08-extension')
assert.equal(fs.realpathSync(sourceExtension), fs.realpathSync(fixturePath))
const manifest = JSON.parse(fs.readFileSync(path.join(fixturePath, 'manifest.json'), 'utf8'))
assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*'])
assert.deepEqual(manifest.optional_host_permissions, ['http://localhost/*'])
assert.deepEqual(manifest.permissions, ['scripting'])

const extensionDirectory = path.join(fixture, 'br08-extension')
if (stage === 'before') {
  fs.mkdirSync(extensionDirectory, { mode: 0o700 })
}
const ownedExtension = fs.lstatSync(extensionDirectory)
assert.ok(ownedExtension.isDirectory() && ownedExtension.uid === process.getuid())
assert.equal(ownedExtension.mode & 0o777, 0o700)
for (const name of ['manifest.json', 'popup.html', 'popup.js', 'marker.js']) {
  const destination = path.join(extensionDirectory, name)
  const bytes = fs.readFileSync(path.join(fixturePath, name))
  if (stage === 'before') {
    fs.writeFileSync(destination, bytes, { mode: 0o600, flag: 'wx' })
  } else {
    const ownedFile = fs.lstatSync(destination)
    assert.ok(ownedFile.isFile() && ownedFile.uid === process.getuid())
    assert.equal(ownedFile.mode & 0o777, 0o600)
    assert.deepEqual(
      fs.readFileSync(destination),
      bytes,
      'retained extension fixture bytes changed'
    )
  }
}

async function connectToPrivateDevTools() {
  const logPath = process.env.ASH_TEST_APP_LOG_PATH
  const deadline = Date.now() + 15_000
  let websocketUrl
  let logOffset = 0
  let logHead = ''
  let logTail = ''
  do {
    const fd = fs.openSync(logPath, 'r')
    try {
      const fileSize = fs.fstatSync(fd).size
      if (fileSize < logOffset) {
        logOffset = 0
        logHead = ''
        logTail = ''
      }
      const chunk = Buffer.alloc(64 * 1024)
      while (logOffset < fileSize) {
        const length = Math.min(chunk.length, fileSize - logOffset)
        const bytesRead = fs.readSync(fd, chunk, 0, length, logOffset)
        if (bytesRead === 0) {
          break
        }
        const value = chunk.toString('utf8', 0, bytesRead)
        if (logOffset < 64 * 1024) {
          logHead += value.slice(0, 64 * 1024 - logOffset)
        }
        logTail = (logTail + value).slice(-128 * 1024)
        logOffset += bytesRead
      }
    } finally {
      fs.closeSync(fd)
    }
    const match = `${logHead}\n${logTail}`.match(
      /DevTools listening on (ws:\/\/127\.0\.0\.1:[0-9]+\/devtools\/browser\/[A-Za-z0-9_-]+)/
    )
    if (match) {
      websocketUrl = match[1]
      break
    }
    await delay(150)
  } while (Date.now() < deadline)
  assert.ok(websocketUrl, 'private Chromium DevTools endpoint did not start')
  assert.match(websocketUrl, /^ws:\/\/127\.0\.0\.1:[0-9]+\//)
  return chromium.connectOverCDP(websocketUrl, { timeout: 10_000 })
}

function allPages(browser) {
  return browser.contexts().flatMap((context) => context.pages())
}

async function findOwnedRenderer(browser) {
  const candidates = []
  let evaluationFailures = 0
  for (const page of allPages(browser)) {
    try {
      const value = await page.evaluate((browserPageId) => {
        const viewport = document.querySelector(
          `[data-browser-page-viewport-id="${browserPageId}"]`
        )
        const webview = viewport ? viewport.querySelector('webview') : null
        const browserApi = window.api && window.api.browser
        return {
          href: window.location.href,
          hasBridge:
            Boolean(browserApi) &&
            typeof browserApi.extensionsList === 'function' &&
            typeof browserApi.extensionsLoadUnpacked === 'function' &&
            typeof browserApi.extensionsSetEnabled === 'function' &&
            typeof browserApi.extensionsRemove === 'function',
          owner: viewport
            ? {
                viewportConnected: viewport.isConnected,
                webviewPresent: webview !== null,
                webviewConnected: Boolean(webview && webview.isConnected),
                webContentsId:
                  webview && typeof webview.getWebContentsId === 'function'
                    ? webview.getWebContentsId()
                    : null,
                partition: webview ? webview.getAttribute('partition') : null
              }
            : null
        }
      }, identity.browserPageId)
      if (value.owner) {
        candidates.push({ page, value })
      }
    } catch {
      evaluationFailures += 1
    }
  }
  assert.equal(
    evaluationFailures,
    0,
    'every CDP page must be evaluated before a trusted renderer can be selected'
  )
  assert.equal(candidates.length, 1, 'exactly one renderer must own the retained page')
  const found = candidates[0]
  assert.ok(found.value.href.startsWith('file://'), 'owner must be the packaged Ash renderer')
  assert.equal(found.value.hasBridge, true, 'owner must expose the real browser management bridge')
  assert.equal(found.value.owner.viewportConnected, true)
  assert.equal(found.value.owner.webviewPresent, true)
  assert.equal(found.value.owner.webviewConnected, true)
  assert.equal(found.value.owner.partition, ownerReceipt.partition)
  assert.equal(
    found.value.owner.webContentsId,
    ownerReceipt.webContentsId,
    'extension operations must use the exact renderer owner attested at this stage'
  )
  return { page: found.page, owner: found.value.owner, href: found.value.href }
}

async function invokeTrusted(browser, method, args) {
  const found = await findOwnedRenderer(browser)
  return found.page.evaluate(
    async (input) => {
      const viewport = document.querySelector(
        `[data-browser-page-viewport-id="${input.browserPageId}"]`
      )
      const webview = viewport ? viewport.querySelector('webview') : null
      if (
        !window.location.href.startsWith('file://') ||
        !viewport ||
        !viewport.isConnected ||
        !webview ||
        !webview.isConnected ||
        typeof webview.getWebContentsId !== 'function' ||
        webview.getWebContentsId() !== input.webContentsId ||
        webview.getAttribute('partition') !== input.partition
      ) {
        throw new Error('Trusted renderer no longer owns the expected browser page/profile')
      }
      const browserApi = window.api && window.api.browser
      if (!browserApi) {
        throw new Error('Trusted browser bridge is missing')
      }
      switch (input.method) {
        case 'settingsGet':
          return window.api.settings.get()
        case 'settingsSet':
          return window.api.settings.set(input.args)
        case 'sessionCreateProfile':
          return browserApi.sessionCreateProfile(input.args)
        case 'sessionListProfiles':
          return browserApi.sessionListProfiles()
        case 'sessionDeleteProfile':
          return browserApi.sessionDeleteProfile(input.args)
        case 'sessionResolvePartition':
          return browserApi.sessionResolvePartition(input.args)
        case 'extensionsSupportStatus':
          return browserApi.extensionsSupportStatus()
        case 'extensionsList':
          return browserApi.extensionsList(input.args)
        case 'extensionsLoadUnpacked':
          return browserApi.extensionsLoadUnpacked(input.args)
        case 'extensionsSetEnabled':
          return browserApi.extensionsSetEnabled(input.args)
        case 'extensionsReload':
          return browserApi.extensionsReload(input.args)
        case 'extensionsRemove':
          return browserApi.extensionsRemove(input.args)
        case 'extensionsActivateAction':
          return browserApi.extensionsActivateAction(input.args)
        default:
          throw new Error('Unknown fixed BR-08 bridge operation')
      }
    },
    {
      browserPageId: identity.browserPageId,
      profileId: identity.profileId,
      partition: found.owner.partition,
      webContentsId: found.owner.webContentsId,
      method,
      args
    }
  )
}

async function waitFor(predicate, message, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  do {
    const value = await predicate()
    if (value) {
      return value
    }
    await delay(150)
  } while (Date.now() < deadline)
  throw new Error(message)
}

// Electron <webview> guests are not necessarily exposed as Playwright Pages.
// Operate only through the exact attested webview in the trusted renderer.
async function guestOperation(browser, operation, url) {
  const allowedUrls = [
    `${origin}/`,
    `${origin}/next`,
    `${origin}/closed`,
    `http://localhost:${ready.port}/next`
  ]
  assert.ok(allowedUrls.includes(url), 'fixture navigation must stay on the fixed loopback URLs')
  const found = await assertBridgePartition(browser)
  return found.page.evaluate(
    async (input) => {
      const viewport = document.querySelector(`[data-browser-page-viewport-id="${input.pageId}"]`)
      const webview = viewport?.querySelector('webview')
      const verifyOwner = () => {
        if (
          !window.location.href.startsWith('file://') ||
          !viewport?.isConnected ||
          !webview?.isConnected ||
          webview.tagName !== 'WEBVIEW' ||
          webview.getWebContentsId() !== input.ownerId ||
          webview.getAttribute('partition') !== input.partition
        ) {
          throw new Error('Attested webview owner changed during extension probe')
        }
        if (!input.allowedUrls.includes(webview.getURL())) {
          throw new Error('Unexpected guest URL outside fixture')
        }
      }
      verifyOwner()
      if (input.operation === 'navigate') {
        await webview.loadURL(input.url)
        verifyOwner()
        if (webview.getURL() !== input.url) {
          throw new Error('Guest navigation did not reach the exact fixture URL')
        }
        return true
      }
      if (input.operation !== 'read') {
        throw new Error('Unknown fixed guest operation')
      }
      if (webview.getURL() !== input.url) {
        throw new Error('Guest is not on the expected fixture URL')
      }
      // Fixed read-only expression; no caller-provided JavaScript.
      const result = await webview.executeJavaScript(
        `({href: location.href, readyState: document.readyState, title: document.title, marker: document.documentElement?.getAttribute('data-ash-br08-extension-marker') ?? null})`
      )
      verifyOwner()
      return result
    },
    {
      pageId: identity.browserPageId,
      ownerId: ownerReceipt.webContentsId,
      partition: ownerReceipt.partition,
      operation,
      url,
      allowedUrls
    }
  )
}

async function navigate(browser, url) {
  assert.equal(await guestOperation(browser, 'navigate', url), true)
  await assertBridgePartition(browser)
}

async function pageState(browser, url) {
  return guestOperation(browser, 'read', url)
}

async function assertMarker(browser, url, expected) {
  const state = await waitFor(
    async () => {
      const observation = await pageState(browser, url)
      if (observation.href !== url || observation.readyState !== 'complete' || !observation.title) {
        return null
      }
      if (expected && observation.marker !== 'br08-v1') {
        return null
      }
      return observation
    },
    `content-script marker did not match expected state at ${url}`,
    10_000
  )
  if (!expected) {
    // Observe absence after load, including a bounded window for late injection.
    const deadline = Date.now() + 1_000
    let observation = state
    do {
      assert.equal(observation.href, url)
      assert.equal(observation.readyState, 'complete')
      assert.equal(observation.marker, null, `unexpected extension marker on ${url}`)
      await delay(150)
      observation = await pageState(browser, url)
    } while (Date.now() < deadline)
    assert.equal(observation.href, url)
    assert.equal(observation.marker, null, `late extension marker on ${url}`)
  }
  return state
}

async function assertBridgePartition(browser) {
  const result = await invokeTrusted(browser, 'sessionResolvePartition', {
    profileId: identity.profileId
  })
  assert.equal(
    result,
    ownerReceipt.partition,
    'profile ID must resolve to the owned webview partition'
  )
  return findOwnedRenderer(browser)
}

async function extensionListing(browser, extensionId) {
  const result = await invokeTrusted(browser, 'extensionsList', { profileId: identity.profileId })
  assert.equal(result.active, true, 'the opted-in real extension manager must be active')
  return result.extensions.find((extension) => extension.id === extensionId) || null
}

async function expectSupportRuntime(browser, runtime, desiredEnabled) {
  const result = await waitFor(
    async () => {
      const status = await invokeTrusted(browser, 'extensionsSupportStatus', {})
      return status?.runtime === runtime && status?.desiredEnabled === desiredEnabled
        ? status
        : null
    },
    `Runtime extension status did not reach ${runtime}`,
    15_000
  )
  assert.deepEqual(result, { runtime, desiredEnabled })
  return result
}

async function runBefore(browser) {
  const initialOwner = await assertBridgePartition(browser)
  assert.equal(initialOwner.owner.webContentsId, ownerReceipt.webContentsId)
  // This fixture has a new profile, not a user profile. Complete the normal
  // onboarding dismissal before exercising permission UI.
  const onboarding = initialOwner.page.getByRole('dialog', {
    name: 'Ash IDE onboarding',
    exact: true
  })
  if (await onboarding.isVisible()) {
    await initialOwner.page.keyboard.press('Escape')
    const skip = initialOwner.page.getByRole('dialog', { name: 'Skip onboarding?', exact: true })
    await skip.getByRole('button', { name: 'Skip', exact: true }).click({ timeout: 10_000 })
    await onboarding.waitFor({ state: 'hidden', timeout: 10_000 })
  }
  await assertBridgePartition(browser)
  console.log('BR08 before: onboarding cleared through normal UI')
  const initialSettings = await invokeTrusted(browser, 'settingsGet', {})
  const initialSetting =
    initialSettings && initialSettings.settings
      ? initialSettings.settings.experimentalBrowserExtensions
      : initialSettings.experimentalBrowserExtensions
  assert.equal(initialSetting, false, 'fresh test-owned profile must preserve the disabled default')
  await expectSupportRuntime(browser, 'disabled', false)
  const metadataPath = path.join(
    fixture,
    'profile/profiles/local-default/browser-session-meta.json'
  )
  const seed = JSON.parse(fs.readFileSync(path.join(fixture, 'pending-deletion-seed.json'), 'utf8'))
  const pending = seed.pendingProfileDeletions[0]
  assert.equal(pending.id, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
  await waitFor(
    () => {
      const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
      return (
        Array.isArray(meta.pendingProfileDeletions) && meta.pendingProfileDeletions.length === 0
      )
    },
    'Startup did not complete the seeded interrupted profile deletion',
    15_000
  )
  assert.equal(
    await invokeTrusted(browser, 'sessionResolvePartition', { profileId: pending.id }),
    null
  )
  const profilesAfterRecovery = await invokeTrusted(browser, 'sessionListProfiles', {})
  assert.equal(
    profilesAfterRecovery.some((profile) => profile.id === pending.id),
    false
  )
  console.log(
    'BR08 default-off startup completed the seeded deletion journal without admitting the retired partition'
  )

  await invokeTrusted(browser, 'settingsSet', { experimentalBrowserExtensions: true })
  await waitFor(
    async () => {
      const settings = await invokeTrusted(browser, 'settingsGet', {})
      const value =
        settings && settings.settings
          ? settings.settings.experimentalBrowserExtensions
          : settings.experimentalBrowserExtensions
      return value === true
    },
    'test-owned browser extension opt-in did not persist',
    10_000
  )
  await waitFor(
    async () => {
      const result = await invokeTrusted(browser, 'extensionsList', {
        profileId: identity.profileId
      })
      return result.active === true
    },
    'real extension management did not activate after opt-in',
    15_000
  )

  await expectSupportRuntime(browser, 'enabled', true)

  const installed = await invokeTrusted(browser, 'extensionsLoadUnpacked', {
    profileId: identity.profileId,
    directory: extensionDirectory
  })
  assert.equal(installed.ok, true, 'trusted unpacked extension installation must succeed')
  await waitFor(
    async () => {
      const result = await invokeTrusted(browser, 'extensionsList', {
        profileId: identity.profileId
      })
      return result.active && result.extensions.some((entry) => entry.name === manifest.name)
    },
    'installed extension list did not become visible',
    10_000
  )
  const extension = (
    await invokeTrusted(browser, 'extensionsList', {
      profileId: identity.profileId
    })
  ).extensions.find((entry) => entry.name === manifest.name)
  assert.ok(extension, 'the real installation must appear in the profile extension list')
  assert.equal(extension.source, 'unpacked')
  assert.equal(extension.enabled, true)
  assert.match(extension.id, /^[a-p]{32}$/)

  // Before requesting optional host access, a fresh local navigation must remain unmarked.
  await navigate(browser, `${origin}/`)
  await assertMarker(browser, `${origin}/`, false)
  console.log('REQUIRED HOST CONTROL: installed; no marker before registration')

  const action = await invokeTrusted(browser, 'extensionsActivateAction', {
    browserPageId: identity.browserPageId,
    extensionId: extension.id,
    anchor: { x: 1, y: 1, width: 1, height: 1 }
  })
  assert.equal(action.ok, true, 'the real extension toolbar action must open its popup')

  console.log('BR08 before: extension action opened')
  const popupUrl = `chrome-extension://${extension.id}/popup.html`
  const popup = await waitFor(
    () => {
      const found = allPages(browser).filter((page) => page.url() === popupUrl)
      return found.length === 1 ? found[0] : null
    },
    'the real extension popup did not open from the owned browser page',
    10_000
  )
  await popup.getByRole('button', { name: 'Allow loopback site access', exact: true }).click()
  // This independent control has the required host permission declared at install.
  // It is not evidence of optional consent.
  await popup.getByText('BR08_PERMISSION_GRANTED', { exact: true }).waitFor({
    state: 'visible',
    timeout: 10_000
  })
  const permissionGranted = await popup.evaluate(async () =>
    chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] })
  )
  assert.equal(permissionGranted, true, 'declared required host permission must be present')
  await popup
    .getByRole('button', { name: 'Request optional localhost access', exact: true })
    .click()
  await popup
    .getByText(
      'BR08_OPTIONAL_ERROR: Optional host permissions are not supported by the current Chromium runtime.',
      { exact: true }
    )
    .waitFor({ state: 'visible', timeout: 10_000 })
  assert.equal(
    await popup.evaluate(async () =>
      chrome.permissions.contains({ origins: ['http://localhost/*'] })
    ),
    false
  )
  const effective = await popup.evaluate(async () => chrome.permissions.getAll())
  assert.deepEqual(effective.origins, ['http://127.0.0.1/*'])
  console.log(
    'BR08 actual optional host request refused; effective native-compatible host access unchanged'
  )
  await popup.close()

  // The same server under localhost is outside the explicit 127.0.0.1 host grant.
  await navigate(browser, `http://localhost:${ready.port}/next`)
  await assertMarker(browser, `http://localhost:${ready.port}/next`, false)
  await navigate(browser, `${origin}/`)
  const marker = await assertMarker(browser, `${origin}/`, true)

  const finalOwner = await assertBridgePartition(browser)
  assert.equal(finalOwner.owner.partition, ownerReceipt.partition)
  fs.writeFileSync(
    path.join(fixture, 'browser-extension-before.json'),
    `${JSON.stringify({
      ok: true,
      stage: 'before',
      browserPageId: identity.browserPageId,
      profileId: identity.profileId,
      partition: finalOwner.owner.partition,
      webContentsId: finalOwner.owner.webContentsId,
      extensionId: extension.id,
      extensionName: extension.name,
      unpackedInstalledThroughTrustedBridge: true,
      experimentalSettingOptedInThroughTrustedBridge: true,
      requiredLoopbackPermissionPredeclared: true,
      optionalHostRequestRefused: true,
      optionalHostExcludedFromEffectiveAccess: true,
      initialRuntimeDisabled: true,
      seededPendingDeletionRecovered: true,
      initialOptInRuntimeEnabled: true,
      exactLoopbackMarkerOnOriginalPage: marker.marker === 'br08-v1',
      wrongHostControlUnmarked: true,
      noMarkerBeforeRegistration: true,
      privateNetworkNamespace: currentNetns
    })}\n`,
    { mode: 0o600 }
  )
  console.log(
    JSON.stringify({
      ok: true,
      stage: 'before',
      browserPageId: identity.browserPageId,
      profileId: identity.profileId,
      extensionId: extension.id,
      originalPageMarker: true,
      requiredHostControl: true,
      wrongHostUnmarked: true
    })
  )
}

async function runAfter(browser) {
  const before = JSON.parse(
    fs.readFileSync(path.join(fixture, 'browser-extension-before.json'), 'utf8')
  )
  assert.equal(before.ok, true)
  assert.equal(before.browserPageId, identity.browserPageId)
  assert.equal(before.profileId, identity.profileId)
  assert.equal(before.partition, ownerReceipt.partition)
  assert.match(before.extensionId, /^[a-p]{32}$/)
  const afterOwner = await assertBridgePartition(browser)

  const extension = await extensionListing(browser, before.extensionId)
  assert.ok(extension, 'the extension must remain installed after the real window transfer')
  assert.equal(extension.source, 'unpacked')
  assert.equal(extension.enabled, true)
  const restoredMarker = await assertMarker(browser, `${origin}/closed`, true)

  const disabled = await invokeTrusted(browser, 'extensionsSetEnabled', {
    profileId: identity.profileId,
    extensionId: before.extensionId,
    enabled: false
  })
  assert.equal(disabled.ok, true)
  const disabledRow = await extensionListing(browser, before.extensionId)
  assert.equal(disabledRow && disabledRow.enabled, false)
  await navigate(browser, `${origin}/next`)
  await assertMarker(browser, `${origin}/next`, false)

  const enabled = await invokeTrusted(browser, 'extensionsSetEnabled', {
    profileId: identity.profileId,
    extensionId: before.extensionId,
    enabled: true
  })
  assert.equal(enabled.ok, true)
  const enabledRow = await extensionListing(browser, before.extensionId)
  assert.equal(enabledRow && enabledRow.enabled, true)
  await navigate(browser, `${origin}/`)
  const reenabledMarker = await assertMarker(browser, `${origin}/`, true)

  console.log('BR08 required-host re-enable marker verified')
  const reloaded = await invokeTrusted(browser, 'extensionsReload', {
    profileId: identity.profileId,
    extensionId: before.extensionId
  })
  assert.equal(reloaded.ok, true, 'explicit reload must finish native content script restoration')
  const reloadedRow = await extensionListing(browser, before.extensionId)
  assert.equal(reloadedRow && reloadedRow.enabled, true)
  await navigate(browser, `${origin}/next`)
  const reloadedMarker = await assertMarker(browser, `${origin}/next`, true)
  await navigate(browser, `http://localhost:${ready.port}/next`)
  await assertMarker(browser, `http://localhost:${ready.port}/next`, false)
  console.log('BR08 required-host reload marker and wrong-host negative verified')

  // Exercise global support retirement while the registered extension is still installed.
  await invokeTrusted(browser, 'settingsSet', { experimentalBrowserExtensions: false })
  await expectSupportRuntime(browser, 'disabled', false)
  await navigate(browser, `${origin}/next`)
  await assertMarker(browser, `${origin}/next`, false)
  const globallyInactive = await invokeTrusted(browser, 'extensionsList', {
    profileId: identity.profileId
  })
  assert.equal(globallyInactive.active, false)
  console.log('BR08 global disable reached confirmed runtime disabled and fresh document unmarked')
  await invokeTrusted(browser, 'settingsSet', { experimentalBrowserExtensions: true })
  await expectSupportRuntime(browser, 'enabled', true)
  const globallyReenabled = await extensionListing(browser, before.extensionId)
  assert.ok(
    globallyReenabled?.enabled,
    'global re-enable preserves installed extension and desired enablement'
  )
  await navigate(browser, `${origin}/`)
  await assertMarker(browser, `${origin}/`, true)
  await navigate(browser, `http://localhost:${ready.port}/next`)
  await assertMarker(browser, `http://localhost:${ready.port}/next`, false)
  console.log('BR08 global re-enable restored actual native marker with wrong-host negative')

  // The profile is disposable and distinct from the retained default browser.
  const isolated = await invokeTrusted(browser, 'sessionCreateProfile', {
    scope: 'isolated',
    label: 'BR08 private retirement fixture'
  })
  assert.ok(
    isolated?.id &&
      isolated.id !== identity.profileId &&
      isolated.partition !== ownerReceipt.partition
  )
  const isolatedEnable = await invokeTrusted(browser, 'extensionsSetEnabled', {
    profileId: isolated.id,
    extensionId: before.extensionId,
    enabled: true
  })
  assert.equal(isolatedEnable.ok, true)
  const isolatedRows = await invokeTrusted(browser, 'extensionsList', { profileId: isolated.id })
  assert.equal(isolatedRows.extensions.find((row) => row.id === before.extensionId)?.enabled, true)
  assert.equal(
    await invokeTrusted(browser, 'sessionDeleteProfile', { profileId: isolated.id }),
    true
  )
  const profiles = await invokeTrusted(browser, 'sessionListProfiles', {})
  assert.equal(
    profiles.some((profile) => profile.id === isolated.id),
    false
  )
  assert.equal(
    await invokeTrusted(browser, 'sessionResolvePartition', { profileId: isolated.id }),
    null
  )
  const deletionMeta = JSON.parse(
    fs.readFileSync(
      path.join(fixture, 'profile/profiles/local-default/browser-session-meta.json'),
      'utf8'
    )
  )
  assert.deepEqual(deletionMeta.pendingProfileDeletions, [])
  const staleEnable = await invokeTrusted(browser, 'extensionsSetEnabled', {
    profileId: isolated.id,
    extensionId: before.extensionId,
    enabled: true
  })
  assert.equal(staleEnable.ok, false)
  await navigate(browser, `${origin}/next`)
  await assertMarker(browser, `${origin}/next`, true)
  console.log(
    'BR08 isolated profile retirement completed; stale enable refused; default native marker retained'
  )

  const removed = await invokeTrusted(browser, 'extensionsRemove', {
    profileId: identity.profileId,
    extensionId: before.extensionId
  })
  assert.equal(removed.ok, true)
  const afterRemove = await invokeTrusted(browser, 'extensionsList', {
    profileId: identity.profileId
  })
  assert.equal(afterRemove.active, true)
  assert.equal(
    afterRemove.extensions.some((entry) => entry.id === before.extensionId),
    false,
    'real extension management must remove the unpacked extension'
  )
  await navigate(browser, `${origin}/next`)
  await assertMarker(browser, `${origin}/next`, false)

  await invokeTrusted(browser, 'settingsSet', { experimentalBrowserExtensions: false })
  await waitFor(
    async () => {
      const settings = await invokeTrusted(browser, 'settingsGet', {})
      const value =
        settings && settings.settings
          ? settings.settings.experimentalBrowserExtensions
          : settings.experimentalBrowserExtensions
      return value === false
    },
    'test-owned browser extension opt-in did not return to the disabled default',
    10_000
  )
  const inactive = await waitFor(
    async () => {
      const result = await invokeTrusted(browser, 'extensionsList', {
        profileId: identity.profileId
      })
      return result.active === false ? result : null
    },
    'extension manager did not unload after restoring the disabled setting',
    10_000
  )
  assert.equal(inactive.active, false)
  await expectSupportRuntime(browser, 'disabled', false)

  fs.writeFileSync(
    path.join(fixture, 'browser-extension-after.json'),
    `${JSON.stringify({
      ok: true,
      stage: 'after',
      browserPageId: identity.browserPageId,
      profileId: identity.profileId,
      partition: afterOwner.owner.partition,
      previousWebContentsId: before.webContentsId,
      webContentsId: afterOwner.owner.webContentsId,
      extensionId: before.extensionId,
      sameLogicalPageAndProfile: true,
      retainedContentScriptMarkerAfterTransfer: restoredMarker.marker === 'br08-v1',
      disabledFreshNavigationUnmarked: true,
      reenabledFreshNavigationMarked: reenabledMarker.marker === 'br08-v1',
      reloadedFreshNavigationMarked: reloadedMarker.marker === 'br08-v1',
      reloadedWrongHostUnmarked: true,
      globalDisableConfirmedAndUnmarked: true,
      globalReenablePreservedMarker: true,
      globalReenableWrongHostUnmarked: true,
      isolatedProfileEnabledAndDeleted: true,
      deletedProfileMutationRejected: true,
      defaultMarkerRetainedAfterIsolatedProfileDeletion: true,
      deletedProfileJournalCleared: true,
      finalRuntimeDisabled: true,
      removedFreshNavigationUnmarked: true,
      extensionRemovedThroughTrustedBridge: true,
      testOwnedExperimentalSettingRestoredToFalse: true,
      privateNetworkNamespace: currentNetns
    })}\n`,
    { mode: 0o600 }
  )
  console.log(
    JSON.stringify({
      ok: true,
      stage: 'after',
      browserPageId: identity.browserPageId,
      profileId: identity.profileId,
      extensionId: before.extensionId,
      retainedMarkerAfterTransfer: true,
      disableReenableReloadRemoveProved: true,
      optInReturnedToFalse: true
    })
  )
}

async function run() {
  const browser = await connectToPrivateDevTools()
  try {
    await findOwnedRenderer(browser)
    await assertBridgePartition(browser)
    await (stage === 'before' ? runBefore(browser) : runAfter(browser))
  } finally {
    await browser.close()
  }
}

void run().catch((error) => {
  console.error('BR-08 REQUIRED-HOST DIAGNOSTIC failed:', error.stack ?? error.message)
  process.exitCode = 1
})
