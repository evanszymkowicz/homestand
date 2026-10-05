import { Link } from "react-router-dom";
import { ownerRef } from "../../lib/stats";
import type { Owner } from "../../types";

interface OwnerLinkProps {
  owners: Owner[];
  ownerId: string | null;
}

/** An owner's canonical name, linked to their page — the owner counterpart to
 * the `<Link to={`/player/${id}`} className="hover:underline">` idiom every
 * table already uses for players. Resolves the name through `ownerRef`, so an
 * id with no owners.json row still renders (as the raw id) and still links.
 * When ownerId is null the component renders "—" with no link, used for
 * current-season free agents in the league table. */
export function OwnerLink({ owners, ownerId }: OwnerLinkProps) {
  if (ownerId === null) return <span className="text-ink-faint">—</span>;
  const owner = ownerRef(owners, ownerId);
  return (
    <Link to={`/owner/${owner.ownerId}`} className="hover:underline">
      {owner.name}
    </Link>
  );
}
