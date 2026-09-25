import { describe, expect, it } from "vitest";
import type { FeLinkFlags } from "../generated/FeLinkFlags";
import type { SystemNode } from "../generated/SystemNode";
import { byId, systemNode } from "../test/builders";
import { newFeZone } from "./feZone";
import {
  isLinked,
  linkChange,
  linkedAnchors,
  linkedTo,
  linkRefusal,
  linkSegment,
  linkSelectedLabel,
  linkToZoneLabel,
  takesCustomLinks,
  toRing,
  unlinkRefusal,
} from "./feLinks";

const flags = (over: Partial<FeLinkFlags>): FeLinkFlags => ({
  custom: false,
  id: null,
  to: [],
  ...over,
});

/** An anchor at (x, 0) whose zone takes custom connections under `id`, or none when null. */
const anchor = (id: number, linkId: number | null, x = 0) =>
  systemNode({
    id,
    x,
    fe_zone: newFeZone("e"),
    fe_link: linkId === null ? flags({}) : flags({ custom: true, id: linkId }),
  });

const linked = (id: number, ...to: number[]) => systemNode({ id, fe_link: flags({ to }) });

const name = (s: SystemNode) => `S${s.id}`;

describe("custom connections", () => {
  it("takesCustomLinks needs the flag, an id and a zone together", () => {
    expect(takesCustomLinks(anchor(1, 4))).toBe(true);
    expect(takesCustomLinks(anchor(1, null))).toBe(false);
    expect(takesCustomLinks({ ...anchor(1, 4), fe_zone: null })).toBe(false);
    expect(takesCustomLinks(systemNode({ fe_link: flags({ custom: true }) }))).toBe(false);
  });

  it("linkedTo lists the systems whose links hold the anchor's id, ascending, never the anchor", () => {
    const a = { ...anchor(1, 4), fe_link: flags({ custom: true, id: 4, to: [4] }) };
    const all = byId(a, linked(9, 4), linked(3, 4, 7), linked(5, 7));
    expect(linkedTo(a, all).map((s) => s.id)).toEqual([3, 9]);
    expect(linkedTo(anchor(1, null), all)).toEqual([]);
  });

  it("linkedAnchors finds every taker of each id a system links to, in id order", () => {
    const first = anchor(1, 4);
    const second = anchor(2, 7);
    const twin = anchor(3, 7);
    const dangling = { ...anchor(8, 9), fe_zone: null };
    const all = byId(first, second, twin, dangling, linked(5, 9, 7, 4));
    expect(linkedAnchors(linked(5, 9, 7, 4), all).map((s) => s.id)).toEqual([2, 3, 1]);
    expect(linkedAnchors(linked(5), all)).toEqual([]);
  });

  it("linkRefusal names an anchor without a zone, the anchor itself and a system already linked", () => {
    const a = anchor(1, 4);
    expect(linkRefusal({ ...a, fe_zone: null }, linked(5), name)).toBe(
      "S1 anchors no fallen empire zone",
    );
    expect(linkRefusal(a, a, name)).toBe("S1 cannot link to its own zone");
    expect(linkRefusal(a, linked(5, 4), name)).toBe(
      "S5 is already linked to S1's fallen empire zone",
    );
    expect(linkRefusal(a, linked(5), name)).toBeNull();
    expect(linkRefusal(anchor(1, null), linked(5), name)).toBeNull();
  });

  it("unlinkRefusal refuses a system that is not linked", () => {
    const a = anchor(1, 4);
    expect(unlinkRefusal(a, linked(5), name)).toBe("S5 is not linked to S1's fallen empire zone");
    expect(unlinkRefusal(a, linked(5, 4), name)).toBeNull();
    expect(isLinked(a, linked(5, 4))).toBe(true);
  });

  it("linkChange offers a link, an unlink, or nothing for the anchor itself and a system without a zone", () => {
    const a = anchor(1, 4);
    expect(linkChange(a, linked(5))).toBe("link");
    expect(linkChange(a, linked(5, 4))).toBe("unlink");
    expect(linkChange(a, a)).toBeNull();
    expect(linkChange({ ...a, fe_zone: null }, linked(5))).toBeNull();
    expect(linkChange(anchor(1, null), linked(5))).toBe("link");
  });

  it("draws a link from the system to the nearest point of the ring, and none from inside it", () => {
    expect(toRing({ x: 100, y: 0 }, { x: 0, y: 0 })).toEqual({
      a: { x: 100, y: 0 },
      b: { x: 30, y: 0 },
    });
    expect(toRing({ x: 0, y: -50 }, { x: 0, y: 0 })).toEqual({
      a: { x: 0, y: -50 },
      b: { x: 0, y: -30 },
    });
    expect(toRing({ x: 20, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(toRing({ x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(linkSegment(anchor(1, 4), linked(5))).toEqual({
      a: { x: 0, y: 0 },
      b: { x: -10, y: 0 },
    });
    expect(linkSegment({ ...anchor(1, 4), fe_zone: null }, linked(5))).toBeNull();
  });

  it("words the two menus' items after the anchor and after the selected system", () => {
    expect(linkToZoneLabel("link", "Sol")).toBe("Link to Sol's fallen empire zone");
    expect(linkToZoneLabel("unlink", "Sol")).toBe("Unlink from Sol's fallen empire zone");
    expect(linkSelectedLabel("link", "Vega")).toBe("Link Vega to this zone");
    expect(linkSelectedLabel("unlink", "Vega")).toBe("Unlink Vega from this zone");
  });
});
