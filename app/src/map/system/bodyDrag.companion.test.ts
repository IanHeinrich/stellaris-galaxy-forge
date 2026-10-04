import { describe, expect, it } from "vitest";
import { DRAG_HINTS, toStarHint } from "../../lib/details/orbitIntent";
import { polar } from "../../lib/details/orbits";
import { SAVE_GEOMETRY } from "../../lib/details/saveGeometry";
import { orbitClasses, orbitSystem, saveBody } from "../../test/builders";
import { sceneRecorder as recorder } from "../../test/mapIntent";
import type { DragStep } from "./bodyDrag";
import { systemContext, type SystemContext } from "./context";
import {
  around,
  grab,
  lastStep,
  LONE,
  named,
  on,
  ORBITS,
  outward,
  PLANET,
  STAR,
} from "./dragFixture";
import { drawnDisc } from "./geometry";
import { NO_SOURCES } from "./sources";
import { SystemGestureModel } from "./SystemGestureModel";

describe("a body dragged onto a companion star", () => {
  const COMPANION = 8;
  const ITS_PLANET = 9;
  const ITS_MOON = 10;
  const NEXT_PLANET = 11;
  const star = { x: -240, y: 0 };
  const itsPlanet = { x: -224, y: 0 };

  /**
   * `orbitFrame` with star 8 at 240 out on the left, and planet 9 orbiting it at 16; with `moons`,
   * also moon 10 orbiting planet 9 at 8, and planet 11 orbiting the star at 30 and 270°.
   */
  function binaryFrame(moons = false): SystemContext {
    const details = orbitSystem();
    const companion = saveBody(COMPANION, "pc_g_star", [-240, 0], 240, 20);
    const itsPlanet = saveBody(ITS_PLANET, "pc_arid", [-224, 0], 16, 10, COMPANION);
    const extra = moons
      ? [
          saveBody(ITS_MOON, "pc_barren", [-224, 8], 8, 5, ITS_PLANET),
          saveBody(NEXT_PLANET, "pc_arid", [-240, -30], 30, 10, COMPANION),
        ]
      : [];
    const planets = [...details.planets, companion, itsPlanet, ...extra].map((p) => ({
      ...p,
      name_key: `NAME_P${p.id}`,
    }));
    return systemContext({
      ...NO_SOURCES,
      id: ORBITS,
      details: { ...details, planets },
      planetClasses: orbitClasses(),
      geometry: SAVE_GEOMETRY,
    });
  }

  /** The least orbit about the companion: just past its drawn disc at one pixel a unit. */
  function starFloor(frame: SystemContext): number {
    const disc = frame.layout.bodies.find((b) => b.id === COMPANION)!.disc;
    return Math.max(10, Math.ceil(drawnDisc(disc, 1) + 5));
  }

  it("makes a planet with moons orbit it at the pointer's distance, never inside the star's disc", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame());
    grab(model, intent, PLANET, around(30));
    model.handle(on("move", polar(star.x, star.y, 33.4, 90)), intent);
    expect(lastStep(intent)?.readout).toEqual({ text: "orbits P8 · orbit 33 · 90°" });
    model.handle(on("move", polar(star.x, star.y, 2, 90)), intent);
    const floor = starFloor(intent.frame());
    const step = lastStep(intent);
    expect(step?.intent).toEqual({
      kind: "reparent",
      system: ORBITS,
      body: PLANET,
      parent: COMPANION,
      radius: floor,
      angle: 90,
    });
    expect(step?.marks.host).toBe(COMPANION);
    expect(step?.readout).toEqual({ text: `orbits P8 · orbit ${floor} · 90°` });
    expect(step?.hint).toBe(toStarHint("P8"));
    expect(step?.refused).toBeUndefined();
    model.handle(on("up", polar(star.x, star.y, 2, 90)), intent);
    expect(named(intent.calls, "commit")).toEqual([["commit", step?.intent]]);
  });

  it("puts it on one of the star's orbits within a few pixels of it", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame());
    grab(model, intent, PLANET, around(30));
    model.handle(on("move", polar(star.x, star.y, 20, 90)), intent);
    const step = lastStep(intent);
    expect(step?.intent).toMatchObject({ parent: COMPANION, radius: 16, angle: 90 });
    expect(step?.marks).toMatchObject({ tone: "shared", other: ITS_PLANET, host: COMPANION });
    expect(step?.readout.text).toBe("orbits P8 · orbit 16 · shared with P9");
  });

  it("takes a planet within 40 units of the star, and not beyond", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame());
    grab(model, intent, LONE, around(120));
    model.handle(on("move", polar(star.x, star.y, 40.5, 180), { scale: 1 }), intent);
    expect(lastStep(intent)?.marks.host).toBeNull();
    model.handle(on("move", polar(star.x, star.y, 39.5, 180), { scale: 1 }), intent);
    expect(lastStep(intent)?.marks.host).toBe(COMPANION);
    expect(lastStep(intent)?.intent).toMatchObject({ parent: COMPANION, radius: 40 });
  });

  it("keeps a moon about its planet beside the star until it is past its detach distance", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame(true));
    grab(model, intent, ITS_MOON, around(90));
    model.handle(on("move", polar(itsPlanet.x, itsPlanet.y, 8, 180)), intent);
    const round = lastStep(intent);
    expect(round?.intent).toEqual({
      kind: "move",
      system: ORBITS,
      body: ITS_MOON,
      radius: 8,
      angle: 180,
    });
    expect(round?.marks.host).toBeNull();
    model.handle(on("move", polar(star.x, star.y, 38, 180)), intent);
    const away = lastStep(intent);
    expect(away?.intent).toMatchObject({
      kind: "reparent",
      parent: COMPANION,
      radius: 38,
      angle: 180,
    });
    expect(away?.marks.host).toBe(COMPANION);
    expect(away?.readout.text).toBe("orbits P8 · orbit 38 · 180°");
  });

  it("makes a moon a moon of a neighbouring planet nearer its own planet than its detach distance", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame(true));
    grab(model, intent, ITS_MOON, around(90));
    model.handle(on("move", { x: -240, y: -12 }), intent);
    const step = lastStep(intent);
    expect(step?.intent).toEqual({
      kind: "reparent",
      system: ORBITS,
      body: ITS_MOON,
      parent: NEXT_PLANET,
      radius: 15,
      angle: 90,
    });
    expect(step?.marks.host).toBe(NEXT_PLANET);
    expect(step?.readout.text).toBe("moon of P11 · orbit 15 · 90°");
  });

  it("with Ctrl, keeps a moon about its planet over a neighbouring planet and over the star, and a planet off the star", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame(true));
    grab(model, intent, ITS_MOON, outward(90));
    model.handle(on("move", { x: -240, y: -12 }, { ctrl: true }), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ kind: "move", body: ITS_MOON });
    expect(lastStep(intent)?.marks.host).toBeNull();
    model.handle(on("move", polar(star.x, star.y, 38, 180), { ctrl: true }), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ kind: "move", body: ITS_MOON, angle: 90 });
    expect(lastStep(intent)?.marks.host).toBeNull();
    model.handle(on("up", polar(star.x, star.y, 38, 180), { ctrl: true }), intent);
    expect(named(intent.calls, "commit")[0]?.[1]).toMatchObject({ kind: "move", body: ITS_MOON });

    grab(model, intent, LONE, around(120), { ctrl: true });
    model.handle(on("move", polar(star.x, star.y, 39.5, 180), { ctrl: true }), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ kind: "move", body: LONE, radius: 100 });
    expect(lastStep(intent)?.marks.host).toBeNull();
  });

  it("keeps a locked moon about its planet over another planet, over the star and past its detach distance", () => {
    const model = new SystemGestureModel();
    const intent = recorder({ ...binaryFrame(true), lockedBodies: new Set([ITS_MOON]) });
    grab(model, intent, ITS_MOON, around(90));
    const aboutItsPlanet = (step: DragStep | null) => {
      expect(step?.intent).toMatchObject({ kind: "move", body: ITS_MOON });
      expect(step?.marks.host).toBeNull();
      expect(step?.readout.text).toMatch(/^locked to P9 · /);
      expect(step?.hint).toBe(`locked to P9 · ${DRAG_HINTS.free}`);
    };
    model.handle(on("move", { x: -240, y: -12 }), intent);
    aboutItsPlanet(lastStep(intent));
    expect(lastStep(intent)?.intent).toMatchObject({ radius: 20 });
    model.handle(on("move", polar(star.x, star.y, 38, 180)), intent);
    aboutItsPlanet(lastStep(intent));
    model.handle(on("move", { x: 0, y: 3 }), intent);
    aboutItsPlanet(lastStep(intent));
    expect(lastStep(intent)?.intent).toMatchObject({ radius: 224 });
    model.handle(on("up", { x: 0, y: 3 }), intent);
    expect(named(intent.calls, "commit")[0]?.[1]).toMatchObject({ kind: "move", body: ITS_MOON });
  });

  it("keeps a locked planet about the companion star when dropped on the centre's star", () => {
    const model = new SystemGestureModel();
    const intent = recorder({ ...binaryFrame(), lockedBodies: new Set([ITS_PLANET]) });
    grab(model, intent, ITS_PLANET, outward(0));
    model.handle(on("move", { x: 0, y: 3 }), intent);
    const step = lastStep(intent);
    expect(step?.intent).toMatchObject({ kind: "move", body: ITS_PLANET, radius: 240 });
    expect(step?.marks.host).toBeNull();
    expect(step?.readout.text).toMatch(/^locked to P8 · orbit 16 → 240 · \d+°$/);
  });

  it("makes its planet a planet of the centre past twice its outermost orbit", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame());
    grab(model, intent, ITS_PLANET, outward(0));
    model.handle(on("move", { x: -224, y: 30 }), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ kind: "move", body: ITS_PLANET });
    model.handle(on("move", { x: -200, y: 60 }), intent);
    const step = lastStep(intent);
    expect(step?.intent).toMatchObject({ kind: "reparent", body: ITS_PLANET, parent: null });
    expect(step?.hint).toBe(DRAG_HINTS.toPlanet);
    expect(step?.readout.text).toMatch(/^planet · orbit \d+ · \d+°$/);
  });

  it("makes its planet a planet of the centre where it stands when dropped on the centre's star", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame());
    grab(model, intent, ITS_PLANET, outward(0));
    model.handle(on("move", { x: 0, y: 3 }), intent);
    const step = lastStep(intent);
    expect(step?.intent).toEqual({
      kind: "reparent",
      system: ORBITS,
      body: ITS_PLANET,
      parent: null,
      radius: 224,
      angle: 180,
    });
    expect(step?.marks.host).toBe(STAR);
    expect(step?.readout.text).toBe("orbits P1 · orbit 224 · 180°");
    expect(step?.hint).toBe(DRAG_HINTS.toPlanet);
  });
});
