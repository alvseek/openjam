import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { regenerateMetadata } from "../../../.github/openjam/metadata"
import {
  ledgerName,
  manifestName,
  promote,
  stage,
  type Ledger,
  type ReleaseStore,
} from "../../../.github/openjam/release"

const prior = { version: "2.3.9", source: "a".repeat(40) }

const candidate = { version: "2.3.10", source: "b".repeat(40) }

const installer = "openjam-desktop-win-x64.exe"

const blockmap = `${installer}.blockmap`

const bytes = "fixture installer bytes"

const sha512 = new Bun.CryptoHasher("sha512").update(bytes).digest("base64")

const ledger = { releases: [prior] }

const expectedLedger = { releases: [prior, candidate] }

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function manifest(
  overrides: Partial<{ version: string; path: string; files: { url: string; size: number; sha512: string }[] }> = {},
) {
  return JSON.stringify({
    version: candidate.version,
    path: installer,
    sha512,
    files: [{ url: installer, size: bytes.length, sha512 }],
    ...overrides,
  })
}

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openjam-release-"))
  tempDirs.push(dir)
  const packageDir = path.join(dir, "package")
  const stageDir = path.join(dir, "stage")
  await mkdir(packageDir)
  await Promise.all([
    Bun.write(path.join(packageDir, installer), bytes),
    Bun.write(path.join(packageDir, blockmap), "fixture blockmap"),
    Bun.write(path.join(packageDir, manifestName), manifest()),
    Bun.write(path.join(packageDir, "unrelated.exe"), "not part of the feed"),
  ])

  return { packageDir, stageDir, ledger, candidate }
}

test("stages only the updater bundle with an ascending upstream build ledger", async () => {
  const input = await fixture()
  expect(await stage(input)).toBe("staged")
  expect((await readdir(input.stageDir)).sort()).toEqual([installer, blockmap, manifestName, ledgerName].sort())
  expect(await Bun.file(path.join(input.stageDir, ledgerName)).json()).toEqual(expectedLedger)
  expect(await Bun.file(path.join(input.stageDir, installer)).text()).toBe(bytes)
  await expect(stage(input)).rejects.toThrow("Stage directory already exists")
  expect(await Bun.file(path.join(input.stageDir, ledgerName)).json()).toEqual(expectedLedger)
})

test.each([
  ["missing metadata", manifestName, undefined, "Missing or empty release file: latest.yml"],
  ["missing installer", installer, undefined, `Missing or empty release file: ${installer}`],
  ["empty blockmap", blockmap, "", `Missing or empty release file: ${blockmap}`],
  ["version mismatch", manifestName, manifest({ version: prior.version }), "latest.yml must describe OpenJam 2.3.10"],
  ["size mismatch", installer, "shorter file", "size does not match latest.yml"],
  ["same-size corruption", installer, "X" + bytes.slice(1), "SHA-512 does not match latest.yml"],
  ["legacy path mismatch", manifestName, manifest({ path: "old.exe" }), "legacy path or SHA-512"],
  [
    "nonlocal installer",
    manifestName,
    manifest({ files: [{ url: `https://example.com/${installer}`, size: bytes.length, sha512 }] }),
    "relative OpenJam Windows x64 installer",
  ],
] as const)("rejects %s without exposing a staging directory", async (_name, file, contents, error) => {
  const input = await fixture()
  const target = path.join(input.packageDir, file)

  if (contents === undefined) await rm(target)

  if (contents !== undefined) await Bun.write(target, contents)
  await expect(stage(input)).rejects.toThrow(error)
  expect(await readdir(path.dirname(input.stageDir))).toEqual(["package"])
})

test("stages a local-only desktop version without rewriting the upstream ledger", async () => {
  const input = await fixture()
  const desktopVersion = "2.3.11"
  await Bun.write(path.join(input.packageDir, manifestName), manifest({ version: desktopVersion }))
  expect(await stage({ ...input, desktopVersion })).toBe("staged")
  expect(await Bun.file(path.join(input.stageDir, ledgerName)).json()).toEqual(expectedLedger)
  const remote = draftStore()
  await expect(promote(input.stageDir, candidate, remote.store)).rejects.toThrow(
    "latest.yml must describe OpenJam 2.3.10",
  )
  expect(remote.calls).toEqual(["read published"])
})

test("rebuilds updater metadata and the external blockmap when final installer bytes change", async () => {
  const input = await fixture()
  const executable = path.join(input.packageDir, installer)
  const map = Bun.file(path.join(input.packageDir, blockmap))
  await regenerateMetadata(input.packageDir, candidate.version)
  const originalMap = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await map.bytes())))

  const finalBytes = bytes + " new final bytes"
  await Bun.write(executable, finalBytes)
  await expect(stage(input)).rejects.toThrow("size does not match latest.yml")
  await regenerateMetadata(input.packageDir, candidate.version)
  expect(await stage(input)).toBe("staged")

  const stagedMap = Bun.file(path.join(input.stageDir, blockmap))
  const regenerated = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await stagedMap.bytes())))
  expect(regenerated).toMatchObject({ version: "2", files: [{ offset: 0, sizes: [finalBytes.length] }] })
  expect(regenerated.files[0].checksums).not.toEqual(originalMap.files[0].checksums)
})

test.skipIf(process.platform !== "win32")(
  "Windows promotion rejects an unverifiable installer even with publication approved",
  async () => {
    const input = await fixture()
    await stage(input)
    const cli = fileURLToPath(new URL("../../../.github/openjam/cli.ts", import.meta.url))

    const child = Bun.spawn([process.execPath, cli, "promote", candidate.version, candidate.source, input.stageDir], {
      env: {
        ...process.env,
        OPENJAM_PUBLICATION_APPROVED: "true",
        OPENJAM_PUBLISHER_NAME: "OpenJam fixture",
        GH_TOKEN: undefined,
        GITHUB_TOKEN: undefined,
      },
      stderr: "pipe",
    })

    expect(await new Response(child.stderr).text()).toContain(
      "Staged installer failed independent Authenticode verification",
    )
    expect(await child.exited).toBe(1)
  },
)

function draftStore(published: Ledger = ledger) {
  const calls: string[] = []
  const assets = new Map<string, { name: string; size: number; digest: string }>()

  const store: ReleaseStore = {
    async readPublished() {
      calls.push("read published")

      return published
    },
    async createDraft(build) {
      calls.push(`draft ${build.version} from ${build.source}`)

      return 1
    },
    async upload(id, file, name) {
      calls.push(`upload ${id} ${name}`)
      const data = await Bun.file(file).arrayBuffer()
      assets.set(name, {
        name,
        size: data.byteLength,
        digest: `sha256:${new Bun.CryptoHasher("sha256").update(data).digest("hex")}`,
      })
    },
    async readDraftAssets(id) {
      calls.push(`check draft ${id}`)

      return [...assets.values()]
    },
    async publish(id) {
      calls.push(`publish ${id}`)
    },
  }

  return { calls, assets, store }
}

test("promotion publishes the newly created draft only after every staged asset verifies", async () => {
  const input = await fixture()
  await stage(input)
  const remote = draftStore()
  expect(await promote(input.stageDir, candidate, remote.store)).toBe("published")
  expect(remote.calls).toEqual([
    "read published",
    `draft ${candidate.version} from ${candidate.source}`,
    `upload 1 ${manifestName}`,
    `upload 1 ${installer}`,
    `upload 1 ${blockmap}`,
    `upload 1 ${ledgerName}`,
    "check draft 1",
    "publish 1",
  ])
})

test.each(["upload fails", "draft is missing a blockmap", "draft has a mismatched installer digest"] as const)(
  "%s leaves the draft unpublished",
  async (fault) => {
    const input = await fixture()
    await stage(input)
    const remote = draftStore()
    const upload = remote.store.upload
    remote.store.upload = async (id, file, name) => {
      if (name === blockmap && fault === "upload fails") throw new Error("upload refused")
      await upload(id, file, name)

      if (name === blockmap && fault === "draft is missing a blockmap") remote.assets.delete(name)
      const asset = remote.assets.get(name)

      if (asset && name === installer && fault === "draft has a mismatched installer digest")
        asset.digest = "sha256:bad"
    }

    await expect(promote(input.stageDir, candidate, remote.store)).rejects.toThrow(
      fault === "upload fails" ? "upload refused" : "GitHub draft assets do not match",
    )
    expect(remote.calls.some((call) => call.startsWith("draft "))).toBe(true)
    expect(remote.calls).not.toContain("publish 1")
  },
)

test.each([
  ["already published", expectedLedger, undefined],
  ["source moved", { releases: [prior, { ...candidate, source: "c".repeat(40) }] }, "already records upstream"],
  ["older than latest", { releases: [{ version: "2.4.0", source: "c".repeat(40) }] }, "older upstream"],
  ["changed baseline", { releases: [] }, "Staged ledger does not extend"],
] as const)("promotion rechecks the published ledger: %s", async (_name, published, error) => {
  const input = await fixture()
  await stage(input)
  const remote = draftStore(published)
  const result = promote(input.stageDir, candidate, remote.store)

  if (error) await expect(result).rejects.toThrow(error)

  if (!error) expect(await result).toBe("already-built")
  expect(remote.calls).toEqual(["read published"])
})
