/** Return the first `n` items of `arr` after sorting by a numeric key.
 *  `key` may return a tuple for lexicographic tie-breaking. */
export function topN<T>(
  arr: readonly T[],
  n: number,
  key: (item: T) => number | number[],
  direction: "asc" | "desc" = "desc"
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...arr]
    .sort((a, b) => {
      const ak = key(a);
      const bk = key(b);
      const aKeys = typeof ak === "number" ? [ak] : ak;
      const bKeys = typeof bk === "number" ? [bk] : bk;
      const len = Math.min(aKeys.length, bKeys.length);
      for (let i = 0; i < len; i++) {
        if (aKeys[i] < bKeys[i]) return -1 * sign;
        if (aKeys[i] > bKeys[i]) return 1 * sign;
      }
      return 0;
    })
    .slice(0, n);
}
