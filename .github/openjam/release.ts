import { copyFile, lstat, mkdir, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"

export const manifestName = "latest.yml"
export const installerName = "openjam-desktop-win-x64.exe"
export const ledgerName = "openjam-releases.json"
export const repository = "alvseek/openjam"

export type Build = { version: string; source: string }
export type Ledger = { releases: readonly Build[] }
export type Asset = { name: string; size: number; digest: string }

const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const source = /^[a-f0-9]{40}$/

export function build(versionValue: unknown, sourceValue: unknown): Build {
  if (typeof versionValue !== "string" || !version.test(versionValue)) throw new Error("Invalid OpenJam version")
  if (typeof sourceValue !== "string" || !source.test(sourceValue))
    throw new Error("Expected a full upstream commit SHA")
  return { version: versionValue, source: sourceValue }
}

export function readLedger(raw: unknown): Ledger {
  if (!raw || typeof raw !== "object" || !("releases" in raw) || !Array.isArray(raw.releases))
    throw new Error("Invalid OpenJam build ledger")
  const releases = raw.releases.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || !("version" in entry) || !("source" in entry))
      throw new Error("Invalid OpenJam build ledger entry")
    return build(entry.version, entry.source)
  })
  if (
    releases.some((entry, index) => {
      const previous = releases[index - 1]
      return previous && Bun.semver.order(previous.version, entry.version) >= 0
    })
  )
    throw new Error("OpenJam ledger versions must be unique and increasing")
  if (new Set(releases.map((entry) => entry.source)).size !== releases.length)
    throw new Error("OpenJam ledger contains duplicate source commits")
  return { releases }
}

export function nextLedger(ledger: Ledger, candidate: Build): Ledger | undefined {
  const previous = ledger.releases.find((entry) => entry.version === candidate.version)
  if (previous && previous.source !== candidate.source)
    throw new Error(`OpenJam ${candidate.version} already records upstream ${previous.source}, not ${candidate.source}`)
  if (previous || ledger.releases.some((entry) => entry.source === candidate.source)) return undefined
  const latest = ledger.releases.at(-1)
  if (latest && Bun.semver.order(candidate.version, latest.version) <= 0)
    throw new Error(`Refusing to replace OpenJam ${latest.version} with older upstream ${candidate.version}`)
  return { releases: [...ledger.releases, candidate] }
}

export const tagFor = (version: string) => `openjam-v${version}`

export async function releaseFile(directory: string, name: string) {
  const file = path.join(directory, name)
  const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
  })
  if (!info?.isFile() || info.size === 0) throw new Error(`Missing or empty release file: ${name}`)
  return Bun.file(file)
}

async function validatePackage(directory: string, expectedVersion: string) {
  const manifest: unknown = Bun.YAML.parse(await (await releaseFile(directory, manifestName)).text())
  if (!manifest || typeof manifest !== "object" || !("version" in manifest) || manifest.version !== expectedVersion)
    throw new Error(`latest.yml must describe OpenJam ${expectedVersion}`)
  if (!("files" in manifest) || !Array.isArray(manifest.files) || manifest.files.length !== 1)
    throw new Error("latest.yml must list exactly one Windows x64 installer")
  const installer: unknown = manifest.files[0]
  if (
    !installer ||
    typeof installer !== "object" ||
    !("url" in installer) ||
    installer.url !== installerName ||
    !("size" in installer) ||
    !("sha512" in installer)
  )
    throw new Error("latest.yml must reference a relative OpenJam Windows x64 installer filename, size, and SHA-512")
  const file = await releaseFile(directory, installer.url)
  if (installer.size !== file.size) throw new Error(`${installer.url} size does not match latest.yml`)
  const hash = new Bun.CryptoHasher("sha512")
  for await (const chunk of file.stream()) hash.update(chunk)
  if (installer.sha512 !== hash.digest("base64")) throw new Error(`${installer.url} SHA-512 does not match latest.yml`)
  if (
    ("path" in manifest && manifest.path !== installer.url) ||
    ("sha512" in manifest && manifest.sha512 !== installer.sha512)
  )
    throw new Error("latest.yml legacy path or SHA-512 does not match its files entry")
  const blockmap = `${installer.url}.blockmap`
  await releaseFile(directory, blockmap)
  return [manifestName, installer.url, blockmap]
}

export async function stage(input: {
  packageDir: string
  stageDir: string
  ledger: Ledger
  candidate: Build
  desktopVersion?: string
}) {
  const ledger = nextLedger(input.ledger, input.candidate)
  if (!ledger) return "already-built"
  const expectedVersion = input.desktopVersion ?? input.candidate.version
  if (!version.test(expectedVersion)) throw new Error("Invalid candidate desktop version")
  const names = await validatePackage(input.packageDir, expectedVersion)
  // Use a fresh adjacent directory so readers never see a partially copied local candidate.
  const temporary = `${input.stageDir}.${crypto.randomUUID()}.stage`
  await mkdir(path.dirname(input.stageDir), { recursive: true })
  await mkdir(temporary)
  try {
    await Promise.all(names.map((name) => copyFile(path.join(input.packageDir, name), path.join(temporary, name))))
    await Bun.write(path.join(temporary, ledgerName), JSON.stringify(ledger, null, 2) + "\n")
    await validatePackage(temporary, expectedVersion)
    // The destination must be new; never replace a previous candidate/feed.
    if (
      await lstat(input.stageDir).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error
          return false
        },
      )
    )
      throw new Error(`Stage directory already exists: ${input.stageDir}`)
    await rename(temporary, input.stageDir)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  return "staged"
}

export interface ReleaseStore {
  readPublished(): Promise<Ledger>
  createDraft(candidate: Build): Promise<number>
  upload(id: number, file: string, name: string): Promise<void>
  readDraftAssets(id: number, candidate: Build): Promise<Asset[]>
  publish(id: number): Promise<void>
}

export async function promote(directory: string, candidate: Build, store: ReleaseStore) {
  const next = nextLedger(await store.readPublished(), candidate)
  if (!next) return "already-built"
  const ledger = readLedger(await (await releaseFile(directory, ledgerName)).json())
  if (JSON.stringify(ledger) !== JSON.stringify(next))
    throw new Error("Staged ledger does not extend the current published ledger with this upstream build")
  const names = [...(await validatePackage(directory, candidate.version)), ledgerName]
  if ((await readdir(directory)).length !== names.length)
    throw new Error("Stage directory contains unexpected release files")
  const expected = await Promise.all(
    names.map(async (name): Promise<Asset> => {
      const file = await releaseFile(directory, name)
      const hash = new Bun.CryptoHasher("sha256")
      for await (const chunk of file.stream()) hash.update(chunk)
      return { name, size: file.size, digest: `sha256:${hash.digest("hex")}` }
    }),
  )
  const id = await store.createDraft(candidate)
  for (const name of names) await store.upload(id, path.join(directory, name), name)
  const uploaded = await store.readDraftAssets(id, candidate)
  if (
    uploaded.length !== expected.length ||
    expected.some(
      (asset) =>
        !uploaded.some(
          (other) => other.name === asset.name && other.size === asset.size && other.digest === asset.digest,
        ),
    )
  )
    throw new Error(`GitHub draft assets do not match the staged release (draft ${id}); prior feed was not changed`)
  await store.publish(id)
  return "published"
}
