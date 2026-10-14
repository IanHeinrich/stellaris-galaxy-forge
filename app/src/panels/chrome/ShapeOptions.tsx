import type { ReactNode } from "react";
import { clampTo } from "../../lib/geometry/geometry";
import { extentOf, SCENARIO_HALF_EXTENT } from "../../lib/guides";
import { galaxyFrame } from "../../lib/shapes/drag";
import { fillSpacing, hasEdgeRow, leastSpacing } from "../../lib/shapes/placement";
import {
  PLACEMENT_RULES,
  shapePath,
  type PlacementPath,
  type PlacementRules,
} from "../../lib/placement/rules";
import {
  ARRANGE_LANE_CHOICES,
  arrangeLabel,
  arrangeLaneRow,
  FILL_CHOICES,
  fillChoiceLabel,
  fillChoiceOf,
  fillKindOf,
  placeLabel,
} from "../../lib/shapes/shapeCopy";
import { centreOf, SHAPE_KINDS, SHAPE_SPECS, specOf } from "../../lib/shapes/specs";
import type { StarChoice } from "../../lib/shapes/stars";
import type {
  ArrangeLanes,
  GalaxyFrame,
  Shape,
  ShapeField,
  ShapeSettings,
} from "../../lib/shapes/types";
import type { Choice } from "../../lib/toolCopy";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useGeneratorStore, type GeneratorStarClass } from "../../store/generatorStore";
import { SHAPE_NEEDS_GAME_DATA, shapeRefusal, useShapePreview } from "../../store/shapePreview";
import { COUNT_RANGE, rememberedFor, SHAPE_SIZE_MIN } from "../../store/toolStore.shape";
import {
  SPACING_RANGE,
  SPACING_SLIDER_MAX,
  sliderOfSpacing,
  spacingOfSlider,
  useToolStore,
} from "../../store/toolStore";
import { Glyph } from "../Glyph";
import { Select } from "../Select";
import { useGeneratorData } from "../useGeneratorData";
import { DraftNumber, LaneDensityOption, LaneModeSelect, SliderOption } from "./toolFields";
import "./chrome.css";

/** What the Small chip sets, as a fraction of the galaxy's radius. */
const SMALL_FRACTION = 0.1;

/** The number `key` holds in `shape`; the field rows only ask for number keys. */
function readField(shape: Shape, key: ShapeField<Shape>["key"]): number {
  return (shape as unknown as Record<string, number>)[key as string]!;
}

/** The circle a shape's size is measured against: the rules' edge, or the scenario square when a document gives none. */
function useGalaxyFrame(rules: PlacementRules): GalaxyFrame {
  const radius = useGalaxyStore((s) => s.galaxy?.galaxy_radius ?? 0);
  return galaxyFrame(
    extentOf(rules.edge, radius) ?? { shape: "square", half: SCENARIO_HALF_EXTENT },
  );
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
  const setFillChoice = useToolStore((s) => s.setFillChoice);
  const fills = specOf(settings.shape).fills(settings.shape);
  const { fill } = settings;
  return (
    <>
      <Choice
        label="Fill"
        value={fillChoiceOf(fill)}
        onPick={setFillChoice}
        choices={FILL_CHOICES.filter((c) => fills.includes(fillKindOf(c))).map((c) => ({
          value: c,
          label: fillChoiceLabel(c),
        }))}
      />
      {fill.kind === "scattered" && (
        <label className="tool-option">
          <input
            type="checkbox"
            checked={fill.edge}
            onChange={(e) => setFill({ ...fill, edge: e.target.checked })}
          />
          Line the edge with systems
        </label>
      )}
    </>
  );
}

function SizeOptions({ shape, rules }: { shape: Shape; rules: PlacementRules }) {
  const frame = useGalaxyFrame(rules);
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

function CountOrSpacing({ settings, rules }: { settings: ShapeSettings; rules: PlacementRules }) {
  const setFill = useToolStore((s) => s.setFill);
  const symmetry = useToolStore((s) => s.symmetry);
  const { shape, fill } = settings;
  if (fill.kind === "outline") {
    const range = { min: COUNT_RANGE.min, max: rules.cap };
    return (
      <label className="tool-option">
        Systems
        <DraftNumber
          min={range.min}
          max={range.max}
          step={1}
          value={fill.count}
          onApply={(n) => setFill({ ...fill, count: clampTo(Math.round(n), range) })}
          aria-label="Systems along the outline"
        />
      </label>
    );
  }
  const least = leastSpacing(shape, fill, symmetry, rules);
  // Rounded up, so the field never shows a spacing closer than the fill is laid at.
  const used = Math.ceil(fillSpacing(shape, fill, symmetry, rules) * 10) / 10;
  // The slider runs close (left) to far (right); the brush's log scale runs the other way.
  return (
    <label className="tool-option">
      Spacing
      <span className="muted">close</span>
      <input
        type="range"
        min={SPACING_SLIDER_MAX - sliderOfSpacing(least)}
        max={SPACING_SLIDER_MAX}
        value={SPACING_SLIDER_MAX - sliderOfSpacing(used)}
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
        min={Math.ceil(least * 10) / 10}
        max={SPACING_RANGE.max}
        step={0.1}
        value={used}
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
      {hasEdgeRow(fill) && (
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

/** Arrange's lane choice about the lanes between the selected systems, and under Rebuild how new ones are laid. */
function ArrangeLaneOptions({
  settings,
  lanes,
  alsoOuter,
}: {
  settings: ShapeSettings;
  lanes: ArrangeLanes;
  alsoOuter: boolean;
}) {
  const setArrangeLanes = useToolStore((s) => s.setArrangeLanes);
  const setArrangeAlsoOuter = useToolStore((s) => s.setArrangeAlsoOuter);
  return (
    <>
      <span className="tool-option">Lanes</span>
      <Choice
        label="Lanes between the selected systems"
        value={lanes}
        onPick={setArrangeLanes}
        choices={ARRANGE_LANE_CHOICES.map((c) => ({ value: c, ...arrangeLaneRow(c) }))}
      />
      {lanes === "rebuild" && <LaneOptions settings={settings} />}
      {lanes !== "keep" && (
        <label className="tool-option">
          <input
            type="checkbox"
            checked={alsoOuter}
            onChange={(e) => setArrangeAlsoOuter(e.target.checked)}
          />
          Also remove lanes to other systems
        </label>
      )}
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

/** What the Stars drop-down's value starts with for one star class, before the class's key. */
const ONE_PREFIX = "one:";

/**
 * The Stars drop-down's choices, each with the stars it sets. One class the game data lacks,
 * as one remembered from another install, is listed as chosen so the drop-down shows it.
 */
function starOptions(
  classes: readonly GeneratorStarClass[],
  stars: StarChoice,
): Array<Choice<string> & { stars: StarChoice }> {
  const lacked = stars.kind === "one" && !classes.some((c) => c.key === stars.class) ? stars : null;
  const ticked =
    stars.kind === "mix"
      ? stars.classes
      : stars.kind === "one" && lacked === null
        ? [stars.class]
        : classes.filter((c) => c.randomOdds > 0).map((c) => c.key);
  return [
    { value: "random", label: "Random", stars: { kind: "random" } },
    ...classes.map((c) => ({
      value: ONE_PREFIX + c.key,
      label: c.label,
      stars: { kind: "one", class: c.key } as const,
    })),
    ...(lacked
      ? [
          {
            value: ONE_PREFIX + lacked.class,
            label: `${lacked.class} (not in the game data)`,
            stars: lacked,
          },
        ]
      : []),
    { value: "mix", label: "A mix…", stars: { kind: "mix", classes: ticked } },
  ];
}

/**
 * Which stars a save's shape rolls: the game's usual mix, one class for all, or a mix of the
 * ticked classes. Shown once the generator's classes are read.
 */
function StarsRow({ stars }: { stars: StarChoice }) {
  useGeneratorData();
  const classes = useGeneratorStore((s) => s.starClasses);
  const setShapeStars = useToolStore((s) => s.setShapeStars);
  if (classes === null) return null;
  const options = starOptions(classes, stars);
  const value = stars.kind === "one" ? ONE_PREFIX + stars.class : stars.kind;
  return (
    <>
      <label className="tool-option">
        Stars
        <Select
          value={value}
          choices={options}
          label="Stars"
          onChange={(v) => {
            const picked = options.find((o) => o.value === v);
            if (picked) setShapeStars(picked.stars);
          }}
        />
      </label>
      {stars.kind === "mix" &&
        classes.map((c) => {
          const on = stars.classes.includes(c.key);
          return (
            <label key={c.key} className="tool-option">
              <input
                type="checkbox"
                checked={on}
                disabled={on && stars.classes.length === 1}
                onChange={(e) =>
                  setShapeStars({
                    kind: "mix",
                    classes: e.target.checked
                      ? [...stars.classes, c.key]
                      : stars.classes.filter((k) => k !== c.key),
                  })
                }
              />
              {c.label}
            </label>
          );
        })}
    </>
  );
}

function PlaceButton({ path }: { path: PlacementPath }) {
  const preview = useShapePreview();
  const gameData = useGameDataStore((s) => s.status === "ready");
  const place = useEditorStore((s) => s.placePendingShape);
  const refusal = preview && shapeRefusal(preview, path);
  // With game data loaded, the star classes are only a moment away.
  const reason = refusal === SHAPE_NEEDS_GAME_DATA && gameData ? null : refusal;
  const label =
    preview === null
      ? "Place"
      : preview.arranged
        ? arrangeLabel(preview.arranged.count)
        : placeLabel(preview);
  return (
    <>
      <button
        type="button"
        className="primary"
        disabled={preview === null || preview.points.length === 0 || refusal !== null}
        title={reason ?? undefined}
        onClick={() => void place()}
      >
        {label}
      </button>
      {reason && <span className="tool-hint warn">{reason}</span>}
    </>
  );
}

/** The kind's number fields the panel's body shows; the rest fold under Exact values. */
function bodyFields(shape: Shape): readonly ShapeField<Shape>[] {
  return (specOf(shape).fields as readonly ShapeField<Shape>[]).filter((f) => !f.exact);
}

/**
 * The Shape tool's options: the shape, its fill, its size and spacing, its lanes and Place. With
 * nothing pending they set what the next shape drawn starts from. Arranging, the count is the
 * selection's and the lanes row is about the selection's own lanes.
 */
export function ShapeOptions() {
  const pending = useToolStore((s) => s.pendingShape);
  const memory = useToolStore((s) => s.shapeMemory);
  const setSkipNear = useToolStore((s) => s.setSkipNear);
  const shuffle = useToolStore((s) => s.shuffleShape);
  const path = useFileSessionStore((s) => shapePath(s.capabilities));
  if (path === null) return null;
  const rules = PLACEMENT_RULES[path];
  const settings = pending ?? rememberedFor(memory);
  const { shape, fill } = settings;
  const arranging = pending?.purpose.kind === "arrange" ? pending.purpose : null;
  return (
    <div className="shape-options">
      <KindPicker shape={shape} />
      <FillPicker settings={settings} />
      {pending && <SizeOptions shape={shape} rules={rules} />}
      {bodyFields(shape).map((f) => (
        <FieldRow key={String(f.key)} shape={shape} field={f} />
      ))}
      {arranging ? (
        <label className="tool-option">
          Systems
          <span className="muted">{arranging.ids.length} selected</span>
        </label>
      ) : (
        <CountOrSpacing settings={settings} rules={rules} />
      )}
      {path === "rolled" && !arranging && <StarsRow stars={pending?.stars ?? memory.stars} />}
      {arranging ? (
        <ArrangeLaneOptions
          settings={settings}
          lanes={arranging.lanes}
          alsoOuter={arranging.alsoOuter}
        />
      ) : (
        <>
          <LaneOptions settings={settings} />
          <label className="tool-option">
            <input
              type="checkbox"
              checked={pending?.skipNear ?? memory.skipNear}
              onChange={(e) => setSkipNear(e.target.checked)}
            />
            Don&apos;t place on top of existing systems
          </label>
        </>
      )}
      {pending && fill.kind === "scattered" && (
        <button type="button" onClick={() => shuffle()}>
          Shuffle
        </button>
      )}
      {pending && <ExactValues shape={shape} />}
      <div className="shape-foot">
        {pending ? (
          <>
            <PlaceButton path={path} />
            <span className="muted">{arranging ? "Esc moves nothing" : "Esc drops it"}</span>
          </>
        ) : (
          <span className="tool-hint muted">Drag on the map to draw a shape</span>
        )}
      </div>
    </div>
  );
}
