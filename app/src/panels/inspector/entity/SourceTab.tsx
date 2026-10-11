import type { EntityAddr } from "../../../generated/EntityAddr";
import { kindWords } from "../../../lib/entities";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { ScriptSnippet } from "../../ScriptSnippet";
import { Empty } from "../parts";
import { InitializerSource } from "./InitializerSource";
import { useEntitySource } from "./useEntity";

/** The entity's own text, then, where `system` is given, that system's initializer. */
export function SourceTab({ addr, system }: { addr: EntityAddr; system?: number }) {
  return (
    <>
      <OwnText addr={addr} />
      {system !== undefined && <InitializerSource system={system} />}
    </>
  );
}

/**
 * The entity's current bytes, read-only, laid out one statement per line for reading, with the
 * text an op changed marked. A scenario writes a whole system as one line; the file keeps it so.
 * A scenario's text has the Open button for its line in the file.
 */
function OwnText({ addr }: { addr: EntityAddr }) {
  const { value: source, error } = useEntitySource(addr);
  const path = useFileSessionStore((s) => s.path);
  if (error !== undefined) {
    return (
      <Empty>
        This {kindWords(addr.kind)}&apos;s text could not be read: {error}
      </Empty>
    );
  }
  if (source === undefined) return <Empty>Reading the {kindWords(addr.kind)}&apos;s text…</Empty>;
  return (
    <>
      <ScriptSnippet
        text={source.text}
        changed={source.changed}
        layout
        source={
          path === null || source.line === undefined ? undefined : { file: path, line: source.line }
        }
      />
      {source.truncated && (
        <div className="muted ins-hint">
          Showing the first mebibyte of this {kindWords(addr.kind)}.
        </div>
      )}
    </>
  );
}
