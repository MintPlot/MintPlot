// @vitest-environment node
// Parity gate: tokens.css mint defaults must equal buildMaterialVars output
// byte-for-byte (whitespace-normalized). tokens.css is the no-JS fallback and
// mint's single source; acrylic.ts is the runtime builder — this spec is the
// anti-drift net for that dual source. Node env because jsdom vite-resolve
// rejects node: built-ins at top-level import (M4-g4 lesson).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMaterialVars, GLASS_T_DEFAULT } from '../../src/kernel/design/acrylic'

const css = readFileSync(resolve(process.cwd(), 'src/kernel/design/tokens.css'), 'utf8')
const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('.dark'))
const darkBlock = css.slice(css.indexOf('.dark'))

const readVar = (block: string, name: string): string => {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`))
  if (!match?.[1]) throw new Error(`[parity] ${name} not found in block`)
  return match[1]
}

const norm = (value: string): string => value.replace(/\s+/g, '')

const MATERIAL_KEYS = [
  '--mp-aurora-base',
  '--mp-glass-bg',
  '--mp-glass-border',
  '--mp-glass-edge',
  '--mp-glass-shadow',
  '--mp-accent-shadow',
  '--mp-surface-ai-bubble',
  '--mp-c-primary-hi',
  '--mp-card-fill-alpha',
] as const

describe('对拍:tokens.css 薄荷默认 ↔ acrylic 构建器(双真源防漂移)', () => {
  it('浅色默认逐项相等', () => {
    const built = buildMaterialVars('mint', 'light', GLASS_T_DEFAULT)
    for (const key of MATERIAL_KEYS) {
      expect(norm(readVar(rootBlock, key)), key).toBe(norm(built[key]!))
    }
  })

  it('深色默认逐项相等', () => {
    const built = buildMaterialVars('mint', 'dark', GLASS_T_DEFAULT)
    for (const key of MATERIAL_KEYS) {
      expect(norm(readVar(darkBlock, key)), key).toBe(norm(built[key]!))
    }
  })
})
