#!/usr/bin/env bun
import { $ } from "bun"
import { copyFile, exists, mkdir, mkdtemp, rename, rmdir } from "node:fs/promises"
import path from "node:path"
import { checkOpenJamOverlay } from "./openjam-overlay"
import { openJamSigning } from "./openjam-signing"

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Build OpenJam on Windows x64")

const control = path.resolve(import.meta.dir, "..")

const dir = path.resolve() === control ? control : path.resolve("packages/desktop")

if (!(await exists(path.join(dir, "package.json"))))
  throw new Error("Run from the upstream checkout or desktop package")

const { version } = await Bun.file(path.join(dir, "package.json")).json()

const candidate = process.argv[2] ?? process.env.OPENJAM_VERSION ?? version

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(candidate))
  throw new Error("Usage: bun run script/openjam-build.ts [major.minor.patch]")

const signing = openJamSigning()

if (dir !== control) {
  await overlay(control, dir, version)
  await $`bun install --frozen-lockfile`.cwd(path.resolve(dir, "../.."))
}

const env = {
  ...process.env,
  // Only the explicit Windows identity is allowed to sign an OpenJam candidate.
  CSC_LINK: undefined,
  OPENCODE_DESKTOP_FLAVOR: "openjam",
  OPENCODE_CHANNEL: "latest",
  OPENCODE_TARGET: "windows-x64",
  OPENCODE_VERSION: candidate,
  OPENCODE_DESKTOP_APP: undefined,
}

await $`bun run build`.cwd(dir).env(env)

await $`bun run pack`.cwd(dir).env(env)

// pack clears dist/desktop on each pass, so park the first pass outside its output.
const dist = path.resolve(dir, "../../dist")

const app = path.join(dist, "desktop", "app")

const staging = await mkdtemp(path.join(dist, "openjam-"))

const staged = path.join(staging, "app")

await rename(app, staged)

await $`bun run pack`.cwd(dir).env({ ...env, OPENCODE_DESKTOP_APP: staged })

await rename(staged, app)

await rmdir(staging)

if (signing.required) {
  await $`powershell.exe -NoProfile -NonInteractive -Command ${`
    $ErrorActionPreference = 'Stop'
    $signature = Get-AuthenticodeSignature -LiteralPath $env:OPENJAM_VERIFY_INSTALLER
    if ($signature.Status -ne 'Valid') { throw "Installer Authenticode status: $($signature.Status)" }
    if ($signature.SignerCertificate.GetNameInfo('SimpleName', $false) -cne $env:OPENJAM_VERIFY_PUBLISHER) {
      throw 'Installer signer does not match the pinned OpenJam publisher'
    }
  `}`.env({
    ...env,
    OPENJAM_VERIFY_INSTALLER: path.join(dist, "desktop", "openjam-desktop-win-x64.exe"),
    OPENJAM_VERIFY_PUBLISHER: signing.publisher,
  })
}

if (process.env.OPENJAM_OUTPUT_DIR) {
  const output = path.resolve(process.env.OPENJAM_OUTPUT_DIR)
  await mkdir(output, { recursive: true })

  for (const file of ["openjam-desktop-win-x64.exe", "openjam-desktop-win-x64.exe.blockmap", "latest.yml"])
    await copyFile(path.join(dist, "desktop", file), path.join(output, file))
}

async function overlay(from: string, to: string, version: string) {
  const service = "src/main/service/openjam-service.ts"
  const added = ["script/openjam-signing.ts", "src/shared/openjam.ts"]
  const modern = ["src/renderer/startup/openjam-i18n.ts", service]

  for (const file of [...added, ...(version === "2.3.2" ? [service] : modern)]) {
    if (await exists(path.join(to, file))) throw new Error(`OpenJam overlay would overwrite ${file}`)
  }

  const checkout = path.resolve(to, "../..")

  if (version !== "2.3.2") {
    const patch = path.join(from, "script/openjam-2.4.2.patch")

    await checkOpenJamOverlay(checkout, patch)
    await $`git apply ${patch}`.cwd(checkout)
    await Promise.all([...added, ...modern].map((file) => copyFile(path.join(from, file), path.join(to, file))))

    return
  }

  // These are the upstream blobs this overlay was reviewed against. Refuse to overwrite new upstream
  // packaging or service behavior until the overlay is reviewed and refreshed.
  const background = "src/main/service/background-service.ts"
  const replaced = {
    "electron-builder.config.ts": "d147662ffd346b3f7cb8ae4643a4e6e6098817a4",
    "electron.vite.config.ts": "22aef746259e2864089c6b54d161b88238aded4e",
    "script/build.ts": "6d55837c17034037edf266a96b14ad89577f76bb",
    "script/pack.ts": "0950d9530447c04696a2350b45a46ca3dd4f6ca3",
    "src/main/constants.ts": "79972677a1f73cb566eb8af5313aea4bf04d71ba",
    "src/main/lifecycle/environment.ts": "2f6e54eff207a60349ff5483d88b567c329b3682",
    [background]: "7bf76da471d48d5819f87cc39a1c80eec72891a2",
    "src/main/service/sidecar-probe.ts": "5f1ceedbc570e442f4a8057f07dee5aa11c91e0f",
  }

  for (const [file, hash] of Object.entries(replaced)) {
    const blob = await $`git hash-object --path=${file} ${file}`.cwd(to).text()

    if (blob.trim() !== hash) throw new Error(`OpenJam overlay needs review: upstream ${file} changed`)
  }

  // This renderer predates the startup error codes. Keep the original discovery-only caller and helper together.
  const patch = path.join(from, "script/openjam-2.3.2.patch")

  await $`git apply ${patch}`.cwd(checkout)
  await Promise.all(
    [...Object.keys(replaced).filter((file) => file !== background), ...added].map((file) =>
      copyFile(path.join(from, file), path.join(to, file)),
    ),
  )
}
