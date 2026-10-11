import type { ReactNode } from "react";
import { ROLLED_TITLE, type ValueSource } from "../../lib/details/spawnFacts";
import { PropertyRow } from "./parts";

/**
 * The three states a scenario value is in, one look each wherever it shows: fixed is plain text,
 * rolled is drawn with a die mark, and unknown with a question mark.
 */

/** The die that marks a rolled value, which says on hover what it means. */
export function RolledMark() {
  return (
    <span className="ins-die" role="img" aria-label={ROLLED_TITLE} title={ROLLED_TITLE}>
      <svg viewBox="0 0 10 10" aria-hidden="true">
        <rect x="0.75" y="0.75" width="8.5" height="8.5" rx="2" />
        <circle cx="3.1" cy="3.1" r="0.95" />
        <circle cx="5" cy="5" r="0.95" />
        <circle cx="6.9" cy="6.9" r="0.95" />
      </svg>
    </span>
  );
}

/** A value the game rolls when a game starts: a range, or what it is drawn from. */
export function Rolled({ children }: { children: ReactNode }) {
  return (
    <span className="ins-st-rolled">
      <RolledMark />
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
