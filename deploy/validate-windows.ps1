#requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'Backend'
$frontend = Join-Path $root 'Frontend'
# Match the production NSSM runtime; do not launch an application instance.
$node = 'C:\Program Files\nodejs\node.exe'
$npm = 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $npm)) {
    throw 'Production-compatible Node and npm must exist at the reviewed paths.'
}
& $node -e "const major=Number(process.versions.node.split('.')[0]); if(major<24) process.exit(1); const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:'); db.close();"
if ($LASTEXITCODE -ne 0) { throw 'Node 24+ with node:sqlite is required.' }
$files = @(Get-ChildItem -LiteralPath (Join-Path $backend 'src'), $frontend -Recurse -File | Where-Object { $_.Extension -in @('.js', '.mjs', '.cjs') -and $_.FullName -notmatch '[\\/]node_modules[\\/]' })
foreach ($file in $files) {
    & $node --check $file.FullName
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript syntax check failed.' }
}
foreach ($path in @($backend, $frontend)) {
    foreach ($file in @(Get-ChildItem -LiteralPath $path -Recurse -Force -File | Where-Object { $_.FullName -notmatch '[\\/](node_modules|\.git)[\\/]' })) {
        if (($file.Name -like '.env*' -and $file.Name -ne '.env.example') -or $file.Name -match '\.(db|sqlite|pem|key|pfx)(-|$|\.)' -or $file.Name -match '\.bak') {
            throw 'A forbidden runtime or credential file exists in the source tree.'
        }
        if ($file.Extension -in @('.js', '.mjs', '.cjs', '.json')) {
            $text = [IO.File]::ReadAllText($file.FullName)
            if ($text -match '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' -or $text -match '(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}') {
                throw 'A possible embedded secret was detected; value is suppressed.'
            }
        }
    }
}
$tokens = $null
$parseErrors = $null
[void][Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'deploy-windows.ps1'), [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -ne 0) { throw 'Deployment script parsing failed.' }
$oldPath = $env:PATH
try {
    $env:PATH = (Split-Path -Parent $node) + ';' + $env:PATH
    Push-Location $backend
    try {
        & $node $npm ci --omit=dev --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Locked dependency installation failed.' }
    } finally { Pop-Location }
} finally { $env:PATH = $oldPath }
Write-Host ('Validation complete: ' + $files.Count + ' JavaScript files; no business application was started.')
