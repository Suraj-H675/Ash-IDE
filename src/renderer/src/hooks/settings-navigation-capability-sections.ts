import { getAccountsPaneSearchEntries } from '@/components/settings/accounts/accounts-search'
import { getAgentsPaneSearchEntries } from '@/components/settings/agents/agents-search'
import { getComputerUsePaneSearchEntries } from '@/components/settings/computer-use/computer-use-search'
import { getGeneralPaneSearchEntries } from '@/components/settings/general/general-search'
import { getIntegrationsPaneSearchEntries } from '@/components/settings/integrations/integrations-search'
import { OrcaLogoSettingsIcon } from '@/components/settings/page/orca-logo-settings-icon'
import { getOrchestrationPaneSearchEntries } from '@/components/settings/orchestration/orchestration-search'
import { translate } from '@/i18n/i18n'
import type { SettingsNavSection } from '@/lib/settings-navigation-types'
import { Blocks, Bot, MousePointerClick, Network, SlidersHorizontal, UserCog } from 'lucide-react'
import type { SettingsNavigationBuildOptions } from './settings-navigation-build-options'

export function buildCapabilitySettingsSections({
  isLocalWindowsHost,
  isWebClient
}: SettingsNavigationBuildOptions): SettingsNavSection[] {
  const showDesktopOnlySettings = !isWebClient
  return [
    {
      id: 'agents',
      title: translate('auto.hooks.useSettingsNavigationMetadata.b49abbd2f7', 'Agents'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.4121f7a0a2',
        'Manage AI agents, set a default, and customize commands.'
      ),
      icon: Bot,
      searchEntries: getAgentsPaneSearchEntries({
        includeAgentAwake: !isWebClient,
        includeAgentChatChoice: !isWebClient,
        includeAgentRuntime: isLocalWindowsHost,
        includeAgentWorkspaceTrust: !isWebClient,
        includeCodexTerminalServerIsolation: !isWebClient
      }),
      group: 'capabilities'
    },
    {
      id: 'accounts',
      title: translate(
        'auto.hooks.useSettingsNavigationMetadata.f70ac54d38',
        'AI Provider Accounts'
      ),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.b1c2f8b0ac',
        'Optional account switching and usage setup for Claude, Codex, Gemini, OpenCode Go, MiniMax, and Grok.'
      ),
      icon: UserCog,
      searchEntries: getAccountsPaneSearchEntries(),
      group: 'capabilities',
      badge: translate('auto.hooks.useSettingsNavigationMetadata.7c79d3b7bf', 'Optional')
    },
    {
      id: 'orchestration',
      title: translate('auto.hooks.useSettingsNavigationMetadata.58a868e8e4', 'Orchestration'),
      description: translate(
        'ash.hooks.useSettingsNavigationMetadata.orchestrationDescription',
        'Coordinate multiple coding agents through Ash IDE.'
      ),
      icon: Network,
      searchEntries: getOrchestrationPaneSearchEntries({
        includeLocalRuntimeSettings: !isWebClient
      }),
      group: 'capabilities'
    },
    ...(showDesktopOnlySettings
      ? [
          {
            id: 'computer-use',
            title: translate('auto.hooks.useSettingsNavigationMetadata.b35e92364b', 'Computer Use'),
            description: translate(
              'auto.hooks.useSettingsNavigationMetadata.0059bd17f3',
              'Enable agents to control any app on your computer.'
            ),
            icon: MousePointerClick,
            searchEntries: getComputerUsePaneSearchEntries(),
            group: 'capabilities'
          }
        ]
      : [])
  ]
}

export function buildSetupSettingsSections({
  isLocalWindowsHost
}: SettingsNavigationBuildOptions): SettingsNavSection[] {
  return [
    {
      id: 'setup-guide',
      title: translate(
        'auto.hooks.useSettingsNavigationMetadata.ded9e9032f',
        'Onboarding checklist'
      ),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.5f32ac08f3',
        'Finish the onboarding checklist for core Orca workflows.'
      ),
      icon: OrcaLogoSettingsIcon,
      searchEntries: [
        {
          title: translate(
            'auto.hooks.useSettingsNavigationMetadata.ded9e9032f',
            'Onboarding checklist'
          ),
          description: translate(
            'auto.hooks.useSettingsNavigationMetadata.17005c73d4',
            'Open the onboarding checklist for setup and milestone steps.'
          ),
          keywords: [
            translate('auto.hooks.useSettingsNavigationMetadata.ea0b1bc7b8', 'setup guide'),
            translate(
              'auto.hooks.useSettingsNavigationMetadata.0505d0df29',
              'get started with Orca'
            ),
            translate('auto.hooks.useSettingsNavigationMetadata.724c440e72', 'getting started')
          ]
        }
      ],
      group: 'setup'
    },
    {
      id: 'general',
      title: translate('auto.hooks.useSettingsNavigationMetadata.13241992bd', 'General'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.2cd4ea75da',
        'Workspace defaults, app setup, and maintenance.'
      ),
      icon: SlidersHorizontal,
      searchEntries: getGeneralPaneSearchEntries({ includeProjectRuntime: isLocalWindowsHost }),
      group: 'setup'
    },
    {
      id: 'integrations',
      title: translate('auto.hooks.useSettingsNavigationMetadata.2b043783ef', 'Integrations'),
      description: translate(
        'ash.hooks.useSettingsNavigationMetadata.codeHostIntegrationDescription',
        'Connect GitHub, GitLab, and other source-control services.'
      ),
      icon: Blocks,
      searchEntries: getIntegrationsPaneSearchEntries(),
      group: 'setup'
    }
  ]
}
