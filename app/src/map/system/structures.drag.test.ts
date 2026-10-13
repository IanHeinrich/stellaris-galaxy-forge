import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/gamedata", () => import("../../test/textures"));

import { polar } from "../../lib/details/orbits";
import { megastructureSummary, megastructureTypeView } from "../../test/builders";
import { sceneRecorder as recorder } from "../../test/mapIntent";
import { systemContext, type SystemContext } from "./context";
import { withStructures } from "./contextFixture";
import { BESIDE, LONE, lastStep, on, orbitFrame, pointOf } from "./dragFixture";
import { stubTextMeasurement } from "./drawFixture";
import { LabelsLayer } from "./layers/LabelsLayer";
import { StructuresLayer } from "./layers/StructuresLayer";
import { SystemGestureModel } from "./SystemGestureModel";

stubTextMeasurement();

const GATEWAY = 40;
const NEXUS = 41;
const types = [
  megastructureTypeView("gateway_final", {
    bypass_type: "gateway",
    placement: { place: "free", outside_gravity_well: true },
  }),
  megastructureTypeView("think_tank_3", { entity: "thinktank_phase_03_entity" }),
];

function frame(): SystemContext {
  return withStructures(
    orbitFrame(),
    [
      megastructureSummary({ id: GATEWAY, kind: "gateway_final", at: [0, 250] }),
      megastructureSummary({ id: NEXUS, kind: "think_tank_3", planet: LONE, at: null }),
    ],
    { types },
  );
}

/** What the layers did over a drag of structure `id` along `path`, each step applied as the scene applies it. */
function drag(id: number, from: { x: number; y: number }, path: [number, number][]) {
  const base = frame();
  const structures = new StructuresLayer();
  const labels = new LabelsLayer();
  structures.rebuild(base);
  labels.rebuild(base);
  const structuresRebuilt = vi.spyOn(structures.container, "removeChildren");
  const labelsRebuilt = vi.spyOn(labels.container, "removeChildren");
  const model = new SystemGestureModel();
  const intent = recorder(base);
  model.handle(
    on("down", from, { target: { kind: "megastructure", id }, draggable: true }),
    intent,
  );
  const held: { modelKey: string | null; on: number | null }[] = [];
  for (const p of path) {
    model.handle(on("move", p), intent);
    const step = lastStep(intent);
    if (!step) continue;
    const ctx = systemContext(base, {
      override: base.geometry.preview(step.intent, base),
      marks: step.marks,
    });
    const s = ctx.structures.find((x) => x.kind === "megastructure" && x.id === id)!;
    held.push({ modelKey: s.modelKey, on: s.on });
    structures.rebuild(ctx);
    labels.rebuild(ctx);
  }
  return {
    base: base.structures.find((x) => x.id === id)!,
    held,
    structuresRebuilt: structuresRebuilt.mock.calls.length,
    labelsRebuilt: labelsRebuilt.mock.calls.length,
  };
}

describe("dragging a megastructure in the system view", () => {
  it("keeps a free one's model while it is held, and rebuilds nothing per move", () => {
    const path: [number, number][] = [];
    for (let i = 1; i <= 60; i++) {
      const p = polar(0, 0, 250, 90 + i * 0.7);
      path.push([p.x, p.y]);
    }
    const r = drag(GATEWAY, { x: 0, y: 250 }, path);
    expect(r.held.length).toBeGreaterThan(50);
    expect(new Set(r.held.map((h) => h.modelKey))).toEqual(new Set([r.base.modelKey]));
    expect(r.structuresRebuilt).toBe(0);
  });

  it("turns a dropped one to face the star from where it stands", () => {
    const base = frame();
    const dropped = withStructures(
      base,
      [megastructureSummary({ id: GATEWAY, kind: "gateway_final", at: [250, 0] })],
      { types },
    );
    const was = base.structures.find((s) => s.id === GATEWAY)!;
    const now = dropped.structures.find((s) => s.id === GATEWAY)!;
    expect(was.modelKey).not.toBeNull();
    expect(now.modelKey).not.toBe(was.modelKey);
  });

  it("keeps a body-tied one's plate to itself while it is swept across other bodies", () => {
    const f = frame();
    const lone = pointOf(f, LONE);
    const beside = pointOf(f, BESIDE);
    const path: [number, number][] = [];
    for (let i = 1; i <= 60; i++) {
      const t = (i % 20) / 20;
      path.push([beside.x - 30 + 60 * t, beside.y]);
    }
    const r = drag(NEXUS, lone, path);
    expect(r.base.on).toBe(LONE);
    expect(r.held.every((h) => h.on === null)).toBe(true);
    expect(r.labelsRebuilt).toBeLessThanOrEqual(1);
  });
});
