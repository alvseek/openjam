import { Service } from "@opencode/client/service"

// Adoption only: ensure() can elect a new owner or replace a mismatched service.
export async function discoverOpenJamService(options: { readonly file?: string; readonly version: string }) {
  const endpoint = await Service.discover(options)

  if (!endpoint?.auth) throw new Error("OpenJam requires a running, compatible OpenCode service.")

  return endpoint
}
