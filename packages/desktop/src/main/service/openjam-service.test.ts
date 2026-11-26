import { expect, setSystemTime, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { discoverOpenJamService } from "./openjam-service"

test("OpenJam adopts compatible stock but leaves a mismatched stock owner and registration alone", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "openjam-discovery-"))
  const file = path.join(dir, "service.json")

  const stock = Bun.spawn(
    [
      process.execPath,
      "-e",
      `const stock = Bun.serve({
        hostname: "127.0.0.1", port: 0,
        fetch(request) {
          if (request.method !== "GET" || new URL(request.url).pathname !== "/api/info")
            throw new Error("Unexpected stock service request")
          if (request.headers.get("authorization") !== "Basic b3BlbmNvZGU6dGVzdA==")
            return new Response(null, { status: 401 })
          return Response.json({ version: "2.4.1", pid: process.pid })
        }
      }); console.log(stock.url.origin)`,
    ],
    { stdout: "pipe" },
  )

  try {
    const reader = stock.stdout.getReader()
    const origin = await reader.read()
    reader.releaseLock()
    const url = new TextDecoder().decode(origin.value).trim()
    const registration = JSON.stringify({ url, pid: stock.pid, version: "2.4.1", password: "test" })
    await Bun.write(file, registration)

    await expect(discoverOpenJamService({ file, version: "2.4.2", command: [] })).rejects.toThrow(
      "OPENJAM_SERVICE_VERSION_MISMATCH:2.4.2:2.4.1",
    )
    expect(stock.exitCode).toBeNull()
    expect(await Bun.file(file).text()).toBe(registration)
    await expect(discoverOpenJamService({ file, version: "2.4.1", command: [] })).resolves.toEqual({
      url,
      auth: { type: "basic", username: "opencode", password: "test" },
    })
  } finally {
    stock.kill()
    await stock.exited
    await rm(dir, { recursive: true, force: true })
  }
})

test.each(["missing", "stale"] as const)(
  "OpenJam starts the supplied command for a %s registration and discovers its authenticated endpoint",
  async (state) => {
    const dir = await mkdtemp(path.join(tmpdir(), "openjam-start-"))
    const file = path.join(dir, "service.json")
    const marker = path.join(dir, "arguments.json")
    // This child is already reaped before its PID is recorded as stale.
    const exited = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" })
    await exited.exited
    if (state === "stale")
      await Bun.write(file, JSON.stringify({ pid: exited.pid, url: "http://127.0.0.1:1", password: "test" }))

    const script = `
      const file = process.argv[1], marker = process.argv[2]
      const server = Bun.serve({
        hostname: "127.0.0.1", port: 0,
        fetch(request) {
          if (request.headers.get("authorization") !== "Basic b3BlbmNvZGU6dGVzdA==")
            return new Response(null, { status: 401 })
          return Response.json({ version: "2.4.1", pid: process.pid })
        }
      })
      await Bun.write(marker, JSON.stringify(process.argv.slice(3)))
      await Bun.write(file, JSON.stringify({ url: server.url.origin, pid: process.pid, version: "2.4.1", password: "test" }))
    `
    try {
      const endpoint = await discoverOpenJamService({
        file,
        version: "2.4.1",
        command: [process.execPath, "-e", script, file, marker, "serve", "--service"],
      })
      const registration = await Bun.file(file).json()
      expect(endpoint).toEqual({
        url: registration.url,
        auth: { type: "basic", username: "opencode", password: "test" },
      })
      expect(await Bun.file(marker).json()).toEqual(["serve", "--service"])
    } finally {
      const registration = await Bun.file(file)
        .json()
        .catch(() => undefined)
      if (registration?.pid && registration.pid !== exited.pid) process.kill(registration.pid)
      await rm(dir, { recursive: true, force: true })
    }
  },
)

test("an unreadable registration is uncertain, not permission to start a contender", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "openjam-uncertain-"))
  const file = path.join(dir, "service.json")
  await Bun.write(file, "{")
  try {
    await expect(discoverOpenJamService({ file, version: "2.4.1", command: [] })).rejects.toThrow(
      "OPENJAM_SERVICE_UNAVAILABLE:2.4.1",
    )
    expect(await Bun.file(file).text()).toBe("{")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test.each([
  { version: "2.4.1", mismatch: false },
  { version: "2.4.2", mismatch: true },
])("concurrent launches recheck the owner elected while contenders start ($version)", async (input) => {
  const dir = await mkdtemp(path.join(tmpdir(), "openjam-concurrent-"))
  const file = path.join(dir, "service.json")
  const release = Promise.withResolvers<void>()
  const contenders = Promise.withResolvers<void>()
  let arrivals = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === "/contender") {
        if (++arrivals === 2) contenders.resolve()
        await release.promise
        return new Response()
      }
      if (request.headers.get("authorization") !== "Basic b3BlbmNvZGU6dGVzdA==")
        return new Response(null, { status: 401 })
      return Response.json({ version: "2.4.1", pid: process.pid })
    },
  })
  const registration = JSON.stringify({ pid: process.pid, url: server.url.origin, version: "2.4.1", password: "test" })
  const command = [process.execPath, "-e", `await fetch(${JSON.stringify(new URL("/contender", server.url).href)})`]
  try {
    const attempts = [1, 2].map(() =>
      discoverOpenJamService({ file, version: input.version, command }).then(
        (endpoint) => ({ endpoint }),
        (error: Error) => ({ error: error.message }),
      ),
    )
    await contenders.promise
    await Bun.write(file, registration)
    const results = await Promise.all(attempts)
    if (input.mismatch)
      expect(results).toEqual([
        { error: "OPENJAM_SERVICE_VERSION_MISMATCH:2.4.2:2.4.1" },
        { error: "OPENJAM_SERVICE_VERSION_MISMATCH:2.4.2:2.4.1" },
      ])
    else
      expect(results).toEqual(
        [1, 2].map(() => ({
          endpoint: { url: server.url.origin, auth: { type: "basic", username: "opencode", password: "test" } },
        })),
      )
    expect(await Bun.file(file).text()).toBe(registration)
  } finally {
    release.resolve()
    server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
})

test.each(["winner", "no owner"] as const)(
  "an unsuccessful contender waits for the deadline or a later %s",
  async (end) => {
    const dir = await mkdtemp(path.join(tmpdir(), "openjam-failed-"))
    const file = path.join(dir, "service.json")
    const stale = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" })
    await stale.exited
    const polled = Promise.withResolvers<void>()
    let launches = 0
    let contenderPID = 0
    let pollsAfterExit = 0
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/contender") {
          launches++
          contenderPID = Number(request.headers.get("x-pid"))
          return new Response()
        }
        if (contenderPID) {
          try {
            process.kill(contenderPID, 0)
          } catch {
            if (++pollsAfterExit === 2) polled.resolve()
          }
        }
        if (request.headers.get("authorization") !== "Basic b3BlbmNvZGU6dGVzdA==")
          return new Response(null, { status: 401 })
        return Response.json({ version: "2.4.1", pid: process.pid })
      },
    })
    const staleRegistration = JSON.stringify({ pid: stale.pid, url: server.url.origin, password: "test" })
    await Bun.write(file, staleRegistration)
    try {
      const result = discoverOpenJamService({
        file,
        version: "2.4.1",
        command: [
          process.execPath,
          "-e",
          `await fetch(${JSON.stringify(new URL("/contender", server.url).href)}, { headers: { "x-pid": String(process.pid) } }); process.exit(1)`,
        ],
      }).then(
        (endpoint) => ({ endpoint }),
        (error: Error) => ({ error: error.message }),
      )
      // A second health probe after the losing process exits proves the first post-exit poll did not fail early.
      expect(await Promise.race([polled.promise.then(() => "polled"), result])).toBe("polled")
      expect(launches).toBe(1)
      if (end === "no owner") {
        setSystemTime(Date.now() + 60_000)
        expect(await result).toEqual({ error: "OPENJAM_SERVICE_UNAVAILABLE:2.4.1" })
        expect(await Bun.file(file).text()).toBe(staleRegistration)
        return
      }
      const registration = JSON.stringify({
        pid: process.pid,
        url: server.url.origin,
        version: "2.4.1",
        password: "test",
      })
      await Bun.write(file, registration)
      const outcome = await result
      expect(outcome).toEqual({
        endpoint: { url: server.url.origin, auth: { type: "basic", username: "opencode", password: "test" } },
      })
      expect(launches).toBe(1)
    } finally {
      setSystemTime()
      server.stop(true)
      await rm(dir, { recursive: true, force: true })
    }
  },
)

test("a command that cannot be spawned reports unavailable", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "openjam-spawn-error-"))
  try {
    await expect(
      discoverOpenJamService({
        file: path.join(dir, "service.json"),
        version: "2.4.1",
        command: [path.join(dir, "missing-executable")],
      }),
    ).rejects.toThrow("OPENJAM_SERVICE_UNAVAILABLE:2.4.1")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("an unresponsive live owner is not terminated or replaced", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "openjam-live-"))
  const file = path.join(dir, "service.json")
  const requested = Promise.withResolvers<void>()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requested.resolve()
      return new Response("not a health response")
    },
  })
  const registration = JSON.stringify({ pid: process.pid, url: server.url.origin, password: "test" })
  await Bun.write(file, registration)
  try {
    const result = discoverOpenJamService({ file, version: "2.4.1", command: [] })
    await requested.promise
    setSystemTime(Date.now() + 60_000)
    await expect(result).rejects.toThrow("OPENJAM_SERVICE_UNAVAILABLE:2.4.1")
    expect(await Bun.file(file).text()).toBe(registration)
    expect(process.kill(process.pid, 0)).toBe(true)
  } finally {
    setSystemTime()
    server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
})
