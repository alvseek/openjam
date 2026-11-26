import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { Service, fallback } from "@opencode/client/service"
import { Option, Schema } from "effect"

const Registration = Schema.fromJsonString(
  Schema.Struct({ pid: Schema.Int.check(Schema.isGreaterThan(0)), url: Schema.String }),
)

// Unlike ensure(), this never stops an incumbent or clears its registration.
export async function discoverOpenJamService(options: {
  readonly file?: string
  readonly version: string
  readonly command: readonly string[]
}) {
  const file = options.file ?? fallback()
  const deadline = Date.now() + 30_000
  const unavailable = () => new Error(`OPENJAM_SERVICE_UNAVAILABLE:${options.version}`)
  let started = false
  let spawnFailed = false

  while (Date.now() < deadline) {
    const registration = await readFile(file, "utf8").then(
      (text) => ({ type: "present" as const, text }),
      (error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? { type: "missing" as const } : undefined),
    )

    if (!registration) throw unavailable()

    if (registration.type === "present") {
      const info = Option.getOrUndefined(Schema.decodeUnknownOption(Registration)(registration.text))

      if (!info) throw unavailable()

      let observed: string | undefined

      const endpoint = await Service.discover({
        file,
        version: (version) => {
          observed = version

          return true
        },
      }).catch(() => undefined)

      if (endpoint?.auth && observed) {
        if (observed !== options.version)
          throw new Error(`OPENJAM_SERVICE_VERSION_MISMATCH:${options.version}:${observed}`)

        return endpoint
      }

      // Only ESRCH proves the recorded process is gone; permission errors and failed health probes do not.
      const dead = (() => {
        try {
          process.kill(info.pid, 0)

          return false
        } catch (error) {
          return error instanceof Error && "code" in error && error.code === "ESRCH"
        }
      })()

      if (!dead) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        continue
      }
    }

    if (!started) {
      const [command, ...args] = options.command

      if (!command) throw unavailable()
      const child = spawn(command, args, { detached: true, windowsHide: true, stdio: "ignore" })
      child.once("error", () => {
        spawnFailed = true
      })
      // A contender can lose the bind before the elected service has registered.
      child.unref()
      started = true
    }

    if (spawnFailed) throw unavailable()
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw unavailable()
}
