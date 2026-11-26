# Quick Wizard Plan: Start the shared service from OpenJam

## Plan State

- **Source protocol:** `/quick-wizard`, saved mode.
- **Approval:** APPROVED by Alvi on 2026-11-26: “approved. for the implementation, please use /einherjar:dispatch-plan”. This approved the stated QA limitation and both local installer builds. Leave checks better done by Alvi pending with a short walkthrough; continue independent work.
- **Resume:** Read this plan and the source protocol, then continue from the first unfinished step.

## Inherited Context

**From a parent plan:** None. This is a follow-up to the [Windows desktop preview](2026-11-21-openjam-windows-desktop.md), not a phase of that plan.

**From pre-planning discussion (2026-11-26):** “reuse a matching service, start one if absent, and leave a different running version alone.” OpenJam must open existing sessions without making the user launch stock OpenCode first. Replacing an incompatible service was rejected because it could interrupt active sessions; requiring the user to start stock first was the behavior that prompted this change.

## Objective and specification

Opening either Windows preview on its own should start or connect to one shared service. The published previews only discover an existing service. Their generic IPC error does not distinguish a missing service from a version mismatch.

| At launch | Required result |
|---|---|
| No service | Start the bundled CLI with `serve --service`, use the normal stock registration and data locations, and connect after authenticated discovery confirms the exact bundled version. |
| Healthy matching service | Reuse the same process; an existing conversation remains accessible. |
| Different running version | Leave it running. Show the required and observed versions and an actionable explanation. |
| Starting or unverifiable service | A failed health probe is not proof of absence. Allow startup to settle within a bounded wait, or report what could not be verified without disturbing the process. |
| Concurrent launches | Recheck the service elected by the normal stock startup mechanism; OpenJam must not stop or overwrite a live owner. Test both orders. Stock OpenCode retains its own replacement policy. |

## Confirmed Decisions

| Decision | Choice | Reason |
|---|---|---|
| Installer scope | Local builds and tests for both 2.4.1 and 2.4.2 (Alvi: “A”). | Covers the two failing previews and the existing 2.4.1 host. |
| Implementation | Keep the change in OpenJam Desktop (Alvi: “A”). Use the bundled executable, not `opencode` from PATH. | Avoid a fork of the shared client. Its normal `Service.ensure()` can terminate a mismatched or unresponsive incumbent during the wait, even after an initial absence check. |
| Integration | Use the existing desktop service lifecycle, packaged CLI resolver and reviewed packaging overlay. | The startup path already has the bundled command and exact version. Preserve authenticated discovery, the stock app and the elapsed-time feature. |

Out of scope: changing the shared client or stock app, cross-version API compatibility, signing, publishing installers or enabling automatic updates.

## Success Criteria and Execution Steps

1. **Desktop startup and error handling** (crosses: registration filesystem, process, local HTTP). Update the OpenJam path in `packages/desktop/src/main/service/`. Check the actual contender and port behavior on both pinned baselines, distinguish absence from uncertain registration, and bound startup and reconnect attempts. Surface localized errors through the desktop UI. Verify decisions and failure cases, including that an unresponsive owner is not terminated.
2. **Exercise real process ownership** (crosses: filesystem, processes, HTTP). Use isolated Windows state, config, data and ports with synthetic session history. For each version test cold start, same-PID reuse, mismatch with both versions visible, and overlapping launches including a stock owner appearing during startup. Check process identity, registration, session readability and cleanup. Never use the live service as the test fixture.
3. **Build and exercise both Windows installers** (crosses: installer, packaged desktop, filesystem). Refresh maintained desktop overlays and user-facing startup instructions. Apply against both pinned upstream trees and run the affected package checks. Use isolated Windows installations or disposable user profiles to verify the actual launch, existing conversation, timer and mismatch message. Record the two artifact paths and results; a source test alone is not installer acceptance.
4. **Review and QA handoff.** Run the wizard's scoped static review, record findings and dispositions, and record the checklist or the reason it could not be generated. Distinguish actual installed-app evidence from unrun checks.

## Execution Log

Read this plan at the start and after compaction. After approval, implement and verify each step in order, recording actual evidence here before moving on.

- [x] 1. Desktop startup and errors — main-process helper and caller implemented in `openjam-service.ts` and `background-service.ts`. The bundled command starts only on missing registration or a confirmed dead PID. Authenticated discovery supplies the elected version; live but unverifiable owners are left alone. Both pinned CLIs use the configured fixed service port and register after listening. `desktop-app.tsx` and `startup/initialization.ts` present version-specific or unavailable guidance on the existing error screen; keyed English source is the fallback pending separate translation review. Coordinator ran the helper and machine tests (25 passed) and `ipc-transport.test.ts` (9 passed, including the raw RPC errors). This verifies presentation logic; installed appearance belongs to step 3.
- [x] 2. Process ownership checks — in isolated temporary profiles, both published CLI versions cold-started, kept the same process on reuse, and read an imported synthetic conversation after restart. A request for the opposite version preserved each owner and returned the expected mismatch. Overlapping same-version calls elected one service for both invocation orders on both versions; the stock command in this check was `serve --service`, not stock desktop `ensure`. In the mixed-version races, both ports had an opposite-version contender start while discovery was pending; both returned the specific mismatch, leaving the winning stock PID (5520 and 31936) and registration unchanged. Worker checked fixture cleanup. Evidence under `%LOCALAPPDATA%/Temp/opencode`: `openjam-owner-fixture-scp3Sf`, `openjam-owner-fixture-GVjphT`.
- [ ] 3. Both local unsigned installers built from pinned upstream `6f0514052a3c` and `fc31a4853179` with the refreshed guarded overlay. The final builds passed desktop typecheck and 60 focused tests each; 37 packaging/release tests passed in the control checkout. Extraction verified that the final renderer, service startup fixes and exact bundled CLIs shipped; manifests match installer size and SHA-512. The coordinator independently verified SHA-256 and `NotSigned` for both files below. **Installed-app acceptance remains pending**; extraction and direct process checks are not an installed launch.
- [x] 4. Static review and QA handoff — two runtime findings fixed and checked. Reviewed the packaging changes and recorded the remaining human check below.

## Quality Review

Independent runtime/UI review found two issues, both addressed. A launched contender's nonzero exit no longer ends discovery before another service can register; both delayed-election regression cases failed before the change and passed afterwards. Startup error copy now has a desktop-owned typed catalog (`openjam-i18n.ts`) using the shared message formatter; feature logic no longer selects locales. The existing app catalog does not have accurate guidance for a mismatch between two V2 versions. English fallback for new keys follows the project's translation workflow. The coordinator reran helper, lifecycle and raw IPC tests together (36 passed); in an additional mixed-version run, OpenJam won both elections, connected to its own version and left both registrations unchanged (fixture `openjam-owner-fixture-8nHkWW`, cleanup verified).

Packaging review covered `openjam-build.ts`, the 2.4.2 and historical 2.3.2 overlay patches, root `.gitattributes`, and the desktop README. New modern-only files remain collision-guarded; the 2.3.2 patch preserves its previous discovery-only implementation. Both patch paths resolve to LF. No project `quality-standard.md` was found. The primary checkout's materialized symlink and unrelated site CSS failures prevent claiming a green repository-wide check; desktop typechecks passed in the actual pinned build trees.

## QA Handoff

The project has no `qa/qa-map.md` or wizard QA bench; the formal `/integration-test` run and generated wizard checklist were skipped. Real isolated CLI verification is complete; **the installed GUI has not been runtime-verified**. The public preview is unchanged.

| Under `%LOCALAPPDATA%\Temp\opencode` | SHA-256 |
|---|---|
| `openjam-startup-final-2.4.1\openjam-desktop-win-x64.exe` | `a0ca182411e8092c50239c5109fb06b52246f41485fa1f1efa1c6b295d0be643` |
| `openjam-startup-final-2.4.2\openjam-desktop-win-x64.exe` | `f823d8070fac6fff969ed7771a9ac0b471bf0857a2a817431e24bea47295df14` |

**Installed Windows check (Alvi):**

1. In a spare Windows login or VM with no running OpenCode service, install a final candidate and open **OpenJam first**. Expect Home, not an IPC error. Open or create a test conversation, make a model request and check the elapsed-time display. Close/reopen OpenJam and confirm the conversation is still accessible. Repeat from a clean test profile for the other version.
2. With stock OpenCode running in the test profile, launch the OpenJam candidate matching its version. Confirm the same conversation is accessible in both apps.
3. Leave that stock service running and open the opposite-version candidate. Expect an error naming both versions and recommending a matching build. Confirm the original stock window can still open the conversation.
