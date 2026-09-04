import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

describe('desktop release workflow', () => {
  it('builds and uploads the installer with the runtime assets', () => {
    const workflow = yaml.load(readFileSync(resolve(import.meta.dirname, '../../../.github/workflows/dsh-runtime-release.yml'), 'utf8')) as {
      jobs: { 'build-and-release': { steps: Array<Record<string, unknown>> } }
    }
    const steps = workflow.jobs['build-and-release'].steps
    const installer = steps.find(step => step.name === 'Build Windows installer')
    const upload = steps.find(step => step.name === 'Create or update GitHub prerelease')
    expect(installer?.run).toContain('dsh-desktop dist')
    expect(upload?.run).toContain('DeepSeek-Harness-Setup-*-x64.exe')
  })
})
