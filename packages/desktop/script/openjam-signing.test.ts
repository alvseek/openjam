import { expect, test } from "bun:test"
import { openJamSigning } from "./openjam-signing"

const thumbprint = "01".repeat(20)

test("OpenJam candidates remain unsigned unless an explicit Windows identity is selected", () => {
  expect(openJamSigning({ CSC_LINK: "unrelated" })).toEqual({
    required: false,
    publisher: "OpenJam",
    certificateSha1: undefined,
  })
  expect(openJamSigning({ OPENJAM_SIGNING_CERT_SHA1: thumbprint, OPENJAM_PUBLISHER_NAME: "Publisher" })).toEqual({
    required: true,
    publisher: "Publisher",
    certificateSha1: thumbprint,
  })
  expect(openJamSigning({ WIN_CSC_LINK: "fixture.pfx", OPENJAM_PUBLISHER_NAME: "Publisher" }).required).toBe(true)
})

test("OpenJam refuses to sign without exactly one valid identity and an explicit publisher pin", () => {
  expect(() => openJamSigning({ WIN_CSC_LINK: "fixture.pfx" })).toThrow("OPENJAM_PUBLISHER_NAME")
  expect(() => openJamSigning({ OPENJAM_SIGNING_CERT_SHA1: "123" })).toThrow("thumbprint")
  expect(() => openJamSigning({ OPENJAM_SIGNING_CERT_SHA1: thumbprint, WIN_CSC_LINK: "fixture.pfx" })).toThrow(
    "Select only one",
  )
})
