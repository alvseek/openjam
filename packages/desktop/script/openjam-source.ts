#!/usr/bin/env bun
import { Option, Schema } from "effect"

// Resolves the stable Windows x64 desktop feed version to the upstream source commit that built it.
// This is the publication gate for OpenJam: a feed version resolves only when exactly one upstream tag
// holds that version, that tag's commit carries the desktop package version, and the official update
// service attests the exact Windows x64 installer by URL, size and SHA-512. The GitHub release must
// then hold that installer with a SHA-256 digest equal to the one the update service records. Missing
// or ambiguous source, or missing or mismatched proof, means no publication.
//
// The feed is the one the installed production app updates from: `resources/app-update.yml` points at
// this URL with channel `latest`, so electron-updater reads `<url>latest.yml`.
export const STABLE_FEED = "https://opencode.ai/update/api/latest/desktop/opencode/"

const WINDOWS_X64 = "opencode-desktop-win-x64.exe"

const Manifest = Schema.Struct({
  version: Schema.NonEmptyString,
  files: Schema.Array(
    Schema.Struct({
      url: Schema.NonEmptyString,
      sha512: Schema.NonEmptyString,
      size: Schema.Int,
    }),
  ),
})

const Release = Schema.Struct({
  assets: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      size: Schema.Int,
      digest: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
})

const UpdateServicePayload = Schema.Struct({
  version: Schema.NonEmptyString,
  metadata: Schema.Struct({
    manifests: Schema.Record(
      Schema.String,
      Schema.Struct({
        files: Schema.Array(
          Schema.Struct({
            url: Schema.NonEmptyString,
            sha512: Schema.NonEmptyString,
            size: Schema.Int,
          }),
        ),
      }),
    ),
    files: Schema.Record(
      Schema.String,
      Schema.Struct({
        url: Schema.NonEmptyString,
        sha256: Schema.String,
        size: Schema.Int,
      }),
    ),
  }),
})

const DesktopPackage = Schema.Struct({ version: Schema.String })

const BuildLedger = Schema.Struct({
  releases: Schema.Array(Schema.Struct({ version: Schema.String, source: Schema.String })),
})

export type FeedArtifact = {
  readonly name: string
  readonly url: string
  readonly size: number
  readonly sha512: string
}

export type Feed = {
  readonly version: string
  readonly files: readonly FeedArtifact[]
}

/** One upstream tag and the commit it points at, with annotated tags already peeled. */
export type TagRef = {
  readonly name: string
  readonly source: string
}

export type ReleaseAsset = {
  readonly name: string
  readonly size: number
  readonly digest?: string
}

export type UpstreamRelease = {
  readonly tag: string
  readonly assets: readonly ReleaseAsset[]
}

export type UpdateManifestFile = {
  readonly url: string
  readonly sha512: string
  readonly size: number
}

/** The official update service record for one channel, name and distribution. */
export type UpdateServiceRecord = {
  readonly version: string
  readonly manifests: Readonly<Record<string, { readonly files: readonly UpdateManifestFile[] }>>
  readonly files: Readonly<Record<string, { readonly url: string; readonly sha256: string; readonly size: number }>>
}

/** One OpenJam build that is already published, keyed to the upstream source it was built from. */
export type BuildRecord = {
  readonly version: string
  readonly source: string
}

type Source = {
  readonly version: string
  readonly tag: string
  readonly source: string
  readonly sha256: string
  readonly artifact: FeedArtifact
  readonly desktopVersion: string
  readonly releaseAsset: ReleaseAsset
}

export type Resolution =
  | ({ readonly status: "resolved" } & Source)
  | ({ readonly status: "already-built"; readonly built: BuildRecord } & Source)
  | ({ readonly status: "conflict"; readonly existing: BuildRecord; readonly reason: string } & Source)
  | { readonly status: "missing"; readonly version?: string; readonly reason: string }
  | {
      readonly status: "ambiguous"
      readonly version?: string
      readonly reason: string
      readonly candidates: readonly string[]
    }

/**
 * Decides whether a feed version names one verified upstream source. All network and Git input is
 * passed in, so the decision is testable without either.
 */
export function resolve(input: {
  readonly feed?: Feed
  readonly tags: readonly TagRef[]
  readonly release?: UpstreamRelease
  readonly desktopVersion?: string
  readonly releases?: readonly BuildRecord[]
  readonly service?: UpdateServiceRecord
  readonly manifest?: string
}): Resolution {
  const { feed } = input

  if (!feed) return { status: "missing", reason: "The feed is not an electron-updater desktop manifest." }

  const artifacts = feed.files.filter((file) => file.name === WINDOWS_X64)

  if (artifacts.length === 0)
    return { status: "missing", version: feed.version, reason: `The ${feed.version} feed lists no ${WINDOWS_X64}.` }

  if (artifacts.length > 1)
    return {
      status: "ambiguous",
      version: feed.version,
      reason: `The ${feed.version} feed lists ${WINDOWS_X64} ${artifacts.length} times.`,
      candidates: artifacts.map((artifact) => artifact.name),
    }

  const artifact = artifacts[0]

  if (!input.service)
    return {
      status: "missing",
      version: feed.version,
      reason: `The update service did not return a record for feed version ${feed.version}.`,
    }

  if (input.service.version !== feed.version)
    return {
      status: "missing",
      version: feed.version,
      reason: `The update service records ${input.service.version}, not feed version ${feed.version}.`,
    }

  const manifest = input.manifest ? input.service.manifests[input.manifest] : undefined

  if (!manifest)
    return {
      status: "missing",
      version: feed.version,
      reason: `The update service records no ${input.manifest ?? "desktop"} manifest.`,
    }

  const attested = manifest.files.find(
    (file) => file.url === artifact.url && file.size === artifact.size && file.sha512 === artifact.sha512,
  )

  if (!attested)
    return {
      status: "missing",
      version: feed.version,
      reason: `The feed's ${artifact.name} is not the ${input.manifest} artifact the update service records.`,
    }

  const recorded = input.service.files[artifact.name]

  if (!recorded || recorded.url !== artifact.url || recorded.size !== artifact.size)
    return {
      status: "missing",
      version: feed.version,
      reason: `The update service does not record ${artifact.name} for feed version ${feed.version}.`,
    }

  if (!/^[0-9a-f]{64}$/i.test(recorded.sha256))
    return {
      status: "missing",
      version: feed.version,
      reason: `The update service records no SHA-256 for ${artifact.name}.`,
    }

  const version = normalizeVersion(feed.version)
  const candidates = sourceTags(input.tags, version)

  if (candidates.length === 0)
    return {
      status: "missing",
      version,
      reason: `Upstream has no v${version} tag for feed version ${feed.version}.`,
    }

  if (new Set(candidates.map((tag) => tag.source)).size > 1)
    return {
      status: "ambiguous",
      version,
      reason: `Upstream tags for ${feed.version} point at different commits.`,
      candidates: candidates.map((tag) => `${tag.name}@${tag.source.slice(0, 12)}`),
    }

  const tag = candidates.find((candidate) => candidate.name === `v${feed.version}`) ?? candidates[0]

  if (input.desktopVersion === undefined)
    return {
      status: "missing",
      version,
      reason: `Could not read packages/desktop/package.json at ${tag.source}.`,
    }

  if (input.desktopVersion !== feed.version && input.desktopVersion !== version)
    return {
      status: "missing",
      version,
      reason: `${tag.source} holds desktop ${input.desktopVersion}, not feed version ${feed.version}.`,
    }

  if (!input.release)
    return {
      status: "missing",
      version,
      reason: `Upstream has no GitHub release for ${tag.name}.`,
    }

  const assets = input.release.assets.filter((asset) => asset.name === artifact.name)

  if (assets.length === 0)
    return {
      status: "missing",
      version,
      reason: `The ${tag.name} release has no ${artifact.name}.`,
    }

  if (assets.length > 1)
    return {
      status: "ambiguous",
      version,
      reason: `The ${tag.name} release lists ${artifact.name} ${assets.length} times.`,
      candidates: assets.map((asset) => `${asset.name}@${asset.size}`),
    }

  const releaseAsset = assets[0]

  if (releaseAsset.size !== artifact.size)
    return {
      status: "missing",
      version,
      reason: `The ${tag.name} release's ${artifact.name} is ${releaseAsset.size} bytes, but the feed says ${artifact.size}.`,
    }

  const digest = /^sha256:([0-9a-f]{64})$/i.exec(releaseAsset.digest ?? "")

  if (!digest)
    return {
      status: "missing",
      version,
      reason: `The ${tag.name} release reports no SHA-256 digest for ${artifact.name}.`,
    }

  if (digest[1].toLowerCase() !== recorded.sha256.toLowerCase())
    return {
      status: "missing",
      version,
      reason: `The ${tag.name} release's ${artifact.name} has the same size but different content than the update service records.`,
    }

  const source = {
    version,
    tag: tag.name,
    source: tag.source,
    sha256: recorded.sha256,
    artifact,
    desktopVersion: input.desktopVersion,
    releaseAsset,
  } satisfies Source

  const existing = (input.releases ?? []).filter((build) => normalizeVersion(build.version) === version)
  const conflicting = existing.find((build) => build.source !== tag.source)

  if (conflicting)
    return {
      ...source,
      status: "conflict",
      existing: conflicting,
      reason: `OpenJam built ${conflicting.version} from ${conflicting.source}, but ${tag.name} now resolves to ${tag.source}.`,
    }

  const built = existing[0] ?? (input.releases ?? []).find((build) => build.source === tag.source)

  if (built) return { ...source, status: "already-built", built }

  return { ...source, status: "resolved" }
}

/**
 * A GitHub release reports Windows' four-part product version (`2.3.2.0`) while the tag and package
 * carry three parts, so the source version drops a trailing `.0`.
 */
export function normalizeVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)\.0$/.exec(version)

  return match ? `${match[1]}.${match[2]}.${match[3]}` : version
}

/** The tags that could name the source for a version: `v2.3.2` and its `.`-suffixed variants. */
export function sourceTags(tags: readonly TagRef[], version: string) {
  return tags.filter((tag) => tag.name === `v${version}` || tag.name.startsWith(`v${version}.`))
}

/** Chooses the tag to verify: the exact version first, then the first equivalent variant. */
export function sourceTag(candidates: readonly TagRef[], version: string): TagRef | undefined {
  if (candidates.length === 0) return undefined

  return candidates.find((candidate) => candidate.name === `v${version}`) ?? candidates[0]
}

/** Parses the electron-updater manifest, or returns undefined when it is not one. */
export function parseFeed(text: string): Feed | undefined {
  let raw: unknown

  try {
    raw = Bun.YAML.parse(text)
  } catch {
    return undefined
  }

  const manifest = Option.getOrUndefined(Schema.decodeUnknownOption(Manifest)(raw))

  if (!manifest) return undefined

  const files = manifest.files.flatMap((file): FeedArtifact[] => {
    const name = artifactName(file.url)

    if (!name || file.size <= 0) return []

    return [{ name, url: file.url, size: file.size, sha512: file.sha512 }]
  })

  if (files.length !== manifest.files.length) return undefined

  return { version: manifest.version, files }
}

/**
 * Parses `git ls-remote --tags` output into one entry per tag name. An annotated tag appears twice,
 * as the tag object and as `<name>^{}`; the peeled commit wins.
 */
export function parseTags(output: string): TagRef[] {
  const tags = new Map<string, string>()

  for (const line of output.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/)

    if (!sha || !ref?.startsWith("refs/tags/")) continue

    const name = ref.slice("refs/tags/".length)

    if (name.endsWith("^{}")) tags.set(name.slice(0, -3), sha)
    else if (!tags.has(name)) tags.set(name, sha)
  }

  return Array.from(tags, ([name, source]) => ({ name, source })).toSorted((left, right) =>
    left.name.localeCompare(right.name),
  )
}

function artifactName(url: string) {
  try {
    return new URL(url).pathname.split("/").at(-1) || undefined
  } catch {
    return undefined
  }
}

/**
 * The official update service record and Windows manifest key behind a feed URL. The desktop feed is
 * `<origin>/update/api/<channel>/desktop/<distribution>/`, and the Windows manifest is served as
 * `latest.yml` from `desktop.yml`. Any other origin is refused so the metadata check cannot be skipped.
 */
export function feedSource(feed: string) {
  const url = new URL(feed)

  if (url.origin !== "https://opencode.ai") return undefined

  const match = /^\/update\/api\/([^/]+)\/desktop\/([^/]+)\/?/.exec(url.pathname)

  if (!match) return undefined

  const name = url.pathname.endsWith(".yml") ? url.pathname.split("/").at(-1) : "latest.yml"

  return {
    record: `${url.origin}/update/api/${match[1]}/desktop/${match[2]}`,
    manifest: name?.replace(/^latest/, "desktop") ?? "desktop.yml",
  }
}

// ---- Script ---------------------------------------------------------------------------------------

type Options = {
  readonly feed: string
  readonly upstream: string
  readonly releases?: string
  readonly help: boolean
}

function options(args: readonly string[]): Options {
  const values = new Map<string, string>()
  let help = false

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]

    if (arg === "--help" || arg === "-h") {
      help = true
      continue
    }

    const separator = arg.indexOf("=")
    const name = separator === -1 ? arg : arg.slice(0, separator)

    if (!["--feed", "--upstream", "--releases"].includes(name)) throw new Error(`Unknown argument: ${arg}`)

    const inline = separator === -1 ? undefined : arg.slice(separator + 1)
    const value = inline ?? args[++index]

    if (!value) throw new Error(`Missing value for ${name}`)

    values.set(name, value)
  }

  return {
    feed: values.get("--feed") ?? STABLE_FEED,
    upstream: values.get("--upstream") ?? "anomalyco/opencode",
    releases: values.get("--releases"),
    help,
  }
}

async function load(options: Options): Promise<Resolution> {
  const source = feedSource(options.feed)

  if (!source) return { status: "missing", reason: `Not an official update service feed: ${options.feed}` }

  const feedUrl = new URL(options.feed.endsWith(".yml") ? options.feed : `${options.feed}latest.yml`)
  const feed = parseFeed(await expectText(fetch(feedUrl), "feed"))
  const service = await updateRecord(source.record)
  const tags = parseTags(await run(["git", "ls-remote", "--tags", `https://github.com/${options.upstream}.git`]))
  const version = feed ? normalizeVersion(feed.version) : undefined
  const tag = version ? sourceTag(sourceTags(tags, version), version) : undefined
  const release = tag ? await githubRelease(options.upstream, tag.name) : undefined
  const desktopVersion = tag ? await desktopVersionAt(options.upstream, tag.source) : undefined
  const releases = options.releases ? await readReleases(options.releases) : []

  return resolve({ feed, tags, release, desktopVersion, releases, service, manifest: source.manifest })
}

async function updateRecord(url: string): Promise<UpdateServiceRecord | undefined> {
  const response = await fetch(url)

  if (!response.ok) return undefined

  const record = Option.getOrUndefined(Schema.decodeUnknownOption(UpdateServicePayload)(await response.json()))

  if (!record) return undefined

  return {
    version: record.version,
    manifests: record.metadata.manifests,
    files: record.metadata.files,
  }
}

async function readReleases(file: string) {
  const ledger = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.fromJsonString(BuildLedger))(await Bun.file(file).text()),
  )

  if (!ledger) throw new Error(`Not a build ledger: ${file}`)

  return ledger.releases
}

async function githubRelease(upstream: string, tag: string): Promise<UpstreamRelease | undefined> {
  const token = process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"]
  const headers = new Headers({ Accept: "application/vnd.github+json" })

  if (token) headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(`https://api.github.com/repos/${upstream}/releases/tags/${tag}`, { headers })

  if (response.status === 404) return undefined

  if (!response.ok) throw new Error(`Release ${tag} request failed with ${response.status}`)

  const release = Option.getOrUndefined(Schema.decodeUnknownOption(Release)(await response.json()))

  if (!release) throw new Error(`Release ${tag} is not a GitHub release payload`)

  return {
    tag,
    assets: release.assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
      digest: asset.digest ?? undefined,
    })),
  }
}

async function desktopVersionAt(upstream: string, source: string) {
  const response = await fetch(`https://raw.githubusercontent.com/${upstream}/${source}/packages/desktop/package.json`)

  if (response.status === 404) return undefined

  if (!response.ok) throw new Error(`packages/desktop/package.json at ${source} request failed with ${response.status}`)

  const pkg = Option.getOrUndefined(Schema.decodeUnknownOption(DesktopPackage)(await response.json()))

  return pkg?.version
}

async function expectText(request: Promise<Response>, label: string) {
  const response = await request

  if (!response.ok) throw new Error(`${label} request failed with ${response.status}`)

  return response.text()
}

async function run(command: string[]) {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  if (code !== 0) throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`)

  return stdout
}

function usage() {
  return `Usage: bun run --cwd packages/desktop openjam-source [options]

Resolves the stable Windows x64 feed version to verified upstream source. Exits 0 for a resolved or
already-built source, and 1 for missing, ambiguous or conflicting source.

Options:
  --feed <url>       Desktop feed directory or manifest URL (default: ${STABLE_FEED})
  --upstream <repo>  Upstream GitHub repository (default: anomalyco/opencode)
  --releases <file>  JSON build ledger: { "releases": [{ "version": "2.3.2", "source": "<sha>" }] }
  -h, --help         Show this help`
}

if (import.meta.main) {
  const args = options(Bun.argv.slice(2))

  if (args.help) {
    console.log(usage())
    process.exit(0)
  }

  const result = await load(args)
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.status === "resolved" || result.status === "already-built" ? 0 : 1)
}
