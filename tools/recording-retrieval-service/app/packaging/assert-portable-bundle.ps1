# Defense in depth for the Recording Retrieval Service portable bundle (W1b).
#
# The PyInstaller spec only packs the explicit materials allow-list
# (`materials-whitelist.json`). This script re-asserts that after packaging so a
# future spec regression fails the build instead of silently shipping user-local
# config or credentials. It never modifies the bundle.
param(
  [Parameter(Mandatory = $true)]
  [string]$BundleRoot,
  [string]$WhitelistPath = (Join-Path $PSScriptRoot "materials-whitelist.json")
)

$ErrorActionPreference = "Stop"

$resolvedBundleRoot = (Resolve-Path -LiteralPath $BundleRoot).Path
if (-not (Test-Path -LiteralPath $WhitelistPath)) {
  throw "Missing materials whitelist: $WhitelistPath"
}
$whitelist = (Get-Content -LiteralPath $WhitelistPath -Raw | ConvertFrom-Json).files
if (-not $whitelist -or $whitelist.Count -eq 0) {
  throw "Materials whitelist is empty: $WhitelistPath"
}
$expectedMaterials = @($whitelist | ForEach-Object { [string]$_ })

$forbiddenFilePattern = '(?i)llm[\s_-]*config|\.local\.json$|\.env$|secrets?\.json$|credential|\.pem$|\.key$'
$secretContentPattern = 'sk-[A-Za-z0-9]{16,}|(?i)Authorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}|AKIA[0-9A-Z]{16}'
$textExtensions = @("*.txt", "*.json", "*.cmd", "*.ini", "*.yaml", "*.yml")

$materialsDir = Join-Path $resolvedBundleRoot "_internal\materials"
$bundlePrefix = "_internal/"
if (-not (Test-Path -LiteralPath $materialsDir)) {
  $materialsDir = Join-Path $resolvedBundleRoot "materials"
  $bundlePrefix = ""
}
if (-not (Test-Path -LiteralPath $materialsDir)) {
  throw "Portable bundle is missing the materials directory: $resolvedBundleRoot"
}

$actualMaterials = @(Get-ChildItem -LiteralPath $materialsDir -Recurse -File | ForEach-Object {
  $_.FullName.Substring($resolvedBundleRoot.Length + 1).Replace('\', '/')
})
$expectedBundleMaterials = @($expectedMaterials | ForEach-Object { "$bundlePrefix$_" })
$unexpectedMaterials = @($actualMaterials | Where-Object { $expectedBundleMaterials -notcontains $_ })
if ($unexpectedMaterials.Count -gt 0) {
  throw "Portable bundle contains materials outside the allow-list: $($unexpectedMaterials -join ', ')"
}
$missingMaterials = @($expectedBundleMaterials | Where-Object { $actualMaterials -notcontains $_ })
if ($missingMaterials.Count -gt 0) {
  throw "Portable bundle is missing whitelisted materials: $($missingMaterials -join ', ')"
}

$scanRoots = @(
  $materialsDir,
  (Join-Path $resolvedBundleRoot "_internal\config"),
  (Join-Path $resolvedBundleRoot "config")
)
foreach ($scanRoot in $scanRoots) {
  if (-not (Test-Path -LiteralPath $scanRoot)) {
    continue
  }
  $scanFiles = @(Get-ChildItem -LiteralPath $scanRoot -Recurse -File -Include $textExtensions)
  if ($scanFiles.Count -eq 0) {
    continue
  }
  $forbiddenFiles = @($scanFiles | Where-Object { $_.Name -match $forbiddenFilePattern })
  if ($forbiddenFiles.Count -gt 0) {
    throw "Portable bundle contains sensitive files: $($forbiddenFiles.FullName -join ', ')"
  }
  $secretHits = @($scanFiles | Select-String -Pattern $secretContentPattern)
  if ($secretHits.Count -gt 0) {
    $hitLocations = @($secretHits | ForEach-Object { "$($_.Path):$($_.LineNumber)" })
    throw "Portable bundle contains secret-like content: $($hitLocations -join ', ')"
  }
}

Write-Host "Portable bundle verified: $resolvedBundleRoot ($($expectedMaterials.Count) materials files)"
exit 0
