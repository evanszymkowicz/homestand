interface RankBadgeProps {
  rank: number;
  /** Skips the gold/silver/bronze top-3 treatment for leaderboards where rank
   * 1-3 isn't a real podium (e.g. per-column keeper leaderboards). */
  plain?: boolean;
  /** Hollow/dashed fill instead of solid -- for an in-progress season's rank,
   * which isn't a real finish yet. */
  provisional?: boolean;
}

const SOLID_CLASS: Record<number, string> = {
  1: "bg-gold-soft text-gold",
  2: "bg-silver-soft text-silver",
  3: "bg-bronze-soft text-bronze",
};
const PROVISIONAL_CLASS: Record<number, string> = {
  1: "border border-dashed border-gold text-gold",
  2: "border border-dashed border-silver text-silver",
  3: "border border-dashed border-bronze text-bronze",
};

export function RankBadge({ rank, plain = false, provisional = false }: RankBadgeProps) {
  const badgeClass = plain ? "" : (provisional ? PROVISIONAL_CLASS[rank] : SOLID_CLASS[rank]) ?? "";

  return (
    <span
      className={`inline-flex h-5.5 w-5.5 flex-none items-center justify-center rounded-full text-[0.65rem] font-extrabold font-mono ${badgeClass}`}>
      {rank}
    </span>
  );
}
