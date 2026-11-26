import { Predicate } from "effect"
import type { ElectronAPI } from "../api-types"
import type { openJamStartupTranslator } from "./openjam-i18n"

type SidecarData = Awaited<ReturnType<ElectronAPI["awaitInitialization"]>>

/** Marks a startup failure so the error page describes it as the local server failing to start. */
export function localServerStartupError(cause: unknown) {
  const failure = cause instanceof Error ? cause : new Error(String(cause))
  Object.defineProperty(failure, "localServerStartup", { value: true })

  return failure
}

/** Only OpenJam emits these startup codes; everything else keeps its original error page details. */
export function presentStartupError(failure: Error, t: ReturnType<typeof openJamStartupTranslator>) {
  // The renderer's RPC client wraps a defect whose encoded Error is a plain object, not an Error instance.
  const cause: unknown = failure.cause

  const message =
    Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message) ? cause.message : failure.message

  const mismatch = /^OPENJAM_SERVICE_VERSION_MISMATCH:([^:\s]+):([^:\s]+)$/.exec(message)

  if (mismatch) return present(t("openjam.startup.versionMismatch", { required: mismatch[1], observed: mismatch[2] }))

  const unavailable = /^OPENJAM_SERVICE_UNAVAILABLE:([^:\s]+)$/.exec(message)

  if (unavailable) return present(t("openjam.startup.serviceUnavailable", { required: unavailable[1] }))

  return failure

  function present(message: string) {
    return localServerStartupError(new Error(message, { cause: failure }))
  }
}

// The main process adds Authorization to sidecar requests (`wireRendererHeaders`); the renderer never
// holds the password, and its GETs carry only CORS-safelisted headers so they skip the preflight.
export function sidecarHttp(data: SidecarData) {
  return { url: data.url }
}

export function createSidecarResolver(input: {
  api: Pick<ElectronAPI, "reconnectService">
  current: () => SidecarData | undefined
  update: (data: SidecarData) => void
}) {
  return async (signal: AbortSignal) => {
    if (signal.aborted) throw signal.reason
    // Aborting interrupts this window's wait in main; the reconnect keeps running for other windows.
    const next = await input.api.reconnectService(signal)

    if (signal.aborted) throw signal.reason

    if (!sameSidecar(input.current(), next)) input.update(next)

    return sidecarHttp(next)
  }
}

function sameSidecar(current: SidecarData | undefined, next: SidecarData) {
  return current?.url === next.url
}
