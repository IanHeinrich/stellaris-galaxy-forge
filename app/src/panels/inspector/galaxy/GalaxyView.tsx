import { useState } from "react";
import type { HeaderField } from "../../../generated/HeaderField";
import { fileName } from "../../../lib/paths";
import { bypassLinks, randomBypassLine } from "../../../lib/scenarioBypasses";
import { useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyVersion } from "../../../store/browserRows";
import { laneCount, useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useApplyOp } from "../../useApplyOp";
import {
  addHeaderField,
  DUPLICATE_KEY_TITLE,
  hasHeaderKey,
  headerRowKey,
  isRepeatedKey,
  KEY_TAKEN,
  removeHeaderField,
  setHeaderField,
} from "./header";
import { Empty, Field, Properties, PropertyRow, Section } from "../parts";

/** One header statement as the file writes it: its key, its raw text, and the way to drop it. */
function HeaderRow({ field }: { field: HeaderField }) {
  const applyOp = useApplyOp();
  return (
    <div className="ins-header-row">
      <span className="k mono">{field.key}</span>
      <Field
        kind="text"
        className="mono"
        label={`${field.key} value`}
        value={field.value}
        onCommit={(value) => applyOp(setHeaderField(field.key, value))}
      />
      <button
        type="button"
        className="link"
        title={`Remove ${field.key}`}
        aria-label={`Remove ${field.key}`}
        onClick={() => applyOp(removeHeaderField(field.key))}
      >
        ×
      </button>
    </div>
  );
}

/** A key the file states more than once: the op names the key, so only the first row edits it. */
function RepeatedRow({ field }: { field: HeaderField }) {
  return (
    <div className="ins-header-row repeated" title={DUPLICATE_KEY_TITLE}>
      <span className="k mono">{field.key}</span>
      <span className="mono muted">{field.value}</span>
    </div>
  );
}

function AddHeaderRow({ header }: { header: readonly HeaderField[] }) {
  const applyOp = useApplyOp();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const taken = key.trim() !== "" && hasHeaderKey(header, key);
  const add = () => {
    const op = addHeaderField(header, key, value);
    if (op === null) return;
    applyOp(op);
    setKey("");
    setValue("");
  };
  return (
    <>
      <div className="ins-header-row add">
        <input
          className="mono"
          aria-label="New key"
          placeholder="key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <input
          className="mono"
          aria-label="New value"
          placeholder="value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" disabled={key.trim() === "" || taken} onClick={add}>
          Add
        </button>
      </div>
      {taken && <div className="muted ins-hint">{KEY_TAKEN}</div>}
    </>
  );
}

/** Every key the scenario's own header holds, in file order, duplicates as the file writes them. */
function HeaderSection({ header }: { header: readonly HeaderField[] }) {
  return (
    <Section id="galaxy.header" title="Scenario header" count={header.length}>
      {header.map((field, i) =>
        isRepeatedKey(header, i) ? (
          <RepeatedRow key={headerRowKey(field, i)} field={field} />
        ) : (
          <HeaderRow key={headerRowKey(field, i)} field={field} />
        ),
      )}
      <AddHeaderRow header={header} />
    </Section>
  );
}

/** Nothing selected: the save itself, and what to do next. */
export function GalaxyView() {
  const meta = useFileSessionStore((s) => s.meta);
  const title = useFileSessionStore((s) => s.title);
  const kind = useFileSessionStore((s) => s.kind);
  const path = useFileSessionStore((s) => s.path);
  const cloud = useFileSessionStore((s) => s.cloud);
  const requestFit = useEditorStore((s) => s.requestFit);
  const galaxy = useGalaxyStore((s) => s.galaxy);
  const header = useGalaxyStore((s) => s.header);
  const systems = useGalaxyStore((s) => s.systems);
  const countries = useGalaxyStore((s) => s.countries);
  const nebulae = useGalaxyStore((s) => s.nebulae);
  const placed = useGameDataStore((s) => s.scenarioBypasses);
  useGalaxyVersion();

  const scenario = kind === "scenario";
  const bypasses = scenario
    ? bypassLinks(placed, true, true).length
    : (galaxy?.bypasses.length ?? 0);
  const random = scenario ? randomBypassLine(placed) : null;
  if (galaxy === null) return <Empty>Open a save to look at its galaxy.</Empty>;
  return (
    <>
      <div className="ins-head">
        <span className="name">{title ?? "Galaxy"}</span>
      </div>
      <div className="ins-sub muted">
        {meta
          ? `${meta.date} · ${meta.version}`
          : kind === "scenario"
            ? "static galaxy scenario"
            : "no save metadata"}
      </div>
      <Section id="galaxy.counts" title="Galaxy">
        <Properties>
          <PropertyRow label="Systems">{systems.size}</PropertyRow>
          <PropertyRow label="Hyperlanes">{laneCount(systems.values())}</PropertyRow>
          <PropertyRow label="Empires">{countries.size}</PropertyRow>
          <PropertyRow label="Nebulae">{nebulae.length}</PropertyRow>
          <PropertyRow label="Bypasses">{bypasses}</PropertyRow>
          <PropertyRow label="Components">{galaxy.components}</PropertyRow>
          <PropertyRow label="Radius">{galaxy.galaxy_radius}</PropertyRow>
          {kind === "scenario" && (
            <PropertyRow
              label="Core radius"
              title="Where the scenario's core sits, as its text states it"
            >
              {galaxy.core_radius}
            </PropertyRow>
          )}
        </Properties>
        {random && <div className="muted ins-hint">{random}</div>}
      </Section>
      {kind === "scenario" && <HeaderSection header={header} />}
      <Section id="galaxy.file" title="File">
        <Properties>
          <PropertyRow label="Name">{path === null ? "not saved yet" : fileName(path)}</PropertyRow>
          <PropertyRow label="Path" mono>
            {path ?? "—"}
          </PropertyRow>
        </Properties>
        {cloud && (
          <div className="ins-warn">
            This save sits in Steam Cloud; Steam may overwrite it with its cloud copy.
          </div>
        )}
      </Section>
      <Section id="galaxy.next" title="Next">
        <div className="ins-actions">
          <button type="button" onClick={() => requestFit()}>
            Fit the galaxy (Home)
          </button>
        </div>
        <div className="muted ins-hint">
          Click a system to inspect it, drag a system to move it, or drag from a system&apos;s ring
          to lay a hyperlane.
        </div>
      </Section>
    </>
  );
}
