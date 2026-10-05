interface ActivityButtonProps {
  onClick: () => void;
}

/** Header button that opens the activity drawer. The unread-count badge is
 * deliberately deferred (spec marks it optional). */
export function ActivityButton({ onClick }: ActivityButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open activity log"
      className="flex h-9 w-9 items-center justify-center rounded-md text-ink-faint hover:text-ink [&_svg]:h-[18px] [&_svg]:w-[18px]">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>
  );
}
