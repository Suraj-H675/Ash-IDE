// Legacy mobile pairing / vendor relay protocol artifacts still emitted by
// TypeScript but not required by Ash's local desktop runtime. These exact
// files have no importers in the inspected packaged CommonJS graph (apart
// from test fixtures); this deliberately does NOT remove shared Markdown,
// native-chat frame budgets, local IPC or Git-over-SSH transport helpers.
const EXCLUDED_ASH_MOBILE_RELAY_MODULES = Object.freeze([
  'out/shared/mobile-notification-identity.js',
  'out/shared/mobile-queued-edit-host.test-fixture-contract.js',
  'out/shared/mobile-web-bundle/mobile-web-bundle-capability.js',
  'out/shared/remote-runtime/control/remote-runtime-shared-control-test-server.js',
  'out/shared/remote-runtime/e2ee/mobile-e2ee-legacy-fixtures.js',
  'out/shared/remote-runtime/e2ee/mobile-e2ee-v2-fixtures.js',
  'out/shared/remote-runtime/e2ee/paired-e2ee-fixed-key-test-fixture.js',
  'out/shared/remote-runtime/host-store/runtime-environment-shipped-store.test-fixture.js',
  'out/shared/remote-runtime/pairing/mobile-pairing-connection-mode.js',
  'out/shared/remote-runtime/relay/mobile-relay-close-codes.js',
  'out/shared/remote-runtime/relay/mobile-relay-mint-failure.js',
  'out/shared/remote-runtime/relay/mobile-relay-pairing-fixtures.js',
  'out/shared/remote-runtime/relay/mobile-relay-phone-protocol.js',
  'out/shared/remote-runtime/relay/mobile-relay-status.js',
  'out/shared/relay-host-close-reason.js',
  'out/shared/relay-version-marker.js'
])

// Avoid accidentally reintroducing a complete mobile/remote service from a
// stale build. Normal Git remotes, local browser and daemon resources are not
// children of these app-managed server roots.
const EXCLUDED_ASH_MOBILE_SERVICE_ROOTS = Object.freeze([
  'out/mobile-web',
  'out/relay',
  'out/remote-host',
  'resources/mobile'
])
const EXCLUDED_ASH_MOBILE_NATIVE_RESOURCE_ROOTS = Object.freeze(['mobile', 'relay'])

module.exports = {
  EXCLUDED_ASH_MOBILE_RELAY_MODULES,
  EXCLUDED_ASH_MOBILE_SERVICE_ROOTS,
  EXCLUDED_ASH_MOBILE_NATIVE_RESOURCE_ROOTS
}
