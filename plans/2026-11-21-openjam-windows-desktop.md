# Quick Wizard plan: OpenJam for Windows desktop

Status: installer and release workflow implemented locally; signed installed A-to-B acceptance
and hosted release verification pending. Nothing is installed or published. Automatic publication
remains disabled. Use the **final candidates** at the end of the execution log, not the earlier build paths.

## Inherited context

Parent plan: none.

Pre-planning discussion: “for now only the window desktop app.” Keep the elapsed-time indicator for KV cache information; follow stable upstream desktop releases. A conflict must leave the last working release available. Use a saved Quick Wizard plan rather than direct implementation.

## Objective

Install OpenJam alongside stock OpenCode on Alvi's Windows x64 machine. Keep the timer through updates without maintaining every release manually.

## Confirmed decisions

| Decision | Choice and reason |
|---|---|
| First launch (A) | Use the existing OpenCode service, conversations and configuration. Keep OpenJam’s installer, updater, window settings and drafts separate. No session migration. |
| Publication (A) | Verify a first A-to-B update before enabling automatic public releases. Subsequent passing builds publish without individual approval. |
| Upstream release source | Use the stable desktop feed configured in the installed 2.3.2.0 app. Match its version to upstream source, not GitHub's unqualified latest release. |
| Update source | Package an OpenJam-only feed and updater cache. The blue button installs a built release; it never runs Git on the user's machine. |

## Execution steps and success criteria

1. Resolve the Windows x64 feed version to verified upstream source; inspect the release's packaging and service contracts. Exercise missing/ambiguous-source and already-built cases. No match means no publication. (crosses: HTTP, Git)
2. Replay the elapsed-time patch from `cba315fd58` onto that source in a disposable checkout. Check elapsed time, declared and absent cache lifetimes, and actual desktop rendering. Exercise a conflicting patch and confirm the release feed remains unchanged. (crosses: Git, filesystem)
3. Package a separately identified per-user Windows installer. Isolate installer paths, desktop state, updater cache and shell registrations from stock; verify the bundled client connects compatibly to the existing service and opens an existing conversation without copying data. (crosses: Windows installer, service)
4. Add a scheduled and manually runnable release workflow. Stage the installer and its matching updater metadata together; serialize promotion and leave the published feed alone on conflicts, test failures, or incomplete artifacts. Report the failed upstream version and step. (crosses: GitHub Actions/Releases)
5. Bootstrap with two versioned candidate builds and the real Windows updater. Install A, update using the blue button, confirm B is running, and check the existing conversation, timer and untouched stock installation. Enable automatic publication only after this passes. Record the installer link and update instructions. (crosses: Windows desktop, release feed)

## Quality review

The review covered the timer, resolved feed, packaging, installer identity, stock service
adoption, signing and promotion. No project `quality-standard.md` was found.

| Finding | Resolution / verification |
|---|---|
| Version allowlist required manual edits for otherwise unchanged stable releases. | Adapter checks the reviewed files by their Git identities. A version-only change passes; a changed packaging input is rejected. |
| An unsigned build could reach the proposed publication path. | Protected signing job and a fresh publisher/signature check before promotion. A real signing run is still needed. |
| Windows Git checkout could convert the patches to CRLF, making CI reject even a reviewed baseline. | `.gitattributes` forces LF for both release patches. A clean `core.autocrlf=true` checkout preserved LF and both patches passed `git apply --cached --check` against 2.4.2. |
| The toolbar claimed the cache had expired even if background warming refreshed it. | Tooltip now states only that time since the last request exceeds the configured cache lifetime. Both built-renderer cases passed against 2.4.2. |
| A stock/client version mismatch could strand OpenJam after an independent update. | Discovery must never replace stock. Keep the A/B test on a compatible service; see the final compatibility evidence in the execution log. |

The independent reviewer found no static installer, uninstall, shortcut, desktop-state, updater
cache or `opencode://` collision. That finding is not a substitute for the live checks below.

## QA handoff

There is no repository QA bench or QA map. The implementation log records the local builds,
renderer runs, service tests and staging checks. None substitutes for the installed update.

**Installed acceptance, not run:** After signed A and B are ready, both must use the same
publisher, loopback feed and a CLI compatible with the running stock service. Serve B's staged
directory (`latest.yml`, installer and blockmap) with a static server bound to that loopback
address. Install A alongside stock; open a conversation you recognize and note the version.
Use OpenJam's blue update button, then confirm About shows B, the same conversation still opens,
the cache age appears, and stock OpenCode remains installed and usable. No conversation export or
session migration is needed. Leave publication disabled if any of these fail.

## Implementation log

### Step 1 — stable Windows x64 feed to verified upstream source (done)

Delivered `packages/desktop/script/openjam-source.ts` with tests in
`packages/desktop/script/openjam-source.test.ts`, and the `openjam-source` script in
`packages/desktop/package.json`. It reads the same feed the installed production app updates from,
resolves it to one upstream tag and commit, and then requires three independent agreements: the
official update service attests the feed artifact by URL, size and SHA-512; the desktop package at the
selected commit carries the feed version; and the GitHub release's x64 installer has the same size and
the SHA-256 the update service records. It returns `resolved`, `already-built`, `conflict`, `missing`
or `ambiguous`, and exits 0 only for `resolved` and `already-built`, so missing or ambiguous source,
missing proof or mismatched proof cannot start a publication.

The build ledger input is `--releases <file>`: `{ "releases": [{ "version": "2.3.2", "source": "<sha>" }] }`.
There is no default ledger because no OpenJam build exists yet. Step 4 must emit this record from what
it publishes; a record with the same source is `already-built`, and a record with the same version but
a different source is `conflict` and must leave the published feed alone.

#### Live observation (installed app, feed, upstream)

- Installed app: `C:\Users\alvia\AppData\Local\Programs\ai.opencode.desktop`; `OpenCode.exe`
  FileVersion `2.3.2`, ProductVersion `2.3.2.0`.
- `resources/app-update.yml`: `provider: generic`, `url: https://opencode.ai/update/api/latest/desktop/opencode/`,
  `channel: latest`, `updaterCacheDirName: '@opencodedesktop-updater'`. This equals `STABLE_FEED`, and a
  test asserts it equals the production `publish` config.
- Feed `https://opencode.ai/update/api/latest/desktop/opencode/latest.yml`: version `2.3.2`, x64
  `opencode-desktop-win-x64.exe`, 269,731,480 bytes, SHA-512 `AXenMdFn3pro28k5+d0m21MzwK1HpyIjtm5nONVLgvaC3Yakq6Gyq7LczldnBg1AOXTXV4MyPdKfXmrU3ZvFew==`.
- Upstream `git ls-remote --tags https://github.com/anomalyco/opencode.git`: `v2.3.2` →
  `c0ad18b402eb2827fc1ee71c171b1177b3fc02d1` (the only `v2.3.2*` tag).
- That commit is `release: v2.3.2`, 2026-11-18T00:28:06Z, parent `de291ab7b1c6e2ea6a3dd2faffeb40967c02f537`.
- `packages/desktop/package.json` read at commit `c0ad18b402eb2827fc1ee71c171b1177b3fc02d1`
  reports `@opencode/desktop` version `2.3.2`; the root package reports `opencode` `2.3.2`. The read
  uses the resolved commit, not the mutable `v2.3.2` tag ref.
- GitHub release `v2.3.2` contains `opencode-desktop-win-x64.exe` at 269,731,480 bytes with digest
  `sha256:1e73b4f49f591971f4ad61c5a39b284bf74d41f50ca1b84e68ccf2ab2be91e8d`.
- The update service record `https://opencode.ai/update/api/latest/desktop/opencode` reports version
  `2.3.2`. Its `metadata.manifests["desktop.yml"]` holds the same x64 URL, size and SHA-512 as the
  feed, which ties the manifest to the service record. Its `metadata.files["opencode-desktop-win-x64.exe"]`
  holds the same URL and size with SHA-256 `1e73b4f49f591971f4ad61c5a39b284bf74d41f50ca1b84e68ccf2ab2be91e8d`,
  equal to the GitHub release digest. The resolver now enforces that chain instead of leaving it to a
  manual comparison.

Exact mapping: **feed 2.3.2 → tag v2.3.2 → commit c0ad18b402eb2827fc1ee71c171b1177b3fc02d1**.
Resolver output on 2026-11-21: `status: "resolved"`, `sha256: "1e73b4f4…"`, exit 0.

#### Tests

`bun test script/openjam-source.test.ts`: 30 pass, 0 fail. Fixture tests cover the resolved mapping,
four-part product versions, equivalent duplicate tags, no manifest, no x64 artifact, duplicate x64
artifact, no tag, two tags at different commits, package version mismatch, unreadable package,
missing release, missing/mismatched release asset, already-built, moved-source conflict, unrelated
builds, YAML manifest parsing, annotated-tag peeling, and the feed URL contract. The update-service
proof tests cover a missing record, a version the service records differently, an artifact the service
does not attest, a missing manifest, a missing SHA-256, a release asset with no digest, and a
same-size release asset with different content. Feed source tests cover the stable feed, a direct
manifest URL, and refusal of a non-official origin.

Live runs with temporary ledgers: the real source produced `already-built` (exit 0) and a different
source produced `conflict` (exit 1). Missing and ambiguous states are proven against fixtures only;
no live bad feed exists, and mutating the real feed is out of bounds.

Targeted `tsc --strict` on both new files: clean. `oxlint` and `prettier` on both files: clean.
`bun run typecheck` in `packages/desktop` fails before reaching these files because this Windows
checkout has `core.symlinks=false`, so `packages/app/src/custom-elements.d.ts` (a committed symlink)
materializes as the text `../../ui/src/custom-elements.d.ts`. Pre-existing and unrelated.

#### Packaging and service contracts confirmed for later steps

- Windows packaging is NSIS, one-click, per-user; app id `ai.opencode.desktop`, executable
  `OpenCode.exe`, artifact `opencode-desktop-win-x64.exe`. The custom installer moves an install out of
  the shared `@opencodedesktop` directory into one named after the app id.
- `app-update.yml` is written from `getConfig().publish` and the package name. The feed is published
  from the final signed files and served as `latest*.yml`; the Windows manifest carries x64 and ARM64.
- Packaging is unsigned; signing runs afterwards (Azure Trusted Signing for Windows). Win config sets
  `verifyUpdateCodeSignature: false`, the updater patch adds `/NCRC`, and staged updates unpack to
  `<install>.update-<payload hash>`.
- Updater settings: channel `latest`, `allowDowngrade = true`, `autoDownload = false`; stage calls the
  installer with `--stage`; `autoInstallOnAppQuit` is macOS-only.
- Isolating OpenJam requires its own package name, app id, product name and installer identity: install
  directory, uninstall entry, userData (`appData/<APP_ID>`), CLI stage, window state, drafts, shortcuts
  and updater cache (`<package name>-updater`) all derive from them.
- Desktop bundles `opencode-cli.exe` and `opencode-cli.version` outside asar, stages it under
  `userData/cli/<version>-<arch>`, and connects through `@opencode/client/service` `Service.ensure`.
  Registration is `~/.local/state/opencode/service.json`; health is `GET /api/info` returning
  `{ version, pid }` with basic auth. A 404 health response is an incompatible protocol.
- `matchesVersion` compares the registered version exactly. `serviceVersion` returns the bundled CLI
  version on an initial production connect. Therefore OpenJam must keep its bundled CLI version at
  `2.3.2` (or pass a compatibility predicate / `undefined`) so first launch adopts the existing stock
  service instead of replacing it. The elapsed-time patch `cba315fd58` touches `gui-plugins`, `tui` and
  `util` only, not core, server or protocol, so a stock `2.3.2` service is compatible.

#### Step 2 blockers

None. Step 2 can replay `cba315fd58` onto `c0ad18b402eb2827fc1ee71c171b1177b3fc02d1`. The ledger
shape is a step-4 contract, not a step-2 dependency. The `custom-elements.d.ts` symlink issue is
local to this Windows checkout and affects the full package typecheck, not the desktop sources.

### Step 2 — replay the elapsed-time patch and verify it (done)

Disposable checkout: `C:\Users\alvia\AppData\Local\Temp\opencode\openjam-step2`, a detached worktree
at `c0ad18b402eb2827fc1ee71c171b1177b3fc02d1`. The patch `cba315fd58^..cba315fd58` applied with
`git apply` exit 0, so the upstream source needed no adaptation; the replay is uncommitted in that
worktree. Dependencies were installed with `bun install --frozen-lockfile` (1,580 packages).

The patch touches `packages/util/src/duration.ts`, `packages/gui-plugins/src/context/{indicator.tsx,i18n/en.ts}`,
`packages/tui/src/feature-plugins/prompt/footer.tsx`, `packages/tui/src/util/session.ts`, and two TUI
test files. It adds no core, server, protocol or service change.

#### Checks

| Check | Command | Result |
|---|---|---|
| Elapsed time, declared and absent cache lifetimes | `bun test src/duration.test.ts` in `packages/util` | 11 pass, 0 fail |
| TUI prompt footer and context sidebar | `bun test test/feature-plugins/prompt-footer.test.tsx test/feature-plugins/sidebar-context.test.tsx` in `packages/tui` | 5 pass, 0 fail |
| Types | `bun run typecheck` in `packages/util`, `packages/gui-plugins`, `packages/tui` | 0 errors in all three |
| Rendered renderer behaviour | Playwright built app, `session-header.spec.ts -g "prompt cache age"` | 2 pass, screenshots attached |

The duration tests pin the contract the step asks for: the age counts from the message that wrote the
cache; a model with no `cache.ttl` shows the age with no expiry even after an hour; a declared `5m`
lifetime is not expired at exactly `5m` and is expired one millisecond later; an unreadable TTL yields
no lifetime; a backwards clock clamps to zero. The TUI tests exercise the same values in the prompt
footer.

#### Actual rendering

The production renderer bundle (the renderer the desktop app hosts) was built and driven with
Playwright against the in-memory mocked server. A new keeper case in `session-header.spec.ts` opens a
session whose last assistant message carries tokens, created times and a model `settings.cache.ttl`.

- With `ttl: "5m"`, the header chip showed the age, then showed `5m` in the warning colour only after
  two minute ticks pushed the age past five minutes, and its tooltip read
  `Toggle session context — Prompt cache expired`.
- With no `cache.ttl`, the header chip showed `6m` in the normal colour and the plain
  `Toggle session context` tooltip.

Screenshots: `packages/app/e2e/test-results/regression-session-header--31e74-the-declared-cache-lifetime-chromium/prompt-cache-expired.png`
and `...-17b5f--declares-no-cache-lifetime-chromium/prompt-cache-no-lifetime.png`, both rendered in the
real header with the usage chip. The test harness needed model/provider `settings` passed through the
mock catalog; that is a test-only change in the disposable checkout (two lines each in `e2e/utils/mock-server.ts`),
not in the repository deliverable.

This is the production renderer in Chromium, not the Electron shell. The installed app and its live
service were deliberately not launched or changed, per the assignment, so the shell itself was not
exercised in this step.

#### Conflicting patch

Second disposable worktree: `C:\Users\alvia\AppData\Local\Temp\opencode\openjam-step2-conflict` at the
same commit. A test-only commit `12998f42d8` inserted drift into the patch's `indicator.tsx` context.
`git apply --check` then failed with `patch does not apply` at
`packages/gui-plugins/src/context/indicator.tsx:180`, and the real `git apply` exited 1. The worktree
stayed clean (`git status --short` empty, `git diff --stat` empty), so no partial patch landed.

The stable feed was fetched before and after the conflict attempt:
`https://opencode.ai/update/api/latest/desktop/opencode/latest.yml`, SHA-256
`57A1328DE5DB66A13692FD0D4FC9FF2B7080F68DB3420E7E54CF9001DF594E22` in both reads, version still
`2.3.2`. No publication call was made and no OpenJam feed exists yet, so the release feed is unchanged
by the conflict.

#### Step 3 notes from this replay

The timer is renderer and TUI only; a stock `2.3.2` service can serve it. The desktop bundle must carry
the patched renderer and TUI, while the bundled CLI can stay at `2.3.2` so the existing stock service is
adopted, as recorded in Step 1. No new blocker was found.

### November 26 continuation — renderer checks and release staging

The main checkout now contains both cache-age regression cases and the model/provider settings
passthrough. Its built Chromium run passed both cases with no retries. The app-wide `typecheck:e2e`
did not pass (errors in other specs and missing asset declarations). This is still renderer evidence,
not an installed desktop update.

The first Step 4 implementation added `.github/workflows/openjam-release.yml` and staging/promotion
under `.github/openjam/`. It keeps public promotion off, binds source to the resolved commit, and
checks uploaded asset sizes and digests before making a draft the latest release. The coordinator
reran the source and release tests together: 48 passed, none failed. No public run or release.

On resumption the resolver reported **2.4.2** (`fc31a485317970bcf6be7b431a9830aaef875731`):
the original timer patch and the 2.3.2 packaging overlay did not pass preflight for that source.
Do not count the older baseline as proof for the new one. The installed stock desktop currently
reports **2.4.1**. No local code-signing certificate appeared in the current-user or machine
personal stores. The signed installed A-to-B acceptance remains pending.

### Step 3 — first local x64 installer (partial)

The installer worker built an unsigned 2.3.2 candidate with the timer and extracted it without
installing it. Output: `%LOCALAPPDATA%\Temp\opencode\openjam-windows-x64-2.3.2\openjam-desktop-win-x64.exe`.
The coordinator independently verified its SHA-256
(`bbaa5c8646f4b38082a03f5ed5144f785612014da5115299fa29bf8885d4fc18`), its `NotSigned`
Authenticode status, and successful release staging of its actual 269,434,999 bytes with
`latest.yml`, blockmap, and ledger. Thirteen desktop configuration and service-adoption tests passed
in a coordinator rerun. The worker also reported that its NSIS sandbox ACL check lacked `pwsh`.
This candidate is not an installed update test. The strict matching service version means not to
use it as a live-session acceptance build against the installed 2.4.1 service.

### Step 2 refresh — verified stable 2.4.2

The maintained [timer patch](../.github/openjam/timer.patch) now preserves upstream's TUI job
counters. The timer worker reported 8 TUI and 11 duration tests passing and clean GUI/TUI/util
typechecks on `fc31a485317970bcf6be7b431a9830aaef875731`. The coordinator ported the two
renderer cases onto that same checkout; both passed against its built bundle in Chromium, no
retries. The release patch includes those cases and the catalog fixture, and the workflow runs
them before staging. The resulting patch passed `git apply --cached --check` against a fresh index
of that exact commit. The historical 2.3.2 candidate retains the previous patch.

### Step 3 refresh — local 2.4.2 x64 package

The worker built a timer-bearing candidate from the verified 2.4.2 source, extracted the installer
and compared its payload with the staged app. The coordinator checked all three exported SHA-256s:

| `%LOCALAPPDATA%\Temp\opencode\openjam-windows-x64-2.4.2\` | SHA-256 |
|---|---|
| `openjam-desktop-win-x64.exe` | `649cc6340eb6fa918e8eece7ad4f77e9354b086a83b32397f60153b2e40ebb3b` |
| `latest.yml` | `c721b775b8775ef463598f3fc20fe5c2188acdc26f25474363bf2a05595babd2` |
| `openjam-desktop-win-x64.exe.blockmap` | `25f5b20eac9fab2e2bf457341cb2e1b943654911c2b20bfc5e1386437b61a2e5` |

The installer is unsigned. Its bundled service version is 2.4.2; using it on this machine today
would refuse the running stock 2.4.1 service rather than replace it. The package is not evidence
of installed side-by-side operation or an A-to-B update.

### Step 4 — signing and publication verification

The release workflow builds without signing or release credentials. Its protected Windows signing
job checks the publisher configured in the base app, signs the installer, and verifies it. Staging
regenerates the blockmap and manifest from the signed bytes; promotion verifies the Windows
signature and publisher again before writing a release. With signing disabled, an unsigned
candidate can still be staged but cannot be promoted. See the
[operator instructions](../.github/openjam/README.md) for identity setup and the two publication
switches. The coordinator reran the source, staging, signing-configuration, desktop-config and
service-adoption suites: 65 tests passed. A real signing run, hosted Actions run, and installed
A-to-B test remain unverified. No signing identity was installed, and nothing was published.

### Current-service bootstrap and final checks

The official 2.4.1 release and 2.4.2 have identical inputs for the eight patched desktop
files. The adapter now checks those Git blob IDs and modes, so new versions with unchanged inputs
can build. A Git fixture accepts a version-only change and rejects drift outside a patch hunk.
The historical 2.3.2 recipe is preserved. Real 2.4.1 needed only a local timer replay that
omits the two conflicting **test** file changes.

The candidate for Alvi's existing service is
`%LOCALAPPDATA%\Temp\opencode\openjam-windows-x64-2.4.1-loopback\openjam-desktop-win-x64.exe`
(coordinator-verified SHA-256 `d55f59f91cadfb23a4bbc4328efc415486b3f82d1c7f393b77c57879c3b5d813`).
Its updater config points to `http://127.0.0.1:4313/`. The installer is unsigned and the
feed is not running. For Step 5, rebuild A and a higher desktop version B from the **same 2.4.1
upstream source** using the same trusted publisher, so B still adopts stock service 2.4.1.
Do not substitute the 2.4.2 release candidate for B on this machine.

The coordinator's final six-suite run (resolver, release, overlay, signing policy, desktop
config, and service adoption) passed 66 tests. The built stable renderer passed both timer
cases; the timer worker reported 19 duration/TUI passes. `actionlint` and `lint:changed`
passed. The full `bun run check` stops at 172 existing site CSS grey-scale violations. There is
no installed blue-button proof, historical-session acceptance or GitHub-hosted signing run.

### Final candidates and compatibility decision

After correcting the timer tooltip, both candidates were rebuilt. The coordinator verified the
following SHA-256s and that both installers are **unsigned**. These paths replace the earlier
paths for testing.

| Under `%LOCALAPPDATA%\Temp\opencode\` | SHA-256 |
|---|---|
| `openjam-final-2.4.1-loopback\openjam-desktop-win-x64.exe` | `b150a2d4e4470eec4327a54e62ea4303a18662ad5bee122b7074d2def3222711` |
| `openjam-final-2.4.2-stable\openjam-desktop-win-x64.exe` | `857f33f1d33ff2343d59d370cdfd4f65ae9dce8092c6da0a560b1a9f5147b2e4` |

Historical-session reads worked in both directions with synthetic history on isolated published
2.4.1 and 2.4.2 services. The pair is **not** fully compatible: the newer client's virtual
skill-file route returns 404 on the older service, and the older client expects inline preview
content that the newer service can omit. The guard therefore still requires matching service
versions and does not start or replace the user's service. A 2.4.2 rollout requires matching
stock 2.4.2; private A/B acceptance can keep both candidates on a 2.4.1 base.

**Owner handoff:** the next input is an approved Windows signing identity configured via the
[signing instructions](../.github/openjam/README.md). Build signed A and B from the 2.4.1
source with different desktop versions and `OPENJAM_FEED_URL=http://127.0.0.1:4313/`.
Then follow **QA handoff** above. Keep public promotion disabled until the hosted signing run,
installed update, existing conversation, matching service, timer, and intact stock app are verified.
The implementation remains local and uncommitted.
