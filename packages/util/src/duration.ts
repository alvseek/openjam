/** Compact elapsed time, e.g. `850ms`, `12.4s`, `3m 5s`, `2h 10m` or `1d 4h`. */
export function duration(input: number) {
  if (input < 1000) {
    return `${input}ms`
  }
  if (input < 60000) {
    return `${(input / 1000).toFixed(1)}s`
  }
  if (input < 3600000) {
    const minutes = Math.floor(input / 60000)
    const seconds = Math.floor((input % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }
  if (input < 86400000) {
    const hours = Math.floor(input / 3600000)
    const minutes = Math.floor((input % 3600000) / 60000)
    return `${hours}h ${minutes}m`
  }
  const days = Math.floor(input / 86400000)
  const hours = Math.floor((input % 86400000) / 3600000)
  return `${days}d ${hours}h`
}

/**
 * Elapsed time for a surface that refreshes once a minute, e.g. `1m`, `3h 12m` or `2d 4h`.
 * Undefined below a minute, where a caller supplies its own wording instead of showing a frozen count.
 */
export function durationCoarse(input: number) {
  if (input < 60000) {
    return
  }
  if (input < 3600000) {
    return `${Math.floor(input / 60000)}m`
  }
  if (input < 86400000) {
    const hours = Math.floor(input / 3600000)
    const minutes = Math.floor((input % 3600000) / 60000)
    return `${hours}h ${minutes}m`
  }
  const days = Math.floor(input / 86400000)
  const hours = Math.floor((input % 86400000) / 3600000)
  return `${days}d ${hours}h`
}

const CACHE_UNITS = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 } as const

type CacheUnit = keyof typeof CACHE_UNITS

const isCacheUnit = (value: string): value is CacheUnit => value in CACHE_UNITS

/**
 * Milliseconds a prompt cache lives, from a `cache.ttl` such as `5m` or `1h`.
 * Undefined when the value is absent or not a duration, so a caller never assumes a lifetime.
 */
export function cacheMilliseconds(ttl: string | undefined) {
  const match = ttl?.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) {
    return
  }
  const unit = match[2]
  if (!isCacheUnit(unit)) {
    return
  }
  return Number(match[1]) * CACHE_UNITS[unit]
}

/**
 * How long ago the last response's request was read, and whether the cache lifetime the model or provider declares
 * has already passed. `expired` stays false when no lifetime is declared: a surface never claims one.
 */
export function idleState(input: { created: number | undefined; ttl: string | undefined; now: number }) {
  if (input.created === undefined) {
    return
  }
  const age = Math.max(0, input.now - input.created)
  const lifetime = cacheMilliseconds(input.ttl)

  return { age, expired: lifetime !== undefined && age > lifetime }
}
