interface RouteLoadingProps {
  label: string;
}

/** Top-level route loading state. Reserves roughly the vertical space a
 * loaded page occupies (nav tabs + a card/table section) so the "Loading…"
 * text doesn't cause the whole page to jump down once data resolves —
 * every top-level route used its own bare `<p>` before this, each a
 * different (and shorter-than-final) height. */
export function RouteLoading({ label }: RouteLoadingProps) {
  return (
    <div className="flex min-h-[50vh] items-start justify-start pt-2" role="status" aria-live="polite">
      <p className="text-ink-dim">{label}</p>
    </div>
  );
}
