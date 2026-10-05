import { Link } from "react-router-dom";

interface PlayerLinkProps {
  playerId: number | null;
  name: string;
}

/** A player's display name, linked to their page. Renders as plain text when
 * `playerId` is null: a recap trade can move draft picks rather than a named
 * player, and there is no player page to link to in that case. */
export function PlayerLink({ playerId, name }: PlayerLinkProps) {
  if (playerId === null) return <span>{name}</span>;
  return (
    <Link to={`/player/${playerId}`} className="hover:underline">
      {name}
    </Link>
  );
}
