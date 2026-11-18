// @vitest-environment happy-dom

import { afterEach, beforeEach, describe } from 'vitest'
import {
  cleanupCreateMessageFixture,
  created,
  mocks,
  resetCreateMessageFixture
} from './structured-agent-session-launch-create-message.test-fixture'
import {
  registerActionEffortCreateTests,
  registerCreateSelectionTests
} from './structured-agent-session-launch-action-effort.test-fixture'
import { registerCreateCompletionTests } from './structured-agent-session-launch-completion.test-fixture'
import { registerCreateHydrationTests } from './structured-agent-session-launch-hydration.test-fixture'
import { registerCreateSelectionAdmissionTests } from './structured-agent-session-launch-selection-admission.test-fixture'

describe('structured agent launch', () => {
  let restoreCatalogStore: ReturnType<typeof resetCreateMessageFixture>

  beforeEach(() => {
    restoreCatalogStore = resetCreateMessageFixture()
  })
  afterEach(() => {
    cleanupCreateMessageFixture(restoreCatalogStore)
  })

  registerActionEffortCreateTests(mocks, created)
  registerCreateSelectionTests()
  registerCreateSelectionAdmissionTests()
  registerCreateCompletionTests()
  registerCreateHydrationTests()
})
