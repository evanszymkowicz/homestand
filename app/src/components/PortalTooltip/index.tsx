import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** Gap between the trigger's edge and the panel. */
const GAP_PX = 6;
/** Minimum distance between the panel and the viewport edges. */
const EDGE_PX = 8;

interface PortalTooltipProps {
  /** Panel content. A rich node (unlike a native `title`), shown on hover and keyboard focus. */
  content: ReactNode;
  /** Open the panel below the trigger instead of above -- a first table row's
   * upward panel would run off the card top or under the sticky header. */
  openDown?: boolean;
  /** Extra classes for the focusable trigger wrapper (e.g. cursor-help). */
  triggerClassName?: string;
  /** Extra classes for the panel, whose default is a compact nowrap stack. */
  panelClassName?: string;
  children: ReactNode;
}

/** Hover/focus tooltip whose panel renders in a body portal with
 * position:fixed, so it can extend outside its table card's dimensions.
 * A CSS-only absolute tooltip can't: inside a Board with overflow-y-auto,
 * a panel extending past the card's bottom edge (a short table whose first
 * row opens downward) inflates the scrollable area -- a phantom vertical
 * scrollbar -- and gets clipped there; the card's rounded overflow-hidden
 * clips it in every other direction. The portal sidesteps all of it.
 *
 * Anchored from the trigger's rect captured on open; scroll/resize dismisses
 * rather than re-anchors -- transient by design, same as SortHeader's header
 * tooltip. The panel is measured before paint so the fixed position can be
 * clamped into the viewport (a max-content panel's width is unknown until it
 * renders; the hidden pre-measurement commit is never painted). */
export function PortalTooltip({
  content,
  openDown = false,
  triggerClassName = "",
  panelClassName = "whitespace-nowrap",
  children,
}: PortalTooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [panelSize, setPanelSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!anchor) return;
    const dismiss = () => setAnchor(null);
    const onPointerDown = (e: PointerEvent) => {
      if (!triggerRef.current?.contains(e.target as Node)) setAnchor(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [anchor]);

  useLayoutEffect(() => {
    if (!anchor) {
      setPanelSize(null);
      return;
    }
    const panel = panelRef.current;
    if (panel) setPanelSize({ width: panel.offsetWidth, height: panel.offsetHeight });
  }, [anchor, content]);

  const open = () => setAnchor(triggerRef.current?.getBoundingClientRect() ?? null);
  const close = () => setAnchor(null);

  let panelNode: ReactNode = null;
  if (anchor) {
    const width = panelSize?.width ?? 0;
    const height = panelSize?.height ?? 0;
    const left = Math.max(EDGE_PX, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - EDGE_PX));
    const top = Math.max(
      EDGE_PX,
      Math.min(openDown ? anchor.bottom + GAP_PX : anchor.top - GAP_PX - height, window.innerHeight - height - EDGE_PX)
    );
    panelNode = createPortal(
      <div
        ref={panelRef}
        id={tooltipId}
        role="tooltip"
        style={{
          position: "fixed",
          left,
          top,
          // Hidden until measured so the unclamped first commit never paints.
          visibility: panelSize ? undefined : "hidden",
        }}
        className={`pointer-events-none z-40 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-ink shadow-md ${panelClassName}`}>
        {content}
      </div>,
      document.body
    );
  }

  return (
    <span
      ref={triggerRef}
      tabIndex={0}
      aria-describedby={anchor ? tooltipId : undefined}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      onKeyDown={e => {
        if (e.key === "Escape") close();
      }}
      className={`relative flex ${triggerClassName}`}>
      {children}
      {panelNode}
    </span>
  );
}
