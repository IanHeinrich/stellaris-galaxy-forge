import { useMemo, useState } from "react";
import * as ipc from "../api/ipc";
import { layoutLines, lineText, scriptLines, type ScriptLine } from "../lib/scriptText";
import { useFileSessionStore } from "../store/fileSessionStore";
import { openGameFile } from "./openGameFile";
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

/** Copy and Open file at the right, and the line the snippet starts on where that is known. */
function SourceBar({ source, text }: { source: SnippetSource; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      (e: unknown) => useFileSessionStore.getState().setError(ipc.errorMessage(e)),
    );
  return (
    <div className="snippet-bar">
      <span className="snippet-where">{source.line !== undefined && `line ${source.line}`}</span>
      <button type="button" className="link" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        type="button"
        className="link"
        title={source.file}
        onClick={() => openGameFile(source.file, false)}
      >
        Open file
      </button>
    </div>
  );
}

const PLAIN = new Set(["space", "value", "operator", "brace"]);

function Line({ line }: { line: ScriptLine }) {
  return (
    <span
      className={line.changed ? "snippet-line changed" : "snippet-line"}
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
    </span>
  );
}

/**
 * Script text as the file writes it, read-only: its own case, quotes and comments, moved left by
 * the indent its lines share and coloured as modders see it in their editor. A long one shows its
 * first lines and a control for the rest. With a `source`, a bar offers Copy and Open file.
 * With `layout`, the text is laid out one statement per line as a game file is, never folded, and
 * its long lines wrap; `changed` then marks the text an edit changed, by offsets into `text`.
 */
export function ScriptSnippet({
  text,
  source,
  changed,
  layout = false,
}: {
  text: string;
  source?: SnippetSource;
  changed?: readonly (readonly [number, number])[];
  layout?: boolean;
}) {
  const [all, setAll] = useState(false);
  const lines = useMemo(
    () => (layout ? layoutLines(text, changed) : scriptLines(text)),
    [text, changed, layout],
  );
  const long = !layout && lines.length > FOLD_LINES;
  const shown = long && !all ? lines.slice(0, FOLD_LINES) : lines;
  const marked = lines.some((line) => line.changed);
  return (
    <>
      <div className="snippet">
        {source !== undefined && (
          <SourceBar source={source} text={lines.map(lineText).join("\n")} />
        )}
        <pre className={layout ? "snippet-text wrap" : "snippet-text"}>
          {shown.map((line, i) => (
            <Line key={i} line={line} />
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
      {marked && (
        <div className="muted snippet-legend">
          <span className="snippet-legend-mark" aria-hidden="true" />
          Marked lines were changed by an edit.
        </div>
      )}
    </>
  );
}
