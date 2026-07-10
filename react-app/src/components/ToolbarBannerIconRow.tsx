/**
 * ToolbarBannerIconRow
 *
 * Row of bell-style icons, one per banner category, meant to sit inline in
 * the toolbar (left of the sprint selector) rather than floating over the
 * page. Each icon only appears once its banner has something to say, and
 * opens its own bounded popover on click.
 *
 * When more than one category is active at once, all active icons switch to
 * the "prominent" style — a visual escalation that something needs attention
 * beyond the usual single nudge.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ClipboardCheck, Brain, CalendarClock, Flag, CalendarDays, Heart, Plug, Clock3 } from 'lucide-react';
import ToolbarBannerIcon from './ToolbarBannerIcon';
import CheckInBanner from './checkins/CheckInBanner';
import { CoachVerdictBanner } from './coach/CoachVerdictBanner';
import PlannerCapacityBanner from './planner/PlannerCapacityBanner';
import SprintClosureBanner from './sprints/SprintClosureBanner';
import PlannedSprintBanner from './sprints/PlannedSprintBanner';
import GlobalHealthProgressBanner from './GlobalHealthProgressBanner';
import GlobalIntegrationStatus from './GlobalIntegrationStatus';
import DeferralCandidatesBanner from './DeferralCandidatesBanner';

interface ToolbarBannerIconRowProps {
  isLargeScreen: boolean;
  hidePlannerCapacityBanner: boolean;
}

const ToolbarBannerIconRow: React.FC<ToolbarBannerIconRowProps> = ({ isLargeScreen, hidePlannerCapacityBanner }) => {
  const [visibleMap, setVisibleMap] = useState<Record<string, boolean>>({});

  const handleVisibilityChange = useCallback((id: string, visible: boolean) => {
    setVisibleMap((prev) => (prev[id] === visible ? prev : { ...prev, [id]: visible }));
  }, []);

  const count = useMemo(() => Object.values(visibleMap).filter(Boolean).length, [visibleMap]);
  const prominent = count > 1;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <ToolbarBannerIcon id="deferral" icon={Clock3} label="Deferral suggestions" prominent={prominent} onVisibilityChange={handleVisibilityChange}>
        <DeferralCandidatesBanner />
      </ToolbarBannerIcon>
      <ToolbarBannerIcon id="checkin" icon={ClipboardCheck} label="Check-in" prominent={prominent} onVisibilityChange={handleVisibilityChange}>
        <CheckInBanner />
      </ToolbarBannerIcon>
      <ToolbarBannerIcon id="coach" icon={Brain} label="Coach" prominent={prominent} onVisibilityChange={handleVisibilityChange}>
        <CoachVerdictBanner />
      </ToolbarBannerIcon>
      {!hidePlannerCapacityBanner && (
        <ToolbarBannerIcon id="plannerCapacity" icon={CalendarClock} label="Planner capacity" prominent={prominent} onVisibilityChange={handleVisibilityChange}>
          <PlannerCapacityBanner />
        </ToolbarBannerIcon>
      )}
      <ToolbarBannerIcon id="sprintClosure" icon={Flag} label="Sprint closure" prominent={prominent} onVisibilityChange={handleVisibilityChange}>
        <SprintClosureBanner />
      </ToolbarBannerIcon>
      <ToolbarBannerIcon id="plannedSprint" icon={CalendarDays} label="Planned sprint" prominent={prominent} onVisibilityChange={handleVisibilityChange}>
        <PlannedSprintBanner />
      </ToolbarBannerIcon>
      {isLargeScreen && (
        <ToolbarBannerIcon id="health" icon={Heart} label="Health" prominent={prominent} onVisibilityChange={handleVisibilityChange}>
          <GlobalHealthProgressBanner />
        </ToolbarBannerIcon>
      )}
      {isLargeScreen && (
        <ToolbarBannerIcon id="integration" icon={Plug} label="Integrations" prominent={prominent} onVisibilityChange={handleVisibilityChange}>
          <GlobalIntegrationStatus />
        </ToolbarBannerIcon>
      )}
    </div>
  );
};

export default ToolbarBannerIconRow;
