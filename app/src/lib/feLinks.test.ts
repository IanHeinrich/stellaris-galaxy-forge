import { describe, expect, it } from "vitest";
import type { FeLinkFlags } from "../generated/FeLinkFlags";
import type { SystemNode } from "../generated/SystemNode";
import { byId, systemNode } from "../test/builders";
import { newFeZone } from "./feZone";
import {
  linkChange,
  linkedAnchors,
  linkedTo,
  linkRefusal,
  linkSegment,
  takesCustomLinks,
  toRing,
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

  it("linkRefusal lets a system link to an anchor whether or not its zone takes links yet", () => {
    expect(linkRefusal(anchor(1, 4), linked(5), name)).toBeNull();
    expect(linkRefusal(anchor(1, null), linked(5), name)).toBeNull();
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
});
