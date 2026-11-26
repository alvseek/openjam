import { expect, test } from "bun:test"
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

    await expect(discoverOpenJamService({ file, version: "2.4.2" })).rejects.toThrow("running, compatible OpenCode")
    expect(stock.exitCode).toBeNull()
    expect(await Bun.file(file).text()).toBe(registration)
    await expect(discoverOpenJamService({ file, version: "2.4.1" })).resolves.toEqual({
      url,
      auth: { type: "basic", username: "opencode", password: "test" },
    })
  } finally {
    stock.kill()
    await stock.exited
    await rm(dir, { recursive: true, force: true })
  }
})
