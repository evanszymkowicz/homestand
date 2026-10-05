interface PartialCoverageNoteProps {
  failedYears: number[];
}

/** Red note listing years whose box scores failed to load while siblings succeded */
export function PartialCoverageNote({ failedYears }: PartialCoverageNoteProps) {
  if (failedYears.length === 0) return null;
  return (
    <p role="status" className="mb-3 rounded-md border border-red bg-red-soft px-3 py-2 text-xs text-red">
      Box scores unavailable for: {failedYears.join(", ")}. Figures shown cover only the seasons that loaded.
    </p>
  );
}
