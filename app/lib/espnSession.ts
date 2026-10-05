// Parse `espn_s2` and `SWID` out of whatever the user pasted.
//
// ESPN issues no fantasy API keys and there is no OAuth for the v3 fantasy
// endpoints -- every client library (espn-api, ffscrapr, espn-fantasy-baseball)
// authenticates with these two cookies lifted from a signed-in browser. So the
// cookies are unavoidable; the only lever is how few steps the user spends
// getting them. Accepting a whole `Cookie:` header means one copy operation
// instead of locating two separate values in DevTools.
//
// Deliberately dependency-free and DOM-free: imported by both the Worker bundle
// and the app tsconfig.

export interface EspnSession {
  espnS2: string;
  swid: string;
}

/** Matches a single cookie pair in a header. Handles the `SWID={...}` braces,
 * quoted values, and surrounding whitespace. Values are NOT URL-decoded:
 * espn_s2 is percent-encoded by ESPN and must be replayed verbatim. */
const PAIR = /(?:^|;\s*)([A-Za-z0-9_-]+)\s*=\s*("([^"]*)"|[^;]*)/g;

function collect(header: string, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const match of header.matchAll(PAIR)) {
    if (match[1].toLowerCase() !== wanted) continue;
    const raw = match[3] !== undefined ? match[3] : match[2];
    const value = raw.trim();
    if (value) return value;
  }
  return null;
}

/** Extracts both cookies, or null if either is missing.
 *
 * Accepts a full `Cookie:` header, a bare `name=value; name=value` pair list,
 * or a copy from DevTools that has the header name and colon still attached. */
export function parseEspnSession(input: string): EspnSession | null {
  if (!input) return null;
  // A copied header line looks like `Cookie: espn_s2=...`; strip a leading
  // `Cookie:` label so the first pair is not swallowed by it.
  const body = input.replace(/^\s*cookie\s*:\s*/i, "");

  const espnS2 = collect(body, "espn_s2");
  const swid = collect(body, "swid");
  if (!espnS2 || !swid) return null;

  // ESPN presents SWID wrapped in braces. Normalize so downstream replay is
  // consistent whether or not the user's copy included them.
  const normalizedSwid = swid.startsWith("{") && swid.endsWith("}") ? swid : `{${swid}}`;

  return { espnS2, swid: normalizedSwid };
}
