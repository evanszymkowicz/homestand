import { CARD, EYEBROW } from "../../components/cardStyles";
import { SectionHeading } from "../../components/SectionHeading";
import type { OwnerMilestone, OwnerMilestones as OwnerMilestonesData } from "../../lib/ownerMilestones";

interface OwnerMilestonesProps {
  milestones: OwnerMilestonesData;
}

const TONE_CLASSES: Record<NonNullable<OwnerMilestone["tone"]>, string> = {
  gold: "text-gold",
  blue: "text-accent",
  neutral: "text-ink",
};

function MilestoneCard({ milestone }: { milestone: OwnerMilestone }) {
  const hasDescription = Boolean(milestone.description);
  return (
    <div className={CARD}>
      <h4 className={EYEBROW}>{milestone.label}</h4>
      <div className={`mt-1 text-2xl font-extrabold ${TONE_CLASSES[milestone.tone ?? "neutral"]}`}>
        {milestone.value}
        {milestone.season !== undefined && hasDescription && (
          <span className="ml-2 text-sm font-bold text-ink-faint">{milestone.season}</span>
        )}
      </div>
      {hasDescription ? (
        <div className="mt-0.5 text-xs text-ink-faint">{milestone.description}</div>
      ) : (
        milestone.season !== undefined && (
          <div className="mt-0.5 text-sm font-bold text-ink-faint">{milestone.season}</div>
        )
      )}
    </div>
  );
}

/**
 * Owner milestones / personal bests card grid. Every figure comes from the
 * shared lib helpers (lib/ownerMilestones.ts's header names the one behind each)
 * and carries its own coverage caveat in `description` where the source isn't
 * the full 2009+ archive — "unique players owned" spans 2009-2026 and
 * states the years it actually covers, flagging 2018 as partial rather than
 * silently dropping it.
 */
export function OwnerMilestones({ milestones }: OwnerMilestonesProps) {
  if (milestones.milestones.length === 0) return null;

  return (
    <div className="mt-7">
      <SectionHeading as="h3" className="mb-3">
        Milestones
      </SectionHeading>
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
        {milestones.milestones.map(milestone => (
          <MilestoneCard key={milestone.label} milestone={milestone} />
        ))}
      </div>
    </div>
  );
}
