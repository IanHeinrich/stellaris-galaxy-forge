import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PAINT_ORIGIN,
  PAINT_READY,
  PAINT_URL,
  isPaintReadyMessage,
  paintEmbedUrl,
  parsePaintMessage,
} from "./paint";

const galaxy = { source: "paint-a-galaxy", type: "galaxy", version: 1, name: "Spiral", txt: "x" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("paintEmbedUrl", () => {
  it("asks the site for embedded mode and names this app, in the query before any hash", () => {
    const raw = paintEmbedUrl();
    expect(raw).toContain("parentAppName=Stellaris%20Galaxy%20Forge");
    expect(raw).not.toContain("+");
    const url = new URL(raw);
    expect(url.origin).toBe(PAINT_ORIGIN);
    expect(url.origin).toBe(new URL(PAINT_URL).origin);
    expect(url.searchParams.get("embeddedMode")).toBe("true");
    expect(url.searchParams.get("parentAppName")).toBe("Stellaris Galaxy Forge");
    expect(url.hash).toBe("");
  });

  it("takes a local build from VITE_PAINT_URL, and accepts messages from it", async () => {
    vi.stubEnv("VITE_PAINT_URL", "http://localhost:5173/paint/#/editor");
    vi.resetModules();
    const fresh = await import("./paint");
    const raw = fresh.paintEmbedUrl();
    expect(raw).toContain("?embeddedMode=true&parentAppName=Stellaris%20Galaxy%20Forge#/editor");
    const url = new URL(raw);
    expect(url.origin).toBe("http://localhost:5173");
    expect(url.pathname).toBe("/paint/");
    expect(url.searchParams.get("embeddedMode")).toBe("true");
    expect(url.hash).toBe("#/editor");
    expect(fresh.PAINT_ORIGIN).toBe("http://localhost:5173");
    expect(fresh.PAINT_URL).toBe(PAINT_URL);
  });
});

describe("parsePaintMessage", () => {
  it("takes a galaxy message with its name and text", () => {
    expect(parsePaintMessage(galaxy)).toEqual({ name: "Spiral", txt: "x" });
  });

  it("names a galaxy the site left unnamed", () => {
    expect(parsePaintMessage({ ...galaxy, name: undefined })).toEqual({
      name: "Painted galaxy",
      txt: "x",
    });
    expect(parsePaintMessage({ ...galaxy, name: 3 })?.name).toBe("Painted galaxy");
    expect(parsePaintMessage({ ...galaxy, name: "  " })?.name).toBe("Painted galaxy");
  });

  it("refuses anything that is not a galaxy from the site", () => {
    expect(parsePaintMessage(null)).toBeNull();
    expect(parsePaintMessage("galaxy")).toBeNull();
    expect(parsePaintMessage({ ...galaxy, source: "someone-else" })).toBeNull();
    expect(parsePaintMessage({ ...galaxy, type: "ready" })).toBeNull();
    expect(parsePaintMessage({ ...galaxy, txt: "" })).toBeNull();
    expect(parsePaintMessage({ ...galaxy, txt: undefined })).toBeNull();
    expect(parsePaintMessage({ ...galaxy, txt: ["x"] })).toBeNull();
  });
});

describe("the ready handshake", () => {
  it("recognises the site's ready message and nothing else", () => {
    expect(isPaintReadyMessage({ source: "paint-a-galaxy", type: "ready", version: 1 })).toBe(true);
    expect(isPaintReadyMessage(galaxy)).toBe(false);
    expect(isPaintReadyMessage({ source: "x", type: "ready" })).toBe(false);
    expect(isPaintReadyMessage(null)).toBe(false);
  });

  it("answers under this app's own name", () => {
    expect(PAINT_READY).toEqual({ source: "stellaris-galaxy-forge", type: "ready", version: 1 });
  });
});
