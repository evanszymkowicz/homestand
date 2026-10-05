export function formatPoints(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function formatDifferential(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${formatPoints(n)}`;
}

export function formatWinPct(pct: number): string {
  return pct.toFixed(3).replace(/^0/, "");
}

/** Percentile-rank delta in percentile points. Sub-0.5 swings round to a bare
 * "0%" and lose their sign, so they render one decimal instead -- cells color
 * by the raw delta's sign and must not contradict a sign-less label. */
export function formatPercentileChange(delta: number): string {
  if (delta !== 0 && Math.round(delta) === 0) {
    return `${delta > 0 ? "+" : "-"}${Math.abs(delta).toFixed(1)}%`;
  }
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${Math.round(delta)}%`;
}

export function formatRecord(wins: number, losses: number, ties: number): string {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

export function formatOwnerNames(owners: { name: string }[]): string {
  return owners.length > 0 ? owners.map(o => o.name).join(" & ") : "—";
}

export function formatInnings(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

export function formatOrdinal(n: number): string {
  const rounded = Math.round(n);
  const mod100 = rounded % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`;
  switch (rounded % 10) {
    case 1:
      return `${rounded}st`;
    case 2:
      return `${rounded}nd`;
    case 3:
      return `${rounded}rd`;
    default:
      return `${rounded}th`;
  }
}
