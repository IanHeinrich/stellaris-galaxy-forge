import type { HostMoonsFit } from "../../generated/HostMoonsFit";
import {
  HOST_MOONS_LABEL,
  hostMoonsSent,
  keepMoonsText,
  moonsRefusal,
  removeMoonsText,
} from "../../lib/hostMoonsAdd";
import { useMegastructureAddStore } from "../../store/megastructureAdd";
import { RadioChoice } from "./RadioChoice";

/**
 * The choice under the tiles of a type whose build removes the moons of the body it stands on:
 * remove them as the game does, picked on opening, or keep them. Where the save refuses to remove
 * them, Keep is picked and Remove is off, with the reason.
 */
export function HostMoonsPicks({
  kind,
  choice,
}: {
  kind: string;
  choice: Exclude<HostMoonsFit, { kind: "kept" }>;
}) {
  const keptFor = useMegastructureAddStore((s) => s.keepMoonsOf);
  const setKeepMoons = useMegastructureAddStore((s) => s.setKeepMoons);
  const keep = hostMoonsSent(choice, keptFor, kind) === "keep";
  const count = choice.kind === "removable" ? choice.count : null;
  const refused = choice.kind === "refused";

  return (
    <RadioChoice
      label={HOST_MOONS_LABEL}
      name="megastructure-moons"
      options={[
        {
          key: "remove",
          label: removeMoonsText(count),
          checked: !keep,
          disabled: refused,
          onPick: () => setKeepMoons(kind, false),
        },
        {
          key: "keep",
          label: keepMoonsText(count),
          checked: keep,
          onPick: () => setKeepMoons(kind, true),
        },
      ]}
      after={refused && <span className="muted">{moonsRefusal(choice)}</span>}
    />
  );
}
