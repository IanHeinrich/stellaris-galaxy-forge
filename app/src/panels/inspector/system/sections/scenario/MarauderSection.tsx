import type { SystemNode } from "../../../../../generated/SystemNode";
import {
  BASE_SITES,
  basesBeside,
  baseSite,
  CLAN_NUMBERS,
  clanHomes,
  homeBeside,
  type BaseSite,
} from "../../../../../lib/marauder";
import { useSystemNames } from "../../../../../store/browserRows";
import { useEditorStore } from "../../../../../store/editorStore";
import { useGalaxyStore } from "../../../../../store/galaxyStore";
import { Section } from "../../../parts";
import { useEditableSystem } from "../../editable";

/** What a clan home is, in three short lines: three systems, created at game start. */
export function homeIntro(clan: number): readonly string[] {
  return [
    `This system is clan ${clan}'s home.`,
    "The initializer creates the clan at game start.",
    "A clan is the home and two raid bases, each hyperlaned to it.",
  ];
}

/** What the section says of a base with no home of its clan on a lane. */
export const NO_HOME_BESIDE = "No clan home beside it. Nothing spawns here.";

export const ADD_BASES = "Add the missing raid bases";

/**
 * The marauder clan a scenario system is part of: a home, whose bases the section lists or
 * offers to add, whose clan the select renumbers and the button removes, or a raid base, which
 * names its home.
 */
export function MarauderSection({ system }: { system: SystemNode }) {
  const editable = useEditableSystem();
  if (!editable || system.marauder === null) return null;
  return "home" in system.marauder ? (
    <Home system={system} clan={system.marauder.home} />
  ) : (
    <Base system={system} clan={system.marauder.base} />
  );
}

function Home({ system, clan }: { system: SystemNode; clan: number }) {
  const renumberMarauderClan = useEditorStore((s) => s.renumberMarauderClan);
  const removeMarauderClan = useEditorStore((s) => s.removeMarauderClan);
  const addMarauderBases = useEditorStore((s) => s.addMarauderBases);
  const select = useEditorStore((s) => s.select);
  const systems = useGalaxyStore((s) => s.systems);
  const bases = basesBeside(system, systems);
  const baseNames = useSystemNames(bases.map((b) => b.id));
  const bySite = new Map<BaseSite, { id: number; name: string }>();
  bases.forEach((b, i) => {
    const wanted = baseSite(b);
    const site = bySite.has(wanted) ? BASE_SITES.find((s) => !bySite.has(s)) : wanted;
    if (site !== undefined) bySite.set(site, { id: b.id, name: baseNames[i] });
  });
  const missing = BASE_SITES.some((site) => !bySite.has(site));
  const homes = clanHomes(systems);
  const heldByAnother = (n: number) => (homes.get(n) ?? []).some((id) => id !== system.id);
  return (
    <Section id="system.marauder" title={`Marauder clan ${clan}`}>
      <ul className="muted ins-hint ins-fe-zone-intro">
        {homeIntro(clan).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {BASE_SITES.map((site) => {
        const base = bySite.get(site);
        return (
          <div className="ins-line" key={site}>
            Raid base {site}:{" "}
            {base === undefined ? (
              "missing"
            ) : (
              <button
                type="button"
                className="link"
                title="Select the raid base"
                onClick={() => void select(base.id)}
              >
                {base.name}
              </button>
            )}
          </div>
        );
      })}
      {missing && (
        <div className="ins-actions">
          <button type="button" onClick={() => void addMarauderBases(system.id)}>
            {ADD_BASES}
          </button>
        </div>
      )}
      <div className="ins-fe-zone">
        <label>
          Clan
          <select
            aria-label="Marauder clan"
            value={clan}
            onChange={(e) => void renumberMarauderClan(system.id, Number(e.currentTarget.value))}
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
        <button type="button" onClick={() => void removeMarauderClan(clan)}>
          Remove clan
        </button>
      </div>
    </Section>
  );
}

function Base({ system, clan }: { system: SystemNode; clan: number }) {
  const systems = useGalaxyStore((s) => s.systems);
  const select = useEditorStore((s) => s.select);
  const home = homeBeside(system, systems);
  const [homeName] = useSystemNames(home === null ? [] : [home.id]);
  return (
    <Section id="system.marauder" title={`Marauder clan ${clan}`}>
      <div className="ins-line">Raid base of clan {clan}.</div>
      {home === null ? (
        <div className="ins-warn">{NO_HOME_BESIDE}</div>
      ) : (
        <div className="ins-line">
          Its clan home is{" "}
          <button
            type="button"
            className="link"
            title="Select the home"
            onClick={() => void select(home.id)}
          >
            {homeName}
          </button>
          .
        </div>
      )}
    </Section>
  );
}
