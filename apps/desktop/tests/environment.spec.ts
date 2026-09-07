import { describe, expect, it } from 'vitest'
import {
  childEnvironment,
  parseEnvOutput,
  resolveEnvironmentPath,
  stripElectronNodeMode,
  withoutUndecodableValues,
} from '../src/environment.js'

describe('stripElectronNodeMode', () => {
  it('removes ELECTRON_RUN_AS_NODE', () => {
    expect(stripElectronNodeMode({ ELECTRON_RUN_AS_NODE: '1', FOO: 'bar' })).toEqual({ FOO: 'bar' })
  })
})

describe('resolveEnvironmentPath', () => {
  it('reads Path on Windows regardless of case', () => {
    expect(resolveEnvironmentPath({ path: 'C:\\bin' }, 'win32')).toBe('C:\\bin')
  })
})

describe('withoutUndecodableValues', () => {
  it('drops U+FFFD TEMP and falls back', () => {
    expect(withoutUndecodableValues(
      { TEMP: 'C:\\Users\\\uFFFD' },
      { TEMP: 'C:\\Users\\ok\\AppData\\Local\\Temp' },
    )).toEqual({ TEMP: 'C:\\Users\\ok\\AppData\\Local\\Temp' })
  })
})

describe('parseEnvOutput', () => {
  it('parses NAME=VALUE lines', () => {
    expect(parseEnvOutput('FOO=bar\nPATH=C:\\bin\n', /\n/)).toEqual({
      FOO: 'bar',
      PATH: 'C:\\bin',
    })
  })
})

describe('childEnvironment', () => {
  it('strips ELECTRON_RUN_AS_NODE and sets DSH_HOME plus Path/PATH', () => {
    const pathValue = process.platform === 'win32' ? 'C:\\bin' : '/usr/bin'
    const parent: NodeJS.ProcessEnv = {
      ELECTRON_RUN_AS_NODE: '1',
      FOO: 'bar',
      ...(process.platform === 'win32' ? { path: pathValue } : { PATH: pathValue }),
    }
    const env = childEnvironment(parent, { DSH_HOME: '/tmp/dsh-home' })
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.DSH_HOME).toBe('/tmp/dsh-home')
    expect(env.FOO).toBe('bar')
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
    expect(env[pathKey]).toBe(pathValue)
  })

  it('deletes every Path spelling before assigning the canonical key', () => {
    const canonical = process.platform === 'win32' ? 'C:\\bin' : '/usr/bin'
    const parent: NodeJS.ProcessEnv = {
      path: 'lower',
      PATH: process.platform === 'win32' ? 'upper' : canonical,
      Path: process.platform === 'win32' ? canonical : 'title',
      FOO: 'bar',
    }
    const env = childEnvironment(parent, { DSH_HOME: '/tmp/dsh-home' })
    const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
    const pathKeys = Object.keys(env).filter(name => /^path$/iu.test(name))
    expect(pathKeys).toEqual([pathKey])
    expect(env[pathKey]).toBe(canonical)
    expect(env.FOO).toBe('bar')
  })

  it('lets extras.DSH_HOME override a parent DSH_HOME', () => {
    const env = childEnvironment(
      { DSH_HOME: 'C:\\Users\\someone\\.dsh' },
      { DSH_HOME: '/tmp/dsh-home' },
    )
    expect(env.DSH_HOME).toBe('/tmp/dsh-home')
  })
})
