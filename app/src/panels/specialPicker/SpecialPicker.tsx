import { useEffect, useMemo } from "react";
import { pickCard, specialMarks, type AddRefusal, type LayoutAdd } from "../../lib/addSystem";
import type { Pt } from "../../lib/geometry/pt";
import {
  clusterRefusal,
  memberName,
  rolledSystems,
  specialKey,
  specialLabel,
  specialPlacement,
  type ClusterRollState,
  type NewSystems,
  type SpecialEntry,
} from "../../lib/specialPicks";
import { counted } from "../../lib/text";
import { useCanEdit } from "../../store/fileSessionStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useSpecialLinks } from "../../store/specialLinks";
import {
  useHighlightedSpecial,
  useSpecialPickerStore,
  useSpecialTree,
  useVisibleSpecials,
} from "../../store/specialPickerStore";
import { BrowseDialog } from "../browseDialog/BrowseDialog";
import { LockGlyph } from "../Glyph";
import { useAddSystemPreview } from "../useAddSystemPreview";
import "./specialPicker.css";

const IN_GALAXY = "Already in this galaxy";
const EXTRAS_LABEL = "Add its anomalies, dig sites and megastructures";
const JOIN_LABEL = "Join to nearby systems";

/** One row: its name, a cluster's count of systems, its marks and its pin. */
function Row({ entry, how }: { entry: SpecialEntry; how: LayoutAdd["kind"] }) {
  const pinned = useSpecialPickerStore((s) => s.pinned);
  const togglePin = useSpecialPickerStore((s) => s.togglePin);
  const key = specialKey(entry);
  const label = specialLabel(entry);
  const owner = entry.kind === "layout" ? entry.pick.layout : entry.pick.cluster;
  const marks = specialMarks(owner, entry.pick.summary.max_instances, how);
  const dlc = owner.dlc?.name ?? "";
  const pin = pinned.includes(key);
  return (
    <>
      <span className="sp-label">{label}</span>
      <span className="sp-marks">
        {entry.kind === "cluster" && (
          <span className="sp-count">{counted(entry.pick.cluster.layouts.length, "system")}</span>
        )}
        {marks.inGalaxy && (
          <span className="warn" role="img" aria-label={IN_GALAXY} title={IN_GALAXY}>
            ⚠
          </span>
        )}
        {marks.dlc === "tag" && (
          <span className="sp-dlc" title={dlc}>
            DLC
          </span>
        )}
        {marks.dlc === "lock" && (
          <LockGlyph
            className="sp-lock"
            width={9}
            height={11}
            title={`Needs ${dlc}, which this save doesn't have`}
          />
        )}
      </span>
      <button
        type="button"
        tabIndex={-1}
        className={`link sp-pin${pin ? " on" : ""}`}
        aria-label={pin ? `Unpin ${label}` : `Pin ${label}`}
        title={`${pin ? "Unpin" : "Pin"} (Ctrl+D)`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => togglePin(key)}
      >
        {pin ? "★" : "☆"}
      </button>
    </>
  );
}

/** Why a cluster's systems can't go where they were rolled, each by name, or why they weren't rolled. */
function ClusterRefusals({ roll }: { roll: ClusterRollState | null }) {
  if (roll === null || roll.kind === "rolling") return null;
  if (roll.kind === "failed") return <div className="sp-note warn">{roll.reason}</div>;
  const refused = roll.roll.members.filter((m) => m.refused !== null);
  return (
    <>
      {refused.map((m, i) => (
        <div key={i} className="sp-note warn">{`${m.name}: ${m.refused}`}</div>
      ))}
      {refused.length > 0 && (
        <div className="sp-note muted">Shuffle, or right-click another spot.</div>
      )}
    </>
  );
}

/**
 * What the highlighted row holds, what it comes with and without, and the option for that; for a
 * cluster, its systems as rolled.
 */
function Detail({
  entry,
  refusal,
  roll,
  how,
}: {
  entry: SpecialEntry | null;
  refusal: AddRefusal | null;
  roll: ClusterRollState | null;
  how: LayoutAdd["kind"];
}) {
  const extras = useSpecialPickerStore((s) => s.extras);
  const setExtras = useSpecialPickerStore((s) => s.setExtras);
  const join = useSpecialPickerStore((s) => s.join);
  const setJoin = useSpecialPickerStore((s) => s.setJoin);
  if (entry === null) {
    return (
      <div className="browse-detail">
        <div className="muted">Nothing highlighted.</div>
      </div>
    );
  }
  const { summary } = entry.pick;
  const cluster = entry.kind === "cluster" ? entry.pick.cluster : null;
  const label = specialLabel(entry);
  const card = pickCard(
    summary,
    cluster ? { phrase: cluster.phrase } : label,
    how === "built" ? { kind: "built", extras } : { kind: "script" },
  );
  return (
    <div className="browse-detail">
      <div className="browse-detail-head">
        <div className="browse-detail-name">{label}</div>
        <div className="muted mono">
          {entry.kind === "cluster"
            ? entry.pick.cluster.layouts.join(" + ")
            : entry.pick.layout.key}
        </div>
      </div>
      <div className="browse-facts">
        {card.lines.map((line) => (
          <div key={line.label} className="browse-fact">
            <span className="k">{line.label}</span>
            <span>{line.text}</span>
          </div>
        ))}
        {roll?.kind === "rolled" && (
          <div className="browse-fact">
            <span className="k">Systems</span>
            <span>{roll.roll.members.map((m) => memberName(m, how)).join(", ")}</span>
          </div>
        )}
      </div>
      {card.unique && (
        <div className={card.unique.warn ? "sp-note warn" : "sp-note muted"}>
          {card.unique.text}
        </div>
      )}
      {card.clusterSystems && <div className="sp-note muted">{card.clusterSystems}</div>}
      {card.storyKept && <div className="sp-note warn">{card.storyKept}</div>}
      {card.missingDlc && <div className="sp-note muted">{card.missingDlc}</div>}
      {cluster ? (
        <ClusterRefusals roll={roll} />
      ) : (
        refusal && <div className="sp-note warn">{refusal.reason}</div>
      )}
      <label className="sp-extras">
        <input type="checkbox" checked={join} onChange={(e) => setJoin(e.currentTarget.checked)} />
        {JOIN_LABEL}
      </label>
      {how === "built" && (summary.comes_with ?? []).length > 0 && (
        <label className="sp-extras">
          <input
            type="checkbox"
            checked={extras}
            onChange={(e) => setExtras(e.currentTarget.checked)}
          />
          {EXTRAS_LABEL}
        </label>
      )}
    </div>
  );
}

/**
 * Draws what the highlighted row would add at `at`, a cluster as rolled, with its lanes to the
 * systems near it when the picker joins them, as the Shape tool draws a shape's systems, while the
 * caller shows.
 */
function useSpecialPreview(
  entry: SpecialEntry | null,
  roll: ClusterRollState | null,
  at: Pt,
  refused: string | null,
) {
  const setPreview = useMapChromeStore((s) => s.setSpecialPreview);
  const join = useSpecialPickerStore((s) => s.join);
  const { x, y } = at;
  const added = useMemo((): NewSystems | null => {
    if (entry === null) return null;
    if (entry.kind === "cluster") return roll?.kind === "rolled" ? rolledSystems(roll.roll) : null;
    return { places: [{ x, y, star_class: null, refused }], lanes: [] };
  }, [entry, roll, x, y, refused]);
  const links = useSpecialLinks(join ? added : null);
  useEffect(() => {
    setPreview(added && specialPlacement(added, links));
    return () => setPreview(null);
  }, [added, links, setPreview]);
}

function Browsing({ at, anchor }: { at: Pt; anchor: Pt }) {
  const close = useSpecialPickerStore((s) => s.close);
  const query = useSpecialPickerStore((s) => s.query);
  const setQuery = useSpecialPickerStore((s) => s.setQuery);
  const group = useSpecialPickerStore((s) => s.group);
  const setGroup = useSpecialPickerStore((s) => s.setGroup);
  const highlighted = useSpecialPickerStore((s) => s.highlighted);
  const highlight = useSpecialPickerStore((s) => s.highlight);
  const pinnedKeys = useSpecialPickerStore((s) => s.pinned);
  const togglePin = useSpecialPickerStore((s) => s.togglePin);
  const place = useSpecialPickerStore((s) => s.place);
  const shuffle = useSpecialPickerStore((s) => s.shuffle);
  const roll = useSpecialPickerStore((s) => s.roll);
  const read = useSpecialPickerStore((s) => s.entries !== null);
  const how: LayoutAdd["kind"] = useCanEdit("create_systems") ? "script" : "built";
  const refusal = useAddSystemPreview(at.x, at.y);

  const tree = useSpecialTree();
  const groups = useMemo(
    () => tree.map((g) => ({ id: g.id, label: g.label, count: g.entries.length })),
    [tree],
  );
  const total = useMemo(() => new Set(tree.flatMap((g) => g.entries.map(specialKey))).size, [tree]);
  const visible = useVisibleSpecials(tree);
  const byKey = useMemo(() => new Map(visible.map((p) => [specialKey(p), p])), [visible]);
  const keys = useMemo(() => visible.map(specialKey), [visible]);
  const entry = useHighlightedSpecial();
  const cluster = entry?.kind === "cluster" ? entry.pick.cluster : null;
  useSpecialPreview(entry, roll, at, refusal?.reason ?? null);
  const pinnedNow = highlighted !== null && pinnedKeys.includes(highlighted);
  const blocked = cluster ? clusterRefusal(roll) : (refusal?.reason ?? null);
  const canPlace = entry !== null && blocked === null;
  const spot = `${at.x.toFixed(2)}, ${at.y.toFixed(2)}`;
  const choose = () => {
    if (canPlace) void place();
  };

  return (
    <BrowseDialog
      label="Add a special system"
      className="sp"
      beside={anchor}
      onClose={close}
      searchLabel="Search special systems"
      query={query}
      onQuery={setQuery}
      tree={{
        label: "Special system groups",
        groups,
        total,
        selected: group,
        onSelect: setGroup,
      }}
      keys={keys}
      rows={{
        label: "Special systems",
        idPrefix: "sp-row-",
        rowClassName: "sp-row",
        renderRow: (key) => {
          const row = byKey.get(key);
          return row === undefined ? null : <Row entry={row} how={how} />;
        },
      }}
      waiting={read ? undefined : "Reading the special systems…"}
      highlighted={highlighted}
      onHighlight={highlight}
      onChoose={choose}
      onPin={togglePin}
      detail={<Detail entry={entry} refusal={refusal} roll={roll} how={how} />}
      foot={
        <>
          <span className="sp-summary">
            {cluster
              ? `${cluster.layouts.length} new systems around ${spot}`
              : `New system at ${spot}`}
          </span>
          <span className="muted sp-hints">
            Up/Down move · Enter place · Ctrl+D pin · Esc close
          </span>
          <button
            type="button"
            className={`sp-pin-button${pinnedNow ? " on" : ""}`}
            disabled={highlighted === null}
            title="Ctrl+D"
            onClick={() => {
              if (highlighted !== null) togglePin(highlighted);
            }}
          >
            {pinnedNow ? "★ Unpin" : "☆ Pin"}
          </button>
          {cluster && (
            <button type="button" className="sp-shuffle" onClick={shuffle}>
              Shuffle
            </button>
          )}
          <button
            type="button"
            className="sp-place primary"
            disabled={!canPlace}
            title={blocked ?? undefined}
            onClick={choose}
          >
            Place
          </button>
        </>
      }
    />
  );
}

/**
 * The Special picker: the game's special systems in a browse dialog beside the right-clicked
 * point of a save, the highlighted one placed there.
 */
export function SpecialPicker() {
  const open = useSpecialPickerStore((s) => s.open);
  const at = useSpecialPickerStore((s) => s.at);
  const anchor = useSpecialPickerStore((s) => s.anchor);
  return open && at !== null && anchor !== null ? <Browsing at={at} anchor={anchor} /> : null;
}
