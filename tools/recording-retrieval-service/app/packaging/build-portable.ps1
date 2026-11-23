$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
$spec = Join-Path $root "packaging\recording-retrieval-service.spec"
$dist = Join-Path $root "dist"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$releaseDir = Join-Path $dist "releases"
$bundle = Join-Path $releaseDir "recording-retrieval-service-portable-$timestamp"
$latestBundle = Join-Path $dist "portable"
$pyinstallerBundle = Join-Path $dist "recording-retrieval-service"
$zipPath = Join-Path $dist "recording-retrieval-service-portable-$timestamp.zip"

# CI runners do not reliably expose `Get-FileHash` (CommandNotFound), so compute
# SHA-256 through .NET APIs instead; this works on Windows PowerShell 5.1 and
# PowerShell 7 alike.
function Get-Sha256Hex([string]$FilePath) {
  $stream = [System.IO.File]::Open($FilePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hashBytes = $algorithm.ComputeHash($stream)
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
  return (($hashBytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

if (-not (Test-Path $python)) {
  throw "Missing local virtual environment: $python"
}

& $python -m PyInstaller --noconfirm --distpath $dist --workpath (Join-Path $root "build\pyinstaller") $spec
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller build failed with exit code $LASTEXITCODE"
}

if (Test-Path $bundle) {
  Remove-Item -Recurse -Force $bundle
}
if (Test-Path $latestBundle) {
  Remove-Item -Recurse -Force $latestBundle
}

New-Item -ItemType Directory -Force -Path $bundle | Out-Null
New-Item -ItemType Directory -Force -Path $latestBundle | Out-Null
Copy-Item -Recurse -Force (Join-Path $pyinstallerBundle "*") $bundle
Copy-Item -Recurse -Force (Join-Path $pyinstallerBundle "*") $latestBundle
Copy-Item -Force (Join-Path $root "packaging\portable-start-service.cmd") (Join-Path $bundle "start-service.cmd")
Copy-Item -Force (Join-Path $root "packaging\portable-start-ui.cmd") (Join-Path $bundle "start-ui.cmd")
Copy-Item -Force (Join-Path $root "packaging\portable-start-service.cmd") (Join-Path $latestBundle "start-service.cmd")
Copy-Item -Force (Join-Path $root "packaging\portable-start-ui.cmd") (Join-Path $latestBundle "start-ui.cmd")

$sensitiveLegacyLlmPaths = @(
  (Join-Path $bundle "_internal\materials\source-profiles\LLM config.txt"),
  (Join-Path $latestBundle "_internal\materials\source-profiles\LLM config.txt")
)
foreach ($legacyLlmPath in $sensitiveLegacyLlmPaths) {
  if (Test-Path $legacyLlmPath) {
    Remove-Item -Force $legacyLlmPath
  }
}

# Defense in depth (W1b): the PyInstaller spec only packs the explicit
# `packaging/materials-whitelist.json` allow-list, so the checks below must pass
# without relying on the compatibility deletion above. A regression in the spec
# fails the build instead of silently shipping user-local config or secrets.
$verifyScript = Join-Path $PSScriptRoot "assert-portable-bundle.ps1"
if (-not (Test-Path -LiteralPath $verifyScript)) {
  throw "Missing portable bundle verification script: $verifyScript"
}
foreach ($bundleRoot in @($bundle, $latestBundle)) {
  & $verifyScript -BundleRoot $bundleRoot -WhitelistPath (Join-Path $PSScriptRoot "materials-whitelist.json")
  if ($LASTEXITCODE -ne 0) {
    throw "Portable bundle verification failed: $bundleRoot"
  }
}

# Build provenance (W7b): record app/git/python/PyInstaller versions, material
# allow-list and requirements-lock hashes, and a digest of the emitted bundle.
$pyinstallerVersion = ""
try {
  $pyinstallerVersion = (& $python -m PyInstaller --version 2>$null | Select-Object -First 1)
} catch {
  $pyinstallerVersion = "unknown"
}
$buildInfoPath = Join-Path $bundle "build-info.json"
& $python (Join-Path $root "app\build_info.py") --app-root $root --bundle-dir $bundle --output $buildInfoPath --pyinstaller-version "$pyinstallerVersion"
if ($LASTEXITCODE -ne 0) {
  throw "build-info.json generation failed"
}
Copy-Item -Force $buildInfoPath (Join-Path $latestBundle "build-info.json")

if (Test-Path $zipPath) {
  Remove-Item -Force $zipPath
}
Compress-Archive -Path (Join-Path $bundle '*') -DestinationPath $zipPath
$zipSha256 = Get-Sha256Hex -FilePath $zipPath
$zipBuildInfoPath = "$zipPath.build-info.json"
& $python (Join-Path $root "app\build_info.py") --app-root $root --bundle-dir $bundle --output $zipBuildInfoPath --pyinstaller-version "$pyinstallerVersion" --portable-zip-sha256 $zipSha256
if ($LASTEXITCODE -ne 0) {
  throw "portable zip build-info.json generation failed"
}
Write-Host "Build info: $buildInfoPath"
Write-Host "Zip build info: $zipBuildInfoPath"
Write-Host "Portable directory: $bundle"
Write-Host "Latest portable directory: $latestBundle"
Write-Host "Portable zip: $zipPath"
