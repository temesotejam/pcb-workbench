$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Node = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $Node) {
  Write-Host "Node.js 20+ is required for the local web bridge." -ForegroundColor Yellow
  Start-Process "https://nodejs.org/en/download"
  exit 1
}
$NodeVersion = (& node --version).Trim().TrimStart("v")
if ([version]$NodeVersion -lt [version]"20.0") { throw "Node.js 20+ required. Detected $NodeVersion" }
Set-Location $Root
$Esbuild = Test-Path (Join-Path $Root "node_modules/esbuild")
$Fflate = Test-Path (Join-Path $Root "node_modules/fflate")
if (-not ($Esbuild -and $Fflate)) {
  Write-Host "Installing local web bridge dependencies..."
  npm install
}
$Server = Start-Process -FilePath "node" -ArgumentList "agent/server.mjs" -WorkingDirectory $Root -PassThru -WindowStyle Normal
$Ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  $Server.Refresh()
  if ($Server.HasExited) { throw "PCB Workbench server exited during startup." }
  try {
    $null = Invoke-WebRequest "http://127.0.0.1:8787/api/bootstrap" -UseBasicParsing -TimeoutSec 1
    $Ready = $true
    break
  } catch {}
}
if (-not $Ready) {
  Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
  throw "PCB Workbench local server did not start."
}
Start-Process "http://127.0.0.1:8787/handoff.html"
Write-Host "Local UI: http://127.0.0.1:8787/handoff.html"
Write-Host "Start your existing EasyEDA Pro API Gateway / Bridge Server if it is not already running."
Write-Host "Close the separate Node server console window to stop PCB Workbench."
Wait-Process -Id $Server.Id
