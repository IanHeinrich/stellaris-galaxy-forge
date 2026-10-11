import { useId, useMemo, useState, type ReactNode } from "react";
import {
  DEPENDS_ON_CLASS,
  NEVER_PLACED,
  ROLLED_TITLE,
  SHARED_VALUE_HINT,
  type ValueSource,
} from "../../lib/details/spawnFacts";
import { Chip } from "../parts";
import type { Press } from "./entity/OddsBar";
import { PickerCard } from "./entity/PickerCard";
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

/**
 * A value the game rolls when a game starts: a range, or what it is drawn from. Without
 * `children` it is the die alone, before a line that says what is rolled.
 */
export function Rolled({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <span className={className === undefined ? "ins-st-rolled" : `${className} ins-st-rolled`}>
      <RolledMark />
      {children}
    </span>
  );
}

/** A value decided when a game starts in a way Galaxy Forge can't show. */
export function Unknown({ children }: { children: ReactNode }) {
  return <span className="ins-st-unknown">{children}</span>;
}

/** The line over a list of what a roll can give, where the class the body gets decides the odds. */
export function DependsOnClass() {
  return (
    <div className="muted ins-hint">
      <Unknown>{DEPENDS_ON_CLASS}</Unknown>
    </div>
  );
}

/** What goes under a row, across both its columns. */
export function Why({ mono, children }: { mono?: boolean; children: ReactNode }) {
  return <div className={mono ? "ins-why mono" : "ins-why"}>{children}</div>;
}

/** The mark a body the game never places shows, on its list row and its page's head; `hint` says why. */
export function NeverPlaced({ hint }: { hint?: string }) {
  const mark = <span className="ins-block-count ins-never">{NEVER_PLACED}</span>;
  if (hint === undefined) return mark;
  return (
    <Hinted label={NEVER_PLACED} hint={hint} focusable={false}>
      {mark}
    </Hinted>
  );
}

/**
 * A value with more to say than fits its row: underlined, with what it says in a card beside the
 * Inspector on hover or focus. `label` heads the card. With `press` it is a toggle button named
 * `label`, and the card shows beside the button rather than inside it.
 */
export function Hinted({
  label,
  hint,
  focusable = true,
  press,
  children,
}: {
  label: string;
  hint: ReactNode;
  /** Takes the focus to show its card; false inside a control that takes it already. */
  focusable?: boolean;
  press?: Press;
  children: ReactNode;
}) {
  const id = useId();
  const cardId = `${id}-card`;
  const [shown, setShown] = useState(false);
  const item = useMemo(() => ({ label, effects: [] }), [label]);
  const describedBy = shown ? cardId : undefined;
  const focus = { onFocus: () => setShown(true), onBlur: () => setShown(false) };
  const card = shown && (
    <PickerCard
      id={cardId}
      rowId={id}
      item={item}
      beside=".ins-kv, .ins-group, .ins-sec, .ins-body"
    >
      <span className="dp-card-text">{hint}</span>
    </PickerCard>
  );
  if (press !== undefined) {
    return (
      <span
        id={id}
        className="ins-hinted-toggle"
        onMouseEnter={() => setShown(true)}
        onMouseLeave={() => setShown(false)}
      >
        <button
          type="button"
          className="ins-toggle"
          aria-label={label}
          aria-pressed={press.pressed}
          aria-describedby={describedBy}
          onClick={press.onPress}
          {...focus}
        >
          {children}
        </button>
        {card}
      </span>
    );
  }
  return (
    <span
      id={id}
      className="ins-hinted"
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={describedBy}
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      {...(focusable ? focus : {})}
    >
      {children}
      {card}
    </span>
  );
}

/** A row whose value has a card on hover where it has more to say. */
export function HintedRow({
  label,
  hint,
  mono,
  children,
}: {
  label: string;
  hint: ReactNode;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <PropertyRow label={label} mono={mono}>
      {hint === null || hint === undefined || hint === false ? (
        children
      ) : (
        <Hinted label={label} hint={hint}>
          {children}
        </Hinted>
      )}
    </PropertyRow>
  );
}

/** Something the initializer stops, as a tag with a ban mark. */
export function StoppedTag({ children }: { children: ReactNode }) {
  return (
    <Chip>
      <span className="ins-ban" aria-hidden="true">
        ⊘
      </span>
      {children}
    </Chip>
  );
}

/** `@base_size`, or `the shared script grand_archive/x`: where a value the game files define once comes from. */
function SourceName({ source }: { source: ValueSource }) {
  return source.via === "variable" ? (
    <span className="mono">{source.name}</span>
  ) : (
    <>
      the shared script <span className="mono">{source.name}</span>
    </>
  );
}

/** What sets a value, as a line in its card: `The smallest size: from @base_size`. */
function SetByLine({ source, lead }: { source: ValueSource; lead?: string }) {
  return (
    <span className="ins-set-by">
      {lead === undefined ? "From" : `${lead}: from`} <SourceName source={source} />
    </span>
  );
}

/** What sets a row's value, in its card: a line per `@variable`. */
export function SetByLines({ sources }: { sources: readonly ValueSource[] }) {
  if (sources.length === 0) return null;
  return (
    <>
      {sources.map((source) => (
        <SetByLine key={`${source.label}-${source.name}`} source={source} lead={source.label} />
      ))}
      <span className="ins-set-by muted">{SHARED_VALUE_HINT}</span>
    </>
  );
}

/** A value an inline script or an `@variable` gives, as a row: what it is, then what sets it. */
export function SetByRow({ source }: { source: ValueSource }) {
  return (
    <HintedRow label={source.label} hint={SHARED_VALUE_HINT}>
      From <SourceName source={source} />
    </HintedRow>
  );
}
