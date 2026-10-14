import { useId, type ComponentType, type ReactNode } from "react";
import { clampTo } from "../../lib/geometry/geometry";
import type { Symmetry } from "../../lib/geometry/symmetry";
import { extentOf, reachOf, SCENARIO_HALF_EXTENT, type MapExtent } from "../../lib/guides";
import { galaxyFrame } from "../../lib/shapes/drag";
import { fillSpacing, hasEdgeRow, leastSpacing } from "../../lib/shapes/placement";
import {
  PLACEMENT_RULES,
  shapePath,
  type PlacementPath,
  type PlacementRules,
} from "../../lib/placement/rules";
import {
  ARRANGE_HINT,
  ARRANGE_LANE_CHOICES,
  arrangeLabel,
  arrangeLaneRow,
  FILL_CHOICES,
  fillChoiceHint,
  fillChoiceLabel,
  fillChoiceOf,
  fillKindOf,
  MIX_CLASS_HINT,
  PLACE_HINT,
  placeLabel,
  SHAPE_OPTIONS,
  SHAPE_SECTION_HEADINGS,
  SHAPE_SECTIONS,
  type ShapeSection,
} from "../../lib/shapes/shapeCopy";
import {
  appliedExtras,
  EXTRA_KEYS,
  EXTRA_ROWS,
  extraApplies,
  takesCentre,
} from "../../lib/shapes/extras";
import { GALAXY_FORM_DESCRIPTIONS, GALAXY_FORMS } from "../../lib/shapes/galaxies";
import { centreOf, fieldShows, SHAPE_KINDS, SHAPE_SPECS, specOf } from "../../lib/shapes/specs";
import type { StarChoice } from "../../lib/shapes/stars";
import type {
  ExtraKey,
  Fill,
  GalaxyForm,
  GalaxyFrame,
  GalaxyShape,
  PendingShape,
  Shape,
  ShapeExtras,
  ShapeField,
  ShapePurpose,
  ShapeSettings,
  SpacedFill,
} from "../../lib/shapes/types";
import { counted } from "../../lib/text";
import { iconTitle, TOOL_OPTIONS, type Choice } from "../../lib/toolCopy";
import { TOOL_ENTRY } from "../../lib/tools";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useGeneratorStore, type GeneratorStarClass } from "../../store/generatorStore";
import { SHAPE_NEEDS_GAME_DATA, shapeRefusal, useShapePreview } from "../../store/shapePreview";
import { COUNT_RANGE, rememberedFor, SHAPE_SIZE_MIN } from "../../store/toolStore.shape";
import {
  SPACING_RANGE,
  sliderOfSpacing,
  spacingOfSlider,
  useToolStore,
} from "../../store/toolStore";
import { Glyph } from "../Glyph";
import { HelpLink } from "../HelpLink";
import { Select } from "../Select";
import { useGeneratorData } from "../useGeneratorData";
import { useNamed } from "../useNamed";
import {
  CheckOption,
  DraftNumber,
  LaneDensityOption,
  LaneModeSelect,
  SliderOption,
} from "./toolFields";
import "./chrome.css";

/** What the Small chip sets, as a fraction of the galaxy's radius. */
const SMALL_FRACTION = 0.1;

/** The number `key` holds in `shape`; the field rows only ask for number keys. */
function readField(shape: Shape, key: ShapeField<Shape>["key"]): number {
  return (shape as unknown as Record<string, number>)[key as string]!;
}

const NO_EDGE: MapExtent = { shape: "square", half: SCENARIO_HALF_EXTENT };

/**
 * The circle a shape's size is measured against, the rules' edge, and the one it may grow to,
 * how far out its systems may stand; the scenario square when a document gives no edge.
 */
function useGalaxyFrames(rules: PlacementRules): { galaxy: GalaxyFrame; reach: GalaxyFrame } {
  const radius = useGalaxyStore((s) => s.galaxy?.galaxy_radius ?? 0);
  return {
    galaxy: galaxyFrame(extentOf(rules.edge, radius) ?? NO_EDGE),
    reach: galaxyFrame(reachOf(rules.edge, radius) ?? NO_EDGE),
  };
}

/** A row of buttons of which `value` is the one chosen: a joined bar, or `tiles` that wrap. */
function Choice<T extends string>({
  label,
  choices,
  value,
  onPick,
  tiles = false,
}: {
  label: string;
  choices: readonly { value: T; label: ReactNode; title: string; name?: string }[];
  value: T;
  onPick(value: T): void;
  tiles?: boolean;
}) {
  return (
    <div
      className={tiles ? "segmented shape-tiles" : "segmented joined"}
      role="radiogroup"
      aria-label={label}
    >
      {choices.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          aria-label={c.name}
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
      tiles
      choices={SHAPE_KINDS.map((kind) => ({
        value: kind,
        name: SHAPE_SPECS[kind].label,
        title: iconTitle(SHAPE_SPECS[kind].label, SHAPE_SPECS[kind].hint),
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
          title: fillChoiceHint(c),
        }))}
      />
      {fill.kind === "scattered" && specOf(settings.shape).edgeRow && (
        <CheckOption
          copy={SHAPE_OPTIONS.edge}
          checked={fill.edge}
          onChange={(edge) => setFill({ ...fill, edge })}
        />
      )}
    </>
  );
}

const noText = () => "";

/** Which of the game's galaxy shapes a galaxy lays out, named and described as the game data has them. */
function GalaxyFormRow({ shape }: { shape: GalaxyShape }) {
  const setGalaxyForm = useToolStore((s) => s.setGalaxyForm);
  const name = useNamed(GALAXY_FORMS);
  const describe = useNamed(Object.values(GALAXY_FORM_DESCRIPTIONS), noText);
  const { label, hint } = SHAPE_OPTIONS.galaxyForm;
  return (
    <label className="tool-option" title={hint}>
      {label}
      <span title={describe(GALAXY_FORM_DESCRIPTIONS[shape.form]) || undefined}>
        <Select<GalaxyForm>
          value={shape.form}
          choices={GALAXY_FORMS.map((form) => ({ value: form, label: name(form) }))}
          label={label}
          onChange={setGalaxyForm}
        />
      </span>
    </label>
  );
}

function SizeOptions({ shape, rules }: { shape: Shape; rules: PlacementRules }) {
  const { galaxy: frame, reach } = useGalaxyFrames(rules);
  const setShapeSize = useToolStore((s) => s.setShapeSize);
  const size = specOf(shape).size(shape);
  const whole = Math.round(frame.radius);
  const small = Math.max(SHAPE_SIZE_MIN, Math.round(frame.radius * SMALL_FRACTION));
  const percent = Math.round((size / frame.radius) * 100);
  return (
    <>
      <SliderOption
        {...SHAPE_OPTIONS.size}
        range={{ min: SHAPE_SIZE_MIN, max: Math.round(reach.radius) }}
        value={Math.round(size)}
        onChange={setShapeSize}
        field="Shape size in game units"
      />
      <div className="segmented shape-chips" role="group" aria-label="Size presets">
        <button type="button" title={SHAPE_OPTIONS.small.hint} onClick={() => setShapeSize(small)}>
          {SHAPE_OPTIONS.small.label}
        </button>
        <span className="muted">{percent}% of the galaxy</span>
        <button type="button" title={SHAPE_OPTIONS.whole.hint} onClick={() => setShapeSize(whole)}>
          {SHAPE_OPTIONS.whole.label}
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
      <label className="tool-option" title={field.hint}>
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
      hint={field.hint}
      range={field.range}
      step={field.step}
      value={value}
      onChange={apply}
      field={`${field.label} as a number`}
      unit={field.unit}
    />
  );
}

/** The least spacing `fill` can lay `shape` at, and the spacing it is laid at, each to a tenth. */
function spacingOf(
  shape: Shape,
  fill: SpacedFill,
  symmetry: Symmetry,
  rules: PlacementRules,
): { least: number; used: number } {
  // Rounded up, so neither shows a spacing closer than the fill is laid at.
  const tenth = (v: number) => Math.ceil(v * 10) / 10;
  return {
    least: tenth(leastSpacing(shape, fill, symmetry, rules)),
    used: tenth(fillSpacing(shape, fill, symmetry, rules)),
  };
}

function CountOrDensity({ settings, rules }: { settings: ShapeSettings; rules: PlacementRules }) {
  const setFill = useToolStore((s) => s.setFill);
  const symmetry = useToolStore((s) => s.symmetry);
  const { shape, fill } = settings;
  if (fill.kind === "outline") {
    const range = { min: COUNT_RANGE.min, max: rules.cap };
    const { label, hint } = SHAPE_OPTIONS.systems;
    return (
      <label className="tool-option" title={hint}>
        {label}
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
  const { least, used } = spacingOf(shape, fill, symmetry, rules);
  const { label, hint } = SHAPE_OPTIONS.density;
  // Sparse (left) to dense (right), as the brushes' Density and Lane density run.
  return (
    <label className="tool-option" title={hint}>
      {label}
      <span className="shape-density">
        <span className="muted">sparse</span>
        <input
          type="range"
          min={0}
          max={sliderOfSpacing(least)}
          value={sliderOfSpacing(used)}
          onChange={(e) => setFill({ ...fill, spacing: spacingOfSlider(Number(e.target.value)) })}
          aria-label={label}
        />
        <span className="muted">dense</span>
      </span>
    </label>
  );
}

/** The spacing a scattered or grid fill is laid at, typed in game units. */
function SpacingField({ settings, rules }: { settings: ShapeSettings; rules: PlacementRules }) {
  const setFill = useToolStore((s) => s.setFill);
  const symmetry = useToolStore((s) => s.symmetry);
  const { shape, fill } = settings;
  if (fill.kind === "outline") return null;
  const { least, used } = spacingOf(shape, fill, symmetry, rules);
  const { label, hint } = SHAPE_OPTIONS.spacing;
  return (
    <label className="tool-option" title={hint}>
      {label}
      <DraftNumber
        min={least}
        max={SPACING_RANGE.max}
        step={0.1}
        value={used}
        onApply={(spacing) => setFill({ ...fill, spacing })}
        aria-label="Spacing between systems in game units"
      />
    </label>
  );
}

/** One of the outline's extras as a slider with a field. */
function ExtraRow({ extra, extras }: { extra: ExtraKey; extras: ShapeExtras }) {
  const setShapeExtras = useToolStore((s) => s.setShapeExtras);
  const row = EXTRA_ROWS[extra];
  return (
    <SliderOption
      label={row.label}
      range={row.range}
      step={row.step}
      value={extras[extra]}
      onChange={(v) => setShapeExtras({ [extra]: clampTo(v, row.range) })}
      field={`${row.label} as a number`}
      hint={row.hint}
      unit={row.unit}
    />
  );
}

/** The new lanes' options: which lanes, how many, along the edge, and spokes once there is a centre system. */
function LaneOptions({
  settings,
  purpose,
}: {
  settings: ShapeSettings;
  purpose: ShapePurpose["kind"];
}) {
  const setShapeLanes = useToolStore((s) => s.setShapeLanes);
  const setShapeExtras = useToolStore((s) => s.setShapeExtras);
  const { lanes, fill, extras } = settings;
  return (
    <>
      <LaneModeSelect value={lanes.mode} onChange={(mode) => setShapeLanes({ mode })} />
      {lanes.mode !== "off" && (
        <>
          <LaneDensityOption />
          <CheckOption
            copy={TOOL_OPTIONS.laneIslands}
            checked={lanes.islands}
            onChange={(islands) => setShapeLanes({ islands })}
          />
        </>
      )}
      {hasEdgeRow(settings.shape, fill) && (
        <CheckOption
          copy={SHAPE_OPTIONS.follow}
          checked={lanes.follow}
          onChange={(follow) => setShapeLanes({ follow })}
        />
      )}
      {takesCentre(settings, purpose) && extras.centre !== "none" && (
        <CheckOption
          copy={SHAPE_OPTIONS.spokes}
          checked={extras.centre === "spokes"}
          onChange={(on) => setShapeExtras({ centre: on ? "spokes" : "system" })}
        />
      )}
    </>
  );
}

/** The centre, the kind's exact fields and a fill's spacing, folded away until the player wants to type them. */
function ExactValues({
  settings,
  rules,
  arranging,
}: {
  settings: ShapeSettings;
  rules: PlacementRules;
  arranging: boolean;
}) {
  const moveShape = useToolStore((s) => s.moveShape);
  const settleShape = useToolStore((s) => s.settleShape);
  const { shape, fill } = settings;
  const centre = centreOf(shape);
  const fields = (specOf(shape).fields as readonly ShapeField<Shape>[]).filter(
    (f) => f.exact && fieldShows(f, fill),
  );
  const centreAt = (axis: "x" | "y") => (v: number) => {
    moveShape(shape, { x: axis === "x" ? v - centre.x : 0, y: axis === "y" ? v - centre.y : 0 });
    settleShape();
  };
  return (
    <details className="shape-exact">
      <summary title={SHAPE_OPTIONS.exact.hint}>{SHAPE_OPTIONS.exact.label}</summary>
      <label className="tool-option" title={SHAPE_OPTIONS.centreAt.hint}>
        {SHAPE_OPTIONS.centreAt.label}
        <DraftNumber
          step={1}
          value={centre.x}
          onApply={centreAt("x")}
          aria-label="Centre x in game units"
        />
        <DraftNumber
          step={1}
          value={centre.y}
          onApply={centreAt("y")}
          aria-label="Centre y in game units"
        />
      </label>
      {fields.map((f) => (
        <FieldRow key={String(f.key)} shape={shape} field={f} />
      ))}
      {!arranging && <SpacingField settings={settings} rules={rules} />}
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
      <label className="tool-option" title={SHAPE_OPTIONS.stars.hint}>
        {SHAPE_OPTIONS.stars.label}
        <Select
          value={value}
          choices={options}
          label={SHAPE_OPTIONS.stars.label}
          onChange={(v) => {
            const picked = options.find((o) => o.value === v);
            if (picked) setShapeStars(picked.stars);
          }}
        />
      </label>
      {stars.kind === "mix" && (
        <div className="shape-mix">
          {classes.map((c) => {
            const on = stars.classes.includes(c.key);
            return (
              <CheckOption
                key={c.key}
                copy={{ label: c.label, hint: MIX_CLASS_HINT }}
                checked={on}
                disabled={on && stars.classes.length === 1}
                onChange={(tick) =>
                  setShapeStars({
                    kind: "mix",
                    classes: tick
                      ? [...stars.classes, c.key]
                      : stars.classes.filter((k) => k !== c.key),
                  })
                }
              />
            );
          })}
        </div>
      )}
    </>
  );
}

/** Place, or Arrange, with `children` beside it, and why it is off on a line below. */
function PlaceButton({
  path,
  arranging,
  children,
}: {
  path: PlacementPath;
  arranging: boolean;
  children: ReactNode;
}) {
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
        title={reason ?? (arranging ? ARRANGE_HINT : PLACE_HINT)}
        onClick={() => void place()}
      >
        {label}
      </button>
      {children}
      {reason && <span className="tool-hint warn">{reason}</span>}
    </>
  );
}

/** Whether Shuffle changes `pending`: a scattered fill, or a band or wobble, draws from its seed. */
function drawsAtRandom(pending: PendingShape): boolean {
  const { band, wobble } = appliedExtras(pending);
  return pending.fill.kind === "scattered" || band > 1 || wobble > 0;
}

/** The kind's number fields the panel's body shows with `fill`; the rest fold under Exact values. */
function bodyFields(shape: Shape, fill: Fill): readonly ShapeField<Shape>[] {
  return (specOf(shape).fields as readonly ShapeField<Shape>[]).filter(
    (f) => !f.exact && fieldShows(f, fill),
  );
}

type Arranging = Extract<ShapePurpose, { kind: "arrange" }>;

/** What the sections read: the settings shown, the pending shape, and where it goes. */
interface Panel {
  settings: ShapeSettings;
  pending: PendingShape | null;
  path: PlacementPath;
  rules: PlacementRules;
  arranging: Arranging | null;
  stars: StarChoice;
  skipNear: boolean;
}

interface SectionProps {
  section: ShapeSection;
  panel: Panel;
}

/** One section of the options under its heading; the first heading carries the tool's help link. */
function Section({ section, children }: { section: ShapeSection; children: ReactNode }) {
  const id = useId();
  const { help, label } = TOOL_ENTRY.shape;
  return (
    <section className="shape-section" aria-labelledby={id}>
      <h3 id={id} className="shape-heading">
        {SHAPE_SECTION_HEADINGS[section]}
        {section === SHAPE_SECTIONS[0] && help?.onHeading && (
          <HelpLink place={help.place} topic={label} />
        )}
      </h3>
      {children}
    </section>
  );
}

function KindSection({ section, panel }: SectionProps) {
  return (
    <Section section={section}>
      <KindPicker shape={panel.settings.shape} />
    </Section>
  );
}

function FillSection({ section, panel }: SectionProps) {
  return (
    <Section section={section}>
      <FillPicker settings={panel.settings} />
    </Section>
  );
}

/** The extras that apply, Gaps only where follow lanes are laid, which Arrange does under Rebuild alone. */
function formExtras({ settings, arranging }: Panel): ExtraKey[] {
  return EXTRA_KEYS.filter(
    (k) =>
      extraApplies(k, settings, arranging ? "arrange" : "add") &&
      (!EXTRA_ROWS[k].followOnly || arranging === null || arranging.lanes === "rebuild"),
  );
}

/** Size, the kind's own fields and the outline's extras; hidden when none of them shows. */
function FormSection({ section, panel }: SectionProps) {
  const { settings, pending, rules } = panel;
  const { shape, fill } = settings;
  const fields = bodyFields(shape, fill);
  const extras = formExtras(panel);
  const galaxy = shape.kind === "galaxy" ? shape : null;
  if (pending === null && !galaxy && fields.length === 0 && extras.length === 0) return null;
  return (
    <Section section={section}>
      {galaxy && <GalaxyFormRow shape={galaxy} />}
      {pending && <SizeOptions shape={shape} rules={rules} />}
      {fields.map((f) => (
        <FieldRow key={String(f.key)} shape={shape} field={f} />
      ))}
      {extras.map((k) => (
        <ExtraRow key={k} extra={k} extras={settings.extras} />
      ))}
    </Section>
  );
}

/** How many systems and which stars, whether they keep clear of existing ones, and a centre system. */
function SystemsSection({ section, panel }: SectionProps) {
  const setSkipNear = useToolStore((s) => s.setSkipNear);
  const setShapeExtras = useToolStore((s) => s.setShapeExtras);
  const { settings, path, rules, arranging, stars, skipNear } = panel;
  return (
    <Section section={section}>
      {arranging ? (
        <label className="tool-option" title={SHAPE_OPTIONS.selected.hint}>
          {SHAPE_OPTIONS.selected.label}
          <span className="muted">{counted(arranging.ids.length, "system")}</span>
        </label>
      ) : (
        <CountOrDensity settings={settings} rules={rules} />
      )}
      {path === "rolled" && !arranging && <StarsRow stars={stars} />}
      {!arranging && (
        <CheckOption copy={SHAPE_OPTIONS.skipNear} checked={skipNear} onChange={setSkipNear} />
      )}
      {takesCentre(settings, arranging ? "arrange" : "add") && (
        <CheckOption
          copy={SHAPE_OPTIONS.centre}
          checked={settings.extras.centre !== "none"}
          onChange={(on) => setShapeExtras({ centre: on ? "system" : "none" })}
        />
      )}
    </Section>
  );
}

/** The lanes the shape lays; arranging, first what becomes of the lanes between the selected systems. */
function LanesSection({ section, panel }: SectionProps) {
  const setArrangeLanes = useToolStore((s) => s.setArrangeLanes);
  const setArrangeAlsoOuter = useToolStore((s) => s.setArrangeAlsoOuter);
  const { settings, arranging } = panel;
  return (
    <Section section={section}>
      {arranging && (
        <Choice
          label="Lanes between the selected systems"
          value={arranging.lanes}
          onPick={setArrangeLanes}
          choices={ARRANGE_LANE_CHOICES.map((c) => ({ value: c, ...arrangeLaneRow(c) }))}
        />
      )}
      {(arranging === null || arranging.lanes === "rebuild") && (
        <LaneOptions settings={settings} purpose={arranging ? "arrange" : "add"} />
      )}
      {arranging && arranging.lanes !== "keep" && (
        <CheckOption
          copy={SHAPE_OPTIONS.alsoOuter}
          checked={arranging.alsoOuter}
          onChange={setArrangeAlsoOuter}
        />
      )}
    </Section>
  );
}

const SECTION_BODIES: Record<ShapeSection, ComponentType<SectionProps>> = {
  shape: KindSection,
  fill: FillSection,
  form: FormSection,
  systems: SystemsSection,
  lanes: LanesSection,
};

/** Two crossing arrows: Shuffle. */
const SHUFFLE_GLYPH =
  "M2 5h2.2c3.6 0 4 6 7.6 6H14M2 11h2.2c1.4 0 2.3-.9 3-2M8.8 7c.7-1.1 1.6-2 3-2H14M12 3l2 2-2 2M12 9l2 2-2 2";

/**
 * The Shape tool's options: the shape, its fill, its size and form, its systems, its lanes and
 * Place. With nothing pending they set what the next shape drawn starts from. Arranging, the count
 * is the selection's and the lanes section is about the selection's own lanes.
 */
export function ShapeOptions() {
  const pending = useToolStore((s) => s.pendingShape);
  const memory = useToolStore((s) => s.shapeMemory);
  const shuffle = useToolStore((s) => s.shuffleShape);
  const path = useFileSessionStore((s) => shapePath(s.capabilities));
  if (path === null) return null;
  const rules = PLACEMENT_RULES[path];
  const settings = pending ?? rememberedFor(memory);
  const arranging = pending?.purpose.kind === "arrange" ? pending.purpose : null;
  const panel: Panel = {
    settings,
    pending,
    path,
    rules,
    arranging,
    stars: pending?.stars ?? memory.stars,
    skipNear: pending?.skipNear ?? memory.skipNear,
  };
  return (
    <div className="shape-options">
      {SHAPE_SECTIONS.map((section) => {
        const Body = SECTION_BODIES[section];
        return <Body key={section} section={section} panel={panel} />;
      })}
      {pending && <ExactValues settings={settings} rules={rules} arranging={arranging !== null} />}
      <div className="shape-foot">
        {pending ? (
          <PlaceButton path={path} arranging={arranging !== null}>
            {drawsAtRandom(pending) && (
              <button
                type="button"
                className="shape-shuffle"
                title={iconTitle(SHAPE_OPTIONS.shuffle.label, SHAPE_OPTIONS.shuffle.hint)}
                aria-label={SHAPE_OPTIONS.shuffle.label}
                onClick={() => shuffle()}
              >
                <Glyph className="shape-glyph">
                  <path d={SHUFFLE_GLYPH} />
                </Glyph>
              </button>
            )}
            <span className="muted">{arranging ? "Esc moves nothing" : "Esc drops it"}</span>
          </PlaceButton>
        ) : (
          <span className="tool-hint muted">Drag on the map to draw a shape</span>
        )}
      </div>
    </div>
  );
}
