import type { SystemNode } from "../../../../../generated/SystemNode";
import {
  basesBeside,
  CLAN_NUMBERS,
  clanHomes,
  homeBeside,
  homeInitializer,
} from "../../../../../lib/marauder";
import { useSystemNames } from "../../../../../store/browserRows";
import { useEditorStore } from "../../../../../store/editorStore";
import { usePaintLayer } from "../../../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../../../store/galaxyStore";
import { useApplyOp } from "../../../../useApplyOp";
import { Section } from "../../../parts";
import { useEditableSystem } from "../../editable";

/** What a clan home is, in three short lines: the initializer spawns the clan, the mod its bases. */
export function homeIntro(clan: number): readonly string[] {
  return [
    `This system is clan ${clan}'s home.`,
    "The initializer creates the clan at game start.",
    "The Paint a Galaxy mod adds its two raid bases beside it on day one, linked by hyperlane.",
  ];
}

/** What the section says of a base with no home of its clan on a lane. */
export const NO_HOME_BESIDE = "No clan home beside it. Nothing spawns here.";

/**
 * The marauder clan a scenario system is part of under Paint a Galaxy: a home, whose clan the
 * select renumbers and the button removes, or a raid base, which names its home.
 */
export function MarauderSection({ system }: { system: SystemNode }) {
  const editable = useEditableSystem();
  const paint = usePaintLayer();
  if (!editable || !paint || system.marauder === null) return null;
  return "home" in system.marauder ? (
    <Home system={system} clan={system.marauder.home} />
  ) : (
    <Base system={system} clan={system.marauder.base} />
  );
}

function Home({ system, clan }: { system: SystemNode; clan: number }) {
  const applyOp = useApplyOp();
  const removeMarauderClan = useEditorStore((s) => s.removeMarauderClan);
  const systems = useGalaxyStore((s) => s.systems);
  const bases = basesBeside(system, systems);
  const baseNames = useSystemNames(bases.map((b) => b.id));
  const homes = clanHomes(systems);
  const heldByAnother = (n: number) => (homes.get(n) ?? []).some((id) => id !== system.id);
  const setClan = (clan: number) =>
    applyOp({ type: "SetInitializer", id: system.id, initializer: homeInitializer(clan) });
  return (
    <Section id="system.marauder" title={`Marauder clan ${clan}`}>
      <ul className="muted ins-hint ins-fe-zone-intro">
        {homeIntro(clan).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {bases.length > 0 && <div className="ins-line">Raid bases: {baseNames.join(", ")}.</div>}
      <div className="ins-fe-zone">
        <label>
          Clan
          <select
            aria-label="Marauder clan"
            value={clan}
            onChange={(e) => setClan(Number(e.currentTarget.value))}
          >
            {CLAN_NUMBERS.map((n) => (
              <option key={n} value={n} disabled={heldByAnother(n)}>
                {heldByAnother(n) ? `${n} · in use` : n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ins-actions">
        <button type="button" onClick={() => void removeMarauderClan(system.id)}>
          Remove clan
        </button>
      </div>
    </Section>
  );
}

function Base({ system, clan }: { system: SystemNode; clan: number }) {
  const systems = useGalaxyStore((s) => s.systems);
  const home = homeBeside(system, systems);
  const [homeName] = useSystemNames(home === null ? [] : [home.id]);
  return (
    <Section id="system.marauder" title={`Marauder clan ${clan}`}>
      <div className="ins-line">Raid base of clan {clan}.</div>
      {home === null ? (
        <div className="ins-warn">{NO_HOME_BESIDE}</div>
      ) : (
        <div className="ins-line">Its clan home is {homeName}.</div>
      )}
    </Section>
  );
}
