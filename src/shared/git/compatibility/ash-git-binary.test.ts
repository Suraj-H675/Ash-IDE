import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { afterEach, beforeEach, describe, expect } from 'vitest'
import { registerGitWorktreeBinaryCompatibilityCases } from '../worktrees/git-worktree-binary-compatibility.test-cases'
import { GitBinaryTestFixture } from './git-binary.test-fixture'
import { registerGitLocalBaseBranchBinaryCompatibilityCase } from './git-local-base-branch-binary-compatibility.test-cases'
import { registerGitRepositoryRegistrationBinaryCompatibilityCase } from './git-repository-registration-binary-compatibility.test-cases'
import { registerGitResolutionBinaryCompatibilityCases } from './git-resolution-binary-compatibility.test-cases'

describe('Ash Git binary compatibility', () => {
  const usesContainer = Boolean(process.env.ORCA_GIT_COMPAT_IMAGE)
  let repoPath: string
  let fixture: GitBinaryTestFixture
  let gitMajor: number
  let gitMinor: number

  const runGit = (args: string[], env?: NodeJS.ProcessEnv) =>
    fixture.exec(args, fixture.executionRoot, env)
  const getRepoPath = () => repoPath

  beforeEach(async () => {
    repoPath = await realpath(await mkdtemp(join(tmpdir(), 'ash-git-compat-')))
    fixture = new GitBinaryTestFixture(repoPath, '/repo')
    await fixture.start()
    const { stdout } = await runGit(['--version'])
    const version = /git version (\d+)\.(\d+)/.exec(stdout)
    if (!version) {
      throw new Error(`Could not parse Git version: ${stdout}`)
    }
    const expectedVersion = process.env.ORCA_GIT_COMPAT_VERSION
    if (expectedVersion) {
      expect(stdout.trim()).toBe(`git version ${expectedVersion}`)
    }
    gitMajor = Number(version[1])
    gitMinor = Number(version[2])

    await runGit(['init', '-q'])
    await runGit(['config', 'user.name', 'Ash Git compatibility'])
    await runGit(['config', 'user.email', 'git-compat@example.invalid'])
    await writeFile(join(repoPath, 'tracked.txt'), 'initial\n')
    await runGit(['add', 'tracked.txt'])
    await runGit(['commit', '-qm', 'initial'])
  })

  afterEach(async () => {
    try {
      await fixture?.stop()
    } finally {
      if (repoPath) {
        await rm(repoPath, { recursive: true, force: true })
      }
    }
  })

  registerGitWorktreeBinaryCompatibilityCases(
    runGit,
    getRepoPath,
    (major, minor) => gitMajor > major || (gitMajor === major && gitMinor >= minor),
    async (args, supported, recognizesUnsupported) => {
      if (!supported) {
        await expect(runGit(args)).rejects.toSatisfy(recognizesUnsupported)
        return
      }
      await runGit(args)
    }
  )
  registerGitLocalBaseBranchBinaryCompatibilityCase(runGit, getRepoPath, usesContainer)
  registerGitRepositoryRegistrationBinaryCompatibilityCase(runGit, getRepoPath, usesContainer)
  registerGitResolutionBinaryCompatibilityCases(runGit, (name) =>
    (usesContainer ? posix.join : join)(fixture.executionRoot, `${name}.git`)
  )
})
