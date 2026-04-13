$ErrorActionPreference = 'Stop'

$repoRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location -LiteralPath $repoRoot

$releaseDir = Join-Path $repoRoot 'release'
$deliverDir = Join-Path $releaseDir 'deliver'
$extensionSource = Join-Path $repoRoot 'browser-extension'

$isWindowsHost = $env:OS -eq 'Windows_NT'
$isMacHost = $false
if (Get-Command uname -ErrorAction SilentlyContinue) {
  $uname = uname
  if ($uname -eq 'Darwin') {
    $isMacHost = $true
  }
}

Write-Host 'Step 1/6: Clean previous output...'
if (Test-Path -LiteralPath $releaseDir) {
  Remove-Item -LiteralPath $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDir | Out-Null

Write-Host 'Step 2/6: Build renderer...'
npm run build
if ($LASTEXITCODE -ne 0) {
  throw "Build failed. npm run build exited with code $LASTEXITCODE"
}

$builtTargets = @()

Write-Host 'Step 3/6: Build portable packages...'
if ($isWindowsHost) {
  Write-Host 'Building Windows portable EXE...'
  npm run package:portable:win
  if ($LASTEXITCODE -ne 0) {
    throw "Build failed. npm run package:portable:win exited with code $LASTEXITCODE"
  }
  $builtTargets += 'windows'
} else {
  Write-Warning 'Skipped Windows portable build (not running on Windows host).'
}

if ($isMacHost) {
  Write-Host 'Building macOS portable ZIP...'
  npm run package:portable:mac
  if ($LASTEXITCODE -ne 0) {
    throw "Build failed. npm run package:portable:mac exited with code $LASTEXITCODE"
  }
  $builtTargets += 'mac'
} else {
  Write-Warning 'Skipped macOS portable build (not running on macOS host).'
}

if ($builtTargets.Count -eq 0) {
  throw 'No portable package was built. Run this script on Windows or macOS.'
}

Write-Host 'Step 4/6: Create deliver directory...'
if (Test-Path -LiteralPath $deliverDir) {
  Remove-Item -LiteralPath $deliverDir -Recurse -Force
}
New-Item -ItemType Directory -Path $deliverDir | Out-Null

if (-not (Test-Path -LiteralPath $extensionSource)) {
  throw 'browser-extension folder not found.'
}

Write-Host 'Step 5/6: Collect deliverables...'

$portableExe = Get-ChildItem -LiteralPath $releaseDir -File -Filter 'KewuToolbox-*-portable.exe' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if ($portableExe) {
  Copy-Item -LiteralPath $portableExe.FullName -Destination (Join-Path $deliverDir $portableExe.Name) -Force
}

$portableMacZip = Get-ChildItem -LiteralPath $releaseDir -File -Filter 'KewuToolbox-*-mac-portable.zip' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if ($portableMacZip) {
  Copy-Item -LiteralPath $portableMacZip.FullName -Destination (Join-Path $deliverDir $portableMacZip.Name) -Force
}

Copy-Item -LiteralPath $extensionSource -Destination (Join-Path $deliverDir 'browser-extension') -Recurse -Force

$collectedArtifacts = Get-ChildItem -LiteralPath $deliverDir -File -ErrorAction SilentlyContinue
if (-not $collectedArtifacts) {
  throw 'No deliverable artifacts found under release output.'
}

Write-Host 'Step 6/6: Remove non-deliver artifacts...'
Get-ChildItem -LiteralPath $releaseDir | Where-Object { $_.Name -ne 'deliver' } | Remove-Item -Recurse -Force

Write-Host ''
Write-Host 'Done. Deliverables kept:'
Get-ChildItem -LiteralPath $deliverDir -Force | Select-Object Name, FullName
