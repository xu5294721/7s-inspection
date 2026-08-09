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
$reportedRoot = [IO.Path]::GetFullPath($report.repoRoot).TrimEnd('\')
$expectedRoot = [IO.Path]::GetFullPath($repoRoot).TrimEnd('\')
if ($reportedRoot -ne $expectedRoot) {
    throw "Health script inspected '$reportedRoot' instead of its own worktree '$expectedRoot'"
}
if ($null -eq $report.locks) {
    throw 'Health report did not include locks'
}
if ($null -eq $report.eol) {
    throw 'Health report did not include eol'
}
if ($report.eol.worktreeCrlfCount -ne 0) {
    throw "Health report found unexpected CRLF files: $($report.eol.worktreeCrlfCount)"
}
if ($report.eol.worktreeMixedCount -ne 0) {
    throw "Health report found mixed-line-ending files: $($report.eol.worktreeMixedCount)"
}
if ($report.eol.indexCrlfCount -ne 0) {
    throw "Health report found CRLF blobs in the index: $($report.eol.indexCrlfCount)"
}
if ($report.eol.indexMixedCount -ne 0) {
    throw "Health report found mixed-line-ending blobs in the index: $($report.eol.indexMixedCount)"
}
if ($null -eq $report.refs) {
    throw 'Health report did not include refs'
}
if ($report.config.optionalLocks -ne '0') {
    throw "GIT_OPTIONAL_LOCKS is not configured as 0: '$($report.config.optionalLocks)'"
}
if ($report.refs.localTagCount -lt 1) {
    throw 'Health report did not parse local tags'
}

Write-Output 'git-health smoke test passed'
