import { useEffect, useRef, useState, type ReactNode } from "react";

interface TickerTextProps {
  text?: string;
  children?: ReactNode;
  className?: string;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Truncates with an ellipsis like a plain `truncate` span, but only when the
 * content actually overflows its container: hovering then slides the full
 * content into view like a marquee instead of leaving it cut off. */
export function TickerText({ text, children, className = "" }: TickerTextProps) {
  const reduceMotion = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  // Set on pointerdown so click handling knows what drove it without relying
  // on the click event itself being a PointerEvent (some engines synthesize
  // taps as plain MouseEvents).
  const lastPointerTypeRef = useRef("");
  const [overflowPx, setOverflowPx] = useState(0);
  // Captured at measure time so `title` reads state instead of dereferencing
  // textRef during render.
  const [fullText, setFullText] = useState("");
  const [hovering, setHovering] = useState(false);
  // Click/tap toggle, so touch users can reveal truncated content too
  // (hover and focus only cover mouse and keyboard).
  const [pinned, setPinned] = useState(false);
  const content = children ?? text;

  useEffect(() => {
    if (reduceMotion) return;
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;
    let lastWidth = container.clientWidth;
    const measure = () => {
      setPinned(false);
      setOverflowPx(Math.max(0, textEl.scrollWidth - container.clientWidth));
      if (textEl.textContent) setFullText(textEl.textContent);
    };
    measure();
    // Re-measure on horizontal resizes only: height-only changes come from
    // our own layout (or a sibling's) and re-entering measure from them can
    // feed back into the marquee state.
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined || width === lastWidth) return;
      lastWidth = width;
      measure();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [content, reduceMotion]);

  if (reduceMotion) {
    // No forced motion: show the full value statically, wrapped — never the
    // truncation/marquee machinery at all.
    return (
      <div className={`overflow-hidden ${className}`}>
        <span className="block whitespace-normal break-words">{content}</span>
      </div>
    );
  }

  const isOverflowing = overflowPx > 0;
  const active = isOverflowing && (hovering || pinned);
  // ~30px/sec of travel, floored so a barely-clipped name doesn't flash by.
  const durationSec = Math.max(2.5, 2 + overflowPx / 30);

  return (
    <div
      ref={containerRef}
      title={isOverflowing ? fullText : undefined}
      // Keyboard users get the marquee too: the container is only tabbable
      // when it overflows. Screen readers read the span's DOM text either
      // way — CSS clipping never removes content from the accessibility tree.
      tabIndex={isOverflowing ? 0 : undefined}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
      onPointerDown={e => {
        lastPointerTypeRef.current = e.pointerType;
      }}
      onClick={e => {
        // Usually mounts inside a Link (honor cards, champions strip). Touch
        // has no hover, so a tap is the only reveal path — absorb the first
        // tap (pin) instead of navigating away; once revealed, taps pass
        // through to the link again. Mouse clicks navigate directly, and
        // keyboard activation reveals via focus before Enter arrives.
        const viaTouch = lastPointerTypeRef.current === "touch";
        lastPointerTypeRef.current = "";
        if (!isOverflowing || !viaTouch || pinned) return;
        e.stopPropagation();
        e.preventDefault();
        setPinned(true);
      }}
      className={`overflow-hidden ${className}`}>
      <span
        ref={textRef}
        className={active ? "inline-block whitespace-nowrap ticker-scrolling" : "block truncate"}
        style={
          active
            ? ({
                "--ticker-distance": `${overflowPx}px`,
                "--ticker-duration": `${durationSec}s`,
              } as React.CSSProperties)
            : undefined
        }>
        {content}
      </span>
    </div>
  );
}
