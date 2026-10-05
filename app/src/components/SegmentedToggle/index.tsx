interface SegmentedToggleOption<T extends string> {
  key: T;
  label: string;
}

interface SegmentedToggleProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedToggleOption<T>[];
  ariaLabel: string;
  /** "sm" reads at the same scale as a subhead caption (e.g. "Click a cell
   * for full history") for toggles that are secondary to a nearby primary
   * one. Defaults to the standard size. */
  size?: "md" | "sm";
}

/** Use this to toggle between Regular Season, Postseason and All Time */
export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "md",
}: SegmentedToggleProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-full border border-border bg-surface-2 p-0.5">
      {options.map(opt => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.key)}
            className={`rounded-full font-semibold whitespace-nowrap transition-colors
              ${size === "sm" ? "px-2 py-0.5 text-[0.64rem]" : "px-3 py-1 text-[0.72rem]"}
              ${active ? "bg-accent text-accent-ink shadow-sm" : "text-ink-faint hover:text-ink"}`}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
