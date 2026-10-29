import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { DSH_SURFACE } from '../packages/ppc/ppc-surface/src/index.ts'
import { renderManifest } from './gen-ppc-surface.ts'

const root = resolve(import.meta.dirname, '..')
const MANIFEST = 'packages/ppc/ppc-surface/surface-manifest.json'

describe('the published surface manifest', () => {
  it('matches what the generator produces from the current surface', () => {
    const generated = renderManifest()
    expect(
      readFileSync(resolve(root, MANIFEST), 'utf8'),
      'stale manifest — run `pnpm run gen-ppc-surface`',
    ).toBe(generated)
  })

  it('carries every rule a substrate needs to accept and validate a proposal', () => {
    const manifest = JSON.parse(renderManifest()) as Record<string, unknown>
    expect(manifest['name']).toBe('dsh')
    expect(manifest['alwaysOn']).toEqual(['PERSONA.md', 'AGENTS.md'])
    expect(manifest['skillDir']).toBe('.dsh/skills')
    expect(manifest['hooksFile']).toBe('hooks.json')
    expect(manifest['hookEvents']).toContain('PostToolUse')
    expect(manifest['alwaysOnMax']).toBe(16_000)
  })

  it('agrees with the surface value it is generated from', () => {
    const manifest = JSON.parse(renderManifest()) as Record<string, unknown>
    expect(manifest['alwaysOn']).toEqual([...DSH_SURFACE.alwaysOn])
    expect(manifest['alwaysOnMax']).toBe(DSH_SURFACE.alwaysOnMax)
    expect(manifest['skillDir']).toBe(DSH_SURFACE.skillDir)
    expect(manifest['scriptDir']).toBe(DSH_SURFACE.scriptDir)
    expect(manifest['hooksFile']).toBe(DSH_SURFACE.hooksFile)
    expect(manifest['hookEvents']).toEqual([...DSH_SURFACE.hookEvents])
    expect(manifest['autotriggerFile']).toBe(DSH_SURFACE.autotriggerFile)
    expect(manifest['triggerLine']).toBe(DSH_SURFACE.triggerLine)
    expect(manifest['stubs']).toEqual(
      DSH_SURFACE.stubs.map(([path, body]) => ({ path, body })),
    )
  })

  it('publishes a null plugin directory, because DSH has no plugin file', () => {
    const manifest = JSON.parse(renderManifest()) as Record<string, unknown>
    expect(manifest['pluginDir']).toBeNull()
  })
})
