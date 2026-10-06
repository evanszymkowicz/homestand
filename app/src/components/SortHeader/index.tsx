import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SortDirection } from "../../hooks/useSortableRows";

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

const TOOLTIP_WIDTH_REM = 21;

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
  const tooltipId = useId();
  // Anchor rect captured on open: the portal panel is position:fixed (a table
  // card's overflow-hidden would clip a positioned child), so scroll/resize
  // dismisses rather than re-anchors -- transient by design.
  const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!tooltipRect) return;
    const dismiss = () => setTooltipRect(null);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [tooltipRect]);

  let tooltipNode: ReactNode = null;
  if (tooltip && tooltipRect) {
    // Clamp to the viewport: below ~352px the 21rem panel wouldn't fit, so it
    // shrinks rather than overflowing the right edge.
    const width = Math.min(TOOLTIP_WIDTH_REM * 16, window.innerWidth - 16);
    const left = Math.max(8, Math.min(tooltipRect.left - 14, window.innerWidth - width - 8));
    tooltipNode = createPortal(
      <div
        id={tooltipId}
        role="tooltip"
        style={{ position: "fixed", top: tooltipRect.bottom + 8, left, width }}
        className="z-40 rounded-[10px] border border-border bg-surface-2 px-3.5 py-3 shadow-lg">
        <span
          aria-hidden
          style={{ top: -5, left: 16 }}
          className="absolute h-[9px] w-[9px] rotate-45 border-l border-t border-border bg-surface-2"
        />
        <p className="whitespace-pre-line text-xs leading-relaxed text-ink-dim">{tooltip}</p>
      </div>,
      document.body
    );
  }

  return (
    <th
      scope="col"
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}
      style={{ left: stickyLeftOffset, top: stickyTop }}
      onMouseEnter={tooltip ? () => setTooltipRect(buttonRef.current?.getBoundingClientRect() ?? null) : undefined}
      onMouseLeave={tooltip ? () => setTooltipRect(null) : undefined}
      className={`text-eyebrow ${stickyClass} bg-surface px-3 py-2 font-semibold tracking-wide text-ink-faint uppercase ${alignClass} ${className}`}>
      {/* h-6 + min-w-6 keeps the tap target at WCAG 2.5.8's 24x24 CSS px minimum.
          Height alone was not enough: as an inline-flex button the width collapsed
          to the label, so single-letter columns (L, W, R) were 7-12px wide and
          unhittable on touch. */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={ariaLabel ?? label}
        aria-describedby={tooltipRect ? tooltipId : undefined}
        onFocus={tooltip ? () => setTooltipRect(buttonRef.current?.getBoundingClientRect() ?? null) : undefined}
        onBlur={tooltip ? () => setTooltipRect(null) : undefined}
        onKeyDown={
          tooltip
            ? e => {
                if (e.key === "Escape") setTooltipRect(null);
              }
            : undefined
        }
        className={`inline-flex h-6 min-w-6 items-center justify-center gap-0.5 hover:text-ink ${active ? "text-ink" : ""}`}>
        {label}
      </button>
      {tooltipNode}
    </th>
  );
}
