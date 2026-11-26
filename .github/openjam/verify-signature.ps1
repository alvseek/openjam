param([Parameter(Mandatory)][string]$Installer)

$ErrorActionPreference = 'Stop'
$publisher = ("$env:OPENJAM_PUBLISHER_NAME").Trim()
if (!$publisher -or $publisher.Contains('=')) {
  throw 'Set OPENJAM_PUBLISHER_NAME to the certificate common name (CN), not a distinguished name'
}

$file = Get-Item -LiteralPath $Installer
if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    $file.Name -cne 'openjam-desktop-win-x64.exe') {
  throw 'Expected the OpenJam Windows x64 installer'
}

$signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
if ($signature.Status -ne 'Valid' -or $signature.SignatureType -ne 'Authenticode') {
  throw "OpenJam installer needs a valid embedded Authenticode signature (status: $($signature.Status))"
}
if ($signature.SignerCertificate.GetNameInfo('SimpleName', $false) -cne $publisher) {
  throw 'Installer signer does not match the configured OpenJam publisher'
}
