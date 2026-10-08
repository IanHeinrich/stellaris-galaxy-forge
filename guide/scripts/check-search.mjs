import { existsSync, readFileSync, readdirSync } from 'node:fs'
import MiniSearch from 'minisearch'
import { indexFields, searchOptions } from '../.vitepress/search.mjs'

const top = 3
const chunksDir = new URL('../.vitepress/dist/assets/chunks/', import.meta.url)
const queriesFile = new URL('../search/queries.json', import.meta.url)
const config = readFileSync(new URL('../.vitepress/config.mts', import.meta.url), 'utf8')
const base = /const base = '([^']*)'/.exec(config)[1]

if (!existsSync(chunksDir)) {
  console.error('Search check: no build found. Run "npx vitepress build" first.')
  process.exit(1)
}

// VitePress emits the index for the root locale as a module whose default export is the
// index's JSON text.
const indexChunk = readdirSync(chunksDir).find((name) => /^@localSearchIndexroot\.[\w-]+\.js$/.test(name))
if (!indexChunk) {
  console.error('Search check: the build has no @localSearchIndexroot chunk. Is local search on?')
  process.exit(1)
}
const { default: indexJson } = await import(new URL(indexChunk, chunksDir).href)
const index = MiniSearch.loadJSON(indexJson, { ...indexFields, searchOptions })

if (!existsSync(queriesFile)) {
  console.error('Search check: search/queries.json is missing.')
  process.exit(1)
}
const queries = JSON.parse(readFileSync(queriesFile, 'utf8'))

function pageOf(id) {
  const [path, anchor = ''] = id.split('#')
  const page = path.startsWith(base) ? path.slice(base.length) : path.replace(/^\//, '')
  return { page: page.replace(/\/$/, '/index') || 'index', anchor }
}

function shown({ page, anchor }) {
  return anchor ? `${page}#${anchor}` : page
}

function hits(result, expect) {
  const [page, anchor] = expect.split('#')
  const found = pageOf(result.id)
  return found.page === page && (anchor === undefined || found.anchor === anchor)
}

const failures = []
for (const { q, expect } of queries) {
  const results = index.search(q).slice(0, top)
  if (!results.some((result) => hits(result, expect))) {
    failures.push({ q, expect, got: results.map((r) => shown(pageOf(r.id))) })
  }
}

if (failures.length) {
  console.error(`Search check: ${failures.length} of ${queries.length} queries miss their page in the top ${top}.\n`)
  const rows = failures.map((f) => [f.q, f.expect, f.got.join('  ') || '(no results)'])
  const widths = [0, 1].map((col) => Math.max(...rows.map((row) => row[col].length), col ? 6 : 5))
  console.error(`${'query'.padEnd(widths[0])}  ${'expect'.padEnd(widths[1])}  top ${top}`)
  for (const row of rows) console.error(`${row[0].padEnd(widths[0])}  ${row[1].padEnd(widths[1])}  ${row[2]}`)
  process.exit(1)
}
console.log(`Search check: all ${queries.length} queries find their page in the top ${top}.`)
