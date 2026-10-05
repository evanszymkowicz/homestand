import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

/** Click-to-sort state for the Records tables — sorts a copy of `rows` by
 * whichever column key is active, flipping direction on repeat clicks of the
 * same column. */
export function useSortableRows<T, K extends string>(
  rows: T[],
  getValue: (row: T, key: K, direction: SortDirection) => number | string,
  initialKey: K,
  initialDirection: SortDirection = "desc"
) {
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [direction, setDirection] = useState<SortDirection>(initialDirection);

  const sorted = useMemo(() => {
    const sign = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = getValue(a, sortKey, direction);
      const bv = getValue(b, sortKey, direction);
      if (av < bv) return -1 * sign;
      if (av > bv) return 1 * sign;
      return 0;
    });
  }, [rows, sortKey, direction, getValue]);

  function toggleSort(key: K) {
    if (key === sortKey) {
      setDirection(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("desc");
    }
  }

  return { sorted, sortKey, direction, toggleSort };
}
