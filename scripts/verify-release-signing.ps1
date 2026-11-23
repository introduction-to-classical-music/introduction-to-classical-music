param([string]$InstallerPath, [switch]$RequireSigned)
$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $InstallerPath)) { throw "installer not found: $InstallerPath" }
$status = "Unavailable"
$detail = ""
try {
  if (Get-Command Get-AuthenticodeSignature -ErrorAction Stop) {
    $signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath -ErrorAction Stop
    $status = [string]$signature.Status
    $detail = [string]$signature.StatusMessage
  }
} catch {
  $status = "Unavailable"
  $detail = $_.Exception.Message
}
Write-Output "SIGNATURE_STATUS=$status"
if ($detail) { Write-Output "SIGNATURE_DETAIL=$($detail -replace '\r?\n',' ')" }
if ($RequireSigned -and $status -ne "Valid") {
  Write-Output "RESULT=FAIL (official release requires valid Authenticode signature; status=$status)"
  exit 1
}
if ($status -ne "Valid") {
  Write-Output "RESULT=WARN (unsigned/unverified release candidate; publishing without a verified certificate is blocked)"
  exit 0
}
Write-Output "RESULT=PASS"
