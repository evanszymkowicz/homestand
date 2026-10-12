import { useId, useRef, useState, type ReactNode } from "react";
import { TooltipPortal } from "../TooltipPortal";

interface PortalTooltipProps {
  /** Panel content. A rich node (unlike a native `title`), shown on hover and keyboard focus. */
  content: ReactNode;
  /** Open the panel below the trigger instead of above -- a first table row's
   *  upward panel would run off the card top or under the sticky header. */
  openDown?: boolean;
  /** Extra classes for the focusable trigger wrapper (e.g. cursor-help). */
  triggerClassName?: string;
  /** Extra classes for the panel, whose default is a compact nowrap stack. */
  panelClassName?: string;
  children: ReactNode;
}

/** Hover/focus tooltip whose panel renders in a body portal with
 *  position:fixed, so it can extend outside its table card's dimensions.
 *  A CSS-only absolute tooltip can't: inside a Board with overflow-y-auto,
 *  a panel extending past the card's bottom edge inflates the scrollable area
 *  and gets clipped; the portal sidesteps all of it. */
export function PortalTooltip({
  content,
  openDown = false,
  triggerClassName = "",
  panelClassName = "whitespace-nowrap",
  children,
}: PortalTooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const open = () => setAnchor(triggerRef.current?.getBoundingClientRect() ?? null);
  const close = () => setAnchor(null);

  return (
    <>
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
      </span>
      <TooltipPortal
        anchor={anchor}
        id={tooltipId}
        placement={openDown ? "bottom-center" : "top-center"}
        onDismiss={close}
        className={`pointer-events-none z-40 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-ink shadow-md ${panelClassName}`}>
        {content}
      </TooltipPortal>
    </>
  );
}
