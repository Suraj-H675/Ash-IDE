import React from 'react'
import { CalendarClock } from 'lucide-react'
import type { AutomationWorkspaceProvenance } from '../../../../../../shared/worktree/types'
import {
  WorktreeCardDetailSection,
  WorktreeCardDetailSectionContent
} from './WorktreeCardDetailSection'
import { DetailHeader } from '../metadata/WorktreeCardMetadataControls'
import { translate } from '@/i18n/i18n'

type WorktreeCardAutomationDetailSectionProps = {
  provenance: AutomationWorkspaceProvenance
}

export function WorktreeCardAutomationDetailSection({
  provenance
}: WorktreeCardAutomationDetailSectionProps): React.JSX.Element {
  // Historical provenance stays visible without querying the removed scheduler.
  return (
    <WorktreeCardDetailSection>
      <DetailHeader
        icon={<CalendarClock className="size-3 text-muted-foreground" />}
        label={translate('auto.components.sidebar.WorktreeCardMeta.automationHeader', 'Automation')}
      />
      <WorktreeCardDetailSectionContent className="space-y-1.5">
        <div className="text-[13px] font-semibold leading-snug text-foreground break-words">
          {provenance.automationNameSnapshot}
        </div>
        <div className="text-[11.5px] leading-snug text-muted-foreground break-words">
          {provenance.automationRunTitleSnapshot}
        </div>
      </WorktreeCardDetailSectionContent>
    </WorktreeCardDetailSection>
  )
}
