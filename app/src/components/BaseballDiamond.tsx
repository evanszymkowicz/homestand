export function BaseballDiamond({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false">
      <title>Baseball diamond</title>
      <path
        d="M12 2l9 9-9 9-9-9 9-9z"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 6.5l4.5 4.5-4.5 4.5-4.5-4.5 4.5-4.5z"
        fill="currentColor"
        fillOpacity="0.25"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="M12 2v4.5M12 17.5V22M3 11h4.5M16.5 11H21"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}
