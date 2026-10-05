interface ChampionBadgeProps {
  /** Falls back to "League champion" — pass a count phrase (e.g. "3 titles")
   * for owner-directory-style usage. */
  label?: string;
  /** "sm" sits inline next to table/card text (team names, table cells).
   * "md" sits inline with a StatCard's large value. */
  size?: "sm" | "md";
  className?: string;
}

/** The one crown+gold treatment for "this is a title," reused everywhere a
 * champion is called out outside playoff brackets (which keep their own
 * generic tier-badge emoji via MatchupCard's ChampionTierBadge — crown and
 * clown share that mechanism and aren't part of this unification). */
export function ChampionBadge({ label = "League champion", size = "sm", className = "" }: ChampionBadgeProps) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block -translate-y-0.5 text-gold ${size === "sm" ? "text-sm" : "text-lg"} ${className}`}>
      👑
    </span>
  );
}
