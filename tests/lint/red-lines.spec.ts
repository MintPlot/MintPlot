/**
 * Red-line CI proof (ADR-001 §08) — the shipped eslint.config.js actually
 * fires: the real kernel tree lints clean, and canary snippets prove every
 * banned route is blocked. This guards against config rot: a rule someone
 * loosens or a path that stops matching fails this test, not a release.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

async function lintTree(patterns: string[]): Promise<string[]> {
  const eslint = new ESLint({ cwd: repoRoot })
  const results = await eslint.lintFiles(patterns)
  return results.flatMap((result) =>
    result.messages
      .filter((message) => message.severity === 2)
      .map((message) => `${path.relative(repoRoot, result.filePath)}: ${message.ruleId}: ${message.message}`),
  )
}

async function lintSnippet(filePath: string, code: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: repoRoot })
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, filePath) })
  return (result?.messages ?? [])
    .filter((message) => message.severity === 2)
    .map((message) => `${message.ruleId}: ${message.message}`)
}

describe('red line · kernel zero functional imports (章程 §3.5.4)', () => {
  it('the real kernel tree lints clean', async () => {
    const errors = await lintTree(['src/kernel/**/*.ts', 'src/kernel/**/*.vue'])
    expect(errors).toEqual([])
  })

  it('canary: kernel importing a plugin is blocked', async () => {
    const messages = await lintSnippet(
      'src/kernel/__canary__.ts',
      `import { anything } from '@/plugins/update-checker'\nexport const use = anything\n`,
    )
    expect(messages.some((message) => message.includes('no-restricted-imports'))).toBe(true)
  })
})

describe('red line · plugins only through the @contracts barrel (R-05)', () => {
  it('canary: plugin importing kernel internals is blocked', async () => {
    const messages = await lintSnippet(
      'src/plugins/__canary__.ts',
      `import { createPluginRuntime } from '@/kernel/runtime'\nexport const use = createPluginRuntime\n`,
    )
    expect(messages.some((message) => message.includes('no-restricted-imports'))).toBe(true)
  })

  it('canary: deep @contracts path is blocked (barrel-only)', async () => {
    const messages = await lintSnippet(
      'src/plugins/__canary__.ts',
      `import { validateManifest } from '@contracts/manifest'\nexport const use = validateManifest\n`,
    )
    expect(messages.some((message) => message.includes('no-restricted-imports'))).toBe(true)
  })

  it('canary: relative escape into contracts/ is blocked', async () => {
    const messages = await lintSnippet(
      'src/plugins/__canary__.ts',
      `import { definePlugin } from '../../contracts/index'\nexport const use = definePlugin\n`,
    )
    expect(messages.some((message) => message.includes('no-restricted-imports'))).toBe(true)
  })

  it('the bare barrel import stays legal', async () => {
    const messages = await lintSnippet(
      'src/plugins/__canary__.ts',
      `import { definePlugin } from '@contracts'\nexport const use = definePlugin\n`,
    )
    expect(messages.filter((message) => message.includes('no-restricted-imports'))).toEqual([])
  })
})

describe('red line · RP-lineage literals (移植流水 §04)', () => {
  // Assembled at runtime so this spec file itself carries no matching literal —
  // the red-line rule scans tests/** too.
  const residues = ['RP' + 'H', 'rp_hub' + '_key', 'sta' + '1n.cn']

  it.each(residues)('canary: literal "%s" is blocked', async (literal) => {
    const messages = await lintSnippet(
      'src/plugins/__canary__.ts',
      `export const residue = '${literal}'\n`,
    )
    expect(messages.some((message) => message.includes('no-restricted-syntax'))).toBe(true)
  })
})
