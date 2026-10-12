import { useRef, useState } from "react";
import type { SortDirection } from "../../hooks/useSortableRows";
import { TooltipPortal } from "../TooltipPortal";

interface SortHeaderProps<K extends string> {
  label: string;
  sortKey: K;
  /** null when the table hasn't been sorted yet and is still showing its default order. */
  activeKey: K | null;
  direction: SortDirection;
  onSort: (key: K) => void;
  align?: "left" | "right" | "center";
  /** Falls back to `label` when omitted. Required when label is empty (e.g. an icon-only column) so the sort button still has an accessible name. */
  ariaLabel?: string;
  /** Also pins this header to the left edge while scrolling horizontally -- for a table's lead identity column (e.g. team name). */
  stickyLeft?: boolean;
  /** CSS `left` for the second and later pinned columns, which sit past the lead column's width. Implies stickyLeft. */
  stickyLeftOffset?: string;
  /** CSS `top` for the lower row of a two-row header; defaults to the scroll container's top edge. */
  stickyTop?: string;
  /** Extra classes for per-table trim (e.g. the divider before a column group). */
  className?: string;
  /**
   * Hover/focus explanation for the column's basis (e.g. Pts = league-counted
   * points). No visible affordance: the existing header button is the
   * hover/focus target, and the panel renders in a portal so the table card's
   * overflow-hidden can't clip it. Newlines render as line breaks.
   */
  tooltip?: string;
}

const TOOLTIP_WIDTH_PX = 21 * 16; // 21rem

export function SortHeader<K extends string>({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "left",
  ariaLabel,
  stickyLeft = false,
  stickyLeftOffset,
  stickyTop,
  className = "",
  tooltip,
}: SortHeaderProps<K>) {
  const active = sortKey === activeKey;
  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const pinned = stickyLeft || stickyLeftOffset !== undefined;
  const stickyClass = pinned ? "sticky top-0 left-0 z-20" : "sticky top-0 z-10";

  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null);

  const openTooltip = () => {
    if (tooltip) setTooltipAnchor(buttonRef.current?.getBoundingClientRect() ?? null);
  };
  const closeTooltip = () => setTooltipAnchor(null);

  return (
    <th
      scope="col"
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}
      style={{ left: stickyLeftOffset, top: stickyTop }}
      onMouseEnter={openTooltip}
      onMouseLeave={closeTooltip}
      className={`text-eyebrow ${stickyClass} bg-surface px-3 py-2 font-semibold tracking-wide text-ink-faint uppercase ${alignClass} ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={ariaLabel ?? label}
        onFocus={openTooltip}
        onBlur={closeTooltip}
        onKeyDown={e => {
          if (e.key === "Escape") closeTooltip();
        }}
        className={`inline-flex h-6 min-w-6 items-center justify-center gap-0.5 hover:text-ink ${active ? "text-ink" : ""}`}>
        {label}
      </button>
      <TooltipPortal
        anchor={tooltipAnchor}
        placement="bottom-left"
        width={Math.min(TOOLTIP_WIDTH_PX, window.innerWidth - 16)}
        leftOffset={-14}
        onDismiss={closeTooltip}
        className="z-40 rounded-[10px] border border-border bg-surface-2 px-3.5 py-3 shadow-lg">
        <span
          aria-hidden
          style={{ top: -5, left: 16 }}
          className="absolute h-[9px] w-[9px] rotate-45 border-l border-t border-border bg-surface-2"
        />
        <p className="whitespace-pre-line text-xs leading-relaxed text-ink-dim">{tooltip}</p>
      </TooltipPortal>
    </th>
  );
}
