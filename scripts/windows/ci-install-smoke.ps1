param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath
)

$ErrorActionPreference = "Stop"
$installer = [System.IO.Path]::GetFullPath($InstallerPath)
if (-not (Test-Path -LiteralPath $installer)) { throw "installer not found: $installer" }

$installDir = Join-Path $env:RUNNER_TEMP "icm-install-smoke"
Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Installing $installer -> $installDir"
$proc = Start-Process -FilePath $installer -ArgumentList "/S", "/D=$installDir" -PassThru -Wait
if ($proc.ExitCode -ne 0) { throw "installer exit code: $($proc.ExitCode)" }
Start-Sleep -Seconds 3

$appExe = Join-Path $installDir "不全书.exe"
if (-not (Test-Path -LiteralPath $appExe)) { throw "installed app executable missing: $appExe" }
$resources = Join-Path $installDir "resources"
$asarPath = Join-Path $resources "app.asar"
if (-not (Test-Path -LiteralPath $asarPath)) { throw "app.asar missing" }
$seedMetaPath = Join-Path $installDir "library\build\site\.icm-build-meta.json"
if (-not (Test-Path -LiteralPath $seedMetaPath)) { throw "seed site metadata missing" }
$seedMeta = Get-Content -LiteralPath $seedMetaPath -Raw | ConvertFrom-Json
if ([string]$seedMeta.appVersion -ne "0.1.2") { throw "seed meta appVersion mismatch: $($seedMeta.appVersion)" }
$rrsBuildInfoPath = Join-Path $resources "recording-retrieval-service\build-info.json"
if (-not (Test-Path -LiteralPath $rrsBuildInfoPath)) { throw "RRS build-info missing" }
$rrsBuildInfo = Get-Content -LiteralPath $rrsBuildInfoPath -Raw | ConvertFrom-Json
if (-not $rrsBuildInfo.git.commit) { throw "RRS build-info commit missing" }
if ($rrsBuildInfo.bundle.path) { throw "RRS build-info contains absolute bundle.path" }

$packageJson = Join-Path $resources "app.asar"
$asarList = & npx --no-install asar list $asarPath
if ($LASTEXITCODE -ne 0) { throw "asar list failed" }
$forbidden = $asarList | Where-Object { $_ -match '\.(test|spec)\.' -or $_ -match '\.map$' }
if ($forbidden.Count -gt 0) { throw "forbidden packaged entries: $($forbidden | Select-Object -First 5)" }

$uninstaller = Join-Path $installDir "Uninstall 不全书.exe"
if (-not (Test-Path -LiteralPath $uninstaller)) { throw "uninstaller missing" }
$uninstall = Start-Process -FilePath $uninstaller -ArgumentList "/S" -PassThru -Wait
if ($uninstall.ExitCode -ne 0) { throw "uninstaller exit code: $($uninstall.ExitCode)" }
Start-Sleep -Seconds 2
if (Test-Path -LiteralPath $appExe) { throw "app executable still present after uninstall" }

Write-Host "INSTALL_SMOKE=PASS version=$($seedMeta.appVersion) rrsCommit=$($rrsBuildInfo.git.commit)"
