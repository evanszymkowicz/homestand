import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const GAP_PX = 6;
const EDGE_PX = 8;

type Placement = "top-center" | "bottom-center" | "bottom-left";

interface TooltipPortalProps {
  anchor: DOMRect | null;
  children: ReactNode;
  className: string;
  id?: string;
  /** Fixed width override, otherwise max-content. */
  width?: number;
  placement?: Placement;
  /** Left offset for bottom-left placement, relative to the anchor left edge. */
  leftOffset?: number;
  onDismiss: () => void;
}

/** Shared tooltip panel: portal, pre-measurement, viewport clamping, and
 *  dismiss-on-scroll/resize/pointerdown. Callers own the trigger and anchor
 *  state. */
export function TooltipPortal({
  anchor,
  children,
  className,
  id,
  width,
  placement = "top-center",
  leftOffset = 0,
  onDismiss,
}: TooltipPortalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!anchor) return;
    const dismiss = () => onDismiss();
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [anchor, onDismiss]);

  useLayoutEffect(() => {
    if (!anchor) {
      setSize(null);
      return;
    }
    const panel = panelRef.current;
    if (panel) setSize({ width: panel.offsetWidth, height: panel.offsetHeight });
  }, [anchor, children, width]);

  if (!anchor) return null;

  const panelWidth = width ?? size?.width ?? 0;
  const panelHeight = size?.height ?? 0;

  let left: number;
  let top: number;
  if (placement === "bottom-left") {
    left = Math.max(EDGE_PX, Math.min(anchor.left + leftOffset, window.innerWidth - panelWidth - EDGE_PX));
    top = Math.max(EDGE_PX, Math.min(anchor.bottom + GAP_PX, window.innerHeight - panelHeight - EDGE_PX));
  } else if (placement === "bottom-center") {
    left = Math.max(EDGE_PX, Math.min(anchor.left + anchor.width / 2 - panelWidth / 2, window.innerWidth - panelWidth - EDGE_PX));
    top = Math.max(EDGE_PX, Math.min(anchor.bottom + GAP_PX, window.innerHeight - panelHeight - EDGE_PX));
  } else {
    left = Math.max(EDGE_PX, Math.min(anchor.left + anchor.width / 2 - panelWidth / 2, window.innerWidth - panelWidth - EDGE_PX));
    top = Math.max(EDGE_PX, Math.min(anchor.top - GAP_PX - panelHeight, window.innerHeight - panelHeight - EDGE_PX));
  }

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="tooltip"
      style={{
        position: "fixed",
        left,
        top,
        width: width ? `${width}px` : undefined,
        visibility: size || width ? undefined : "hidden",
      }}
      className={className}>
      {children}
    </div>,
    document.body
  );
}
