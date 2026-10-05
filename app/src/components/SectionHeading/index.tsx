import type { ElementType, ReactNode } from "react";

interface SectionHeadingProps {
  children: ReactNode;
  /** Heading level for the surrounding document outline — callers nest this
   * under a page h1, sometimes under an h2, so the level isn't fixed here. */
  as?: ElementType;
  className?: string;
}

/** Section/leaderboard title styled like a scorecard column header:
 * an ink underline with a red accent tick, small-caps label feel. */
export function SectionHeading({ children, as: Tag = "h2", className = "" }: SectionHeadingProps) {
  return (
    <Tag
      className={`text-heading inline-flex items-center gap-2 border-b-2 border-ink pb-1 pr-4 font-bold uppercase tracking-wide text-ink ${className}`}>
      <span aria-hidden="true" className="inline-block h-2 w-2 bg-hs-red" />
      {children}
    </Tag>
  );
}
