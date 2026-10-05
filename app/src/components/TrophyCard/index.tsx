import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { TickerText } from "../TickerText";

type TrophyTone = "gold" | "accent" | "red";

interface TrophyCardProps {
  label: ReactNode;
  value: string;
  detail?: ReactNode;
  /** Soft-tinted panel + border per honor: gold (champion), accent (best
   * record), red (points leader). */
  tone: TrophyTone;
  /** When present, the whole card becomes a link, matching StatCard's
   * block-link treatment. */
  to?: string;
  /** Dashed border — marks an honor that isn't decided yet (the in-progress
   * season's Current Leader card) so it reads as provisional, not won. */
  dashed?: boolean;
  /** Swaps the honor's full soft fill for a faint tint of its own color --
   * reads as shaded-but-not-won, for provisional honors like Current Leader. */
  hollow?: boolean;
}

// Every honor's label shares the same dimmed ink — unified trophy-case look.
const LABEL_COLOR = "text-ink-dim";

const toneClasses: Record<TrophyTone, { border: string; bg: string; tint: string }> = {
  gold: { border: "border-gold", bg: "bg-gold-soft", tint: "bg-gold/15" },
  accent: { border: "border-accent", bg: "bg-accent-soft", tint: "bg-accent/15" },
  red: { border: "border-red", bg: "bg-red-soft", tint: "bg-red/15" },
};

/** Centered trophy-case-style stat card: eyebrow label over a large value over
 * a ticker detail line, on a soft tinted panel per honor. Distinct from
 * StatCard (left-aligned, left-edge accent) so the season page's three honors
 * read as trophies rather than more stats. */
export function TrophyCard({ label, value, detail, tone, to, dashed = false, hollow = false }: TrophyCardProps) {
  const { border, bg, tint } = toneClasses[tone];
  const content = (
    <>
      <div className={`text-eyebrow font-bold tracking-wide uppercase ${LABEL_COLOR}`}>{label}</div>
      <div className="mt-1 w-full text-trophy leading-tight font-extrabold tabular-nums break-words">{value}</div>
      {detail && <TickerText className="w-full mt-0.5 text-xs text-ink-dim">{detail}</TickerText>}
    </>
  );
  const className = `flex flex-col items-center gap-0.5 rounded-xl ${border} ${hollow ? tint : bg} px-4 pt-6 pb-5 text-center shadow-sm${dashed ? " border-dashed" : ""}${to ? " cursor-pointer transition-transform duration-150 hover:-translate-y-0.5" : ""}`;
  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }
  return <div className={className}>{content}</div>;
}
