import type { ReactNode } from "react";
import { clampTo } from "../../lib/geometry/geometry";
import { mapExtent, SCENARIO_HALF_EXTENT } from "../../lib/guides";
import { galaxyFrame } from "../../lib/shapes/drag";
import {
  FILL_KIND_LABELS,
  FILL_KINDS,
  LATTICE_LABELS,
  LATTICES,
  placeLabel,
} from "../../lib/shapes/shapeCopy";
import { centreOf, SHAPE_KINDS, SHAPE_SPECS, specOf } from "../../lib/shapes/specs";
import type { Fill, GalaxyFrame, Shape, ShapeField, ShapeSettings } from "../../lib/shapes/types";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useShapePreview } from "../../store/shapePreview";
import { COUNT_RANGE, rememberedFor, SHAPE_SIZE_MIN } from "../../store/toolStore.shape";
import {
  SPACING_RANGE,
  SPACING_SLIDER_MAX,
  sliderOfSpacing,
  spacingOfSlider,
  useToolStore,
} from "../../store/toolStore";
import { Glyph } from "../Glyph";
import { DraftNumber, LaneDensityOption, LaneModeSelect, SliderOption } from "./toolFields";
import "./chrome.css";

/** What the Small chip sets, as a fraction of the galaxy's radius. */
const SMALL_FRACTION = 0.1;

/** The number `key` holds in `shape`; the field rows only ask for number keys. */
function readField(shape: Shape, key: ShapeField<Shape>["key"]): number {
  return (shape as unknown as Record<string, number>)[key as string]!;
}

/** The circle a shape's size is measured against: the map's edge, or the scenario square when a document gives none. */
function useGalaxyFrame(): GalaxyFrame {
  const kind = useFileSessionStore((s) => s.kind);
  const radius = useGalaxyStore((s) => s.galaxy?.galaxy_radius ?? 0);
  return galaxyFrame(mapExtent(kind, radius) ?? { shape: "square", half: SCENARIO_HALF_EXTENT });
}

/** A row of buttons of which `value` is the one chosen. */
function Choice<T extends string>({
  label,
  choices,
  value,
  onPick,
}: {
  label: string;
  choices: readonly { value: T; label: ReactNode; title?: string }[];
  value: T;
  onPick(value: T): void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {choices.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          title={c.title}
          onClick={() => onPick(c.value)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function KindPicker({ shape }: { shape: Shape }) {
  const setShapeKind = useToolStore((s) => s.setShapeKind);
  return (
    <Choice
      label="Shape"
      value={shape.kind}
      onPick={setShapeKind}
      choices={SHAPE_KINDS.map((kind) => ({
        value: kind,
        title: SHAPE_SPECS[kind].label,
        label: (
          <Glyph className="shape-glyph">
            <path d={SHAPE_SPECS[kind].glyph} />
          </Glyph>
        ),
      }))}
    />
  );
}

function FillPicker({ settings }: { settings: ShapeSettings }) {
  const setFill = useToolStore((s) => s.setFill);
  const setFillKind = useToolStore((s) => s.setFillKind);
  const fills = specOf(settings.shape).fills(settings.shape);
  const { fill } = settings;
  return (
    <>
      <Choice
        label="Fill"
        value={fill.kind}
        onPick={setFillKind}
        choices={FILL_KINDS.filter((k) => fills.includes(k)).map((k) => ({
          value: k,
          label: FILL_KIND_LABELS[k],
        }))}
      />
      {fill.kind === "grid" && (
        <Choice
          label="Lattice"
          value={fill.lattice}
          onPick={(lattice) => setFill({ ...fill, lattice })}
          choices={LATTICES.map((l) => ({ value: l, label: LATTICE_LABELS[l] }))}
        />
      )}
    </>
  );
}

function SizeOptions({ shape }: { shape: Shape }) {
  const frame = useGalaxyFrame();
  const setShapeSize = useToolStore((s) => s.setShapeSize);
  const size = specOf(shape).size(shape);
  const whole = Math.round(frame.radius);
  const small = Math.max(SHAPE_SIZE_MIN, Math.round(frame.radius * SMALL_FRACTION));
  const percent = Math.round((size / frame.radius) * 100);
  return (
    <>
      <SliderOption
        label="Size"
        range={{ min: SHAPE_SIZE_MIN, max: whole }}
        value={Math.round(size)}
        onChange={setShapeSize}
        field="Shape size in world units"
      />
      <div className="segmented shape-chips" role="group" aria-label="Size presets">
        <button type="button" onClick={() => setShapeSize(small)}>
          Small
        </button>
        <span className="muted">{percent}% of the galaxy</span>
        <button type="button" onClick={() => setShapeSize(whole)}>
          Whole galaxy
        </button>
      </div>
    </>
  );
}

/** One of the kind's number fields, as a slider with a field, or a field alone when folded under Exact values. */
function FieldRow({ shape, field }: { shape: Shape; field: ShapeField<Shape> }) {
  const setShapeField = useToolStore((s) => s.setShapeField);
  const value = readField(shape, field.key);
  const apply = (v: number) =>
    setShapeField(shape.kind, field.key as never, clampTo(v, field.range));
  if (field.exact) {
    return (
      <label className="tool-option">
        {field.label}
        <DraftNumber
          min={field.range.min}
          max={field.range.max}
          step={field.step}
          value={value}
          onApply={apply}
          aria-label={`${field.label} in ${field.unit === "" ? "game units" : field.unit === "°" ? "degrees" : "percent"}`}
        />
        {field.unit !== "" && <span className="muted">{field.unit}</span>}
      </label>
    );
  }
  return (
    <SliderOption
      label={field.label}
      range={field.range}
      step={field.step}
      value={value}
      onChange={apply}
      field={`${field.label} as a number`}
      unit={field.unit}
    />
  );
}

function CountOrSpacing({ fill }: { fill: Fill }) {
  const setFill = useToolStore((s) => s.setFill);
  if (fill.kind === "outline") {
    return (
      <label className="tool-option">
        Systems
        <DraftNumber
          min={COUNT_RANGE.min}
          max={COUNT_RANGE.max}
          step={1}
          value={fill.count}
          onApply={(n) => setFill({ ...fill, count: clampTo(Math.round(n), COUNT_RANGE) })}
          aria-label="Systems along the outline"
        />
      </label>
    );
  }
  // The slider runs close (left) to far (right); the brush's log scale runs the other way.
  return (
    <label className="tool-option">
      Spacing
      <span className="muted">close</span>
      <input
        type="range"
        min={0}
        max={SPACING_SLIDER_MAX}
        value={SPACING_SLIDER_MAX - sliderOfSpacing(fill.spacing)}
        onChange={(e) =>
          setFill({
            ...fill,
            spacing: spacingOfSlider(SPACING_SLIDER_MAX - Number(e.target.value)),
          })
        }
        aria-label="Spacing"
      />
      <span className="muted">far</span>
      <DraftNumber
        min={SPACING_RANGE.min}
        max={SPACING_RANGE.max}
        step={0.1}
        value={fill.spacing}
        onApply={(spacing) => setFill({ ...fill, spacing })}
        aria-label="Spacing between systems in world units"
      />
    </label>
  );
}

function LaneOptions({ settings }: { settings: ShapeSettings }) {
  const setShapeLanes = useToolStore((s) => s.setShapeLanes);
  const { lanes, fill } = settings;
  return (
    <>
      {fill.kind !== "grid" && (
        <label className="tool-option">
          <input
            type="checkbox"
            checked={lanes.follow}
            onChange={(e) => setShapeLanes({ follow: e.target.checked })}
          />
          Follow the shape
        </label>
      )}
      <LaneModeSelect value={lanes.mode} onChange={(mode) => setShapeLanes({ mode })} />
      {lanes.mode !== "off" && <LaneDensityOption />}
    </>
  );
}

/** The centre and the kind's exact fields, folded away until the player wants to type them. */
function ExactValues({ shape }: { shape: Shape }) {
  const moveShape = useToolStore((s) => s.moveShape);
  const settleShape = useToolStore((s) => s.settleShape);
  const centre = centreOf(shape);
  const fields = specOf(shape).fields.filter((f) => f.exact);
  const centreAt = (axis: "x" | "y") => (v: number) => {
    moveShape(shape, { x: axis === "x" ? v - centre.x : 0, y: axis === "y" ? v - centre.y : 0 });
    settleShape();
  };
  return (
    <details className="shape-exact">
      <summary>Exact values</summary>
      <label className="tool-option">
        Centre
        <DraftNumber
          step={1}
          value={Math.round(centre.x * 100) / 100}
          onApply={centreAt("x")}
          aria-label="Centre x in game units"
        />
        <DraftNumber
          step={1}
          value={Math.round(centre.y * 100) / 100}
          onApply={centreAt("y")}
          aria-label="Centre y in game units"
        />
      </label>
      {(fields as readonly ShapeField<Shape>[]).map((f) => (
        <FieldRow key={String(f.key)} shape={shape} field={f} />
      ))}
    </details>
  );
}

function PlaceButton() {
  const preview = useShapePreview();
  const place = useEditorStore((s) => s.placePendingShape);
  return (
    <button
      type="button"
      className="primary"
      disabled={preview === null || preview.points.length === 0}
      onClick={() => void place()}
    >
      {preview === null ? "Place" : placeLabel(preview)}
    </button>
  );
}

/** The kind's number fields the panel's body shows; the rest fold under Exact values. */
function bodyFields(shape: Shape): readonly ShapeField<Shape>[] {
  return (specOf(shape).fields as readonly ShapeField<Shape>[]).filter((f) => !f.exact);
}

/**
 * The Shape tool's options: the shape, its fill, its size and spacing, its lanes and Place. With
 * nothing pending they set what the next shape drawn starts from.
 */
export function ShapeOptions() {
  const pending = useToolStore((s) => s.pendingShape);
  const memory = useToolStore((s) => s.shapeMemory);
  const setSkipNear = useToolStore((s) => s.setSkipNear);
  const shuffle = useToolStore((s) => s.shuffleShape);
  const settings = pending ?? rememberedFor(memory);
  const { shape, fill } = settings;
  return (
    <div className="shape-options">
      <KindPicker shape={shape} />
      <FillPicker settings={settings} />
      {pending && <SizeOptions shape={shape} />}
      {bodyFields(shape).map((f) => (
        <FieldRow key={String(f.key)} shape={shape} field={f} />
      ))}
      <CountOrSpacing fill={fill} />
      <LaneOptions settings={settings} />
      <label className="tool-option">
        <input
          type="checkbox"
          checked={pending?.skipNear ?? memory.skipNear}
          onChange={(e) => setSkipNear(e.target.checked)}
        />
        Don&apos;t place on top of existing systems
      </label>
      {pending && fill.kind === "scattered" && (
        <button type="button" onClick={() => shuffle()}>
          Shuffle
        </button>
      )}
      {pending && <ExactValues shape={shape} />}
      <div className="shape-foot">
        {pending ? (
          <>
            <PlaceButton />
            <span className="muted">Esc drops it</span>
          </>
        ) : (
          <span className="tool-hint muted">Drag on the map to draw a shape</span>
        )}
      </div>
    </div>
  );
}
