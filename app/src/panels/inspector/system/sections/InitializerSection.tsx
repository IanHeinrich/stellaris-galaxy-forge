import type { CountryRef } from "../../../../generated/CountryRef";
import type { SystemNode } from "../../../../generated/SystemNode";
import type { SystemSpawn } from "../../../../generated/SystemSpawn";
import { hasStatedRows } from "../../../../lib/details/spawnFacts";
import { displayName } from "../../../../lib/names";
import { fileName } from "../../../../lib/paths";
import { kindLabel } from "../../../../lib/special";
import { useCanEdit } from "../../../../store/fileSessionStore";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { browseInitializers, INITIALIZERS_NEED_GAME_DATA } from "../../../initializers/entry";
import { useApplySymmetricOp } from "../../../useApplyOp";
import { useNamed } from "../../../useNamed";
import { TextField } from "../../../EditField";
import { openGameFile } from "../../../openGameFile";
import { Properties, PropertyRow, Section } from "../../parts";
import { kindHover } from "./kindHover";
import { InitializerSpawn } from "./scenario/Initializer";
import { StatedGroups, StatedRows } from "./scenario/InitializerFacts";
import { useInitializerFile } from "./scenario/useInitializerFile";

export const SEAT_INITIALIZER_HINT =
  "An empire that spawns here brings its own starting system in place of this one. " +
  "What this initializer spawns around it, like Sol's neighbours, still appears. " +
  "If no empire lands here, it is used as written.";

/** The initializer's name typed in, for when no game data is loaded to browse. */
function InitializerField({ system }: { system: SystemNode }) {
  const applyOp = useApplySymmetricOp();
  return (
    <>
      <TextField
        kind="text"
        className="ins-init-field"
        label="Initializer"
        value={system.initializer}
        onCommit={(value) =>
          applyOp({
            type: "SetInitializer",
            system: system.id,
            initializer: value.trim() === "" ? null : value.trim(),
          })
        }
      />
      <div className="muted ins-hint">{INITIALIZERS_NEED_GAME_DATA}</div>
    </>
  );
}

/** The countries the initializer creates, each with its type's name where the game data has one. */
function CreatesRow({ countries }: { countries: readonly CountryRef[] }) {
  const typeName = useNamed(
    countries.map((c) => c.country_type),
    () => "",
  );
  return (
    <PropertyRow label="Creates">
      {countries.map((c, i) => (
        <span key={`${c.name_key}-${i}`} className="ins-init-country">
          {c.name ?? displayName(c.name_key)}
          {typeName(c.country_type) !== "" && (
            <span className="muted"> · {typeName(c.country_type)}</span>
          )}
        </span>
      ))}
    </PropertyRow>
  );
}

/** What kind of system the initializer makes, its file, and the two ways out to that file. */
function SubLine({ system, file }: { system: SystemNode; file: string | null }) {
  const special = useGameDataStore((s) => s.special.get(system.id));
  const scripted = useCanEdit("scripts");
  const kinds = scripted ? (special?.kinds ?? []) : [];
  if (kinds.length === 0 && file === null) return null;
  const shown = file === null ? "" : fileName(file) || file;
  return (
    <div className="muted ins-init-sub">
      <span className="ins-init-what">
        {kinds.map((k, i) => (
          <span key={k} title={kindHover(system, k)}>
            {i > 0 && " · "}
            {kindLabel(k)}
          </span>
        ))}
        {file !== null && (
          <span title={file}>
            {kinds.length > 0 && " · "}
            {shown}
          </span>
        )}
      </span>
      {file !== null && (
        <span className="ins-init-links">
          <button type="button" className="link" onClick={() => openGameFile(file, false)}>
            Open file
          </button>
          <button type="button" className="link" onClick={() => openGameFile(file, true)}>
            Show in folder
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * The initializer: its name and the button that changes it, what kind of system it makes and
 * where it is defined, the countries it creates, and on a scenario what it states beyond a save's
 * fields. The bodies it places are listed only where the system's own contents are not: they are
 * the same list.
 */
export function InitializerSection({
  system,
  spawn = true,
  stated,
}: {
  system: SystemNode;
  spawn?: boolean;
  stated?: SystemSpawn;
}) {
  const special = useGameDataStore((s) => s.special.get(system.id));
  const ready = useGameDataStore((s) => s.status === "ready");
  const scripted = useCanEdit("scripts");
  const editable = useCanEdit("create_systems");
  const file = useInitializerFile(system.initializer);
  const unknown = ready && special?.initializer_known === false;
  const countries = special?.countries ?? [];
  const named = system.initializer !== "";
  const seat =
    scripted &&
    (system.spawn_script !== null ||
      (system.spawn_weight ?? 0) > 0 ||
      system.spawn_design !== null);
  const rows = countries.length > 0 || (stated !== undefined && hasStatedRows(stated));
  return (
    <Section id="system.initializer" title="Initializer" startClosed={!editable}>
      <div className="ins-init">
        <div className="ins-init-head">
          <span className="mono ins-init-name">
            {system.initializer || (editable ? "Random (no initializer)" : "—")}
            {unknown && (
              <span className="ins-unknown">
                {editable ? " (not in loaded game data)" : " (unknown to game data)"}
              </span>
            )}
          </span>
          {editable && ready && (
            <button type="button" onClick={() => browseInitializers([system.id])}>
              {named ? "Change…" : "Choose…"}
            </button>
          )}
        </div>
        <SubLine system={system} file={file} />
        {editable && !ready && <InitializerField system={system} />}
        {seat && <div className="muted ins-hint">{SEAT_INITIALIZER_HINT}</div>}
        {rows && (
          <Properties>
            {countries.length > 0 && <CreatesRow countries={countries} />}
            {stated !== undefined && <StatedRows spawn={stated} />}
          </Properties>
        )}
        {stated !== undefined && <StatedGroups spawn={stated} file={file} />}
        {spawn && named && <InitializerSpawn name={system.initializer} />}
      </div>
    </Section>
  );
}
