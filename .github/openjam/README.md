# OpenJam Windows releases

## Signing and release readiness

Signing lets an installed copy of OpenJam verify who made an update. **You can sign and test an installer without publishing a release.**

### 1. Check what you have

For GitHub Actions to sign, you need all three:

- A **Windows-trusted code-signing certificate** with its private key in an exportable, password-protected `.pfx` file.
- The **password** that opens the PFX.
- The certificate's **publisher name**. In the certificate's **Details → Subject**, find `CN=` (common name). If it says `CN=Example Studio`, use `Example Studio`, with the same spelling and capitalization.

If you don't have these, leave signing disabled. You can still build an unsigned installer, but it cannot serve as the signed update for the blue-button test. The workflow does not issue certificates or install trust roots.

### 2. Configure GitHub once

1. In [`alvseek/openjam` → Settings → Environments](https://github.com/alvseek/openjam/settings/environments), create an environment named **`openjam-signing`**. Restrict deployment to the default branch (`dev`). Add a required reviewer if you want to approve each signing run.
2. Open that environment for the first two settings below. For the last two, go to [Settings → Secrets and variables → Actions → Variables](https://github.com/alvseek/openjam/settings/variables/actions). Set the enable switch **last**.

| Where | Name | What to enter |
|---|---|---|
| Environment **secret** | `OPENJAM_PFX_BASE64` | The PFX file contents encoded as Base64, not its filename. |
| Environment **secret** | `OPENJAM_PFX_PASSWORD` | The password that opens that PFX. |
| Repository **variable** | `OPENJAM_PUBLISHER_NAME` | The exact publisher name from step 1, without `CN=`. |
| Repository **variable** | `OPENJAM_SIGNING_ENABLED` | `true` when the other three settings are ready. |

If you have the GitHub CLI, this PowerShell command sets the first secret directly without printing the key. Replace the path with your PFX location:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\path\to\signing.pfx')) |
  gh secret set OPENJAM_PFX_BASE64 --repo alvseek/openjam --env openjam-signing
```

> [!IMPORTANT]
> The Base64 value contains the private key. Keep it and its password in **environment secrets**, never in chat, Git, or repository variables. For this test, leave `OPENJAM_PUBLICATION_APPROVED` **unset** and the `"false"` publication switch in the [workflow](../workflows/openjam-release.yml) unchanged.

### 3. Run once and check the result

Once the workflow is on `dev`, open **Actions → OpenJam Windows release → Run workflow**, select `dev`, and run it. For a new stable version, look at the **Artifacts** section of the completed run:

| What you see | What it means |
|---|---|
| `openjam-signed-stage` | Signing succeeded. The workflow checked the Windows signature and publisher and prepared the update files from the signed installer. No release was published. |
| `openjam-unsigned-stage` | Signing was skipped. Check the branch and `OPENJAM_SIGNING_ENABLED` before testing the updater. |
| No new artifact | Check **Resolve stable upstream source** first. `already-built` needs no new installer; a failed job names the step to fix. |

### 4. Test the blue button on Windows

GitHub Actions artifacts on this public fork are **not private**. For a private test, use the [local candidate build instructions](../../packages/desktop/README.md#openjam-windows-x64-candidates):

1. Prepare two signed installers: **A** is the version you install; **B** has a higher desktop version. Build both with the same publisher and loopback feed. On a machine running stock service **2.4.1**, build **both from 2.4.1 source** so they can open the same sessions.
2. Serve B's installer, `latest.yml`, and `.blockmap` together at the loopback address configured in A. Install A and open an existing conversation you recognize.
3. Click the **blue update button**. After restart, check that **About** shows B's version, the same conversation opens, the cache timer is visible, and stock OpenCode still works.

Passing both the signed workflow run and this installed update test is the prerequisite for enabling public releases.

## Timer patch

The release workflow resolves a stable upstream commit, checks it out detached, and applies
[`timer.patch`](timer.patch) from the workflow checkout. The current patch was reviewed against
OpenCode `2.4.2` (`fc31a485317970bcf6be7b431a9830aaef875731`). If it no longer applies, review and
test the timer changes in a disposable checkout of the newly resolved commit before refreshing it.
Generate the patch with `git diff --binary --full-index HEAD` in that checkout (stage any newly added files
first so they are included). Run `git apply --index --check` on a clean checkout of the baseline.

For prepared local candidates based on `2.3.2` (`c0ad18b402eb2827fc1ee71c171b1177b3fc02d1`),
keep using the original patch. From Git Bash, with `control` pointing to the checkout that already
contains the original timer commit and `candidate` to a **clean** disposable `2.3.2` checkout:

```bash
timer=cba315fd58a06af7703dcddbdc92e1bc8ee1759e
git -C "$control" diff --binary "$timer^" "$timer" | git -C "$candidate" apply --index --check
git -C "$control" diff --binary "$timer^" "$timer" | git -C "$candidate" apply --index
```

Only run the second command if the check succeeds. If an existing candidate already has the timer,
leave it as-is. The historical patch is for local testing only; the release workflow always uses
`timer.patch` on the resolver's stable commit.
