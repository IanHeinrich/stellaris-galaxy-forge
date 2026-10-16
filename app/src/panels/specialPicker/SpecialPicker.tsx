import { useMemo } from "react";
import type { SpecialPick } from "../../generated/SpecialPick";
import { pickCard, specialMarks, type AddRefusal } from "../../lib/addSystem";
import type { Pt } from "../../lib/geometry/pt";
import { specialKey } from "../../lib/specialPicks";
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

/** One layout's row: its name, its marks and its pin. */
function Row({ pick }: { pick: SpecialPick }) {
  const pinned = useSpecialPickerStore((s) => s.pinned);
  const togglePin = useSpecialPickerStore((s) => s.togglePin);
  const { layout, summary } = pick;
  const marks = specialMarks(layout, summary.max_instances);
  const dlc = layout.dlc?.name ?? "";
  const pin = pinned.includes(layout.key);
  return (
    <>
      <span className="sp-label">{layout.label}</span>
      <span className="sp-marks">
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
        aria-label={pin ? `Unpin ${layout.label}` : `Pin ${layout.label}`}
        title={`${pin ? "Unpin" : "Pin"} (Ctrl+D)`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => togglePin(layout.key)}
      >
        {pin ? "★" : "☆"}
      </button>
    </>
  );
}

/** What the highlighted layout holds, what it comes with and without, and the option for that. */
function Detail({ pick, refusal }: { pick: SpecialPick | null; refusal: AddRefusal | null }) {
  const extras = useSpecialPickerStore((s) => s.extras);
  const setExtras = useSpecialPickerStore((s) => s.setExtras);
  if (pick === null) {
    return (
      <div className="browse-detail">
        <div className="muted">Nothing highlighted.</div>
      </div>
    );
  }
  const { layout, summary } = pick;
  const card = pickCard(summary, layout.label, extras);
  return (
    <div className="browse-detail">
      <div className="browse-detail-head">
        <div className="browse-detail-name">{layout.label}</div>
        <div className="muted mono">{layout.key}</div>
      </div>
      <div className="browse-facts">
        {card.lines.map((line) => (
          <div key={line.label} className="browse-fact">
            <span className="k">{line.label}</span>
            <span>{line.text}</span>
          </div>
        ))}
      </div>
      {card.unique && (
        <div className={card.unique.warn ? "sp-note warn" : "sp-note muted"}>
          {card.unique.text}
        </div>
      )}
      {card.storyKept && <div className="sp-note warn">{card.storyKept}</div>}
      {card.missingDlc && <div className="sp-note muted">{card.missingDlc}</div>}
      {refusal && <div className="sp-note warn">{refusal.reason}</div>}
      {(summary.comes_with ?? []).length > 0 && (
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
  const pick = useHighlightedSpecial();
  const pinnedNow = highlighted !== null && pinnedKeys.includes(highlighted);
  const canPlace = pick !== null && refusal === null;
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
          return row === undefined ? null : <Row pick={row} />;
        },
      }}
      highlighted={highlighted}
      onHighlight={highlight}
      onChoose={choose}
      onPin={togglePin}
      detail={<Detail pick={pick} refusal={refusal} />}
      foot={
        <>
          <span className="sp-summary">{`New system at ${at.x.toFixed(2)}, ${at.y.toFixed(2)}`}</span>
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
          <button
            type="button"
            className="sp-place primary"
            disabled={!canPlace}
            title={refusal?.reason}
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
