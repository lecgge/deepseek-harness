import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

type WorkflowStep = Record<string, unknown> & {
  name?: string
  run?: string
  if?: string
}

type DesktopReleaseWorkflow = {
  on: { push: { tags?: string[] } }
  jobs: { 'build-and-release': { steps: WorkflowStep[] } }
}

describe('desktop release workflow', () => {
  it('publishes dual-channel node-closure installers', () => {
    const workflow = yaml.load(
      readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/dsh-desktop-release.yml'), 'utf8'),
    ) as DesktopReleaseWorkflow
    expect(workflow.on.push.tags).toEqual(expect.arrayContaining(['desktop-v*']))

    const steps = workflow.jobs['build-and-release'].steps
    expect(steps.some(step => /pkg-cache/i.test(JSON.stringify(step)))).toBe(false)
    // apps/desktop depends on the npm `node` package; `pnpm exec node` launches
    // that native binary and does not set npm_execpath.
    expect(JSON.stringify(steps)).not.toContain('pnpm exec node')

    const build = steps.find(step => typeof step.run === 'string' && step.run.includes('build-exe-for-python-sdk'))
    expect(build?.run).toContain('--skip-pkg')
    expect(build?.run).not.toContain('pkg-fetch')

    const installer = steps.find(step => typeof step.run === 'string' && step.run.includes('dsh-desktop dist'))
    expect(installer?.run).toContain('dsh-desktop dist')

    const smokeIndex = steps.findIndex(step => step.name === 'Smoke staged runtime')
    const installerIndex = steps.findIndex(step => typeof step.run === 'string' && step.run.includes('dsh-desktop dist'))
    expect(steps[smokeIndex]?.run).toContain('scripts/smoke-desktop-runtime.ts')
    expect(smokeIndex).toBeGreaterThan(installerIndex)

    const rename = steps.find(step => step.name === 'Rename prerelease installer')
    expect(rename?.if).toContain("github.ref_type != 'tag'")
    expect(rename?.run).toContain('Substring(0, 12)')
    expect(rename?.run).toContain('DeepSeek-Harness-Setup-*-x64.exe')
    expect(rename?.run).toContain('Rename-Item')
    expect(rename?.run).toContain('-$shortSha-x64.exe')
    const renameIndex = steps.findIndex(step => step.name === 'Rename prerelease installer')
    const checksumIndex = steps.findIndex(step => step.name === 'Create checksums')
    expect(renameIndex).toBeGreaterThan(smokeIndex)
    expect(checksumIndex).toBeGreaterThan(renameIndex)

    const upload = steps.find(step => typeof step.run === 'string' && step.run.includes('gh release upload'))
    expect(upload?.run).toContain('DeepSeek-Harness-Setup-*-x64.exe')
    expect(upload?.run).toContain('SHA256SUMS')
    expect(upload?.run).not.toContain('dist-exe/deepseek-harness-sdk-runtime')

    const officialTagPath = steps.find(step => String(step.if ?? '').includes("github.ref_type == 'tag'"))
    expect(officialTagPath?.run).not.toContain('--prerelease')

    const versionCheck = steps.find(step =>
      typeof step.run === 'string' && step.run.includes("require('./package.json').version"))
    expect(versionCheck?.run).toContain('desktop-v')
    expect(versionCheck?.run).toContain("require('./package.json').version")
  })
})
