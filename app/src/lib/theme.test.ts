import { describe, expect, it } from "vitest";
import { nextTheme, parseStoredTheme, resolveTheme } from "./theme";

describe("parseStoredTheme", () => {
  it("accepts explicit light and dark", () => {
    expect(parseStoredTheme("light")).toBe("light");
    expect(parseStoredTheme("dark")).toBe("dark");
  });

  it("falls back to system for null, absent, or garbage values", () => {
    expect(parseStoredTheme(null)).toBe("system");
    expect(parseStoredTheme("purple")).toBe("system");
    expect(parseStoredTheme("")).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("passes explicit themes through regardless of OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("resolves system against the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("nextTheme", () => {
  it("cycles system -> light -> dark -> system", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
});
