/** Deterministic chip hue per owner — djb2 over the owner id, so the same
 * owner reads as the same color everywhere, forever, without storing anything.
 * Initials carry the identity; the hue is decorative differentiation only. */
export function ownerHue(ownerId: string): number {
  let hash = 5381;
  for (let i = 0; i < ownerId.length; i++) {
    hash = ((hash << 5) + hash + ownerId.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}
