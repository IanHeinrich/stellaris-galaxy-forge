import { useEffect, useMemo } from "react";
import type { SystemNode } from "../../../../generated/SystemNode";
import { displayName } from "../../../../lib/names";
import { kindLabel } from "../../../../lib/special";
import { useCanEdit, useFileSessionStore } from "../../../../store/fileSessionStore";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { browseInitializers, INITIALIZERS_NEED_GAME_DATA } from "../../../initializers/entry";
import { useApplySymmetricOp } from "../../../useApplyOp";
import { TextField } from "../../../EditField";
import { SourceChip } from "../../../parts";
import { Section } from "../../parts";
import { kindHover } from "./kindHover";
import { InitializerSpawn } from "./scenario/Initializer";
import { ScriptActions } from "./scenario/scriptActions";

export const SEAT_INITIALIZER_HINT =
  "An empire that spawns here brings its own starting system in place of this one. " +
  "What this initializer spawns around it, like Sol's neighbours, still appears. " +
  "If no empire lands here, it is used as written.";

/** Choosing what a system is: the browser with game data loaded, the raw name without it. */
function InitializerEditor({ system }: { system: SystemNode }) {
  const ready = useGameDataStore((s) => s.status === "ready");
  const applyOp = useApplySymmetricOp();

  if (!ready) {
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
              id: system.id,
              initializer: value.trim() === "" ? null : value.trim(),
            })
          }
        />
        <div className="muted ins-hint">{INITIALIZERS_NEED_GAME_DATA}</div>
      </>
    );
  }
  return (
    <div className="ins-actions">
      <button type="button" onClick={() => browseInitializers([system.id])}>
        Choose…
      </button>
    </div>
  );
}

/**
 * The initializer, whether the loaded game data knows it, and the countries it spawns here. The
 * bodies it places are listed only where the system's own contents are not: they are the same list.
 */
export function InitializerSection({
  system,
  spawn = true,
}: {
  system: SystemNode;
  spawn?: boolean;
}) {
  const special = useGameDataStore((s) => s.special.get(system.id));
  const ready = useGameDataStore((s) => s.status === "ready");
  const initializers = useGameDataStore((s) => s.initializers);
  // Only a scenario names the file its systems are generated from; a save has none to open.
  const scenario = useFileSessionStore((s) => s.kind === "scenario");
  const editable = useCanEdit("create_systems");
  const unknown = ready && special?.initializer_known === false;
  const countries = special?.countries ?? [];
  const kinds = special?.kinds ?? [];
  const source = useMemo(
    () =>
      scenario ? (initializers?.find((e) => e.name === system.initializer)?.source ?? null) : null,
    [scenario, initializers, system.initializer],
  );

  // Reading the install again once game data is ready is what fills the list in.
  useEffect(() => {
    if (scenario) void useGameDataStore.getState().loadInitializers();
  }, [scenario, ready]);

  const known = initializers?.some((e) => e.name === system.initializer) ?? false;
  const derived = scenario && (countries.length > 0 || (spawn && known));
  const seat =
    scenario &&
    (system.spawn_script !== null ||
      (system.spawn_weight ?? 0) > 0 ||
      system.spawn_design !== null);
  return (
    <Section id="system.initializer" title="Initializer" startClosed={!editable}>
      <div className="ins-flags mono ins-init-line">
        {system.initializer || (editable ? "Random (no initializer)" : "—")}
        {scenario &&
          kinds.map((k) => (
            <span key={k} className="ins-kind" title={kindHover(system, k)}>
              · {kindLabel(k)}
            </span>
          ))}
        {unknown && (
          <span className="ins-unknown">
            {editable ? " (not in loaded game data)" : " (unknown to game data)"}
          </span>
        )}
        <ScriptActions file={source} />
      </div>
      {editable && <InitializerEditor system={system} />}
      {seat && <div className="muted ins-hint">{SEAT_INITIALIZER_HINT}</div>}
      {derived && (
        <div className="ins-line muted">
          <SourceChip source="initializers" />
          <span>what this initializer places here</span>
        </div>
      )}
      {countries.length > 0 && (
        <div className="ins-flags">
          {countries.map((c, i) => (
            <div key={`${c.name_key}-${i}`}>
              {c.name ?? displayName(c.name_key)} <span className="muted">{c.country_type}</span>
            </div>
          ))}
        </div>
      )}
      {spawn && system.initializer !== "" && <InitializerSpawn name={system.initializer} />}
    </Section>
  );
}
