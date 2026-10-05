import type { ElementType, ReactNode } from "react";

interface SectionHeadingProps {
  children: ReactNode;
  /** Heading level for the surrounding document outline — callers nest this
   * under a page h1, sometimes under an h2, so the level isn't fixed here. */
  as?: ElementType;
  className?: string;
}

/** Section/leaderboard title sitting above a table or card row (e.g. "League
 * Champions", "Career Points Leaderboard"). ink-dim + a left accent bar so it
 * reads as its own headline tier, distinct from the small uppercase-faint
 * labels used for table columns (SortHeader/th) and StatCard labels, without
 * the full-black weight of a page h1. */
export function SectionHeading({ children, as: Tag = "h2", className = "" }: SectionHeadingProps) {
  return (
    <Tag
      className={`text-heading border-l-[3px] border-accent pl-2.5 leading-tight font-semibold text-ink-dim ${className}`}>
      {children}
    </Tag>
  );
}
