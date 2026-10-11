import type { ReactNode } from "react";
import { ROLLED_TITLE } from "../../lib/details/spawnFacts";

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

/** Where a value comes from when it isn't the block itself: an inline script or an `@variable`. */
export function ComesFrom({ children }: { children: ReactNode }) {
  return <div className="ins-from">{children}</div>;
}
