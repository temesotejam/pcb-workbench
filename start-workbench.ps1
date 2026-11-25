$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Cli = Get-Command "easyeda-pro" -ErrorAction SilentlyContinue
if (-not $Cli) {
  $Candidates = @(
    "C:\Program Files\EasyEDA-Pro\easyeda-pro.exe",
    "C:\Program Files\EasyEDA Pro\easyeda-pro.exe",
    "C:\Program Files\JLCEDA-Pro\easyeda-pro.exe",
    "$env:LOCALAPPDATA\Programs\EasyEDA-Pro\easyeda-pro.exe"
  )
  foreach ($Candidate in $Candidates) {
    if (Test-Path $Candidate) { $Cli = Get-Item $Candidate; break }
  }
}
if (-not $Cli) {
  Write-Host "EasyEDA Pro desktop client was not found." -ForegroundColor Yellow
  Write-Host "Install EasyEDA Pro desktop v4.1.70 or newer. The browser/online edition does not expose the required local CLI."
  Start-Process "https://easyeda.com/page/download"
  exit 1
}
if ($Cli -is [System.Management.Automation.ApplicationInfo]) { $CliPath = $Cli.Source } else { $CliPath = $Cli.FullName }
$Help = (& $CliPath --help 2>&1 | Out-String)
$Match = [regex]::Match($Help, "EasyEDA Pro\s+(\d+)\.(\d+)\.(\d+)")
if (-not $Match.Success) { throw ("Could not identify EasyEDA Pro CLI version. Run: " + $CliPath + " --help") }
$Version = [version]::Parse("$($Match.Groups[1].Value).$($Match.Groups[2].Value).$($Match.Groups[3].Value)")
if ($Version -lt [version]"4.1.70") { throw "EasyEDA Pro CLI 4.1.70+ is required. Detected $Version" }
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
$env:EASYEDA_PRO_CLI = $CliPath
Write-Host "EasyEDA Pro $Version detected. Starting the local-only web workspace..."
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
Write-Host "Close the separate Node server console window to stop the local engine bridge."
Wait-Process -Id $Server.Id
