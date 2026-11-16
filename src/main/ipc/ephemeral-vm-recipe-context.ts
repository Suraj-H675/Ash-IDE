import type { Store } from '../persistence/loading-store/store'
import { loadHooks } from '../workspace-hooks/hooks'
import type { EphemeralVmRecipeDoctorResult } from '../../shared/ephemeral-vm-recipes'
import { listEphemeralVmRuntimes } from '../../shared/ephemeral-vm-runtime-store'
import type { EphemeralVmRuntimeRecord } from '../../shared/ephemeral-vm-runtimes'
import { isFolderRepo, isGitRepoKind } from '../../shared/repo-kind'
import type { OrcaVmRecipe } from '../../shared/orca-yaml-hook-types'
import {
  EphemeralVmFailureError,
  ephemeralVmFailure,
  type EphemeralVmFailure
} from '../../shared/ephemeral-vm-failure-copy'

export type EphemeralVmRecipeListResult = {
  status: 'ok' | 'error'
  repoPath: string | null
  recipes: OrcaVmRecipe[]
  diagnostics: NonNullable<ReturnType<typeof loadHooks>>['environmentRecipeDiagnostics']
  message?: string
  messageCode?: string
  messageParams?: Record<string, string | number>
}

export type EphemeralVmRecipeCatalogEntry = {
  repoId: string
  repoName: string
  repoPath: string
  recipes: OrcaVmRecipe[]
  diagnostics: NonNullable<ReturnType<typeof loadHooks>>['environmentRecipeDiagnostics']
}

export type RecipeRepoResult =
  | { ok: true; repo: Exclude<ReturnType<Store['getRepo']>, null | undefined> }
  | {
      ok: false
      message: string
      failure: EphemeralVmFailure
      doctor: (recipeId: string) => EphemeralVmRecipeDoctorResult
    }

export function listRecipes(store: Store, repoId: string): EphemeralVmRecipeListResult {
  const repo = store.getRepo(repoId)
  if (!repo || isFolderRepo(repo)) {
    return failedRecipeList(null, ephemeralVmFailure('repoNotFound', { repoId }))
  }
  if (repo.connectionId) {
    return failedRecipeList(repo.path, ephemeralVmFailure('remoteRepoUnsupported'))
  }
  const hooks = loadHooks(repo.path)
  return {
    status: 'ok',
    repoPath: repo.path,
    recipes: hooks?.environmentRecipes ?? [],
    diagnostics: hooks?.environmentRecipeDiagnostics ?? []
  }
}

export function listRecipeCatalog(store: Store): EphemeralVmRecipeCatalogEntry[] {
  return store
    .getRepos()
    .filter((repo) => isGitRepoKind(repo) && !isFolderRepo(repo) && !repo.connectionId)
    .map((repo) => {
      const hooks = loadHooks(repo.path)
      return {
        repoId: repo.id,
        repoName: repo.displayName,
        repoPath: repo.path,
        recipes: hooks?.environmentRecipes ?? [],
        diagnostics: hooks?.environmentRecipeDiagnostics ?? []
      }
    })
    .filter((entry) => entry.recipes.length > 0 || entry.diagnostics.length > 0)
}

export function getRecipeRepo(store: Store, repoId: string): RecipeRepoResult {
  const repo = store.getRepo(repoId)
  if (!repo || isFolderRepo(repo)) {
    return failedRecipeRepo(null, ephemeralVmFailure('repoNotFound', { repoId }))
  }
  if (repo.connectionId) {
    return failedRecipeRepo(repo.path, ephemeralVmFailure('remoteRepoUnsupported'))
  }
  return { ok: true, repo }
}

export function getRuntimeRecipeContext(
  store: Store,
  userDataPath: string,
  runtimeId: string
): {
  runtime: EphemeralVmRuntimeRecord
  repo: Extract<RecipeRepoResult, { ok: true }>
  recipe: OrcaVmRecipe
} {
  const runtime = listEphemeralVmRuntimes(userDataPath).find((entry) => entry.id === runtimeId)
  if (!runtime) {
    throw new EphemeralVmFailureError(ephemeralVmFailure('runtimeNotFound', { runtimeId }))
  }
  if (!runtime.repoId) {
    throw new EphemeralVmFailureError(ephemeralVmFailure('runtimeRepoMissing', { runtimeId }))
  }
  const repo = getRecipeRepo(store, runtime.repoId)
  if (!repo.ok) {
    throw new EphemeralVmFailureError(repo.failure)
  }
  // Preserve saved recipe snapshots; legacy runtimes can still resolve their original repo recipe.
  const recipe =
    runtime.recipe ??
    (loadHooks(repo.repo.path)?.environmentRecipes ?? []).find(
      (entry) => entry.id === runtime.recipeId
    )
  if (!recipe) {
    throw new EphemeralVmFailureError(
      ephemeralVmFailure('recipeNotFound', { recipeId: runtime.recipeId })
    )
  }
  return { runtime, repo, recipe }
}

export function resolveRecipeForRepo(repoPath: string, recipeId: string): OrcaVmRecipe | null {
  return (
    (loadHooks(repoPath)?.environmentRecipes ?? []).find((recipe) => recipe.id === recipeId) ?? null
  )
}

function failedRecipeRepo(repoPath: string | null, failure: EphemeralVmFailure): RecipeRepoResult {
  const message = failure.error
  return {
    ok: false,
    message,
    failure,
    doctor: (recipeId) => ({
      recipeId,
      repoPath: repoPath ?? '',
      ok: false,
      checks: [
        {
          id: 'recipe.execution_target',
          status: 'fail',
          message,
          remediation: 'Use a local repo checkout for the recipe.'
        }
      ]
    })
  }
}

function failedRecipeList(
  repoPath: string | null,
  failure: EphemeralVmFailure
): EphemeralVmRecipeListResult {
  return {
    status: 'error',
    repoPath,
    recipes: [],
    diagnostics: [],
    message: failure.error,
    ...(failure.errorCode ? { messageCode: failure.errorCode } : {}),
    ...(failure.errorParams ? { messageParams: failure.errorParams } : {})
  }
}
