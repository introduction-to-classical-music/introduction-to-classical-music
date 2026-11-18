param([string]$InstallerPath, [switch]$RequireSigned)
$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $InstallerPath)) { throw "installer not found: $InstallerPath" }
$signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
$status = [string]$signature.Status
Write-Output "SIGNATURE_STATUS=$status"
if ($RequireSigned -and $status -ne "Valid") {
  Write-Output "RESULT=FAIL (official release requires valid Authenticode signature)"
  exit 1
}
if ($status -ne "Valid") {
  Write-Output "RESULT=WARN (unsigned release candidate; publishing without certificate is blocked)"
} else {
  Write-Output "RESULT=PASS"
}
