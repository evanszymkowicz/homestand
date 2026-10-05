import { describe, expect, it } from "vitest";
import { parseEspnSession } from "../../lib/espnSession";

// The user gets these cookies from a signed-in espn.com session. Every client
// library does it the same way, so the parser has to tolerate the shapes real
// copy-paste produces -- which is the whole point: one paste, not two hunts.
describe("parseEspnSession", () => {
  it("reads both values out of a full Cookie header", () => {
    const result = parseEspnSession("Cookie: espn_s2=ABCdef123%3D%3D; SWID={03JFJHW-FWFWF-044G}; other=1; more=2");
    expect(result).toEqual({ espnS2: "ABCdef123%3D%3D", swid: "{03JFJHW-FWFWF-044G}" });
  });

  it("reads a bare pair list with no header label", () => {
    expect(parseEspnSession("espn_s2=xyz; SWID={abc-123}")).toEqual({
      espnS2: "xyz",
      swid: "{abc-123}",
    });
  });

  it("leaves the percent-encoded espn_s2 verbatim", () => {
    const encoded = "AEB%2FQ%3D%3D%2Fw%2Fy%2Bz";
    expect(parseEspnSession(`espn_s2=${encoded}; SWID={x-y}`)?.espnS2).toBe(encoded);
  });

  it("adds the braces ESPN wraps SWID in when the copy omitted them", () => {
    expect(parseEspnSession("espn_s2=a; SWID=03JFJHW-FWFWF-044G")?.swid).toBe("{03JFJHW-FWFWF-044G}");
  });

  it("is case-insensitive on the cookie names", () => {
    expect(parseEspnSession("ESPN_S2=a; Swid={b-c}")?.espnS2).toBe("a");
    expect(parseEspnSession("ESPN_S2=a; Swid={b-c}")?.swid).toBe("{b-c}");
  });

  it("tolerates quotes, ragged whitespace, and a leading space per pair", () => {
    expect(parseEspnSession('espn_s2="quoted";   SWID = {b-c} ')?.swid).toBe("{b-c}");
  });

  it("returns null when either cookie is missing", () => {
    expect(parseEspnSession("espn_s2=only-one")).toBeNull();
    expect(parseEspnSession("SWID={only-one}")).toBeNull();
    expect(parseEspnSession("")).toBeNull();
    expect(parseEspnSession("session=abc; csrf=def")).toBeNull();
  });

  it("does not match a cookie whose name merely ends with ours", () => {
    expect(parseEspnSession("xespn_s2=a; SWID={b}")).toBeNull();
    expect(parseEspnSession("notswid=x; espn_s2=a")).toBeNull();
  });
});
