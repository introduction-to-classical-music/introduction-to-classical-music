param([Parameter(Mandatory = $true)][string]$InstallerPath)
$ErrorActionPreference = "Stop"
$installer = [System.IO.Path]::GetFullPath($InstallerPath)
if (-not (Test-Path -LiteralPath $installer)) { throw "installer not found: $installer" }
$seven = Join-Path $PSScriptRoot "..\..\node_modules\7zip-bin\win\x64\7za.exe"
if (-not (Test-Path -LiteralPath $seven)) { throw "7za not found: $seven" }
$temp = Join-Path $env:RUNNER_TEMP "icm-installer-payload"
Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $temp | Out-Null
& $seven x -y "-o$temp" $installer | Out-Null
if ($LASTEXITCODE -ne 0) { throw "7za extraction failed: $LASTEXITCODE" }
$app = Join-Path $temp "不全书.exe"
if (-not (Test-Path -LiteralPath $app)) { throw "app executable missing in installer payload" }
$asar = Join-Path $temp "resources\app.asar"
if (-not (Test-Path -LiteralPath $asar)) { throw "app.asar missing in installer payload" }
$metaPath = Join-Path $temp "library\build\site\.icm-build-meta.json"
if (-not (Test-Path -LiteralPath $metaPath)) { throw "seed meta missing in installer payload" }
$meta = Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
if ([string]$meta.appVersion -ne "0.1.2") { throw "seed meta version mismatch: $($meta.appVersion)" }
$rrsBuildInfo = Join-Path $temp "resources\recording-retrieval-service\build-info.json"
if (-not (Test-Path -LiteralPath $rrsBuildInfo)) { throw "RRS build-info missing" }
$info = Get-Content -LiteralPath $rrsBuildInfo -Raw | ConvertFrom-Json
if (-not $info.git.commit) { throw "RRS build-info commit missing" }
if ($info.bundle.path) { throw "RRS build-info contains absolute bundle.path" }
Write-Host "INSTALLER_PAYLOAD=PASS version=$($meta.appVersion) rrsCommit=$($info.git.commit)"
