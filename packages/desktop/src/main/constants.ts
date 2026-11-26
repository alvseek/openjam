import { app } from "electron"
import { OPENJAM_ID, OPENJAM_NAME } from "../shared/openjam"

export const OPENJAM = import.meta.env.OPENCODE_DESKTOP_FLAVOR === "openjam"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const appNames = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
}

const appIDs = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}

// Local renderer/server mode keeps the dev application identity.
const identity = app.isPackaged && CHANNEL !== "local" ? CHANNEL : "dev"

export const APP_NAME = OPENJAM ? OPENJAM_NAME : appNames[identity]

export const APP_ID = OPENJAM ? OPENJAM_ID : appIDs[identity]
