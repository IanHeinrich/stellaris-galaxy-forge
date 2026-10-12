import { useEffect } from "react";
import { parseGameText, type GameTextSpan } from "../lib/gameText";
import { resourceAbbrev } from "../lib/details/resources";
import { useDetailsStore } from "../store/detailsStore";
import { Icon } from "./parts";
import "./panels.css";

/** `spans` as inline text: icons from `icons` (resource key to sprite), colours as `gt-<letter>` classes. */
export function GameTextSpans({
  spans,
  icons,
}: {
  spans: readonly GameTextSpan[];
  icons: ReadonlyMap<string, string>;
}) {
  return (
    <>
      {spans.map((span, i) => {
        switch (span.kind) {
          case "text":
            return span.text;
          case "break":
            return <br key={i} />;
          case "icon": {
            const sprite = icons.get(span.key);
            if (sprite === undefined) return null;
            return (
              <Icon
                key={i}
                className="gi gt-icon"
                keys={[sprite]}
                glyph={resourceAbbrev(span.key)}
              />
            );
          }
          case "colour":
            return (
              <span key={i} className={`gt-${span.colour}`}>
                <GameTextSpans spans={span.children} icons={icons} />
              </span>
            );
        }
      })}
    </>
  );
}

/** A localised game text with its `£resource£` icons and `§Y…§!` colours. */
export function GameText({ text }: { text: string }) {
  const icons = useDetailsStore((s) => s.resourceIcons);
  const needsIcons = text.includes("£") && icons.size === 0;
  useEffect(() => {
    if (needsIcons) void useDetailsStore.getState().loadResourceIcons();
  }, [needsIcons]);
  return <GameTextSpans spans={parseGameText(text)} icons={icons} />;
}
