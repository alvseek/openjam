import { OPENJAM_NAME } from "../src/shared/openjam"

export function openJamSigning(env = process.env) {
  const certificateSha1 = env.OPENJAM_SIGNING_CERT_SHA1
  const hasPfx = Boolean(env.WIN_CSC_LINK)
  const publisher = env.OPENJAM_PUBLISHER_NAME?.trim()

  if (certificateSha1 !== undefined && !/^[0-9a-f]{40}$/i.test(certificateSha1))
    throw new Error("OPENJAM_SIGNING_CERT_SHA1 must be a 40-digit Windows certificate thumbprint")

  if (certificateSha1 && hasPfx) throw new Error("Select only one OpenJam Windows signing identity")

  const required = Boolean(certificateSha1 || hasPfx)

  if (required && !publisher) throw new Error("Set OPENJAM_PUBLISHER_NAME to the signing certificate's publisher")

  return {
    required,
    publisher: publisher || OPENJAM_NAME,
    certificateSha1,
  }
}
