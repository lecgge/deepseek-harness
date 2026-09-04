/**
 * Parse and validate the authenticated URL printed by `dsh web`.
 * @param line - one runtime stdout line.
 * @returns the original authenticated URL, or undefined for unrelated output.
 */
export function parseStartupUrl(line: string): string | undefined {
  const match = /^dsh web:\s+(\S+)/.exec(line)
  if (match === null) return undefined
  const candidate = match[1]
  if (candidate === undefined) return undefined
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error('dsh web startup URL is not valid')
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username !== '' || url.password !== '') {
    throw new Error('dsh web startup URL must use http://127.0.0.1')
  }
  if (url.port === '' || Number(url.port) === 0 || !Number.isInteger(Number(url.port))) {
    throw new Error('dsh web startup URL must include a non-zero port')
  }
  const token = url.searchParams.get('token')
  if (token === null || token === '') throw new Error('dsh web startup URL is missing its token')
  return candidate
}
