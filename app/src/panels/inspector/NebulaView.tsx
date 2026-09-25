import { nodeName } from "../../lib/names";
import { useEditorStore } from "../../store/editorStore";
import { useSystemNames } from "../../store/browserRows";
import { useGalaxyStore } from "../../store/galaxyStore";
import { NEBULA_RADIUS_INPUT_ID } from "../nebula";
import { EditBlock, EditRow, TextField } from "../EditField";
import { Empty, Properties, PropertyRow, Swatch } from "./parts";
import { shortcutLabel } from "../../lib/keys";
import { counted } from "../../lib/text";

const NO_SYSTEMS: number[] = [];

/** One nebula: where it sits, how wide it is, which systems it holds, and the one way to unmake it. */
export function NebulaView({ index }: { index: number }) {
  const selectNebula = useEditorStore((s) => s.selectNebula);
  const setNebulaRadius = useEditorStore((s) => s.setNebulaRadius);
  const setNebulaName = useEditorStore((s) => s.setNebulaName);
  const jumpTo = useEditorStore((s) => s.jumpTo);
  const removeNebula = useEditorStore((s) => s.removeNebula);
  const nebulae = useGalaxyStore((s) => s.nebulae);
  const systems = useGalaxyStore((s) => s.systems);
  const nebula = nebulae[index];
  const names = useSystemNames(nebula?.systems ?? NO_SYSTEMS);

  if (!nebula) return <Empty>Loading nebula #{index}…</Empty>;
  return (
    <>
      <div className="ins-head">
        <span className="name">{nodeName(nebula.name)}</span>
        <span className="muted mono">#{index}</span>
        <button
          className="link ins-close"
          onClick={() => selectNebula(null)}
          title={`Clear (${shortcutLabel("clearSelection")})`}
        >
          ×
        </button>
      </div>
      <EditBlock title="Nebula">
        <EditRow label="Name">
          <TextField
            kind="text"
            label="Nebula name"
            value={nebula.name.key}
            onCommit={(name) => void setNebulaName(index, name)}
          />
        </EditRow>
        <EditRow label="Radius">
          <TextField
            kind="number"
            id={NEBULA_RADIUS_INPUT_ID}
            className="coord"
            label="Radius"
            value={nebula.radius}
            onCommit={(radius) => void setNebulaRadius(index, radius)}
          />
        </EditRow>
      </EditBlock>
      <div className="edit-block-title ins-about">About</div>
      <Properties>
        <PropertyRow label="x" mono>
          {nebula.x.toFixed(2)}
        </PropertyRow>
        <PropertyRow label="y" mono>
          {nebula.y.toFixed(2)}
        </PropertyRow>
      </Properties>
      <div className="ins-line muted">
        <span>{counted(nebula.systems.length, "system")}</span>
      </div>
      {nebula.systems.length > 0 && (
        <div className="ins-chips">
          {nebula.systems.map((id, i) => (
            <button
              type="button"
              className="chip jump"
              key={id}
              title={`Jump to #${id}`}
              onClick={() => void jumpTo(id)}
            >
              <Swatch owner={systems.get(id)?.owner ?? null} />
              {names[i]}
            </button>
          ))}
        </div>
      )}
      <div className="ins-actions">
        <button type="button" onClick={() => void removeNebula(index)}>
          Delete nebula
        </button>
      </div>
    </>
  );
}
