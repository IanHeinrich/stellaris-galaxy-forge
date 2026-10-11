import type { BodySpawn } from "../../../generated/BodySpawn";
import type { InitializerDefinition } from "../../../generated/InitializerDefinition";
import type { SourceLine } from "../../../generated/SourceLine";
import { fileName, normalise } from "../../../lib/paths";
import { scriptLines } from "../../../lib/scriptText";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { ScriptSnippet, type LineLink, type SnippetMark } from "../../ScriptSnippet";
import { useInitializerDefinition } from "../../../store/initializerDefinitionStore";

const BODY_KEYS = new Set(["planet", "moon"]);

/**
 * The lines of `definition` the block written at `at` spans, its braces counted from the first
 * `planet` or `moon` key on its line; none for a block written in another file.
 */
function blockMark(definition: InitializerDefinition, at: SourceLine): SnippetMark | undefined {
  if (normalise(at.file) !== normalise(definition.at.file)) return undefined;
  const first = at.line - definition.at.line + 1;
  const lines = scriptLines(definition.text);
  if (first < 1 || first > lines.length) return undefined;
  const head = lines[first - 1].tokens;
  const key = head.findIndex(
    (t) => (t.kind === "key" || t.kind === "keyword") && BODY_KEYS.has(t.text.toLowerCase()),
  );
  let depth = 0;
  for (let n = first; n <= lines.length; n++) {
    const tokens = n === first ? head.slice(Math.max(key, 0)) : lines[n - 1].tokens;
    for (const token of tokens) {
      if (token.kind !== "brace") continue;
      depth += token.text === "{" ? 1 : -1;
      if (depth === 0) return { first, last: n };
    }
  }
  return { first, last: lines.length };
}

/**
 * The lines of `definition` that place `spawn`'s body: its block, or, for a body an inline script
 * places, the first `inline_script` line that calls that script.
 */
function spawnMark(
  definition: InitializerDefinition,
  spawn: BodyBlock | undefined,
): SnippetMark | undefined {
  if (spawn?.at === undefined) return undefined;
  const block = blockMark(definition, spawn.at);
  if (block !== undefined || spawn.from_script === null) return block;
  const call = definition.inline_scripts.find((c) => c.script === spawn.from_script);
  return call === undefined ? undefined : { first: call.line, last: call.line };
}

function scriptLinks(definition: InitializerDefinition): LineLink[] {
  return definition.inline_scripts.flatMap((call) =>
    call.file === undefined ? [] : [{ line: call.line, target: call.file, name: call.script }],
  );
}

/** Where a body's block is written, and the inline script it was read from. */
type BodyBlock = Pick<BodySpawn, "at" | "from_script">;

/**
 * System `system`'s initializer as the game data defines it, under a heading with its name and
 * file, each `inline_script` line with a button to its script. With `spawn`, the lines that place
 * that body are marked. Nothing for a system with no initializer or without game data.
 */
export function InitializerSource({ system, spawn }: { system: number; spawn?: BodyBlock }) {
  const name = useGalaxyStore((s) => s.systems.get(system)?.initializer ?? "");
  const read = useInitializerDefinition(name);
  if (read === null) return null;
  if (read.error !== undefined) {
    return (
      <div className="muted ins-hint">
        The initializer {name}&apos;s definition could not be read: {read.error}
      </div>
    );
  }
  const definition = read.value;
  if (definition === undefined) {
    return <div className="muted ins-hint">Reading the initializer {name}…</div>;
  }
  return (
    <div className="ins-init-source">
      <div className="ins-init-head">
        <span className="mono ins-init-name">{name}</span>
        <span className="muted" title={definition.at.file}>
          {fileName(definition.at.file)}
        </span>
      </div>
      <ScriptSnippet
        text={definition.text}
        source={definition.at}
        folded={false}
        mark={spawnMark(definition, spawn)}
        lineLinks={scriptLinks(definition)}
      />
    </div>
  );
}
