import type { ContentsRow } from "../../../generated/ContentsRow";
import type { EntityAddr } from "../../../generated/EntityAddr";
import type { EntityView as EntityViewData } from "../../../generated/EntityView";
import type { Fact } from "../../../generated/Fact";
import { capabilityFor, iconKeys, kindWords } from "../../../lib/entities";
import { entityAddr, useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { DataTab } from "./DataTab";
import { Icon } from "../../parts";
import { ChangedBadge, DrillLink, DrillRow, Empty, Properties, PropertyRow } from "../parts";
import { SourceTab } from "./SourceTab";
import "./entity.css";
import { useEntityView, useOpenEntity } from "./useEntity";

/** The root level of an entity; a drill asks for its own level instead of nesting. */
const ROOT: readonly string[] = [];

/** The paths whose node an op rewrote, so a curated fact can carry the same badge. */
function changedPaths(view: EntityViewData): Set<string> {
  return new Set(view.nodes.filter((node) => node.changed).map((node) => node.path.join("/")));
}

function Head({ label, addr, view }: { label: string; addr: EntityAddr; view?: EntityViewData }) {
  return (
    <>
      <div className="ins-head">
        <span className="name">{label}</span>
        <span className="muted mono">#{addr.id}</span>
        {view?.dirty === true && <ChangedBadge title="an edit rewrote this entity" />}
      </div>
      <div className="ins-sub muted">{kindWords(addr.kind)}</div>
    </>
  );
}

function FactRow({ fact, changed }: { fact: Fact; changed: boolean }) {
  const opener = useOpenEntity();
  const link = fact.link !== null && opener.opens(fact.link) ? fact.link : null;
  return (
    <PropertyRow label={fact.label}>
      {fact.icon !== null && <Icon className="gi" keys={iconKeys(fact.icon)} glyph="" />}
      {link === null ? (
        fact.value
      ) : (
        <DrillLink
          requires={capabilityFor(link.kind)}
          title={`Open ${kindWords(link.kind)} #${link.id}`}
          onOpen={() => opener.open(link, fact.value)}
        >
          {fact.value}
        </DrillLink>
      )}
      {changed && <ChangedBadge />}
    </PropertyRow>
  );
}

function Overview({ view }: { view: EntityViewData }) {
  const changed = changedPaths(view);
  if (view.overview.length === 0) {
    return (
      <Empty>
        No curated overview for a {kindWords(view.addr.kind)} yet; its Data tab shows every field
        the save wrote.
      </Empty>
    );
  }
  return (
    <Properties>
      {view.overview.map((fact, i) => (
        <FactRow
          key={`${fact.label}-${i}`}
          fact={fact}
          changed={fact.path !== null && changed.has(fact.path.join("/"))}
        />
      ))}
    </Properties>
  );
}

function ContentsRowView({ row, addr }: { row: ContentsRow; addr: EntityAddr }) {
  const open = useInspectorStore((s) => s.open);
  const opener = useOpenEntity();
  const body = (
    <>
      <span className="l1">{row.label}</span>
      <span className="muted">{row.count}</span>
    </>
  );
  const link = row.link !== null && opener.opens(row.link) ? row.link : null;
  const path = row.path;
  if (link !== null) {
    return (
      <DrillRow
        className="ins-drow"
        requires={capabilityFor(link.kind)}
        onOpen={() => opener.open(link, row.label)}
      >
        {body}
      </DrillRow>
    );
  }
  if (path !== null && row.count > 0) {
    return (
      <DrillRow
        className="ins-drow"
        requires={row.of === null ? undefined : capabilityFor(row.of)}
        onOpen={() =>
          open({ ref: { kind: "nodelist", parent: addr, path, of: row.of }, label: row.label })
        }
      >
        {body}
      </DrillRow>
    );
  }
  return <div className="ins-drow static">{body}</div>;
}

function Contents({ view }: { view: EntityViewData }) {
  if (view.contents.length === 0) {
    return <Empty>This {kindWords(view.addr.kind)} lists nothing of its own.</Empty>;
  }
  return (
    <>
      {view.contents.map((row, i) => (
        <ContentsRowView key={`${row.label}-${i}`} row={row} addr={view.addr} />
      ))}
    </>
  );
}

function EntityBody({ addr, label }: { addr: EntityAddr; label: string }) {
  const tab = useInspectorStore((s) => s.tab);
  const { value: view, error } = useEntityView(addr, ROOT);
  if (tab === "data") {
    return (
      <>
        <Head label={label} addr={addr} view={view} />
        <DataTab addr={addr} path={ROOT} />
      </>
    );
  }
  if (tab === "source") {
    return (
      <>
        <Head label={label} addr={addr} view={view} />
        <SourceTab addr={addr} />
      </>
    );
  }
  return (
    <>
      <Head label={label} addr={addr} view={view} />
      {error !== undefined ? (
        <Empty>
          This {kindWords(addr.kind)} could not be read: {error}
        </Empty>
      ) : view === undefined ? (
        <Empty>Reading the {kindWords(addr.kind)}…</Empty>
      ) : tab === "contents" ? (
        <Contents view={view} />
      ) : (
        <Overview view={view} />
      )}
    </>
  );
}

/**
 * One entity, whatever its kind: the curated Overview, what it contains, every field the save
 * wrote and its own text. A list inside it opens as a level of its own, so nothing nests.
 */
export function EntityView({ entry }: { entry: Entry }) {
  const ref = entry.ref;
  const addr = entityAddr(ref);
  if (addr === null) return <Empty>Nothing to show for {entry.label}.</Empty>;
  if (ref.kind === "nodelist") {
    return (
      <>
        <div className="ins-head">
          <span className="name">{entry.label}</span>
          <span className="muted mono">
            {addr.kind} #{addr.id}
          </span>
        </div>
        <DataTab addr={addr} path={ref.path} listOf={ref.of} />
      </>
    );
  }
  return <EntityBody addr={addr} label={entry.label} />;
}
