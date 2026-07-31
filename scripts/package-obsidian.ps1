param(
  [string]$PluginRoot = (Join-Path $PSScriptRoot '..\integrations\obsidian'),
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\dist\pcs-obsidian.zip')
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $PluginRoot).Path
$output = [IO.Path]::GetFullPath($OutputPath)
$outputDir = Split-Path -Parent $output
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }
Compress-Archive -Path (Join-Path $resolvedRoot 'manifest.json'), (Join-Path $resolvedRoot 'main.js') -DestinationPath $output
Write-Output "Created $output"
