import { SegmentedToggle } from "../SegmentedToggle";

export type OwnerScope = "current" | "all";

interface OwnerScopeToggleProps {
  value: OwnerScope;
  onChange: (value: OwnerScope) => void;
}

const OPTIONS: { key: OwnerScope; label: string }[] = [
  { key: "current", label: "Active" },
  { key: "all", label: "All-Time" },
];

export function OwnerScopeToggle({ value, onChange }: OwnerScopeToggleProps) {
  return <SegmentedToggle ariaLabel="Owner scope" value={value} onChange={onChange} options={OPTIONS} />;
}
