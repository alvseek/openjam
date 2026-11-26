import { createRequire } from "node:module"
import path from "node:path"
import { installerName, manifestName, releaseFile } from "./release"

/** Rebuild electron-updater's external blockmap and manifest from the final installer bytes. */
export async function regenerateMetadata(directory: string, version: string) {
  await releaseFile(directory, installerName)
  const file = path.join(directory, installerName)
  // Use the same implementation as electron-builder's NSIS target, from the control checkout's lockfile.
  const {
    buildBlockMap,
  }: {
    buildBlockMap(file: string, compression: "gzip", output: string): Promise<{ size: number; sha512: string }>
  } = createRequire(new URL("../../packages/desktop/package.json", import.meta.url))(
    "app-builder-lib/out/targets/blockmap/blockmap.js",
  )
  const info = await buildBlockMap(file, "gzip", `${file}.blockmap`)
  await Bun.write(
    path.join(directory, manifestName),
    Bun.YAML.stringify({
      version,
      files: [{ url: installerName, ...info }],
      path: installerName,
      sha512: info.sha512,
      releaseDate: new Date().toISOString(),
    }),
  )
}
