import { readMcpServerTomlOwnership } from '../toml/config-toml-mcp-servers'
import {
  deduplicateProjectTomlSections,
  getHookTrustTomlSectionKeys,
  getMcpServerTomlSectionName,
  getProjectTrustLevel,
  getRevocationTomlSectionHeaderKey,
  getTomlSectionHeaderKey,
  getTomlSections,
  isRuntimePreservedTomlSection,
  isRuntimeProjectTomlSection,
  joinTomlBlocks,
  stripRuntimeOwnedTomlSections
} from '../toml/config-toml-runtime-owned-sections'

/** Ordinary settings and shared hook trust from ~/.codex plus the tables the managed home owns. */
export function mergeSystemCodexConfigIntoRuntime(
  runtimeConfig: string,
  systemConfig: string,
  systemConfigDir: string,
  mirroredMcpServerNames: ReadonlySet<string> = new Set(),
  mirroredMcpServerRoot = false
): string {
  const runtimeSections = deduplicateProjectTomlSections(getTomlSections(runtimeConfig))
  const runtimeProjectHeaders = new Set(
    runtimeSections
      .filter((section) => isRuntimeProjectTomlSection(section.header))
      .map((section) => getTomlSectionHeaderKey(section.header))
  )
  const systemProjectSections = deduplicateProjectTomlSections(
    getTomlSections(systemConfig)
  ).filter((section) => isRuntimeProjectTomlSection(section.header))
  const systemUntrustedProjectHeaders = new Set(
    systemProjectSections
      .filter((section) => getProjectTrustLevel(section.block) === 'untrusted')
      .map((section) => getRevocationTomlSectionHeaderKey(section.header))
  )
  // Exact-cased re-grants must override legacy case-drifted revocations or each mirror reverts trust.
  const systemTrustedProjectHeaders = new Set(
    systemProjectSections
      .filter((section) => getProjectTrustLevel(section.block) === 'trusted')
      .map((section) => getTomlSectionHeaderKey(section.header))
  )
  const systemMcpServers = readMcpServerTomlOwnership(systemConfig)
  // Mirror ordinary settings while retaining runtime trust, subject to explicit system project revocations.
  return joinTomlBlocks([
    stripRuntimeOwnedTomlSections(systemConfig, runtimeProjectHeaders, {
      systemHomeDir: systemConfigDir,
      runtimeHookTrustKeys: getHookTrustTomlSectionKeys(runtimeSections)
    }),
    ...runtimeSections
      .filter((section) => {
        if (isRuntimePreservedTomlSection(section.header)) {
          return true
        }
        const mcpServerName = getMcpServerTomlSectionName(section.header)
        return (
          mcpServerName !== null &&
          !systemMcpServers.ownsRoot &&
          !mirroredMcpServerRoot &&
          !systemMcpServers.names.has(mcpServerName) &&
          !mirroredMcpServerNames.has(mcpServerName)
        )
      })
      .filter(
        (section) =>
          !isRuntimeProjectTomlSection(section.header) ||
          !systemUntrustedProjectHeaders.has(getRevocationTomlSectionHeaderKey(section.header)) ||
          systemTrustedProjectHeaders.has(getTomlSectionHeaderKey(section.header))
      )
      .map((section) => section.block)
  ])
}

/** Apply native project distrust even when unrelated Ash-home edits cannot be promoted. */
export function applyNativeProjectRevocationsToRuntime(
  runtimeConfig: string,
  systemConfig: string
): string {
  const systemProjects = deduplicateProjectTomlSections(getTomlSections(systemConfig)).filter(
    (section) => isRuntimeProjectTomlSection(section.header)
  )
  const revoked = new Map(
    systemProjects
      .filter((section) => getProjectTrustLevel(section.block) === 'untrusted')
      .map((section) => [getRevocationTomlSectionHeaderKey(section.header), section])
  )
  if (revoked.size === 0) {
    return runtimeConfig
  }
  const explicitlyTrusted = new Set(
    systemProjects
      .filter((section) => getProjectTrustLevel(section.block) === 'trusted')
      .map((section) => getTomlSectionHeaderKey(section.header))
  )
  const sections = getTomlSections(runtimeConfig)
  const lines = runtimeConfig.split('\n')
  const edits: { start: number; end: number; replacement: string[] }[] = []
  const applied = new Set<string>()
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index]!
    if (!isRuntimeProjectTomlSection(section.header)) {
      continue
    }
    const key = getRevocationTomlSectionHeaderKey(section.header)
    const nativeRevocation = revoked.get(key)
    if (!nativeRevocation || explicitlyTrusted.has(getTomlSectionHeaderKey(section.header))) {
      continue
    }
    if (getProjectTrustLevel(section.block) === 'untrusted' && !applied.has(key)) {
      applied.add(key)
      continue
    }
    edits.push({
      start: section.start,
      end: sections[index + 1]?.start ?? lines.length,
      replacement: applied.has(key) ? [] : nativeRevocation.block.split('\n')
    })
    applied.add(key)
  }
  for (const edit of edits.toReversed()) {
    lines.splice(edit.start, edit.end - edit.start, ...edit.replacement)
  }
  return edits.length === 0 ? runtimeConfig : lines.join('\n')
}
