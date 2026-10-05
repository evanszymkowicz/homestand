import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The modal behavior every dialog in the app needs: move focus inside on open,
 * keep Tab and Shift+Tab cycling within the panel, close on Escape, stop the
 * page behind the dialog from scrolling, and hand focus back to whatever opened
 * it on close.
 *
 * Extracted so a new dialog can't ship without the trap — the copy that used to
 * live in `ActivityDrawer` and `TradeGradeModal` had already drifted.
 *
 * `active` is false while the dialog is closed so callers that keep the component
 * mounted can skip the work. `restoreFocusRef` is the trigger that opened the
 * dialog; omit it to leave focus where the browser puts it.
 */
export function useFocusTrap(
  panelRef: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
  restoreFocusRef?: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!active) return;
    (initialFocusRef?.current ?? panelRef.current)?.focus();
    // Snapshot the trigger now: by cleanup time the ref may point at a different
    // node (the drawer re-renders, or a filter swap unmounts the row that opened
    // the dialog), and focusing a stale/empty ref loses the return trip.
    const restoreTarget = restoreFocusRef?.current ?? null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || panelRef.current === null) return;

      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        el => !el.hasAttribute("disabled") && el.offsetParent !== null
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active_ = document.activeElement;

      // Focus outside the panel (or on the panel itself) means Tab was already
      // escaping, so pull it back in before the browser picks a page-behind node.
      const outside = active_ !== null && !panelRef.current.contains(active_);
      if (event.shiftKey && (active_ === first || active_ === panelRef.current || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active_ === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreTarget?.focus();
    };
  }, [active, onClose, panelRef, initialFocusRef, restoreFocusRef]);
}
