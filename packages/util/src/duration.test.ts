import { describe, expect, test } from "bun:test"
import { cacheMilliseconds, duration, durationCoarse, idleState } from "./duration.js"

describe("duration", () => {
  test("picks the unit the value belongs to", () => {
    expect(duration(850)).toBe("850ms")
    expect(duration(12_400)).toBe("12.4s")
    expect(duration(185_000)).toBe("3m 5s")
    expect(duration(7_800_000)).toBe("2h 10m")
    expect(duration(100_800_000)).toBe("1d 4h")
  })
})

describe("durationCoarse", () => {
  test("has no value below a minute, so the caller can word it", () => {
    expect(durationCoarse(0)).toBeUndefined()
    expect(durationCoarse(59_999)).toBeUndefined()
  })

  test("drops the units a minute tick never shows moving", () => {
    expect(durationCoarse(60_000)).toBe("1m")
    expect(durationCoarse(185_000)).toBe("3m")
    expect(durationCoarse(7_800_000)).toBe("2h 10m")
    expect(durationCoarse(100_800_000)).toBe("1d 4h")
  })
})

describe("cacheMilliseconds", () => {
  test("reads the durations a cache.ttl carries", () => {
    expect(cacheMilliseconds("5m")).toBe(300_000)
    expect(cacheMilliseconds("1h")).toBe(3_600_000)
    expect(cacheMilliseconds("90s")).toBe(90_000)
    expect(cacheMilliseconds("500ms")).toBe(500)
    expect(cacheMilliseconds("2d")).toBe(172_800_000)
  })

  test("has no value when it cannot be read, so nothing assumes a lifetime", () => {
    expect(cacheMilliseconds(undefined)).toBeUndefined()
    expect(cacheMilliseconds("")).toBeUndefined()
    expect(cacheMilliseconds("5 minutes")).toBeUndefined()
    expect(cacheMilliseconds("m")).toBeUndefined()
    expect(cacheMilliseconds("5w")).toBeUndefined()
    expect(cacheMilliseconds("-5m")).toBeUndefined()
  })
})

const now = 1_000_000_000

describe("idleState", () => {
  test("counts from the request that wrote the cache", () => {
    expect(idleState({ created: now - 185_000, ttl: undefined, now })).toEqual({ age: 185_000, expired: false })
  })

  test("has no state for a session with no response yet", () => {
    expect(idleState({ created: undefined, ttl: "5m", now })).toBeUndefined()
  })

  test("never claims a lifetime the model does not declare", () => {
    expect(idleState({ created: now - 3_600_000, ttl: undefined, now })).toEqual({
      age: 3_600_000,
      expired: false,
    })
  })

  test("expires only after the declared lifetime, not at it", () => {
    expect(idleState({ created: now - 300_000, ttl: "5m", now })?.expired).toBe(false)
    expect(idleState({ created: now - 300_001, ttl: "5m", now })?.expired).toBe(true)
  })

  test("reads an hour-long lifetime as an hour", () => {
    expect(idleState({ created: now - 3_000_000, ttl: "1h", now })?.expired).toBe(false)
  })

  test("clamps a clock that moved backwards instead of showing a negative age", () => {
    expect(idleState({ created: now + 5_000, ttl: "5m", now })).toEqual({ age: 0, expired: false })
  })
})
