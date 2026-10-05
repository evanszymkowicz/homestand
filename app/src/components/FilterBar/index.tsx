import type { ReactNode } from "react";

const FILTER_ROW = "mb-3 flex flex-wrap gap-2";

/** The `shown/total` count that trails a filter row. */
export function FilterCount({ shown, total }: { shown: number; total: number }) {
  return (
    <span className="self-center text-xs text-ink-faint tabular-nums">
      {shown} / {total}
    </span>
  );
}

export function FilterBar({ children, shown, total }: { children: ReactNode; shown?: number; total?: number }) {
  return (
    <div className={FILTER_ROW}>
      {children}
      {shown != null && total != null ? <FilterCount shown={shown} total={total} /> : null}
    </div>
  );
}
