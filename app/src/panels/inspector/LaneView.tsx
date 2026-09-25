import { useEditorStore } from "../../store/editorStore";
import { useSystemNames } from "../../store/browserRows";
import { useGalaxyStore } from "../../store/galaxyStore";
import { Chip } from "../parts";
import { Empty, Properties, PropertyRow } from "./parts";

/** One hyperlane: its length against the distance it spans, and the two edits it allows. */
export function LaneView({ a, b }: { a: number; b: number }) {
  const select = useEditorStore((s) => s.select);
  const deleteSelection = useEditorStore((s) => s.deleteSelection);
  const applyOp = useEditorStore((s) => s.applyOp);
  const systems = useGalaxyStore((s) => s.systems);
  const [nameA, nameB] = useSystemNames([a, b]);

  const systemA = systems.get(a);
  const systemB = systems.get(b);
  if (!systemA || !systemB) {
    return (
      <Empty>
        Loading lane #{a}–#{b}…
      </Empty>
    );
  }

  const lane = systemA.lanes.find((l) => l.to === b);
  const length = lane?.length ?? null;
  const distance = Math.hypot(systemB.x - systemA.x, systemB.y - systemA.y);
  const mismatch = lane?.stale ?? false;
  return (
    <>
      <div className="ins-head">
        <span className="name">
          <button className="link" onClick={() => void select(a)} title={`Jump to #${a}`}>
            {nameA}
          </button>
          {" — "}
          <button className="link" onClick={() => void select(b)} title={`Jump to #${b}`}>
            {nameB}
          </button>
        </span>
      </div>
      <Properties>
        <PropertyRow label="Length">
          {length ?? "—"}
          {mismatch && (
            <Chip warn title="Length differs from floor(distance)">
              !
            </Chip>
          )}
        </PropertyRow>
        <PropertyRow label="Distance">{distance.toFixed(1)}</PropertyRow>
        <PropertyRow label="Bridge">{lane?.bridge ? "yes" : "no"}</PropertyRow>
      </Properties>
      <div className="ins-actions">
        <button type="button" onClick={() => void deleteSelection()}>
          ✂ Cut
        </button>
        {mismatch && (
          <button type="button" onClick={() => void applyOp({ type: "NormaliseLaneLength", a, b })}>
            Reset length
          </button>
        )}
      </div>
    </>
  );
}
