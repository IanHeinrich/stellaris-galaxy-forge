/**
 * A scenario's geometry adapter: it moves what the scenario's own `effect` block places, its ruins
 * and ambient objects in the shapes the editor writes. The bodies the game rolls stay where they
 * are, and so does what the initializer or a hand-written part of the file places.
 */
import {
  ambientObjectPoint,
  ambientObjectsOf,
  aboutMainStar,
  mainStarPoint,
} from "./ambientObjects";
import { MEGASTRUCTURE_FIXED, megastructureMove } from "./megastructureMoves";
import {
  GEOMETRY_REASONS,
  type GeometryAdapter,
  type GeometryFrame,
  type GeometryIntent,
  type GeometryOp,
  type SceneEditing,
} from "./orbitIntent";
import { near } from "./orbits";
import { layoutPreview, megastructureOp, NOTHING_EDITABLE } from "./saveGeometry";

/** The ruins and ambient objects of the scenario's own block that may be dragged. */
function structureEditing(frame: GeometryFrame): SceneEditing {
  if (frame.details === null) return NOTHING_EDITABLE;
  const movable = ambientObjectsOf(frame.details).flatMap((o) =>
    o.id !== null && o.origin === "editable" && o.place.place === "point" ? [o.id] : [],
  );
  return { ...NOTHING_EDITABLE, megastructures: true, ambientObjects: new Set(movable) };
}

function ruinOp(
  intent: Extract<GeometryIntent, { kind: "moveMegastructure" }>,
  frame: GeometryFrame,
): GeometryOp {
  const row = frame.details?.megastructures.find((m) => m.id === intent.megastructure);
  if (!row) return { refused: GEOMETRY_REASONS.megastructureElsewhere };
  const move = megastructureMove(row, undefined);
  if (move.place === "fixed") return { refused: move.why };
  return megastructureOp(intent, frame);
}

function ambientObjectOp(
  intent: Extract<GeometryIntent, { kind: "moveAmbientObject" }>,
  frame: GeometryFrame,
): GeometryOp {
  const object = ambientObjectsOf(frame.details).find((o) => o.id === intent.ambientObject);
  if (!object || object.id === null) return { refused: GEOMETRY_REASONS.ambientObjectElsewhere };
  if (object.origin === "initializer") return { refused: MEGASTRUCTURE_FIXED.initializer };
  const star = mainStarPoint(frame.layout, frame.details);
  const at = ambientObjectPoint(object, star);
  if (object.origin !== "editable" || at === null) return { refused: MEGASTRUCTURE_FIXED.file };
  if (!(Number.isFinite(intent.x) && Number.isFinite(intent.y))) {
    return { refused: GEOMETRY_REASONS.notANumber };
  }
  if (near(at.x, intent.x) && near(at.y, intent.y)) return null;
  const { x, y } = aboutMainStar(intent, star);
  return { op: { type: "MoveAmbientObject", ambient_object: object.id, x, y } };
}

function structureOp(intent: GeometryIntent, frame: GeometryFrame): GeometryOp {
  switch (intent.kind) {
    case "moveMegastructure":
      return ruinOp(intent, frame);
    case "moveAmbientObject":
      return ambientObjectOp(intent, frame);
    // The bodies, belts and inner radius are the game's to roll, and a scenario has no wormhole.
    case "move":
    case "reparent":
    case "addBelt":
    case "setBeltRadius":
    case "setBeltKind":
    case "removeBelt":
    case "innerRadius":
    case "moveWormhole":
      return null;
  }
}

/** A scenario's own ruins and ambient objects, moved by the ops that edit its `effect` block. */
export const SCENARIO_GEOMETRY: GeometryAdapter = {
  ranges: false,
  editing: structureEditing,
  preview: (intent, frame) =>
    intent.kind === "moveMegastructure" || intent.kind === "moveAmbientObject"
      ? layoutPreview(intent, frame)
      : {},
  op: structureOp,
};
