$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$healthScript = Join-Path $PSScriptRoot 'git-health.ps1'

if (-not (Test-Path -LiteralPath $healthScript)) {
    throw "Missing health script: $healthScript"
}

$json = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $healthScript -Json -NoNetwork
if ($LASTEXITCODE -ne 0) {
    throw "Health script returned exit code $LASTEXITCODE"
}

$report = $json | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($report.repoRoot)) {
    throw 'Health report did not include repoRoot'
}
if ($null -eq $report.locks) {
    throw 'Health report did not include locks'
}
if ($null -eq $report.eol) {
    throw 'Health report did not include eol'
}
if ($null -eq $report.refs) {
    throw 'Health report did not include refs'
}
if ($report.refs.localTagCount -lt 1) {
    throw 'Health report did not parse local tags'
}

Write-Output 'git-health smoke test passed'
