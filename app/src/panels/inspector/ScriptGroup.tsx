import type { RawStatement } from "../../generated/RawStatement";
import {
  lineCount,
  looksForNeighbours,
  NEIGHBOUR_LOOKUP_WARNING,
  OTHER_KEYS_HINT,
  OTHER_KEYS_TITLE,
  rawText,
  SCRIPT_HINT,
  SCRIPT_TITLE,
} from "../../lib/details/spawnFacts";
import { counted } from "../../lib/text";
import { ScriptSnippet, type SnippetSource } from "../ScriptSnippet";
import { Group } from "./parts";

/** Where a snippet of `statements` starts: the first one's file and line, else the top of `file`. */
function snippetSource(
  statements: readonly RawStatement[],
  file: string | null,
): SnippetSource | undefined {
  const at = statements[0]?.at;
  if (at !== undefined) return at;
  return file === null ? undefined : { file };
}

/**
 * The lines an initializer runs at game start, on a system's page or a body's: their count, what
 * they are in the title's card, a warning where they look for a neighbouring system, and the text.
 * `file` is the initializer's file, which the snippet opens where the statements don't say where
 * they are written.
 */
export function ScriptGroup({
  id,
  statements,
  file,
}: {
  id: string;
  statements: readonly RawStatement[];
  file: string | null;
}) {
  if (statements.length === 0) return null;
  const text = rawText(statements);
  return (
    <Group
      id={id}
      title={SCRIPT_TITLE}
      hint={SCRIPT_HINT}
      tail={counted(lineCount(statements), "line")}
    >
      {looksForNeighbours(text) && <div className="ins-warn">{NEIGHBOUR_LOOKUP_WARNING}</div>}
      <ScriptSnippet text={text} source={snippetSource(statements, file)} />
    </Group>
  );
}

/** The initializer's lines Galaxy Forge keeps as written and shows nowhere else, with their count. */
export function OtherLinesGroup({
  id,
  statements,
  file,
}: {
  id: string;
  statements: readonly RawStatement[];
  file: string | null;
}) {
  if (statements.length === 0) return null;
  return (
    <Group id={id} title={OTHER_KEYS_TITLE} hint={OTHER_KEYS_HINT} tail={`${statements.length}`}>
      <ScriptSnippet text={rawText(statements)} source={snippetSource(statements, file)} />
    </Group>
  );
}
