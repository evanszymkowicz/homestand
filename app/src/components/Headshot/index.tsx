import { useEffect, useState } from "react";
import { headshotUrl } from "../../lib/positions";

interface HeadshotProps {
  playerId: number;
  playerName: string;
  /** Rendered box size in px. */
  size?: number;
}

/**
 * ESPN's public headshot for a player, with initials as the fallback.
 *
 * The image is hotlinked from espncdn.com — it is not archived under `data/`
 * and no processed file references it (the URL is derived from `player_id`;
 * see `headshotUrl`). Two consequences the fallback exists for: a player with
 * no photo on file 404s, and the whole thing degrades to initials if ESPN
 * moves or blocks the path. `key` on the img resets `failed` when the page
 * switches players, so one missing photo doesn't suppress the next one.
 *
 * Decorative: the player's name is always rendered as real text beside this,
 * so the img carries an empty alt rather than duplicating it for screen
 * readers.
 */
export function Headshot({ playerId, playerName, size = 64 }: HeadshotProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [playerId]);

  const initials = playerName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div
      className="flex flex-none items-center justify-center overflow-hidden rounded-full border border-border bg-surface-2"
      style={{ width: size, height: size }}>
      {failed ? (
        <span className="font-semibold text-ink-faint" style={{ fontSize: size * 0.34 }} aria-hidden="true">
          {initials || "?"}
        </span>
      ) : (
        <img
          src={headshotUrl(playerId)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}
