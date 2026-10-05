interface CommissionerBadgeProps {
  /** Falls back to "League commissioner". */
  label?: string;
  /** "sm" sits inline next to table/card text. "md" sits inline with a heading. */
  size?: "sm" | "md";
  className?: string;
}

/** Shield badge for the league commissioner — visually distinct from the gold
 * crown used for champions (ChampionBadge). */
export function CommissionerBadge({
  label = "League commissioner",
  size = "sm",
  className = "",
}: CommissionerBadgeProps) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block -translate-y-0.5 text-accent ${size === "sm" ? "text-sm" : "text-lg"} ${className}`}>
      🛡️
    </span>
  );
}
