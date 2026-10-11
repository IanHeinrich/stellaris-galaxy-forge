import type { EntityAddr } from "../../../generated/EntityAddr";
import { kindWords } from "../../../lib/entities";
import { ScriptSnippet } from "../../ScriptSnippet";
import { Empty } from "../parts";
import { useEntitySource } from "./useEntity";

/**
 * The entity's current bytes, read-only, laid out one statement per line for reading, with the
 * text an op changed marked. A scenario writes a whole system as one line; the file keeps it so.
 */
export function SourceTab({ addr }: { addr: EntityAddr }) {
  const { value: source, error } = useEntitySource(addr);
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
      <ScriptSnippet text={source.text} changed={source.changed} layout />
      {source.truncated && (
        <div className="muted ins-hint">
          Showing the first mebibyte of this {kindWords(addr.kind)}.
        </div>
      )}
    </>
  );
}
