$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$taskName = "Personal Context Studio"
$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"Set-Location -LiteralPath '$repo'; npm.cmd run dev:supervisor`""
schtasks.exe /Create /TN $taskName /SC ONLOGON /TR $command /F | Out-Host
Write-Host "Installed logon task: $taskName"
