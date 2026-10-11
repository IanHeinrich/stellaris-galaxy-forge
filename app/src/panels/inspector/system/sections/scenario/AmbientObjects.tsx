import type { AmbientObject } from "../../../../../generated/AmbientObject";
import { keyWords } from "../../../../../lib/text";
import { useNamed } from "../../../../useNamed";
import { DrillLink, Section } from "../../../parts";
import { openBody } from "../../../entity/openBody";
import { useSystemBodyNamer } from "../../../entity/useBodyName";

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

/** The ambient objects the initializer creates: each by its type, and the body it is created at. */
export function AmbientObjectSection({
  system,
  objects,
}: {
  system: number;
  objects: readonly AmbientObject[];
}) {
  const named = useNamed(
    objects.map((o) => o.kind),
    keyWords,
  );
  return (
    <Section id="system.ambientObjects" title="Ambient objects" count={objects.length}>
      {objects.map((object, i) => (
        <div key={`${object.kind}-${i}`} className="ins-prow static">
          <span className="pi ghost" aria-hidden="true" />
          <span>
            <span className="l1">{named(object.kind)}</span>
            {object.body !== null && <AtBody system={system} body={object.body} />}
          </span>
        </div>
      ))}
    </Section>
  );
}
