import { Fragment } from "react";
import type { EntityAddr } from "../../../generated/EntityAddr";
import { kindWords, sourceSegments } from "../../../lib/entities";
import { Empty } from "../parts";
import { useEntitySource } from "./useEntity";

/**
 * The entity's current bytes, read-only, with the ranges an op changed marked. A `<pre>` rather
 * than an editor: the app carries no editor dependency yet, and Tier 2 is what brings one.
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
  const segments = sourceSegments(source.text, source.changed);
  return (
    <>
      <pre className="ins-source mono">
        {segments.map((segment, i) => (
          <Fragment key={i}>
            {segment.changed ? (
              <mark className="ins-changed" title="changed by an edit">
                {segment.text}
              </mark>
            ) : (
              segment.text
            )}
          </Fragment>
        ))}
      </pre>
      {source.truncated && (
        <div className="muted ins-hint">
          Showing the first mebibyte of this {kindWords(addr.kind)}.
        </div>
      )}
    </>
  );
}
