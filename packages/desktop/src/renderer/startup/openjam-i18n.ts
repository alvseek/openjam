import type { Locale } from "@opencode/app/desktop"
import { formatDesktopNativeMessage } from "@opencode/app/i18n/desktop-native"

type StartupMessages = {
  "openjam.startup.versionMismatch": { required: string; observed: string }
  "openjam.startup.serviceUnavailable": { required: string }
}

type Catalog = Record<keyof StartupMessages, string>

const english = {
  "openjam.startup.versionMismatch":
    "OpenJam bundles service version {{required}}, but the running OpenCode service is version {{observed}}. OpenJam left it running. Use an OpenJam build that matches the running OpenCode service.",
  "openjam.startup.serviceUnavailable":
    "OpenJam could not reach or verify the local OpenCode service. This OpenJam build requires service version {{required}}. Wait a moment and retry. If the problem persists, run opencode service status to check the service.",
} satisfies Catalog

const catalogs: Partial<Record<Locale, Partial<Catalog>>> = { en: english }

export function openJamStartupTranslator(locale: () => Locale) {
  return <Key extends keyof StartupMessages>(key: Key, params: StartupMessages[Key]) =>
    formatDesktopNativeMessage(catalogs[locale()]?.[key] ?? english[key], params)
}
