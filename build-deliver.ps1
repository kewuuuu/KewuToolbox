$ErrorActionPreference = 'Stop'

$repoRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location -LiteralPath $repoRoot

$releaseDir = Join-Path $repoRoot 'release'
$deliverDir = Join-Path $releaseDir 'deliver'
$extensionSource = Join-Path $repoRoot 'browser-extension'

Write-Host 'Step 1/5: Clean previous output...'
if (Test-Path -LiteralPath $releaseDir) {
  Remove-Item -LiteralPath $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDir | Out-Null

Write-Host 'Step 2/5: Build portable EXE...'
npm run build:portable
if ($LASTEXITCODE -ne 0) {
  throw "Build failed. npm run build:portable exited with code $LASTEXITCODE"
}

Write-Host 'Step 3/5: Create deliver directory...'
if (Test-Path -LiteralPath $deliverDir) {
  Remove-Item -LiteralPath $deliverDir -Recurse -Force
}
New-Item -ItemType Directory -Path $deliverDir | Out-Null

$portableExe = Get-ChildItem -LiteralPath $releaseDir -File -Filter 'KewuToolbox-*-portable.exe' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $portableExe) {
  throw 'Portable EXE not found: KewuToolbox-*-portable.exe'
}
if (-not (Test-Path -LiteralPath $extensionSource)) {
  throw 'browser-extension folder not found.'
}

Write-Host 'Step 4/5: Collect deliverables...'
Copy-Item -LiteralPath $portableExe.FullName -Destination (Join-Path $deliverDir $portableExe.Name) -Force
Copy-Item -LiteralPath $extensionSource -Destination (Join-Path $deliverDir 'browser-extension') -Recurse -Force

Write-Host 'Step 5/5: Remove non-deliver artifacts...'
Get-ChildItem -LiteralPath $releaseDir | Where-Object { $_.Name -ne 'deliver' } | Remove-Item -Recurse -Force

Write-Host ''
Write-Host 'Done. Deliverables kept:'
Get-ChildItem -LiteralPath $deliverDir -Force | Select-Object Name, FullName
