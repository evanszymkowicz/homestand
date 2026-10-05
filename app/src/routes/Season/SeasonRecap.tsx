import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Board } from "../../components/Board";
import { FilterSelect } from "../../components/FilterSelect";
import { OwnerLink } from "../../components/OwnerLink";
import { PlayerLink } from "../../components/PlayerLink";
import { SectionHeading } from "../../components/SectionHeading";
import { formatDifferential, formatPoints } from "../../lib/format";
import { generateSeasonRecap, type SeasonRecap, type SeasonRecapTradeAsset } from "../../lib/seasonRecap";
import type { DraftPick, Matchup, Owner, PlayerSeasonPoints, Season, Team, Trade } from "../../types";

interface SeasonRecapProps {
  season: Season;
  seasons: Season[];
  teams: Team[];
  owners: Owner[];
  matchups: Matchup[];
  trades: Trade[];
  playerSeasonPoints: PlayerSeasonPoints[];
  draftPicks: DraftPick[];
}

/** Every owner on a recap line linked to their page, joined with " & " the
 * same way `formatOwnerNames` joins a co-owned team. */
function OwnerLinks({ owners, ownerIds }: { owners: Owner[]; ownerIds: string[] }) {
  if (ownerIds.length === 0) return <span className="text-ink-faint">—</span>;
  return (
    <>
      {ownerIds.map((id, i) => (
        <span key={id}>
          {i > 0 && " & "}
          <OwnerLink owners={owners} ownerId={id} />
        </span>
      ))}
    </>
  );
}

/** The players (or bare "picks") moving in a trade. */
function TradeAssets({ assets }: { assets: SeasonRecapTradeAsset[] }) {
  return (
    <>
      {assets.map((asset, i) => (
        <span key={asset.playerId ?? `picks-${i}`}>
          {i > 0 && ", "}
          <PlayerLink playerId={asset.playerId} name={asset.name} />
        </span>
      ))}
    </>
  );
}

function NotableTrades({
  recap,
  season,
  owners,
}: {
  recap: SeasonRecap;
  season: Season;
  owners: Owner[];
}) {
  if (recap.notableTrades.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-ink-faint">
        {season.coverage.transactions === "full"
          ? "No executed trades this season."
          : "Trade ledger coverage begins in 2019; no executed trades are on file for this season."}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {recap.notableTrades.map((trade, i) => (
        <li key={i} className="px-3 py-2 text-sm">
          <span className="font-semibold text-ink">
            <OwnerLinks owners={owners} ownerIds={trade.ownerAIds} />
          </span>
          <span className="text-ink-faint"> traded </span>
          <span className="text-ink">
            <TradeAssets assets={trade.gave} />
          </span>
          <span className="text-ink-faint"> to </span>
          <span className="font-semibold text-ink">
            <OwnerLinks owners={owners} ownerIds={trade.ownerBIds} />
          </span>
          <span className="text-ink-faint"> for </span>
          <span className="text-ink">
            <TradeAssets assets={trade.received} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function BreakoutPlayers({
  recap,
  season,
  owners,
}: {
  recap: SeasonRecap;
  season: Season;
  owners: Owner[];
}) {
  if (recap.breakoutPlayers.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-ink-faint">
        {season.coverage.stat_lines === "full"
          ? "No breakout performers identified."
          : "No breakout performers identified. This era's player totals are backfilled from whole-week box scores, so fewer draft picks have a matching season total."}
      </div>
    );
  }
  return (
    <>
      {/* Pre-2019 box scores are whole-week, so season totals exist for most but
          not all draft picks and the percentile is built from a partial pool.
          The figures are real, so they are shown with the caveat rather than
          hidden -- but they are not comparable to a full-coverage season. */}
      {season.coverage.stat_lines !== "full" && (
        <p className="px-3 pb-1 pt-2 text-xs text-ink-faint">
          Season totals for this era are backfilled from whole-week box scores, so percentiles are
          approximate.
        </p>
      )}
      <ul className="divide-y divide-border">
        {recap.breakoutPlayers.map((player, i) => (
          <li key={i} className="px-3 py-2 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-ink">
              <PlayerLink playerId={player.playerId} name={player.playerName} />
            </span>
            <span className="text-xs text-ink-faint">
              <OwnerLink owners={owners} ownerId={player.ownerId} />
            </span>
          </div>
          <div className="text-xs text-ink-faint">
            Drafted #{player.draftPosition} · {formatPoints(player.finalPercentile)} percentile ·{" "}
            {formatDifferential(player.valueShift)} value shift
          </div>
        </li>
      ))}
      </ul>
    </>
  );
}

export function SeasonRecap({
  season,
  seasons,
  teams,
  owners,
  matchups,
  trades,
  playerSeasonPoints,
  draftPicks,
}: SeasonRecapProps) {
  const navigate = useNavigate();
  const sortedYears = useMemo(() => [...seasons.map(s => s.year)].sort((a, b) => b - a), [seasons]);

  const recap = useMemo<SeasonRecap | null>(
    () =>
      generateSeasonRecap(
        season.year,
        teams,
        matchups,
        trades,
        playerSeasonPoints,
        draftPicks
      ),
    [season, teams, matchups, trades, playerSeasonPoints, draftPicks]
  );

  if (!recap) {
    return <p className="text-sm text-ink-dim">Couldn&apos;t generate a recap for this season.</p>;
  }

  const statTiles = [
    {
      label: "Champion",
      value: <OwnerLinks owners={owners} ownerIds={recap.champion.ownerIds} />,
      sub: `${recap.champion.record} · ${formatPoints(recap.champion.points)} pts`,
    },
    {
      label: "Runner-Up",
      value: <OwnerLinks owners={owners} ownerIds={recap.runnerUp.ownerIds} />,
      sub: `${recap.runnerUp.record} · ${formatPoints(recap.runnerUp.points)} pts`,
    },
    {
      label: "Biggest Mover",
      value: recap.biggestMover ? (
        <OwnerLinks owners={owners} ownerIds={recap.biggestMover.ownerIds} />
      ) : (
        "—"
      ),
      sub: recap.biggestMover
        ? `#${recap.biggestMover.fromRank} → #${recap.biggestMover.toRank}`
        : "No prior season",
    },
    {
      label: "Best Week",
      value: <OwnerLinks owners={owners} ownerIds={recap.highestScoringWeek.ownerIds} />,
      sub: `Week ${recap.highestScoringWeek.week} · ${formatPoints(recap.highestScoringWeek.points)} pts`,
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionHeading>Season Recap</SectionHeading>
        <FilterSelect
          value={season.year}
          onChange={e => navigate(`/season/${e.target.value}/recap`)}
          aria-label="Select season year">
          {sortedYears.map(y => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </FilterSelect>
      </div>

      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {statTiles.map(tile => (
            <div key={tile.label} className="rounded-xl border border-border bg-surface p-4 text-center shadow-sm">
              <div className="text-xs font-bold uppercase tracking-wide text-ink-faint">{tile.label}</div>
              <div className="mt-1 text-base font-extrabold text-ink">{tile.value}</div>
              <div className="text-xs text-ink-faint">{tile.sub}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Board title="Trades">
            <NotableTrades recap={recap} season={season} owners={owners} />
          </Board>
          <Board title="Breakout Players">
            <BreakoutPlayers recap={recap} season={season} owners={owners} />
          </Board>
        </div>
      </div>
    </div>
  );
}