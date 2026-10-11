import type { InitializerDefinition } from "../../../generated/InitializerDefinition";
import type { SourceLine } from "../../../generated/SourceLine";
import { fileName, normalise } from "../../../lib/paths";
import { scriptLines } from "../../../lib/scriptText";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { ScriptSnippet, type LineLink, type SnippetMark } from "../../ScriptSnippet";
import { useInitializerDefinition } from "../../../store/initializerDefinitionStore";

/**
 * The lines of `definition` the block written at `at` spans, its braces counted from its first
 * line; none for a block written in another file.
 */
function blockMark(
  definition: InitializerDefinition,
  at: SourceLine | undefined,
): SnippetMark | undefined {
  if (at === undefined || normalise(at.file) !== normalise(definition.at.file)) return undefined;
  const first = at.line - definition.at.line + 1;
  const lines = scriptLines(definition.text);
  if (first < 1 || first > lines.length) return undefined;
  let depth = 0;
  for (let n = first; n <= lines.length; n++) {
    for (const token of lines[n - 1].tokens) {
      if (token.kind !== "brace") continue;
      depth += token.text === "{" ? 1 : -1;
      if (depth === 0) return { first, last: n };
    }
  }
  return { first, last: lines.length };
}

function scriptLinks(definition: InitializerDefinition): LineLink[] {
  return definition.inline_scripts.flatMap((call) =>
    call.file === undefined ? [] : [{ line: call.line, target: call.file, name: call.script }],
  );
}

/**
 * System `system`'s initializer as the game data defines it, under a heading with its name, file
 * and line, each `inline_script` line with a button to its script. With `block`, the lines of the
 * body block written there are marked. Nothing for a system with no initializer or without game
 * data.
 */
export function InitializerSource({ system, block }: { system: number; block?: SourceLine }) {
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
          {fileName(definition.at.file)}, line {definition.at.line}
        </span>
      </div>
      <ScriptSnippet
        text={definition.text}
        source={definition.at}
        folded={false}
        mark={blockMark(definition, block)}
        lineLinks={scriptLinks(definition)}
      />
    </div>
  );
}
