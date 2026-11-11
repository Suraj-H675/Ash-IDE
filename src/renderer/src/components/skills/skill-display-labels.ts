import type { SkillSourceKind } from '../../../../shared/skills'
import { translate } from '@/i18n/i18n'

// Repo-scoped roots also include folder workspaces; call them Workspace consistently with eligibility copy.
export function sourceKindLabel(kind: SkillSourceKind): string {
  switch (kind) {
    case 'home':
      return translate('auto.components.skills.sourceKind.home', 'Home')
    case 'repo':
      return translate('auto.components.skills.sourceKind.workspace', 'Workspace')
    case 'bundled':
      return translate('auto.components.skills.sourceKind.bundled', 'Bundled')
    case 'plugin':
      return translate('auto.components.skills.sourceKind.plugin', 'Plugin')
  }
}

export function skillCountLabel(count: number): string {
  return translate('auto.components.skills.count.skill', '{{count}} skills', {
    count,
    defaultValue_one: '{{count}} skill'
  })
}

export function sourceCountLabel(count: number): string {
  return translate('auto.components.skills.count.source', '{{count}} sources', {
    count,
    defaultValue_one: '{{count}} source'
  })
}

export function fileCountLabel(count: number): string {
  return translate('auto.components.skills.count.file', '{{count}} files', {
    count,
    defaultValue_one: '{{count}} file'
  })
}

export function resultCountLabel(count: number): string {
  return translate('auto.components.skills.count.result', '{{count}} results', {
    count,
    defaultValue_one: '{{count}} result'
  })
}

export function selectedCountLabel(count: number): string {
  return translate('auto.components.skills.count.selected', '{{count}} selected', { count })
}
