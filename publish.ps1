$defaultOutput = Join-Path $PSScriptRoot "bin\Release\net8.0-windows\win-x64\publish"
$output = $defaultOutput

if (Test-Path (Join-Path $defaultOutput "WindowMonitorApp.exe")) {
    try {
        Remove-Item -LiteralPath (Join-Path $defaultOutput "WindowMonitorApp.exe") -Force
    }
    catch {
        $output = Join-Path $PSScriptRoot ("bin\Release\net8.0-windows\win-x64\publish-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    }
}

dotnet publish .\WindowMonitorApp.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  /p:PublishSingleFile=true `
  /p:IncludeNativeLibrariesForSelfExtract=true `
  /p:EnableCompressionInSingleFile=true `
  -o $output

Write-Host "Publish output: $output"
