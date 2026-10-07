import { readFileSync } from 'node:fs'
import { defineConfig, type DefaultTheme } from 'vitepress'
import { renderForSearch, searchOptions } from './search.mjs'

const repo = 'https://github.com/IanHeinrich/stellaris-galaxy-forge'
const base = '/stellaris-galaxy-forge/'
const siteUrl = `https://ianheinrich.github.io${base}`

const version = readFileSync(new URL('../../VERSION', import.meta.url), 'utf8')
  .trim()
  .split('.')
  .slice(0, 2)
  .join('.')

const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Get started',
    items: [
      { text: 'Install and update', link: '/start/install-and-update' },
      { text: 'Your first edit', link: '/start/first-edit' },
      { text: 'The window', link: '/start/the-window' },
      { text: 'Open a save or scenario', link: '/start/open' },
      { text: 'Game data and mods', link: '/start/game-data' }
    ]
  },
  {
    text: 'Find your way',
    items: [
      { text: 'Move around the map', link: '/map/navigate' },
      { text: 'Search', link: '/map/search' },
      { text: 'Layers', link: '/map/layers' }
    ]
  },
  {
    text: 'Edit the map',
    items: [
      { text: 'Select and move systems', link: '/edit/select-and-move' },
      { text: 'Hyperlanes', link: '/edit/hyperlanes' },
      { text: 'Add and delete systems', link: '/edit/add-systems' },
      { text: 'Brushes and symmetry', link: '/edit/brushes' },
      { text: 'System heights', link: '/edit/heights' },
      { text: 'Nebulae', link: '/edit/nebulae' },
      { text: 'Stars', link: '/edit/stars' },
      { text: 'Empires and the L-Gate', link: '/edit/empires' },
      { text: 'Wormholes', link: '/edit/wormholes' }
    ]
  },
  {
    text: 'Inside a system',
    items: [
      { text: 'System view', link: '/system/system-view' },
      { text: 'Arrange planets and moons', link: '/system/arrange-planets' },
      { text: 'Copy and move planets', link: '/system/copy-and-move-planets' },
      { text: 'Planet pages', link: '/system/planet-pages' },
      { text: 'Deposits and modifiers', link: '/system/deposits-and-modifiers' },
      { text: 'Edit several planets at once', link: '/system/edit-several-planets' },
      { text: 'Asteroid belts and the inner radius', link: '/system/belts' },
      { text: 'Colonies and deleting planets', link: '/system/colonies' }
    ]
  },
  {
    text: 'Build a galaxy',
    items: [
      { text: 'What a scenario is', link: '/scenario/what-is-a-scenario' },
      { text: 'Make a scenario', link: '/scenario/make-a-scenario' },
      { text: 'Paint a Galaxy', link: '/scenario/paint-a-galaxy' },
      { text: 'Spawn points', link: '/scenario/spawn-points' },
      { text: 'Initializers', link: '/scenario/initializers' },
      {
        text: 'Fallen empires, marauders and L-Gates',
        link: '/scenario/fallen-empires-marauders-lgates'
      },
      { text: 'Prepare for a new game', link: '/scenario/prepare' },
      { text: 'Export and play', link: '/scenario/play' }
    ]
  },
  {
    text: 'Save and avoid problems',
    items: [
      { text: 'Save, back up and restore', link: '/safety/saving' },
      { text: 'Steam Cloud', link: '/safety/steam-cloud' },
      { text: 'Undo and the Changes tab', link: '/safety/undo' },
      { text: 'Issues', link: '/safety/issues' },
      { text: 'Go back to your campaign', link: '/safety/back-to-campaign' }
    ]
  },
  {
    text: 'Reference',
    items: [
      { text: 'FAQ', link: '/reference/faq' },
      { text: 'Troubleshooting', link: '/reference/troubleshooting' },
      { text: 'Glossary', link: '/reference/glossary' },
      { text: 'Keyboard shortcuts', link: '/reference/keys' },
      { text: 'Supported game versions', link: '/reference/versions' },
      { text: 'Command line', link: '/reference/command-line' }
    ]
  }
].map((group) => ({ ...group, collapsed: false }))

export default defineConfig({
  title: 'Galaxy Forge guide',
  description:
    'How to use Stellaris Galaxy Forge to edit Stellaris saves and build galaxy scenarios.',
  lang: 'en-GB',
  base,
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: false,
  srcExclude: ['scripts/**', '**/README.md', 'images/SHOTS.md'],

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${base}app-icon.png` }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Galaxy Forge guide' }],
    ['meta', { property: 'og:image', content: `${siteUrl}social.png` }],
    ['meta', { name: 'twitter:card', content: 'summary' }]
  ],

  themeConfig: {
    logo: '/app-icon.png',

    nav: [
      { text: 'Download', link: `${repo}/releases/latest` },
      { text: 'Report a problem', link: `${repo}/issues` },
      { text: 'Workshop', link: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3805578137' },
      { component: 'GuideVersion', props: { text: `Guide for ${version}` } }
    ],

    sidebar,

    outline: { level: [2, 3], label: 'On this page' },

    docFooter: { prev: 'Previous page', next: 'Next page' },

    editLink: {
      pattern: `${repo}/blob/main/guide/:path`,
      text: 'Suggest a change to this page'
    },

    lastUpdated: { text: 'Last updated' },

    socialLinks: [{ icon: 'github', link: repo }],

    footer: {
      message: 'Stellaris is a Paradox Interactive title. Galaxy Forge is not affiliated with or endorsed by Paradox.',
      copyright: 'MIT licence'
    },

    search: {
      provider: 'local',
      options: {
        detailedView: true,
        miniSearch: { searchOptions },
        _render: renderForSearch
      }
    }
  }
})
