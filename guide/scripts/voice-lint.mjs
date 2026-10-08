import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const determiner =
  '(?:a|an|the|its|their|his|her|our|your|this|that|these|those|every|each|some|several|many|one|two|three|four|\\d+)'

const rules = [
  { name: 'carries', fix: 'say "shows" or "has"', pattern: /\bcarr(?:y|ies)\b/gi },
  { name: 'bears', fix: 'say "shows" or "has"', pattern: /\bbears\b/gi },
  { name: 'sports', fix: 'say "shows" or "has"', pattern: new RegExp(`\\bsports\\s+${determiner}\\b`, 'gi') },
  { name: 'features', fix: 'say "shows" or "has"', pattern: new RegExp(`\\bfeatures\\s+${determiner}\\b`, 'gi') },
  { name: 'boasts', fix: 'say "shows" or "has"', pattern: /\bboasts?\b/gi },
  { name: 'showcases', fix: 'say "shows"', pattern: /\bshowcases?\b/gi },
  { name: 'seamless', fix: 'cut it', pattern: /\bseamless(?:ly)?\b/gi },
  { name: 'effortless', fix: 'cut it', pattern: /\beffortless(?:ly)?\b/gi },
  { name: 'robust', fix: 'cut it or say what holds', pattern: /\brobust\b/gi },
  { name: 'leverage', fix: 'say "use"', pattern: /\bleverag(?:e|es|ed|ing)\b/gi },
  { name: 'powerful', fix: 'cut it', pattern: /\bpowerful\b/gi },
  { name: 'utilise', fix: 'say "use"', pattern: /\butili[sz](?:e|es|ed|ing|ation)\b/gi },
  { name: 'functionality', fix: 'name the feature', pattern: /\bfunctionalit(?:y|ies)\b/gi },
  { name: "whether you're", fix: 'cut it', pattern: /\bwhether you['\u2019]re\b/gi },
  { name: 'not just', fix: 'state what it does', pattern: /\bnot just\b/gi },
  { name: "it's worth noting", fix: 'cut it', pattern: /\bit['\u2019]s worth noting\b/gi },
  { name: 'simply', fix: 'cut it', pattern: /\bsimply\b/gi },
  { name: 'in order to', fix: 'say "to"', pattern: /\bin order to\b/gi },
  { name: 'em dash', fix: 'use a full stop, comma or brackets', pattern: /\u2014/g },
  { name: 'semicolon', fix: 'split the sentence', pattern: /;/g }
]

const guideDir = fileURLToPath(new URL('..', import.meta.url))
const skippedDirs = new Set(['node_modules', '.vitepress', 'scripts', 'public'])
const allowed = JSON.parse(readFileSync(new URL('voice-allow.json', import.meta.url), 'utf8'))

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return skippedDirs.has(entry.name) || entry.name.startsWith('.') ? [] : markdownFiles(path)
    }
    return entry.name.endsWith('.md') && entry.name !== 'README.md' ? [path] : []
  })
}

function blank(text) {
  return ' '.repeat(text.length)
}

function proseOf(line) {
  let prose = line
    .replace(/(`+)[\s\S]*?\1/g, blank)
    .replace(/\]\([^)]*\)/g, blank)
    .replace(/<[^>]*>/g, blank)
    .replace(/&#?\w+;/g, blank)
  for (const phrase of allowed) prose = prose.split(phrase).join(blank(phrase))
  return prose
}

function* bodyLines(text) {
  const lines = text.split(/\r?\n/)
  let i = 0
  if (lines[0] === '---') {
    i = lines.indexOf('---', 1) + 1
    if (i === 0) i = lines.length
  }
  let fence = null
  let inComment = false
  for (; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      continue
    }
    let visible = line
    if (inComment) {
      const end = visible.indexOf('-->')
      if (end < 0) continue
      inComment = false
      visible = blank(visible.slice(0, end + 3)) + visible.slice(end + 3)
    }
    visible = visible.replace(/<!--[\s\S]*?-->/g, blank)
    const start = visible.indexOf('<!--')
    if (start >= 0) {
      inComment = true
      visible = visible.slice(0, start)
    }
    yield { number: i + 1, text: visible }
  }
}

const failures = []
for (const file of markdownFiles(guideDir)) {
  const name = relative(guideDir, file).split('\\').join('/')
  for (const line of bodyLines(readFileSync(file, 'utf8'))) {
    const prose = proseOf(line.text)
    for (const rule of rules) {
      for (const match of prose.matchAll(rule.pattern)) {
        const from = Math.max(0, match.index - 30)
        const excerpt = line.text.slice(from, match.index + match[0].length + 30).trim()
        failures.push(`${name}:${line.number}  ${rule.name} (${rule.fix})  "${excerpt}"`)
      }
    }
  }
}

if (failures.length) {
  console.error(`Voice lint: ${failures.length} problem(s). Add an exact phrase to scripts/voice-allow.json only for a game word.\n`)
  for (const failure of failures) console.error(failure)
  process.exit(1)
}
console.log('Voice lint: no problems.')
