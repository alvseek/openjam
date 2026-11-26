param([Parameter(Mandatory)][string]$Installer)

$ErrorActionPreference = 'Stop'
if (!$env:OPENJAM_PFX_BASE64 -or !$env:OPENJAM_PFX_PASSWORD) {
  throw 'Configure the OpenJam PFX and password in the protected signing environment'
}

$publisher = ("$env:OPENJAM_PUBLISHER_NAME").Trim()
if (!$publisher -or $publisher.Contains('=')) {
  throw 'Set OPENJAM_PUBLISHER_NAME to the certificate common name (CN), not a distinguished name'
}

$installerFile = Get-Item -LiteralPath $Installer
if ($installerFile.PSIsContainer -or ($installerFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    $installerFile.Name -cne 'openjam-desktop-win-x64.exe') {
  throw 'Expected the OpenJam Windows x64 installer'
}

$sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$tool = Get-ChildItem -LiteralPath $sdk -Directory |
  Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
  Sort-Object { [version]$_.Name } -Descending |
  ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1
if (!$tool) { throw 'Windows SDK x64 SignTool not found' }

$pfx = Join-Path $env:RUNNER_TEMP ("openjam-" + [guid]::NewGuid() + ".pfx")
$certificates = @()
try {
  [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:OPENJAM_PFX_BASE64))
  $password = ConvertTo-SecureString $env:OPENJAM_PFX_PASSWORD -AsPlainText -Force
  Remove-Item Env:OPENJAM_PFX_BASE64, Env:OPENJAM_PFX_PASSWORD
  $certificates = @(Import-PfxCertificate -FilePath $pfx -Password $password -CertStoreLocation Cert:\CurrentUser\My)
  Remove-Item -LiteralPath $pfx

  $signers = @($certificates | Where-Object HasPrivateKey)
  if ($signers.Count -ne 1 -or $signers[0].GetNameInfo('SimpleName', $false) -cne $publisher) {
    throw 'The PFX must contain exactly one signing key with the configured OpenJam publisher'
  }

  & $tool sign /s My /sha1 $signers[0].Thumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $installerFile.FullName
  if ($LASTEXITCODE -ne 0) { throw "Installer signing failed (SignTool exit $LASTEXITCODE)" }
} finally {
  if (Test-Path -LiteralPath $pfx) { Remove-Item -LiteralPath $pfx -Force }
  foreach ($certificate in $certificates) {
    $entry = "Cert:\CurrentUser\My\$($certificate.Thumbprint)"
    if ($certificate.HasPrivateKey) {
      Remove-Item -LiteralPath $entry -DeleteKey
    } else {
      Remove-Item -LiteralPath $entry
    }
  }
}
