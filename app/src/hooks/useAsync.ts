/* eslint-disable react-hooks/exhaustive-deps -- this hook forwards a
   caller-supplied deps array for an arbitrary async loader, which the rule
   can't statically verify. */
import { useEffect, useState } from "react";

export type AsyncState<T> =
  { status: "loading" } | { status: "error"; error: unknown } | { status: "success"; data: T };

/** Runs an async loader on mount (and whenever deps change), tracking
 * loading/error/success so routes can render an honest empty/error state
 * instead of nothing. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = [], enabled = true): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ status: "loading" });
    load()
      .then(data => {
        if (!cancelled) setState({ status: "success", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", error });
      });
    return () => {
      cancelled = true;
    };
  }, [...deps, enabled]);

  return state;
}

const EMPTY_ARRAY: readonly unknown[] = [];

/** Selects an array field out of an AsyncState, returning a stable empty
 * array before the data has loaded — so callers can feed the result straight
 * into a useMemo dependency without a hand-rolled empty-array fallback at
 * every call site. */
export function useAsyncList<S, T>(state: AsyncState<S>, select: (data: S) => T[]): T[] {
  return state.status === "success" ? select(state.data) : (EMPTY_ARRAY as T[]);
}
