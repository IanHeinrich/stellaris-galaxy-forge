import { Fragment, useEffect } from "react";
import type { HeaderField } from "../../../generated/HeaderField";
import type { AppIssue } from "../../../lib/issues";
import { useEditorStore } from "../../../store/editorStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useApplyOp } from "../../useApplyOp";
import { Section } from "../parts";
import {
  LOAD_SHAPES_HINT,
  NO_SHAPES_HINT,
  SCRIPTS_LINE_PREFIX,
  SCRIPTS_LINE_TITLE,
  setupViews,
  SHAPES_LABEL,
  SHAPES_TITLE,
  shapeChoices,
  toggleShape,
  UNKNOWN_SHAPE_SUFFIX,
  type SetupView,
} from "./gameSetup";
import { BoundCells, ScalarCell } from "./SetupCells";

function SetupRow({ view }: { view: SetupView }) {
  const applyOp = useApplyOp();
  const { row } = view;
  return (
    <>
      <span className="k">{row.label}</span>
      <BoundCells view={view} applyOp={applyOp} />
      <ScalarCell
        label={`${row.label} default`}
        keyName={row.default}
        reading={view.default}
        decimals={row.decimals ?? false}
        applyOp={applyOp}
      />
    </>
  );
}

/** The shapes the new-game screen lists the map under, one checkbox each, ticked as the header lists them. */
function ShapesRow({ header }: { header: readonly HeaderField[] }) {
  const applyOp = useApplyOp();
  const ready = useGameDataStore((s) => s.status === "ready");
  const shapes = useGameDataStore((s) => s.galaxyShapes);
  // Reading the install again once game data is ready is what fills the list in.
  useEffect(() => void useGameDataStore.getState().loadGalaxyShapes(), [ready]);
  const choices = shapeChoices(header, shapes);
  return (
    <>
      <div className="ins-shapes" title={SHAPES_TITLE}>
        <span className="k">{SHAPES_LABEL}</span>
        <div className="ins-shape-list">
          {choices.map((choice) => (
            <label key={choice.name} className="ins-shape">
              <input
                type="checkbox"
                aria-label={`${choice.name} shape`}
                checked={choice.ticked}
                onChange={() => applyOp(toggleShape(choices, choice.name))}
              />
              <span className="mono">{choice.name}</span>
              {!choice.known && <span className="muted">{UNKNOWN_SHAPE_SUFFIX}</span>}
            </label>
          ))}
        </div>
      </div>
      {shapes === null && <div className="muted ins-hint">{LOAD_SHAPES_HINT}</div>}
      {!choices.some((choice) => choice.ticked) && <div className="ins-warn">{NO_SHAPES_HINT}</div>}
    </>
  );
}

/** The validator's word on the header's empire counts, and the button that rewrites them. */
function EmpireCounts({ issue }: { issue: AppIssue }) {
  const updateEmpireCounts = useEditorStore((s) => s.updateEmpireCounts);
  return (
    <>
      <div className="ins-warn">{issue.message}</div>
      <div className="ins-actions">
        <button
          type="button"
          title="Set the counts from the seats and fallen empire zones on the map."
          onClick={() => void updateEmpireCounts()}
        >
          Update counts
        </button>
      </div>
    </>
  );
}

/** The button that asks how many of the mod's automatic zones to place, spread across the map. */
function FeZoneFit() {
  const promptFeZoneFit = useEditorStore((s) => s.promptFeZoneFit);
  return (
    <div className="ins-actions">
      <button
        type="button"
        title="Place the mod's automatic zones, as many as you choose, spread across the map."
        onClick={() => void promptFeZoneFit()}
      >
        Fit fallen empire zones…
      </button>
    </div>
  );
}

/** The row the scripts line sits under: the last of the bypass rows the day-one events add to. */
const SCRIPTS_LINE_AFTER = "Gateways";

/** The counts the new-game screen reads from the header, as a grid of min, max and default. */
export function GameSetupSection({
  header,
  paint,
  seatsLine,
  scriptsLine,
  countsIssue,
}: {
  header: readonly HeaderField[];
  paint: boolean;
  seatsLine: string | null;
  /** What the scripts add to the bypass counts, from `randomBypassLine`. */
  scriptsLine: string | null;
  countsIssue: AppIssue | null;
}) {
  const views = setupViews(header);
  return (
    <Section id="galaxy.setup" title="Game setup">
      <div className="ins-setup">
        <span />
        <span className="ins-setup-head">Min</span>
        <span className="ins-setup-head">Max</span>
        <span className="ins-setup-head">Default</span>
        {views.map((view) => (
          <Fragment key={view.row.label}>
            <SetupRow view={view} />
            {scriptsLine !== null && view.row.label === SCRIPTS_LINE_AFTER && (
              <div className="muted ins-hint ins-setup-note" title={SCRIPTS_LINE_TITLE}>
                {SCRIPTS_LINE_PREFIX}
                {scriptsLine}
              </div>
            )}
          </Fragment>
        ))}
      </div>
      {views.flatMap((view) =>
        view.hints.map((hint) => (
          <div className="ins-warn" key={hint}>
            {hint}
          </div>
        )),
      )}
      <ShapesRow header={header} />
      {paint && seatsLine !== null && <div className="muted ins-hint">{seatsLine}</div>}
      {countsIssue !== null && <EmpireCounts issue={countsIssue} />}
      {paint && <FeZoneFit />}
    </Section>
  );
}
