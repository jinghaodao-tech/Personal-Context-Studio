param(
  [string]$ExtensionRoot = (Join-Path $PSScriptRoot '..\integrations\vscode')
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $ExtensionRoot).Path
Push-Location $resolvedRoot
try {
  npm install
  npm run package
} finally {
  Pop-Location
}
