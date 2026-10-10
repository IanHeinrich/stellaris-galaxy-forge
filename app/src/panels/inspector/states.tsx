import { useState, type ReactNode } from "react";
import { dedent, MAY_NOT_SPAWN, ROLLED_TITLE } from "../../lib/details/spawnFacts";
import { Twisty } from "../Twisty";

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

/** The chip on a body the game may not place. */
export function MayNotSpawnChip() {
  return <span className="chip ins-maybe">{MAY_NOT_SPAWN}</span>;
}

/** Lines past this many are hidden behind "show all". */
const RAW_LINES = 12;

/**
 * Statements as the file writes them, read-only and in their own case, moved left by the indent
 * their lines share, cut after a dozen lines with a control that shows the rest and hides it again.
 */
export function RawText({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const lines = dedent(text).split("\n");
  const long = lines.length > RAW_LINES;
  const shown = long && !all ? lines.slice(0, RAW_LINES) : lines;
  return (
    <div className="ins-written">
      <pre className="ins-written-text">{shown.join("\n")}</pre>
      {long && (
        <button
          type="button"
          className="link ins-written-more"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          <Twisty open={all} />
          {all ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

/** A small heading inside a section, with its count where it lists several things. */
export function SubHead({ title, count }: { title: string; count?: number }) {
  return (
    <div className="ins-subhead">
      {title}
      {count !== undefined && ` · ${count}`}
    </div>
  );
}
