import { $ } from "bun"
import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { checkOpenJamOverlay } from "./openjam-overlay"

test("overlay follows unchanged blobs across versions but rejects clean drift and dirty collisions", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "openjam-overlay-test-"))
  const checkout = path.join(temp, "upstream")
  const patch = path.join(temp, "overlay.patch")
  const desktop = "packages/desktop"
  const packaging = `${desktop}/pack.ts`
  const secondary = `${desktop}/builder.ts`
  const original = ["old", "", "", "", "", "", "unrelated"].join("\n") + "\n"

  try {
    await mkdir(checkout)
    await $`git init --quiet`.cwd(checkout)

    const commit = async (message: string) => {
      await $`git add -- ${desktop}`.cwd(checkout)
      await $`git -c user.name=Fixture -c user.email=fixture@example.invalid commit --quiet -m ${message}`.cwd(checkout)
    }

    await Bun.write(path.join(checkout, packaging), original)
    await Bun.write(path.join(checkout, secondary), original)
    await Bun.write(path.join(checkout, `${desktop}/package.json`), '{"version":"1.0.0"}')
    await commit("reviewed release")

    await Bun.write(path.join(checkout, packaging), original.replace("old", "OpenJam"))
    await Bun.write(path.join(checkout, secondary), original.replace("old", "OpenJam"))
    await $`git diff --full-index --binary --output=${patch} -- ${desktop}`.cwd(checkout)
    await Bun.write(path.join(checkout, packaging), original)
    await Bun.write(path.join(checkout, secondary), original)

    await Bun.write(path.join(checkout, `${desktop}/package.json`), '{"version":"1.1.0"}')
    await commit("new release without packaging changes")
    await expect(checkOpenJamOverlay(checkout, patch)).resolves.toBeUndefined()

    const collision = path.join(checkout, `${desktop}/untracked.ts`)

    await Bun.write(collision, "local input\n")
    await expect(checkOpenJamOverlay(checkout, patch)).rejects.toThrow("clean upstream desktop tree")
    await rm(collision)

    await Bun.write(path.join(checkout, packaging), original.replace("unrelated", "upstream drift"))
    await commit("new release with drift outside the overlay hunk")
    await $`git apply --check ${patch}`.cwd(checkout)
    await expect(checkOpenJamOverlay(checkout, patch)).rejects.toThrow("differs from its reviewed blob")
    expect(await $`git status --porcelain`.cwd(checkout).text()).toBe("")
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
