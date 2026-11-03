/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// Vitest blanks CSS imports (even ?raw), so the file is read directly.
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'theme.css'),
  'utf8',
)

// 정규식이 CSS 모양에 묶여 있으므로, 못 찾으면 어느 블록인지 알려 주며 실패한다.
const block = (re: RegExp, label: string) => {
  const m = css.match(re)
  if (!m) throw new Error(`theme.css: ${label} block not found (regex ${re})`)
  return m[1]
}
const lightBlock = block(/:root\s*{([^}]*)}/, ':root')
const darkBlock = block(
  /@media \(prefers-color-scheme: dark\)\s*{\s*:root\s*{([^}]*)}/,
  'dark :root',
)
const inlineBlock = block(/@theme inline\s*{([^}]*)}/, '@theme inline')

const names = (b: string) => [...b.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])
const values = (b: string) =>
  Object.fromEntries(
    [...b.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
  )

const light = names(lightBlock)
const dark = names(darkBlock)
const referenced = [...inlineBlock.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1])
const themes = [
  ['light', values(lightBlock)],
  ['dark', values(darkBlock)],
] as const

// WCAG 상대 휘도 대비
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

it.each(themes)('%s: text pairs reach 4.5:1 and control borders 3:1', (_, t) => {
  for (const text of ['fg', 'muted', 'ok', 'warn', 'err', 'info']) {
    for (const ground of ['bg', 'surface']) {
      expect(contrast(t[text], t[ground]), `${text} on ${ground}`).toBeGreaterThanOrEqual(4.5)
    }
  }
  expect(contrast(t['line-strong'], t.bg), 'line-strong on bg').toBeGreaterThanOrEqual(3)
})

it.each(themes)('%s: surface is a visible step from bg (1.08:1 or more)', (_, t) => {
  expect(contrast(t.surface, t.bg)).toBeGreaterThanOrEqual(1.08)
})

it('dark overrides exactly the variables the light theme defines', () => {
  expect([...dark].sort()).toEqual([...light].sort())
})

it('@theme inline points at exactly the defined variables', () => {
  expect([...new Set(referenced)].sort()).toEqual([...light].sort())
})
