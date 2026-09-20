import { describe, expect, it } from "vitest";
import { nextPrefix, parseQuery } from "./query";

describe("palette query", () => {
  it("reads a kind prefix or none", () => {
    expect(parseQuery("ether")).toEqual({ kind: null, text: "ether" });
    expect(parseQuery("e:vex")).toEqual({ kind: "country", text: "vex" });
    expect(parseQuery("P: earth")).toEqual({ kind: "planet", text: "earth" });
    expect(parseQuery("f:")).toEqual({ kind: "fleet", text: "" });
    expect(parseQuery("n:mia")).toEqual({ kind: "nebula", text: "mia" });
    expect(parseQuery("s:sol")).toEqual({ kind: "system", text: "sol" });
    expect(parseQuery("  sol ")).toEqual({ kind: null, text: "sol" });
  });

  it("a colon that is not a prefix stays part of the query", () => {
    expect(parseQuery("x:thing")).toEqual({ kind: null, text: "x:thing" });
  });

  it("Tab keeps the words and cycles the prefix back to everything", () => {
    expect(nextPrefix("sol")).toBe("s:sol");
    expect(nextPrefix("s:sol")).toBe("e:sol");
    expect(nextPrefix("e:sol")).toBe("p:sol");
    expect(nextPrefix("p:sol")).toBe("f:sol");
    expect(nextPrefix("f:sol")).toBe("n:sol");
    expect(nextPrefix("n:sol")).toBe("sol");
  });
});
