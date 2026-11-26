import { describe, expect, test } from "bun:test"
import { getConfig } from "../electron-builder.config"
import {
  feedSource,
  normalizeVersion,
  parseFeed,
  parseTags,
  resolve,
  STABLE_FEED,
  type BuildRecord,
  type Feed,
  type TagRef,
  type UpdateServiceRecord,
} from "./openjam-source"

const source = "c0ad18b402eb2827fc1ee71c171b1177b3fc02d1"

const installerSize = 269731480

const arm64Url = "https://opencode.ai/files/bin/2.3.2/opencode-desktop-win-arm64.exe"

const x64Url = "https://opencode.ai/files/bin/2.3.2/opencode-desktop-win-x64.exe"

const sha256 = "1e73b4f49f591971f4ad61c5a39b284bf74d41f50ca1b84e68ccf2ab2be91e8d"

const feed: Feed = {
  version: "2.3.2",
  files: [
    { name: "opencode-desktop-win-arm64.exe", url: arm64Url, size: 256837488, sha512: "arm64" },
    { name: "opencode-desktop-win-x64.exe", url: x64Url, size: installerSize, sha512: "x64" },
  ],
}

const service: UpdateServiceRecord = {
  version: "2.3.2",
  manifests: {
    "desktop.yml": {
      files: [
        { url: arm64Url, sha512: "arm64", size: 256837488 },
        { url: x64Url, sha512: "x64", size: installerSize },
      ],
    },
  },
  files: {
    "opencode-desktop-win-arm64.exe": { url: arm64Url, sha256: "a".repeat(64), size: 256837488 },
    "opencode-desktop-win-x64.exe": { url: x64Url, sha256, size: installerSize },
  },
}

const tags: TagRef[] = [{ name: "v2.3.2", source }]

const release = {
  tag: "v2.3.2",
  assets: [
    { name: "opencode-desktop-win-arm64.exe", size: 256837488 },
    { name: "opencode-desktop-win-x64.exe", size: installerSize, digest: `sha256:${sha256}` },
  ],
}

const verified = { feed, tags, release, desktopVersion: "2.3.2", service, manifest: "desktop.yml" }

describe("feed to source", () => {
  test("resolves the Windows x64 feed version to its upstream tag commit", () => {
    expect(resolve(verified)).toMatchObject({
      status: "resolved",
      version: "2.3.2",
      tag: "v2.3.2",
      source,
      sha256,
      desktopVersion: "2.3.2",
      artifact: { name: "opencode-desktop-win-x64.exe", size: installerSize },
      releaseAsset: { name: "opencode-desktop-win-x64.exe", size: installerSize, digest: `sha256:${sha256}` },
    })
  })

  test("maps Windows' four-part product version to the three-part tag", () => {
    expect(normalizeVersion("2.3.2.0")).toBe("2.3.2")
    expect(normalizeVersion("2.3.2")).toBe("2.3.2")
    expect(
      resolve({
        ...verified,
        feed: { ...feed, version: "2.3.2.0" },
        service: { ...service, version: "2.3.2.0" },
        desktopVersion: "2.3.2",
      }),
    ).toMatchObject({
      status: "resolved",
      version: "2.3.2",
      tag: "v2.3.2",
    })
  })

  test("accepts equivalent tags that point at the same commit", () => {
    expect(resolve({ ...verified, tags: [tags[0], { name: "v2.3.2.0", source }] })).toMatchObject({
      status: "resolved",
      tag: "v2.3.2",
    })
  })

  test("blocks a feed that is not a desktop manifest", () => {
    expect(resolve({ ...verified, feed: undefined })).toMatchObject({ status: "missing" })
  })

  test("blocks a feed that lists no Windows x64 installer", () => {
    expect(resolve({ ...verified, feed: { ...feed, files: [feed.files[0]] } })).toMatchObject({
      status: "missing",
      version: "2.3.2",
    })
  })

  test("blocks a feed that lists the Windows x64 installer twice", () => {
    expect(resolve({ ...verified, feed: { ...feed, files: [feed.files[1], feed.files[1]] } })).toMatchObject({
      status: "ambiguous",
      version: "2.3.2",
      candidates: ["opencode-desktop-win-x64.exe", "opencode-desktop-win-x64.exe"],
    })
  })

  test("blocks a version with no upstream tag", () => {
    expect(resolve({ ...verified, tags: [{ name: "v2.3.1", source }] })).toMatchObject({
      status: "missing",
      reason: "Upstream has no v2.3.2 tag for feed version 2.3.2.",
    })
  })

  test("blocks two upstream tags for the version that point at different commits", () => {
    expect(resolve({ ...verified, tags: [tags[0], { name: "v2.3.2.0", source: "de291ab7b1c6" }] })).toMatchObject({
      status: "ambiguous",
      version: "2.3.2",
      candidates: ["v2.3.2@c0ad18b402eb", "v2.3.2.0@de291ab7b1c6"],
    })
  })

  test("blocks a tag whose desktop package does not carry the feed version", () => {
    expect(resolve({ ...verified, desktopVersion: "2.3.1" })).toMatchObject({
      status: "missing",
      reason: `${source} holds desktop 2.3.1, not feed version 2.3.2.`,
    })
  })

  test("blocks a tag that cannot report its desktop package version", () => {
    expect(resolve({ ...verified, desktopVersion: undefined })).toMatchObject({ status: "missing" })
  })

  test("blocks a version with no upstream release", () => {
    expect(resolve({ ...verified, release: undefined })).toMatchObject({
      status: "missing",
      reason: "Upstream has no GitHub release for v2.3.2.",
    })
  })

  test("blocks a release that does not contain the feed's installer", () => {
    expect(resolve({ ...verified, release: { ...release, assets: [release.assets[0]] } })).toMatchObject({
      status: "missing",
      reason: "The v2.3.2 release has no opencode-desktop-win-x64.exe.",
    })
  })

  test("blocks a release whose installer size differs from the feed", () => {
    expect(
      resolve({
        ...verified,
        release: { ...release, assets: [release.assets[0], { ...release.assets[1], size: installerSize - 1 }] },
      }),
    ).toMatchObject({
      status: "missing",
      reason: `The v2.3.2 release's opencode-desktop-win-x64.exe is ${installerSize - 1} bytes, but the feed says ${installerSize}.`,
    })
  })

  test("reports an already-built source without resolving it for a new build", () => {
    const releases: BuildRecord[] = [{ version: "2.3.2", source }]

    expect(resolve({ ...verified, releases })).toMatchObject({
      status: "already-built",
      source,
      built: { version: "2.3.2", source },
    })
  })

  test("reports a conflict when the same version now resolves to a different source", () => {
    const built = { version: "2.3.2", source: "de291ab7b1c6e2ea6a3dd2faffeb40967c02f537" }

    expect(resolve({ ...verified, releases: [built] })).toMatchObject({
      status: "conflict",
      source,
      existing: built,
      reason: `OpenJam built 2.3.2 from ${built.source}, but v2.3.2 now resolves to ${source}.`,
    })
  })

  test("ignores builds of other versions", () => {
    expect(resolve({ ...verified, releases: [{ version: "2.3.1", source: "de291ab7b1c6" }] })).toMatchObject({
      status: "resolved",
    })
  })
})

describe("update service proof", () => {
  test("blocks a feed the update service did not record", () => {
    expect(resolve({ ...verified, service: undefined })).toMatchObject({ status: "missing" })
  })

  test("blocks a version the update service records differently", () => {
    expect(resolve({ ...verified, service: { ...service, version: "2.3.1" } })).toMatchObject({
      status: "missing",
      reason: "The update service records 2.3.1, not feed version 2.3.2.",
    })
  })

  test("blocks a feed artifact the update service does not attest", () => {
    const desktop = service.manifests["desktop.yml"]

    expect(
      resolve({ ...verified, service: { ...service, manifests: { "desktop.yml": { files: [desktop.files[0]] } } } }),
    ).toMatchObject({
      status: "missing",
      reason: "The feed's opencode-desktop-win-x64.exe is not the desktop.yml artifact the update service records.",
    })
  })

  test("blocks a feed manifest the update service does not record", () => {
    expect(resolve({ ...verified, manifest: "desktop-linux.yml" })).toMatchObject({
      status: "missing",
      reason: "The update service records no desktop-linux.yml manifest.",
    })
  })

  test("blocks a service record without a SHA-256", () => {
    expect(
      resolve({
        ...verified,
        service: {
          ...service,
          files: {
            ...service.files,
            "opencode-desktop-win-x64.exe": { url: x64Url, sha256: "", size: installerSize },
          },
        },
      }),
    ).toMatchObject({
      status: "missing",
      reason: "The update service records no SHA-256 for opencode-desktop-win-x64.exe.",
    })
  })

  test("blocks a release asset without a SHA-256 digest", () => {
    expect(
      resolve({
        ...verified,
        release: { ...release, assets: [release.assets[0], { ...release.assets[1], digest: undefined }] },
      }),
    ).toMatchObject({
      status: "missing",
      reason: "The v2.3.2 release reports no SHA-256 digest for opencode-desktop-win-x64.exe.",
    })
  })

  test("blocks a same-size release asset with different content", () => {
    expect(
      resolve({
        ...verified,
        release: {
          ...release,
          assets: [release.assets[0], { ...release.assets[1], digest: `sha256:${"0".repeat(64)}` }],
        },
      }),
    ).toMatchObject({
      status: "missing",
      reason:
        "The v2.3.2 release's opencode-desktop-win-x64.exe has the same size but different content than the update service records.",
    })
  })
})

describe("feed source", () => {
  test("derives the official record and Windows manifest from the stable feed", () => {
    expect(feedSource(STABLE_FEED)).toEqual({
      record: "https://opencode.ai/update/api/latest/desktop/opencode",
      manifest: "desktop.yml",
    })
  })

  test("accepts a direct Windows manifest URL", () => {
    expect(feedSource(`${STABLE_FEED}latest.yml`)).toEqual({
      record: "https://opencode.ai/update/api/latest/desktop/opencode",
      manifest: "desktop.yml",
    })
  })

  test("refuses a feed outside the official update service", () => {
    expect(feedSource("https://example.com/update/api/latest/desktop/opencode/")).toBeUndefined()
    expect(feedSource("https://opencode.ai/files/latest.yml")).toBeUndefined()
  })
})

describe("feed manifest", () => {
  test("reads the updater manifest the stable feed serves", () => {
    expect(
      parseFeed(`files:
  - url: https://opencode.ai/files/bin/2.3.2/opencode-desktop-win-x64.exe
    sha512: AXenMdFn3pro28k5+d0m21MzwK1HpyIjtm5nONVLgvaC3Yakq6Gyq7LczldnBg1AOXTXV4MyPdKfXmrU3ZvFew==
    size: 269731480
releaseDate: 2026-11-18T01:13:11.000Z
version: 2.3.2
`),
    ).toEqual({
      version: "2.3.2",
      files: [
        {
          name: "opencode-desktop-win-x64.exe",
          url: "https://opencode.ai/files/bin/2.3.2/opencode-desktop-win-x64.exe",
          size: installerSize,
          sha512: "AXenMdFn3pro28k5+d0m21MzwK1HpyIjtm5nONVLgvaC3Yakq6Gyq7LczldnBg1AOXTXV4MyPdKfXmrU3ZvFew==",
        },
      ],
    })
  })

  test("rejects malformed manifests instead of guessing", () => {
    expect(parseFeed("files: [")).toBeUndefined()
    expect(parseFeed("version: 2.3.2\nfiles: [{ url: /relative }]")).toBeUndefined()
    expect(parseFeed("version: 2.3.2")).toBeUndefined()
  })
})

describe("upstream tags", () => {
  test("peels annotated tags and keeps one entry per name", () => {
    expect(
      parseTags(`c0ad18b402eb2827fc1ee71c171b1177b3fc02d1\trefs/tags/v2.3.2^{}
526a88235da8ff8504a713b0954299c6758dea79\trefs/tags/v2.3.2
1835d7526fba897ab00a32574189bb54e3d8f831\trefs/tags/v2.3.1
`),
    ).toEqual([
      { name: "v2.3.1", source: "1835d7526fba897ab00a32574189bb54e3d8f831" },
      { name: "v2.3.2", source: "c0ad18b402eb2827fc1ee71c171b1177b3fc02d1" },
    ])
  })
})

describe("stable feed", () => {
  test("is the feed the production app updates from", () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = "prod"

    try {
      expect(getConfig().publish).toMatchObject({
        provider: "generic",
        url: STABLE_FEED,
        channel: "latest",
      })
    } finally {
      delete process.env.OPENCODE_CHANNEL

      if (previous !== undefined) process.env.OPENCODE_CHANNEL = previous
    }
  })
})
