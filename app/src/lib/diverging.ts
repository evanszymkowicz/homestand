import type { CSSProperties } from "react";

/**
 * Shared diverging-heatmap color helper
 */
export function divergingBackground(signedStrengthPct: number, maxStrength = 55): CSSProperties {
  if (!Number.isFinite(signedStrengthPct)) return {};
  const clamped = Math.max(-maxStrength, Math.min(maxStrength, Math.round(signedStrengthPct)));
  if (clamped === 0) return {};
  const pole = clamped > 0 ? "var(--color-diverge-pos)" : "var(--color-diverge-neg)";
  return { backgroundColor: `color-mix(in oklab, ${pole} ${Math.abs(clamped)}%, var(--color-surface))` };
}

/** Scales a signed value to a ±maxStrength color strength, full strength at
 * |value - center| === scaleMax. Linear -- most views use this directly. */
export function linearStrength(value: number, center: number, scaleMax: number, maxStrength = 55): number {
  if (scaleMax === 0) return 0;
  return ((value - center) / scaleMax) * maxStrength;
}

/** Diverging fill for a 0-100 percentile. Neutral at the
 * 50th, full pole at the 0th/100th. */
export function percentileBackground(percentile: number, maxStrength = 70): CSSProperties {
  return divergingBackground(linearStrength(percentile, 50, 50, maxStrength), maxStrength);
}

/** A diverging scale needs a neutral *gray* midpoint. divergingBackground mixes
 * toward the surface instead, which is right for grid cells (their borders still
 * bound them) but renders an un-bordered bar at the 50th percentile invisible --
 * so bar fills mix toward this visible neutral rather than toward the surface.
 * Same approach DivergingViews dotFill takes for scatter dots. */
const NEUTRAL_BAR_FILL = "color-mix(in oklab, var(--color-ink-faint) 22%, var(--color-surface))";

/** Fill for a full-width 0-100 percentile bar. Neutral gray at the 50th (always a
 * visible color, never `{}`), blue pole below, red pole above. */
export function percentileBarBackground(percentile: number): CSSProperties {
  const strength = Math.max(-55, Math.min(55, Math.round(linearStrength(percentile, 50, 50))));
  if (strength === 0) return { backgroundColor: NEUTRAL_BAR_FILL };
  const pole = strength > 0 ? "var(--color-diverge-pos)" : "var(--color-diverge-neg)";
  return { backgroundColor: `color-mix(in oklab, ${pole} ${Math.abs(strength)}%, ${NEUTRAL_BAR_FILL})` };
}

/** Square-root scaled strength -- compresses a wide value range so small
 * values stay visibly tinted instead of being swamped by a handful of large
 * outliers (the scoring-rules drift grid's no-hitter/perfect-game rows next
 * to single-point stats). Sign follows the raw value. */
export function sqrtStrength(value: number, maxAbs: number, maxStrength = 55): number {
  if (maxAbs === 0) return 0;
  const sign = value >= 0 ? 1 : -1;
  return sign * (Math.sqrt(Math.abs(value)) / Math.sqrt(maxAbs)) * maxStrength;
}

/** Heat index for a traded points delta. */
export function pointsDeltaBackground(value: number, scaleMax: number): CSSProperties {
  return divergingBackground(linearStrength(value, 0, scaleMax));
}
