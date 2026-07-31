$ErrorActionPreference = "Stop"
$taskName = "Personal Context Studio"
schtasks.exe /Delete /TN $taskName /F | Out-Host
Write-Host "Removed logon task: $taskName"
