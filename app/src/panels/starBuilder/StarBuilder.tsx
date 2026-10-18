import { useEffect, useMemo, useRef } from "react";
import type { Arrangement } from "../../generated/Arrangement";
import { crisisVariantKeys } from "../../lib/details/starClass";
import type { Pt } from "../../lib/geometry/pt";
import {
  gameStarSets,
  slotsFor,
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
import { useStarClassLabel } from "../useStarClassLabel";
import { StarDiagram } from "../StarDiagram";
import { MapIconPicker, StarSlot } from "../StarPickers";
import "./starBuilder.css";

const TITLE = "Build a binary or trinary";
const NO_PLANETS_LABEL = "No planets";
const JOIN_LABEL = "Join to nearby systems";
const MAP_ICON_LABEL = "Shows on the galaxy map as";
const PLANETS_NOTE = "Planets are generated to suit the stars you choose.";
const TILE_PX = 64;
const TILE_STAR_PX = 14;
const PREVIEW_PX = 200;
const PREVIEW_STAR_PX = 40;

/** The game's own sets of as many stars as the slots, each a chip that fills them. */
function GameSets({ count }: { count: number }) {
  const views = useGameDataStore((s) => s.starClasses);
  const fillStars = useStarBuilderStore((s) => s.fillStars);
  const sets = useMemo(
    () => gameStarSets(views.values(), count, crisisVariantKeys(views.values())),
    [views, count],
  );
  const label = useStarClassLabel(sets.map((c) => c.key));
  if (sets.length === 0 || (count !== 2 && count !== 3)) return null;
  const chips = sets
    .map((view) => ({ view, label: label(view.key, view.key) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="sb-chips">
      <span className="muted">{`The game's ${starSetNoun(count as StarCount).many}:`}</span>
      {chips.map(({ view, label: text }) => (
        <button
          key={view.key}
          type="button"
          className="sb-chip"
          onClick={() => fillStars(view.planet_keys)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** One arrangement as a tile, drawn with the stars chosen so far where it would put them. */
function Tile({
  arrangement,
  slots,
  pad,
  chosen,
}: {
  arrangement: Arrangement;
  slots: readonly string[];
  pad: string | undefined;
  chosen: boolean;
}) {
  const setLayout = useStarBuilderStore((s) => s.setLayout);
  return (
    <button
      type="button"
      className="sb-tile"
      aria-pressed={chosen}
      title={arrangement.layout}
      onClick={() => setLayout(arrangement.layout)}
    >
      <StarDiagram
        diagram={arrangement.diagram}
        stars={slotsFor(slots, arrangement.stars, pad)}
        size={TILE_PX}
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
  const { arrangement, slots } = builtStars(state.layout, state.stars, arrangements, starTypes);
  const pad = starTypes?.[0]?.key;
  const automatic = filed.get(starsKey(slots));
  const slotsKey = starsKey(slots);
  useEffect(() => {
    if (slotsKey !== "") useGeneratorStore.getState().fileStars(slotsKey.split("+"));
  }, [slotsKey]);

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
                    pad={pad}
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
                    onPick={(key) => setStar(i, key)}
                  />
                </div>
              ))}
              <GameSets count={slots.length} />
              <h4>{MAP_ICON_LABEL}</h4>
              <MapIconPicker
                label={MAP_ICON_LABEL}
                automatic={automatic}
                chosen={state.starClass}
                triggerClassName="edit-field"
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
              <div className="browse-detail-name">{names.join(" + ")}</div>
              {arrangement && (
                <StarDiagram
                  diagram={arrangement.diagram}
                  stars={slots}
                  size={PREVIEW_PX}
                  starSize={PREVIEW_STAR_PX}
                  names={names}
                  label={names.join(" + ")}
                />
              )}
              <div className="muted sb-note">{PLANETS_NOTE}</div>
              {refusal && <div className="warn sb-note">{refusal.reason}</div>}
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
