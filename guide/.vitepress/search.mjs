// Read by config.mts and scripts/check-search.mjs, so the site and the check search alike.

export const searchOptions = {
  prefix: true,
  fuzzy: 0.2,
  boost: { title: 4, titles: 2, text: 1 }
}

// The fields VitePress indexes and loads its index with (its local search plugin and VPLocalSearchBox.vue).
export const indexFields = {
  fields: ['title', 'titles', 'text'],
  storeFields: ['title', 'titles']
}

const spellings = [
  ['colour', 'color'],
  ['colours', 'colors'],
  ['initialiser', 'initializer'],
  ['initialisers', 'initializers'],
  ['normalise', 'normalize'],
  ['organise', 'organize'],
  ['centre', 'center'],
  ['grey', 'gray']
]

// A section that uses any word on the left is also indexed under the words on the right.
const relatedWords = [
  ...spellings.flatMap(([a, b]) => [
    [[a], [b]],
    [[b], [a]]
  ]),
  [['height', 'heights'], ['z', 'coordinate', 'elevation', 'vertical', 'up', 'down']],
  [['elevation', 'vertical'], ['height']],
  [['hyperlane', 'hyperlanes'], ['lane', 'lanes']],
  [['lane', 'lanes'], ['hyperlane', 'hyperlanes']]
]

// MiniSearch's default tokenizer.
const wordSeparator = /[\n\r\p{Z}\p{P}]+/u

function wordsOf(html) {
  const text = html.replace(/<[^>]*>/g, ' ').toLowerCase()
  return new Set(text.split(wordSeparator).filter(Boolean))
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function extraWords(section, aliases) {
  const words = wordsOf(section)
  const extra = new Set(aliases)
  for (const [when, add] of relatedWords) {
    if (when.some((w) => words.has(w))) {
      for (const w of add) if (!words.has(w)) extra.add(w)
    }
  }
  return [...extra]
}

// Extra words go into the index HTML, not a processTerm: VitePress ships a processTerm to the browser as bare source, without the tables it closes over.
export function renderForSearch(src, env, md) {
  const html = md.render(src, env)
  if (env.frontmatter?.search === false) return ''
  const aliases = Array.isArray(env.frontmatter?.aliases) ? env.frontmatter.aliases.map(String) : []
  let aliasesPlaced = false
  return html
    .split(/(?=<h[1-6][\s>])/i)
    .map((section) => {
      if (!/^<h[1-6][\s>]/i.test(section)) return section
      const isFirstH1 = !aliasesPlaced && /^<h1[\s>]/i.test(section)
      if (isFirstH1) aliasesPlaced = true
      const extra = extraWords(section, isFirstH1 ? aliases : [])
      return extra.length ? `${section}<p>${escapeHtml(extra.join(' '))}</p>` : section
    })
    .join('')
}
