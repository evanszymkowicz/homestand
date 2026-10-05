import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { TickerText } from "../TickerText";

interface StatCardProps {
  label: ReactNode;
  value: string;
  detail: ReactNode;
  accent?: "positive" | "negative" | "gold";
  runnersUp?: ReactNode[];
  /** Renders the value above the label instead of beneath it. */
  labelBelow?: boolean;
  /** When present, the whole card becomes a link to its "receipt" (a matchup
   * or season page) — root renders as a Link instead of a div, matching
   * MatchupCard's hover:bg-surface-2 block-link treatment. Omitting it keeps
   * every existing non-clickable StatCard usage unchanged. */
  to?: string;
  valueFont?: "mono" | "sans";
}

export function StatCard({
  label,
  value,
  detail,
  accent,
  runnersUp,
  labelBelow,
  to,
  valueFont = "mono",
}: StatCardProps) {
  const accentColor =
    accent === "positive"
      ? "var(--color-diverge-pos)"
      : accent === "negative"
        ? "var(--color-diverge-neg)"
        : accent === "gold"
          ? "var(--color-gold)"
          : undefined;

  const valueNum = valueFont === "sans" ? "" : " tabular-nums";
  const valueEl = (className: string) => (
    <div
      className={`${className}${valueNum} whitespace-nowrap`}
      style={accentColor ? { color: accentColor } : undefined}>
      {value}
    </div>
  );

  const content = (
    <>
      {labelBelow ? (
        <>
          {valueEl("text-2xl font-extrabold")}
          <div className="text-eyebrow mt-1 font-bold tracking-wide text-ink-faint uppercase">{label}</div>
        </>
      ) : (
        <>
          <div className="text-eyebrow font-bold tracking-wide text-ink-faint uppercase">{label}</div>
          {valueEl("mt-1 text-2xl font-extrabold")}
        </>
      )}
      <TickerText className="mt-0.5 text-xs text-ink-faint">{detail}</TickerText>
      {runnersUp && runnersUp.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
          {runnersUp.map((entry, i) => (
            <li key={i} className="flex gap-1 text-xs text-ink-faint tabular-nums">
              <span className="flex-none">{i + 2}.</span>
              <TickerText className="min-w-0 flex-1">{entry}</TickerText>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const className = `block rounded-xl border border-border bg-surface p-4 shadow-sm${to ? " hover:bg-surface-2" : ""}`;
  const style = accentColor ? { borderLeftColor: accentColor, borderLeftWidth: "3px" } : undefined;

  if (to) {
    return (
      <Link to={to} className={className} style={style}>
        {content}
      </Link>
    );
  }
  return (
    <div className={className} style={style}>
      {content}
    </div>
  );
}
