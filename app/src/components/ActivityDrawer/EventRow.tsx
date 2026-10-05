import type { EventKind } from "../../lib/activityDrawer";
import type { ReactNode } from "react";
import { Headshot } from "../Headshot";

type EventAction = "added" | "dropped" | "win" | "loss";

function strokeIcon(paths: ReactNode): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-3 w-3">
      {paths}
    </svg>
  );
}

function eventIcon(kind: EventKind, action?: EventAction): ReactNode {
  switch (kind) {
    case "trade":
      return strokeIcon(
        <>
          <polyline points="17 1 21 5 17 9" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <polyline points="7 23 3 19 7 15" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </>
      );
    case "fa":
      return action === "dropped"
        ? strokeIcon(
            <>
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="18" y1="8" x2="24" y2="14" />
              <line x1="24" y1="8" x2="18" y2="14" />
            </>
          )
        : strokeIcon(
            <>
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </>
          );
    case "matchup":
      return action === "loss"
        ? strokeIcon(
            <>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </>
          )
        : strokeIcon(<polyline points="20 6 9 17 4 12" />);
    case "achievement":
      return strokeIcon(
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      );
    case "trophy":
      return strokeIcon(
        <>
          <path d="M8 21h8" />
          <path d="M12 17v4" />
          <path d="M7 4h10v6a5 5 0 0 1-10 0V4Z" />
          <path d="M7 6H4a1 1 0 0 0-1 1 4 4 0 0 0 4 4" />
          <path d="M17 6h3a1 1 0 0 1 1 1 4 4 0 0 1-4 4" />
        </>
      );
    case "il":
      return strokeIcon(
        <>
          <rect x="3" y="7" width="18" height="14" rx="2" />
          <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </>
      );
    case "record":
      return strokeIcon(
        <>
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 8 12 8s5-4 7.5-4a2.5 2.5 0 0 1 0 5H18" />
          <path d="M6 15H4.5a2.5 2.5 0 0 0 0 5C7 20 7 16 12 16s5 4 7.5 4a2.5 2.5 0 0 0 0-5H18" />
        </>
      );
  }
}

const ACCENTS: Record<EventKind, { border: string; chip: string }> = {
  trade: { border: "border-trade", chip: "bg-trade-soft text-trade" },
  fa: { border: "border-fa", chip: "bg-fa-soft text-fa" },
  il: { border: "border-il", chip: "bg-il-soft text-il" },
  matchup: { border: "border-matchup-win", chip: "bg-matchup-win-soft text-matchup-win" },
  achievement: { border: "border-achievement", chip: "bg-achievement-soft text-achievement" },
  trophy: { border: "border-achievement", chip: "bg-achievement-soft text-achievement" },
  record: { border: "border-achievement", chip: "bg-achievement-soft text-achievement" },
};

function accentFor(kind: EventKind, action?: EventAction): { border: string; chip: string } {
  if (kind === "matchup") {
    return action === "loss"
      ? { border: "border-matchup-loss", chip: "bg-matchup-loss-soft text-matchup-loss" }
      : ACCENTS.matchup;
  }
  return ACCENTS[kind];
}

interface EventRowProps {
  kind: EventKind;
  action?: EventAction;
  title: ReactNode;
  meta: ReactNode;
  /** Right-aligned tabular value; omitted renders nothing. */
  points?: string | null;
  /** When present, replaces the category icon with an owner-initials chip
   * colored by the owner's stable hue — for rows that open with a human
   * name. */
  ownerChip?: { initials: string; hue: number };
  /** When present, replaces the whole icon chip with the player's headshot —
   * for rows that open with a player name. */
  headshot?: { playerId: number; playerName: string };
}

/** One activity row — colored left border + icon chip + title/meta, shared by
 * every drawer event type. The lead is a headshot (player rows), an
 * owner-colored initials chip (human-name rows), or the category icon. */
export function EventRow({ kind, action, title, meta, points, ownerChip, headshot }: EventRowProps) {
  const accent = accentFor(kind, action);
  return (
    <div className={`flex gap-2 border-l-[3px] py-2 pl-2.5 pr-3 hover:bg-surface-2/60 ${accent.border}`}>
      {headshot ? (
        <Headshot playerId={headshot.playerId} playerName={headshot.playerName} size={24} />
      ) : ownerChip ? (
        <span
          className="owner-chip flex h-6 w-6 flex-none items-center justify-center rounded-full text-[0.6rem] font-extrabold uppercase tracking-wide"
          style={{ "--owner-hue": ownerChip.hue } as React.CSSProperties}>
          {ownerChip.initials}
        </span>
      ) : (
        <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full ${accent.chip}`}>
          {eventIcon(kind, action)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[0.8rem] font-semibold leading-snug">{title}</p>
        <p className="mt-0.5 text-[0.7rem] text-ink-faint">{meta}</p>
      </div>
      {points ? (
        <span className="self-center font-mono text-[0.75rem] font-semibold tabular-nums text-ink-dim">{points}</span>
      ) : null}
    </div>
  );
}
