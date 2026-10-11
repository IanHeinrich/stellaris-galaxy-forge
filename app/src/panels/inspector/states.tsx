import type { ReactNode } from "react";
import { ROLLED_TITLE, type ValueSource } from "../../lib/details/spawnFacts";
import { PropertyRow } from "./parts";

/**
 * The three states a scenario value is in, one look each wherever it shows: fixed is plain text,
 * rolled is drawn with a die mark, and unknown with a question mark.
 */

/** A value the game rolls when a game starts: a range, or what it is drawn from. */
export function Rolled({ children }: { children: ReactNode }) {
  return (
    <span className="ins-st-rolled" title={ROLLED_TITLE}>
      {children}
    </span>
  );
}

/** A value decided when a game starts in a way Galaxy Forge can't show. */
export function Unknown({ children }: { children: ReactNode }) {
  return <span className="ins-st-unknown">{children}</span>;
}

/** The reason under a row, across both its columns. */
export function Why({ children }: { children: ReactNode }) {
  return <span className="ins-why">{children}</span>;
}

/** A value an inline script or an `@variable` gives, as a row: what it is, then what sets it. */
export function SetByRow({ source }: { source: ValueSource }) {
  return (
    <PropertyRow label={source.label}>
      Set by the {source.via} <span className="mono">{source.name}</span>
    </PropertyRow>
  );
}
