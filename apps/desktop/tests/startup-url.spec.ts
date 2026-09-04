import { describe, expect, it } from 'vitest'
import { parseStartupUrl } from '../src/startup-url.js'

describe('parseStartupUrl', () => {
  it('extracts a tokenized loopback URL from the dsh web line', () => {
    expect(parseStartupUrl('dsh web: http://127.0.0.1:43123/?token=abc-123 (LAN: http://192.168.1.2:43123/?token=abc-123)'))
      .toBe('http://127.0.0.1:43123/?token=abc-123')
  })

  it('accepts URL-safe token characters and ignores trailing log text', () => {
    expect(parseStartupUrl('dsh web: http://127.0.0.1:9/?token=a_b.c%2Dd'))
      .toBe('http://127.0.0.1:9/?token=a_b.c%2Dd')
  })

  it.each([
    'dsh web: http://localhost:43123/?token=abc',
    'dsh web: http://127.0.0.2:43123/?token=abc',
    'dsh web: https://127.0.0.1:43123/?token=abc',
    'dsh web: http://127.0.0.1:43123/',
  ])('rejects unsafe startup output: %s', (line) => {
    expect(() => parseStartupUrl(line)).toThrow()
  })

  it('returns undefined for unrelated output', () => {
    expect(parseStartupUrl('web server listening on 127.0.0.1:43123')).toBeUndefined()
  })
})
