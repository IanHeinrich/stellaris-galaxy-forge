import type { AmbientObject } from "../../../../../generated/AmbientObject";
import type { AmbientPlace } from "../../../../../generated/AmbientPlace";
import { documentCapabilities } from "../../../../../lib/capabilities";
import {
  AT_A_RANDOM_SPOT,
  NO_AMBIENT_OBJECTS,
  originMark,
} from "../../../../../lib/details/placedRows";
import { keyWords } from "../../../../../lib/text";
import { useFileSessionStore } from "../../../../../store/fileSessionStore";
import { OriginMark } from "../../../../parts";
import { useNamed } from "../../../../useNamed";
import { DrillLink, Empty, Section } from "../../../parts";
import { openBody } from "../../../entity/openBody";
import { useSystemBodyNamer } from "../../../../useBodyName";

/** The body an ambient object is created at, opening its page. */
function AtBody({ system, body }: { system: number; body: number }) {
  const name = useSystemBodyNamer(system)(body) ?? `#${body}`;
  return (
    <span className="l2">
      at{" "}
      <DrillLink title="Open the body's page" onOpen={() => openBody(system, body, name)}>
        {name}
      </DrillLink>
    </span>
  );
}

/** Where an ambient object stands, under its name; nothing for one at a point of its own. */
function Where({ system, place }: { system: number; place: AmbientPlace }) {
  switch (place.place) {
    case "body":
      return <AtBody system={system} body={place.body} />;
    case "random":
      return <span className="l2">{AT_A_RANDOM_SPOT}</span>;
    case "point":
      return null;
    default:
      return place satisfies never;
  }
}

/**
 * The ambient objects the initializer and the scenario's own block create: each by its type, where
 * it stands and where it comes from. With none, a line on how to add one where the document can.
 */
export function AmbientObjectSection({
  system,
  objects,
}: {
  system: number;
  objects: readonly AmbientObject[];
}) {
  const editable = useFileSessionStore((s) => documentCapabilities(s).ambient_objects);
  const named = useNamed(
    objects.map((o) => o.kind),
    keyWords,
  );
  return (
    <Section id="system.ambientObjects" title="Ambient objects" count={objects.length}>
      {objects.length === 0 && <Empty>{NO_AMBIENT_OBJECTS}</Empty>}
      {objects.map((object, i) => {
        const mark = originMark(object.origin, editable);
        return (
          <div key={`${object.kind}-${i}`} className="ins-prow static">
            <span className="pi ghost" aria-hidden="true" />
            <span>
              <span className="l1">
                {named(object.kind)}
                {mark !== null && <OriginMark mark={mark} />}
              </span>
              <Where system={system} place={object.place} />
            </span>
          </div>
        );
      })}
    </Section>
  );
}
