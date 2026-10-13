import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { layoutLines, scriptLineText, scriptLines, type ScriptLine } from "../lib/scriptText";
import { reportFailure } from "../store/fileSessionStore";
import type { OpenTarget } from "../store/scriptEditorStore";
import { OpenButton } from "./OpenButton";
import { Twisty } from "./Twisty";
import "./panels.css";

/** A snippet longer than this many lines shows this many until the reader asks for the rest. */
export const FOLD_LINES = 12;

/** What a changed line says on hover. */
export const CHANGED_TITLE = "changed by an edit";

/** The game-data file a snippet was read from, and the line it starts on where that is known. */
export interface SnippetSource {
  file: string;
  line?: number;
}

/** Lines of a snippet's text, from 1, both included. */
export interface SnippetMark {
  first: number;
  last: number;
}

/** A button at the end of a snippet's line that opens `target`, named `name`. */
export interface LineLink {
  line: number;
  target: OpenTarget;
  name: string;
}

/** Copy and the Open button at the right, and the line the snippet starts on where that is known. */
function SourceBar({ source, text }: { source: SnippetSource; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    reportFailure(
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }),
    );
  return (
    <div className="snippet-bar">
      <span className="snippet-where">{source.line !== undefined && `line ${source.line}`}</span>
      <button type="button" className="link" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
      <OpenButton target={source} />
    </div>
  );
}

const PLAIN = new Set(["space", "value", "operator", "brace"]);

function Line({
  line,
  marked,
  lineRef,
  tail,
}: {
  line: ScriptLine;
  marked: boolean;
  lineRef?: Ref<HTMLSpanElement>;
  tail?: ReactNode;
}) {
  const classes = [
    "snippet-line",
    ...(line.changed ? ["changed"] : []),
    ...(marked ? ["marked"] : []),
  ];
  return (
    <span
      ref={lineRef}
      className={classes.join(" ")}
      title={line.changed ? CHANGED_TITLE : undefined}
    >
      {line.tokens.map((token, i) => {
        const classes = [
          ...(PLAIN.has(token.kind) ? [] : [`snippet-${token.kind}`]),
          ...(token.changed ? ["snippet-changed"] : []),
        ];
        return classes.length === 0 ? (
          token.text
        ) : (
          <span key={i} className={classes.join(" ")}>
            {token.text}
          </span>
        );
      })}
      {tail}
    </span>
  );
}

/**
 * Script text as the file writes it, read-only: its own case, quotes and comments, moved left by
 * the indent its lines share and coloured as modders see it in their editor. A long one shows its
 * first lines and a control for the rest. With a `source`, a bar offers Copy and the Open button.
 * With `layout`, the text is laid out one statement per line as a game file is, never folded, and
 * its long lines wrap; `changed` then marks the text an edit changed, by offsets into `text`.
 * `mark` draws the line bar beside some of its lines, shows them however long the text is and
 * scrolls the first into view. `folded={false}` shows a long text whole. Each of `lineLinks` puts
 * a button that opens its target at the end of its line.
 */
export function ScriptSnippet({
  text,
  source,
  changed,
  layout = false,
  mark,
  folded = true,
  lineLinks = [],
}: {
  text: string;
  source?: SnippetSource;
  changed?: readonly (readonly [number, number])[];
  layout?: boolean;
  mark?: SnippetMark;
  folded?: boolean;
  lineLinks?: readonly LineLink[];
}) {
  const [all, setAll] = useState(false);
  const firstMarked = useRef<HTMLSpanElement>(null);
  const lines = useMemo(
    () => (layout ? layoutLines(text, changed) : scriptLines(text)),
    [text, changed, layout],
  );
  const markedPast = mark !== undefined && mark.last > FOLD_LINES;
  const long = folded && !layout && !markedPast && lines.length > FOLD_LINES;
  const shown = long && !all ? lines.slice(0, FOLD_LINES) : lines;
  const edited = lines.some((line) => line.changed);
  const isMarked = (n: number) => mark !== undefined && n >= mark.first && n <= mark.last;

  useEffect(() => {
    firstMarked.current?.scrollIntoView({ block: "nearest" });
  }, [mark?.first, mark?.last]);

  return (
    <>
      <div className="snippet">
        {source !== undefined && (
          <SourceBar source={source} text={lines.map(scriptLineText).join("\n")} />
        )}
        <pre className={layout ? "snippet-text wrap" : "snippet-text"}>
          {shown.map((line, i) => (
            <Line
              key={i}
              line={line}
              marked={isMarked(i + 1)}
              lineRef={mark?.first === i + 1 ? firstMarked : undefined}
              tail={lineLinks
                .filter((link) => link.line === i + 1)
                .map((link) => (
                  <OpenButton key={link.name} className="snippet-link" target={link.target}>
                    {link.name}
                  </OpenButton>
                ))}
            />
          ))}
        </pre>
        {long && (
          <div className="snippet-foot">
            <button
              type="button"
              className="link snippet-more"
              aria-expanded={all}
              onClick={() => setAll(!all)}
            >
              <Twisty open={all} />
              {all ? "Show fewer" : `Show all ${lines.length} lines`}
            </button>
          </div>
        )}
      </div>
      {edited && (
        <div className="muted snippet-legend">
          <span className="snippet-legend-mark" aria-hidden="true" />
          Marked lines were changed by an edit.
        </div>
      )}
    </>
  );
}
