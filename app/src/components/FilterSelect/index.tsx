import type { ComponentProps } from "react";

export const FILTER_SELECT = "rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold";

/* Canonical filter/scope dropdown. */
export function FilterSelect({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={className ? `${FILTER_SELECT} ${className}` : FILTER_SELECT} />;
}
