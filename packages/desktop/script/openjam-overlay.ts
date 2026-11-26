import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

export async function checkOpenJamOverlay(checkout: string, patch: string) {
  const status = await $`git status --porcelain --untracked-files=all -- packages/desktop`.cwd(checkout).text()

  if (status) throw new Error("OpenJam needs a clean upstream desktop tree")

  // A mode-only change can make Git infer its old blob from the working index. Require a full
  // reviewed preimage for every file instead of accepting an inferred identity.
  const sections = (await Bun.file(patch).text()).split(/^diff --git /m).slice(1)

  if (!sections.length || sections.some((section) => !/^index [a-f0-9]{40}\.\.[a-f0-9]{40} 100644\r?$/m.test(section)))
    throw new Error("OpenJam overlay must contain only full-index edits to existing desktop files")

  const temp = await mkdtemp(path.join(tmpdir(), "openjam-overlay-"))

  try {
    const index = path.join(temp, "index")

    await $`git apply --build-fake-ancestor=${index} ${patch}`.cwd(checkout)

    const reviewed = (
      await $`git ls-files --stage -z`
        .cwd(checkout)
        .env({ ...process.env, GIT_INDEX_FILE: index })
        .text()
    )
      .split("\0")
      .filter(Boolean)

    const format = "%(objectmode) %(objectname) 0%x09%(path)"

    const current = new Set(
      (await $`git ls-tree -r -z --format=${format} HEAD -- packages/desktop`.cwd(checkout).text()).split("\0"),
    )

    if (reviewed.length !== sections.length) throw new Error("OpenJam overlay has duplicate or missing preimages")

    for (const entry of reviewed) {
      if (!current.has(entry))
        throw new Error(`OpenJam overlay needs review: ${entry.split("\t").at(-1)} differs from its reviewed blob`)
    }

    await $`git apply --check --index ${patch}`.cwd(checkout)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
