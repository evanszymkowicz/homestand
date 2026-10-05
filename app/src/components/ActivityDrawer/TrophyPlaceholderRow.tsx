import { EventRow } from "./EventRow";

export function TrophyPlaceholderRow() {
  return (
    <div
      title="ESPN trophies pending — the capture is live, but ESPN's API doesn't serve earned trophies yet"
      aria-disabled="true"
      className="opacity-45">
      <EventRow
        kind="trophy"
        title={<span className="italic">ESPN'S Achievement Trophies</span>}
        meta="Captured daily; rows appear with the first earned trophy"
      />
    </div>
  );
}
