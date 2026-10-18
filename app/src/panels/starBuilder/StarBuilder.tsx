import { useEffect, useMemo, useRef } from "react";
import type { Arrangement } from "../../generated/Arrangement";
import type { StarType } from "../../generated/StarType";
import { crisisVariantKeys } from "../../lib/details/starClass";
import type { Pt } from "../../lib/geometry/pt";
import {
  gameStarSets,
  shortStarNames,
  systemReach,
  fitSlots,
  starSetNoun,
  starTypeName,
  type StarCount,
} from "../../lib/multiStar";
import type { NewSystems } from "../../lib/specialPicks";
import { useGameDataStore } from "../../store/gameDataStore";
import { starsKey, useGeneratorStore } from "../../store/generatorStore";
import { useSpecialPickerStore } from "../../store/specialPickerStore";
import { builtStars, useStarBuilderStore } from "../../store/starBuilderStore";
import { useBeside } from "../browseDialog/useBeside";
import { Dialog, DialogFrame } from "../Dialog";
import { useAddSystemPreview } from "../useAddSystemPreview";
import { useStarData } from "../useGeneratorData";
import { useNewSystemPreview } from "../useNewSystemPreview";
import { StarDiagram } from "../StarDiagram";
import { MapIconPicker, StarSlot } from "../StarPickers";
import "./starBuilder.css";

const TITLE = "Build a binary or trinary";
const NO_PLANETS_LABEL = "No planets";
const JOIN_LABEL = "Join to nearby systems";
const MAP_ICON_LABEL = "Shows on the galaxy map as";
const UNUSED_SLOT = "This arrangement has no third star";
const PLANETS_NOTE = "Planets are generated to suit the stars you choose.";
const TILE_PX = 64;
const TILE_STAR_PX = 14;
const PREVIEW_PX = 200;
const PREVIEW_STAR_PX = 32;

/**
 * The game's own sets of as many stars as the slots, each a chip named short by its stars that
 * fills them, its full name its title. While another count is shown, it holds the room that
 * count's chips take, empty, so the block is as tall for a pair as for a trio.
 */
function GameSets({
  count,
  shown,
  starTypes,
}: {
  count: StarCount;
  shown: boolean;
  starTypes: readonly StarType[] | null;
}) {
  const views = useGameDataStore((s) => s.starClasses);
  const fillStars = useStarBuilderStore((s) => s.fillStars);
  const sets = useMemo(
    () => gameStarSets(views.values(), count, crisisVariantKeys(views.values())),
    [views, count],
  );
  const short = useMemo(() => shortStarNames(starTypes ?? []), [starTypes]);
  if (sets.length === 0) return null;
  const chips = sets
    .map((view) => ({
      view,
      text: view.planet_keys.map(short).join(" + "),
      full: view.planet_keys.map((key) => starTypeName(starTypes, key)).join(" + "),
    }))
    .sort((a, b) => a.text.localeCompare(b.text));
  if (!shown) {
    return (
      <div className="sb-sets sb-sets-held" aria-hidden="true">
        <div className="sb-sets-label">&nbsp;</div>
        <div className="sb-chips">
          {chips.map(({ view, text }) => (
            <span key={view.key} className="sb-chip held">
              {text}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="sb-sets">
      <div className="muted sb-sets-label">{`The game's ${starSetNoun(count).many}`}</div>
      <div className="sb-chips">
        {chips.map(({ view, text, full }) => (
          <button
            key={view.key}
            type="button"
            className="sb-chip"
            title={full}
            aria-label={full}
            onClick={() => fillStars(view.planet_keys)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The game's pairs or trios, whichever the slots call for, in a block as tall for either. */
function GameSetsStack({
  count,
  starTypes,
}: {
  count: number;
  starTypes: readonly StarType[] | null;
}) {
  return (
    <div className="sb-sets-stack">
      {([2, 3] as const).map((n) => (
        <GameSets key={n} count={n} shown={n === count} starTypes={starTypes} />
      ))}
    </div>
  );
}

/** One arrangement as a tile, drawn with the stars chosen so far where it would put them. */
function Tile({
  arrangement,
  slots,
  starTypes,
  reach,
  chosen,
}: {
  arrangement: Arrangement;
  slots: readonly string[];
  starTypes: readonly StarType[] | null;
  reach: number | undefined;
  chosen: boolean;
}) {
  const setLayout = useStarBuilderStore((s) => s.setLayout);
  return (
    <button
      type="button"
      className="sb-tile"
      aria-pressed={chosen}
      onClick={() => setLayout(arrangement.layout)}
    >
      <StarDiagram
        diagram={arrangement.diagram}
        stars={fitSlots(slots, arrangement.stars, starTypes)}
        size={TILE_PX}
        reach={reach}
        starSize={TILE_STAR_PX}
      />
      <span>{arrangement.name}</span>
    </button>
  );
}

function Building({ at, anchor, perUnit }: { at: Pt; anchor: Pt; perUnit: Pt }) {
  const state = useStarBuilderStore();
  const { close, setStar, setStarClass, setNoPlanets, place } = state;
  const join = useSpecialPickerStore((s) => s.join);
  const setJoin = useSpecialPickerStore((s) => s.setJoin);
  const filed = useGeneratorStore((s) => s.filed);
  const { arrangements, starTypes } = useStarData();
  const reach = useMemo(() => systemReach(arrangements), [arrangements]);
  const { arrangement, slots, spare } = useMemo(
    () => builtStars(state.layout, state.stars, arrangements, starTypes),
    [state.layout, state.stars, arrangements, starTypes],
  );
  const known = filed.get(starsKey(slots));
  const automatic = known?.kind === "filed" ? known.starClass : undefined;
  useEffect(() => {
    useGeneratorStore.getState().fileStars(slots);
  }, [slots]);

  const refusal = useAddSystemPreview(at.x, at.y);
  const added = useMemo(
    (): NewSystems => ({
      places: [{ x: at.x, y: at.y, star_class: null, refused: refusal?.reason ?? null }],
      lanes: [],
    }),
    [at.x, at.y, refusal?.reason],
  );
  const { area } = useNewSystemPreview(added, join, at, anchor, perUnit);
  const inner = useRef<HTMLDivElement>(null);
  const placed = useBeside(area, inner, close);

  const names = slots.map((star) => starTypeName(starTypes, star));
  const blocked = refusal?.reason ?? (arrangement === null ? "Reading the arrangements…" : null);
  const canPlace = blocked === null;
  const spot = `${at.x.toFixed(2)}, ${at.y.toFixed(2)}`;

  return (
    <Dialog className="sb" style={placed} label={TITLE} onClose={close}>
      <div ref={inner} className="sb-inner">
        <DialogFrame
          title={TITLE}
          onSubmit={(e) => {
            e.preventDefault();
            if (canPlace) void place();
          }}
          actions={
            <>
              <button type="button" onClick={close}>
                Cancel
              </button>
              <button
                type="submit"
                className="primary"
                disabled={!canPlace}
                title={blocked ?? undefined}
              >
                Place
              </button>
            </>
          }
          note={<span className="muted">{`New system at ${spot}`}</span>}
        >
          <div className="sb-cols">
            <div className="sb-choices">
              <h4>Arrangement</h4>
              <div className="sb-tiles">
                {(arrangements ?? []).map((a) => (
                  <Tile
                    key={a.layout}
                    arrangement={a}
                    slots={slots}
                    starTypes={starTypes}
                    reach={reach}
                    chosen={a.layout === arrangement?.layout}
                  />
                ))}
              </div>
              <h4>Stars</h4>
              {slots.map((star, i) => (
                <div key={i} className="sb-slot">
                  <span className="muted">{i + 1}</span>
                  <StarSlot
                    label={`Star ${i + 1}`}
                    star={star}
                    starTypes={starTypes}
                    triggerClassName="edit-field"
                    floating
                    onPick={(key) => setStar(i, key)}
                  />
                </div>
              ))}
              {spare !== null && (
                <div className="sb-slot off">
                  <span className="muted">{slots.length + 1}</span>
                  <StarSlot
                    label={`Star ${slots.length + 1}`}
                    star={spare}
                    starTypes={starTypes}
                    triggerClassName="edit-field"
                    floating
                    disabledReason={UNUSED_SLOT}
                    onPick={() => undefined}
                  />
                </div>
              )}
              <h4>{MAP_ICON_LABEL}</h4>
              <MapIconPicker
                label={MAP_ICON_LABEL}
                automatic={automatic}
                chosen={state.starClass}
                triggerClassName="edit-field"
                floating
                onPick={setStarClass}
              />
              <label className="sp-extras">
                <input
                  type="checkbox"
                  checked={state.noPlanets}
                  onChange={(e) => setNoPlanets(e.currentTarget.checked)}
                />
                {NO_PLANETS_LABEL}
              </label>
              <label className="sp-extras">
                <input
                  type="checkbox"
                  checked={join}
                  onChange={(e) => setJoin(e.currentTarget.checked)}
                />
                {JOIN_LABEL}
              </label>
            </div>
            <div className="sb-preview">
              {arrangement && (
                <StarDiagram
                  diagram={arrangement.diagram}
                  stars={slots}
                  size={PREVIEW_PX}
                  reach={reach}
                  starSize={PREVIEW_STAR_PX}
                  labels={slots.map((_, i) => `${i + 1}`)}
                  label={names.join(" + ")}
                />
              )}
              <div className="muted sb-note">{PLANETS_NOTE}</div>
              {refusal && <div className="warn sb-note">{refusal.reason}</div>}
              <GameSetsStack count={slots.length} starTypes={starTypes} />
            </div>
          </div>
        </DialogFrame>
      </div>
    </Dialog>
  );
}

/**
 * The builder: a binary or trinary of the player's own stars in one of the game's arrangements,
 * beside the right-clicked point of a save, placed there.
 */
export function StarBuilder() {
  const open = useStarBuilderStore((s) => s.open);
  const at = useStarBuilderStore((s) => s.at);
  const anchor = useStarBuilderStore((s) => s.anchor);
  const perUnit = useStarBuilderStore((s) => s.perUnit);
  return open && at !== null && anchor !== null ? (
    <Building at={at} anchor={anchor} perUnit={perUnit} />
  ) : null;
}
