import type { ReactNode } from "react";

/** Shared max-height for row-capped Boards: header (~33px) + ten ~37px rows of
 * a standard py-2 text-sm table. Tables inside should make their thead sticky. */
export const TEN_ROWS = "25.5rem";

interface BoardProps {
  title?: string;
  children: ReactNode;
  maxHeight?: string;
}

export function Board({ title, children, maxHeight }: BoardProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      {title && (
        <div className="border-b border-border px-3 py-3">
          <h3 className="text-sm font-bold">{title}</h3>
        </div>
      )}
      <div
        className={`scrollbar-accent overflow-x-auto ${maxHeight ? "overflow-y-auto" : ""}`}
        style={maxHeight ? { maxHeight } : undefined}>
        {children}
      </div>
    </div>
  );
}
