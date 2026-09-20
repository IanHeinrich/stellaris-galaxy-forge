import { nodeName } from "../../lib/names";
import { useEditorStore } from "../../store/editorStore";
import { useSystemNames } from "../../store/browserRows";
import { useGalaxyStore } from "../../store/galaxyStore";
import { confirmRemoveNebula, NEBULA_RADIUS_INPUT_ID, systemCount } from "./nebula";
import { Empty, Field, Properties, PropertyRow, Swatch } from "./parts";

const NO_SYSTEMS: number[] = [];

/** One nebula: where it sits, how wide it is, which systems it holds, and the one way to unmake it. */
export function NebulaView({ index }: { index: number }) {
  const selectNebula = useEditorStore((s) => s.selectNebula);
  const setNebulaRadius = useEditorStore((s) => s.setNebulaRadius);
  const setNebulaName = useEditorStore((s) => s.setNebulaName);
  const jumpTo = useEditorStore((s) => s.jumpTo);
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
        <button className="link ins-close" onClick={() => selectNebula(null)} title="Clear (Esc)">
          ×
        </button>
      </div>
      <div className="ins-name">
        <span className="k">Name</span>
        <Field
          kind="text"
          className="ins-name-field"
          label="Nebula name"
          value={nebula.name.key}
          onCommit={(name) => void setNebulaName(index, name)}
        />
      </div>
      <Properties>
        <PropertyRow label="x" mono>
          {nebula.x.toFixed(2)}
        </PropertyRow>
        <PropertyRow label="y" mono>
          {nebula.y.toFixed(2)}
        </PropertyRow>
      </Properties>
      <div className="ins-radius">
        <span className="k">Radius</span>
        <Field
          kind="number"
          id={NEBULA_RADIUS_INPUT_ID}
          className="coord"
          label="Radius"
          value={nebula.radius}
          onCommit={(radius) => void setNebulaRadius(index, radius)}
        />
      </div>
      <div className="ins-line muted">
        <span>{systemCount(nebula.systems.length)}</span>
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
        <button type="button" onClick={() => void confirmRemoveNebula(index)}>
          Delete nebula
        </button>
      </div>
    </>
  );
}
