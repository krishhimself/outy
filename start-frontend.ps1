# Starts the Outy Expo dev server.
# Usage (from the repo root):
#   .\start-frontend.ps1            normal start
#   .\start-frontend.ps1 -Tunnel    use a tunnel (for testing off your Wi-Fi)
#   .\start-frontend.ps1 -Clear     clear the Metro cache first
param(
    [switch]$Tunnel,
    [switch]$Clear
)

Set-Location (Join-Path $PSScriptRoot "frontend")

$expoArgs = @("expo", "start")
if ($Tunnel) { $expoArgs += "--tunnel" }
if ($Clear)  { $expoArgs += "--clear" }

& npx @expoArgs
