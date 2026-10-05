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

const toneTokens: Record<TrophyTone, { border: string; bg: string; ink: string }> = {
  gold: { border: "var(--color-gold)", bg: "var(--color-gold-soft)", ink: "var(--color-gold)" },
  accent: { border: "var(--color-accent)", bg: "var(--color-accent-soft)", ink: "var(--color-accent)" },
  red: { border: "var(--color-red)", bg: "var(--color-red-soft)", ink: "var(--color-red)" },
};

/** Centered trophy-case-style stat card styled as a scored scorebox.
 * Each honor gets its own ink color on the border and a soft panel fill. */
export function TrophyCard({ label, value, detail, tone, to, dashed = false, hollow = false }: TrophyCardProps) {
  const tokens = toneTokens[tone];
  const content = (
    <>
      <div className="text-eyebrow font-bold tracking-wide text-ink-faint uppercase">{label}</div>
      <div className="scorebook-stat mt-1 w-full text-trophy leading-tight break-words">{value}</div>
      {detail && <TickerText className="w-full mt-0.5 text-xs text-ink-dim">{detail}</TickerText>}
    </>
  );

  const base = `scorebook-card flex flex-col items-center gap-0.5 px-4 pt-6 pb-5 text-center${dashed ? " border-dashed" : ""}${to ? " cursor-pointer transition-transform duration-150 hover:-translate-y-0.5" : ""}`;
  const style: React.CSSProperties = {
    borderColor: tokens.border,
    background: hollow ? `color-mix(in srgb, ${tokens.bg} 35%, var(--color-surface))` : tokens.bg,
  };

  if (to) {
    return (
      <Link to={to} className={base} style={style}>
        {content}
      </Link>
    );
  }
  return (
    <div className={base} style={style}>
      {content}
    </div>
  );
}
