# Quick Wizard Plan: Start the shared service from OpenJam

## Plan State

- **Source protocol:** `/quick-wizard`, saved mode.
- **Approval:** PENDING. Alvi selected the installer scope and the desktop-only approach, then requested wrap-up before implementation.
- **Resume:** Read this plan and the source protocol. Confirm the plan and the QA coverage below before executing or marking any step complete.

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

- [ ] 1. Desktop startup and errors — not started; tests not run.
- [ ] 2. Process ownership checks — not started; no runtime evidence yet.
- [ ] 3. Both installers — not built or exercised.
- [ ] 4. Static review and QA handoff — pending implementation.

## Quality Review

Pending. No `quality-standard.md` was found during planning. Apply the repository and affected package instructions.

## QA Handoff

No `qa/` directory or wizard QA bench exists in this checkout; stack status is unknown (no bench probe available). Formal `/integration-test` coverage is therefore unavailable; confirm that limitation at plan approval. The isolated process and installed-app acceptance checks above are still required. No QA checklist or runtime verification has been completed for this change.
