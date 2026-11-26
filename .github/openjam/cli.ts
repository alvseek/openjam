import { appendFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  build,
  installerName,
  ledgerName,
  promote,
  readLedger,
  repository,
  releaseFile,
  stage,
  tagFor,
  type Asset,
  type ReleaseStore,
} from "./release"

type GitHubRelease = {
  id: number
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: (Asset & { id: number; state: string })[]
}

function github(): ReleaseStore {
  const token = process.env["GH_TOKEN"]
  if (!token) throw new Error("GH_TOKEN is required to read or publish GitHub releases")
  const endpoint = `https://api.github.com/repos/${repository}/releases`
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    Accept: "application/vnd.github+json",
  }
  async function request(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, headers: { ...headers, ...init?.headers } })
    if (!response.ok)
      throw new Error(
        `GitHub ${init?.method ?? "GET"} ${new URL(url).pathname}: ${response.status} ${await response.text()}`,
      )
    return response
  }
  async function release(url: string, method = "GET", body?: object): Promise<GitHubRelease> {
    const response = await request(url, {
      method,
      body: body && JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    })
    return response.json()
  }
  return {
    async readPublished() {
      const response = await fetch(`${endpoint}/latest`, { headers })
      if (response.status === 404) return { releases: [] }
      if (!response.ok) throw new Error(`Reading last published OpenJam release failed: GitHub ${response.status}`)
      const latest: GitHubRelease = await response.json()
      const asset = latest.assets.find((asset) => asset.name === ledgerName && asset.state === "uploaded")
      if (latest.draft || latest.prerelease || !latest.tag_name.startsWith("openjam-v") || !asset)
        throw new Error(`GitHub latest release ${latest.tag_name} is not a published OpenJam release with a ledger`)
      const download = await fetch(`${endpoint}/assets/${asset.id}`, {
        headers: { ...headers, Accept: "application/octet-stream" },
        redirect: "manual",
      })
      // Private assets can redirect to a signed URL. Never forward the repository token.
      const location = download.status === 302 ? download.headers.get("location") : null
      const content = location ? await fetch(location) : download
      if (!content.ok) throw new Error(`Downloading published ${ledgerName} failed: GitHub ${content.status}`)
      const bytes = await content.arrayBuffer()
      const digest = `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`
      if (bytes.byteLength !== asset.size || digest !== asset.digest)
        throw new Error(`Published ${ledgerName} does not match its GitHub asset digest`)
      const ledger = readLedger(JSON.parse(new TextDecoder().decode(bytes)))
      const last = ledger.releases.at(-1)
      if (!last || latest.tag_name !== tagFor(last.version))
        throw new Error(`Published ${ledgerName} does not end with ${latest.tag_name}`)
      return ledger
    },
    async createDraft(candidate) {
      const target = build(candidate.version, process.env["GITHUB_SHA"]).source
      const draft = await release(endpoint, "POST", {
        tag_name: tagFor(candidate.version),
        target_commitish: target,
        name: `OpenJam ${candidate.version} for Windows x64`,
        body: `Built from verified upstream anomalyco/opencode@${candidate.source}.`,
        draft: true,
        prerelease: false,
        make_latest: "false",
      })
      if (!draft.draft || draft.tag_name !== tagFor(candidate.version) || !Number.isSafeInteger(draft.id))
        throw new Error("GitHub did not return the requested OpenJam draft")
      return draft.id
    },
    async upload(id, file, name) {
      await request(
        `https://uploads.github.com/repos/${repository}/releases/${id}/assets?name=${encodeURIComponent(name)}`,
        {
          method: "POST",
          body: Bun.file(file),
          headers: { "Content-Type": "application/octet-stream" },
        },
      )
    },
    async readDraftAssets(id, candidate) {
      const draft = await release(`${endpoint}/${id}`)
      if (!draft.draft || draft.prerelease || draft.tag_name !== tagFor(candidate.version))
        throw new Error("OpenJam draft is no longer the expected unpublished release")
      if (draft.assets.some((asset) => asset.state !== "uploaded"))
        throw new Error(`GitHub draft ${id} contains an incomplete upload`)
      return draft.assets
    },
    async publish(id) {
      // This is the only operation that changes what /releases/latest/download serves.
      await release(`${endpoint}/${id}`, "PATCH", { draft: false, make_latest: "true" })
    },
  }
}

const usage = `Usage:
  bun .github/openjam/cli.ts ledger <output.json>
  bun .github/openjam/cli.ts report <resolution.json> <github-output>
  bun .github/openjam/cli.ts check-publisher <app-update.yml>
  bun .github/openjam/cli.ts metadata <version> <source> <package-dir>
  bun .github/openjam/cli.ts stage <version> <source> <ledger.json> <package-dir> <new-stage-dir> [local-desktop-version]
  bun .github/openjam/cli.ts promote <version> <source> <stage-dir>

Promotion is not for local A-to-B testing. It is disabled in the workflow pending acceptance.`

function publisherName() {
  const publisher = process.env["OPENJAM_PUBLISHER_NAME"]?.trim()
  if (!publisher || publisher.includes("="))
    throw new Error("Set OPENJAM_PUBLISHER_NAME to the signing certificate common name (CN)")
  return publisher
}

async function main(args: string[]) {
  if (args.some((arg) => arg === "")) throw new Error(usage)
  const [step, first = "", second = "", third = "", fourth = "", fifth = "", sixth] = args
  if (step === "ledger" && args.length === 2) {
    await Bun.write(first, JSON.stringify(await github().readPublished(), null, 2) + "\n")
    return
  }
  if (step === "report" && args.length === 3) {
    const result: unknown = await Bun.file(first).json()
    console.log(result)
    if (!result || typeof result !== "object" || !("status" in result))
      throw new Error("Missing source resolver status")
    if (result.status !== "resolved" && result.status !== "already-built")
      throw new Error("Stable upstream resolver refused the build (see the version and reason above)")
    if (!("version" in result) || !("source" in result)) throw new Error("Missing stable upstream version or commit")
    const candidate = build(result.version, result.source)
    await appendFile(second, `status=${result.status}\nversion=${candidate.version}\nsource=${candidate.source}\n`)
    return
  }
  if (step === "check-publisher" && args.length === 2) {
    const publisher = publisherName()
    const config: unknown = Bun.YAML.parse(await Bun.file(first).text())
    if (
      !config ||
      typeof config !== "object" ||
      !("publisherName" in config) ||
      !Array.isArray(config.publisherName) ||
      config.publisherName.length !== 1 ||
      config.publisherName[0] !== publisher
    )
      throw new Error("The base build's app-update.yml does not pin the configured OpenJam publisher")
    return
  }
  if (step === "metadata" && args.length === 4) {
    const { regenerateMetadata } = await import("./metadata")
    await regenerateMetadata(path.resolve(third), build(first, second).version)
    return
  }
  if (step === "stage" && (args.length === 6 || args.length === 7)) {
    console.log(
      await stage({
        candidate: build(first, second),
        ledger: readLedger(await Bun.file(third).json()),
        packageDir: path.resolve(fourth),
        stageDir: path.resolve(fifth),
        desktopVersion: sixth,
      }),
    )
    return
  }
  if (step === "promote" && args.length === 4) {
    // The workflow also hard-disables this job. Local candidate tests never set this gate.
    if (process.env["OPENJAM_PUBLICATION_APPROVED"] !== "true")
      throw new Error("OpenJam public publication is disabled pending installed A-to-B acceptance")
    if (process.platform !== "win32")
      throw new Error("Promotion requires independent Windows Authenticode verification")
    const candidate = build(first, second)
    const directory = path.resolve(third)
    await releaseFile(directory, installerName)
    const verifier = fileURLToPath(new URL("./verify-signature.ps1", import.meta.url))
    const check = Bun.spawn(
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        verifier,
        "-Installer",
        path.join(directory, installerName),
      ],
      {
        env: { ...process.env, OPENJAM_PUBLISHER_NAME: publisherName(), GH_TOKEN: undefined, GITHUB_TOKEN: undefined },
        stdout: "inherit",
        stderr: "inherit",
      },
    )
    if ((await check.exited) !== 0) throw new Error("Staged installer failed independent Authenticode verification")
    console.log(await promote(directory, candidate, github()))
    return
  }
  throw new Error(usage)
}

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  await main(args).catch((error: unknown) => {
    const step = args[0] ?? "usage"
    const version = ["metadata", "stage", "promote"].includes(step) ? ` ${args[1] ?? "(unknown version)"}` : ""
    console.error(`OpenJam ${step}${version}: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  })
}
