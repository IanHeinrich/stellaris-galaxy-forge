import { describe, expect, it } from "vitest";
import { systemLabel } from "./systemLabel";

describe("systemLabel", () => {
  it("names a system and its id", () => {
    expect(systemLabel("Ferragon", 489, false)).toBe("Ferragon #489");
    expect(systemLabel("Alpha Centauri", 1, false)).toBe("Alpha Centauri #1");
  });

  it("falls back to the id when the system has no name", () => {
    expect(systemLabel("", 489, false)).toBe("system #489");
    expect(systemLabel("", 489, true)).toBe("system #489");
  });

  it("falls back to the id while a word of the name still reads as a localisation key", () => {
    expect(systemLabel("HUMAN2 SYS", 12, false)).toBe("system #12");
    expect(systemLabel("Hub_9", 12, false)).toBe("system #12");
    expect(systemLabel("NGC 1234", 12, false)).toBe("system #12");
  });

  it("keeps a name that has been localised or written out, whatever it looks like", () => {
    expect(systemLabel("NGC 1234", 12, true)).toBe("NGC 1234 #12");
  });
});
