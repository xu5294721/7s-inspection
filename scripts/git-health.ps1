[CmdletBinding()]
param(
    [switch]$Json,
    [switch]$NoNetwork,
    [switch]$RepairStaleLocks
)

$ErrorActionPreference = 'Stop'

# Always inspect the worktree that contains this script, regardless of the
# caller's current directory. This keeps a canonical-worktree health check
# from accidentally reading the user's older root checkout.
$scriptRepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $scriptRepoRoot

function Invoke-GitText {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $previousOptionalLocks = $env:GIT_OPTIONAL_LOCKS
    try {
        $env:GIT_OPTIONAL_LOCKS = '0'
        $output = & git @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw (($output | Out-String).Trim())
        }
        return (($output | Out-String).TrimEnd())
    } finally {
        if ($null -eq $previousOptionalLocks) {
            Remove-Item Env:GIT_OPTIONAL_LOCKS -ErrorAction SilentlyContinue
        } else {
            $env:GIT_OPTIONAL_LOCKS = $previousOptionalLocks
        }
    }
}

function Try-GitText {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    try {
        return [pscustomobject]@{
            Ok = $true
            Value = Invoke-GitText -Arguments $Arguments
            Error = $null
        }
    } catch {
        return [pscustomobject]@{
            Ok = $false
            Value = $null
            Error = $_.Exception.Message
        }
    }
}

function Get-ConfigValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    $result = Try-GitText -Arguments @('config', '--get', $Key)
    if ($result.Ok) {
        return $result.Value
    }
    return $null
}

function Get-WorktreeRecords {
    $lines = (Invoke-GitText -Arguments @('worktree', 'list', '--porcelain')) -split "`r?`n"
    $records = New-Object System.Collections.Generic.List[object]
    $current = $null

    foreach ($line in $lines) {
        if ($line -match '^worktree (.+)$') {
            if ($null -ne $current) {
                $records.Add([pscustomobject]$current)
            }
            $current = [ordered]@{
                Path = $matches[1]
                Head = $null
                Branch = $null
                Detached = $false
            }
        } elseif ($line -match '^HEAD (.+)$' -and $null -ne $current) {
            $current.Head = $matches[1]
        } elseif ($line -match '^branch (.+)$' -and $null -ne $current) {
            $current.Branch = $matches[1] -replace '^refs/heads/', ''
        } elseif ($line -eq 'detached' -and $null -ne $current) {
            $current.Detached = $true
        }
    }

    if ($null -ne $current) {
        $records.Add([pscustomobject]$current)
    }
    return $records.ToArray()
}

function Get-TagMap {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Lines,
        [switch]$Remote
    )

    $map = @{}
    foreach ($line in $Lines) {
        if ($Remote) {
            $parts = $line -split '\s+'
            if ($parts.Count -ge 2 -and $parts[1] -match '^refs/tags/(.+)$') {
                $map[$matches[1]] = $parts[0]
            }
        } else {
            $parts = $line -split ' ', 2
            if ($parts.Count -eq 2) {
                $map[$parts[0]] = $parts[1]
            }
        }
    }
    return $map
}

function Get-EolReport {
    $counts = @{}
    $crlfPaths = New-Object System.Collections.Generic.List[string]
    $mixedPaths = New-Object System.Collections.Generic.List[string]
    $indexCrlfPaths = New-Object System.Collections.Generic.List[string]
    $indexMixedPaths = New-Object System.Collections.Generic.List[string]
    $lines = (Invoke-GitText -Arguments @('ls-files', '--eol')) -split "`r?`n"

    foreach ($line in $lines) {
        $parts = $line -split "`t", 2
        if ($parts.Count -eq 2 -and $parts[0] -match '^i/(?<index>\S+)\s+w/(?<worktree>\S+)\s+attr/(?<attr>.+)$') {
            $path = $parts[1]
            $key = "$($matches['index'])/$($matches['worktree'])/$($matches['attr'])"
            if (-not $counts.ContainsKey($key)) {
                $counts[$key] = 0
            }
            $counts[$key]++
            if ($matches['index'] -eq 'crlf') {
                $indexCrlfPaths.Add($path)
            }
            if ($matches['index'] -eq 'mixed') {
                $indexMixedPaths.Add($path)
            }
            if ($matches['worktree'] -eq 'crlf' -and $matches['attr'] -notmatch 'eol=crlf') {
                $crlfPaths.Add($path)
            }
            if ($matches['worktree'] -eq 'mixed') {
                $mixedPaths.Add($path)
            }
        }
    }

    return [ordered]@{
        combinations = @($counts.GetEnumerator() | ForEach-Object {
            [pscustomobject]@{
                state = $_.Key
                count = $_.Value
            }
        } | Sort-Object state)
        worktreeCrlfCount = $crlfPaths.Count
        worktreeMixedCount = $mixedPaths.Count
        indexCrlfCount = $indexCrlfPaths.Count
        indexMixedCount = $indexMixedPaths.Count
        sampleCrlfPaths = @($crlfPaths | Select-Object -First 20)
        sampleMixedPaths = @($mixedPaths | Select-Object -First 20)
        sampleIndexCrlfPaths = @($indexCrlfPaths | Select-Object -First 20)
        sampleIndexMixedPaths = @($indexMixedPaths | Select-Object -First 20)
    }
}

$repoRoot = Invoke-GitText -Arguments @('rev-parse', '--show-toplevel')
$gitDir = Invoke-GitText -Arguments @('rev-parse', '--path-format=absolute', '--git-dir')
$commonDir = Invoke-GitText -Arguments @('rev-parse', '--path-format=absolute', '--git-common-dir')
$lockFiles = @(Get-ChildItem -LiteralPath $commonDir -Recurse -Filter 'index.lock' -File -Force -ErrorAction SilentlyContinue)
$gitProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -in @('git.exe', 'git-remote-https.exe', 'ssh.exe')
})

$lockRecords = New-Object System.Collections.Generic.List[object]
$repairActions = New-Object System.Collections.Generic.List[string]
foreach ($lock in $lockFiles) {
    $staleCandidate = $gitProcesses.Count -eq 0
    $record = [ordered]@{
        path = $lock.FullName
        length = $lock.Length
        ageMinutes = [math]::Round(((Get-Date) - $lock.LastWriteTime).TotalMinutes, 1)
        staleCandidate = $staleCandidate
        movedTo = $null
    }
    if ($RepairStaleLocks -and $staleCandidate) {
        $destination = "$($lock.FullName).stale-$(Get-Date -Format yyyyMMdd-HHmmss)"
        Move-Item -LiteralPath $lock.FullName -Destination $destination -Force
        $record.movedTo = $destination
        $repairActions.Add("Moved $($lock.FullName) to $destination")
    }
    $lockRecords.Add([pscustomobject]$record)
}

$localTagLines = (Invoke-GitText -Arguments @('for-each-ref', '--format=%(refname:strip=2) %(objectname)', 'refs/tags')) -split "`r?`n"
$localTags = Get-TagMap -Lines $localTagLines
$remoteTagMap = @{}
$remoteError = $null
$remoteHead = $null
if (-not $NoNetwork) {
    $remoteTagsResult = Try-GitText -Arguments @('ls-remote', '--tags', '--refs', 'origin')
    if ($remoteTagsResult.Ok) {
        $remoteTagLines = $remoteTagsResult.Value -split "`r?`n"
        $remoteTagMap = Get-TagMap -Lines $remoteTagLines -Remote
    } else {
        $remoteError = $remoteTagsResult.Error
    }
    $remoteHeadResult = Try-GitText -Arguments @('ls-remote', 'origin', 'HEAD')
    if ($remoteHeadResult.Ok) {
        $remoteHead = (($remoteHeadResult.Value -split '\s+')[0])
    } elseif ($null -eq $remoteError) {
        $remoteError = $remoteHeadResult.Error
    }
}

$tagNames = @($localTags.Keys + $remoteTagMap.Keys | Sort-Object -Unique)
$tagMismatches = New-Object System.Collections.Generic.List[object]
foreach ($name in $tagNames) {
    $local = $localTags[$name]
    $remote = $remoteTagMap[$name]
    if ($null -ne $local -and $null -ne $remote -and $local -ne $remote) {
        $tagMismatches.Add([pscustomobject]@{
            tag = $name
            local = $local
            remote = $remote
        })
    }
}

$upstream = Try-GitText -Arguments @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}')
$aheadBehind = $null
if ($upstream.Ok) {
    $aheadBehind = (Try-GitText -Arguments @('rev-list', '--left-right', '--count', "@$($upstream.Value)...HEAD")).Value
}
$worktreeRecords = Get-WorktreeRecords
$lockRecordArray = $lockRecords.ToArray()
$repairActionArray = $repairActions.ToArray()
$tagMismatchArray = $tagMismatches.ToArray()

$report = [ordered]@{
    generatedAt = (Get-Date).ToString('o')
    repoRoot = $repoRoot
    gitVersion = (& git --version).Trim()
    gitDir = $gitDir
    commonDir = $commonDir
    branch = (Try-GitText -Arguments @('branch', '--show-current')).Value
    head = (Try-GitText -Arguments @('rev-parse', 'HEAD')).Value
    upstream = if ($upstream.Ok) { $upstream.Value } else { $null }
    aheadBehind = $aheadBehind
    remoteUrl = Get-ConfigValue -Key 'remote.origin.url'
    config = [ordered]@{
        autocrlf = Get-ConfigValue -Key 'core.autocrlf'
        httpVersion = Get-ConfigValue -Key 'http.version'
        optionalLocks = if ($null -ne $env:GIT_OPTIONAL_LOCKS) {
            $env:GIT_OPTIONAL_LOCKS
        } else {
            [Environment]::GetEnvironmentVariable('GIT_OPTIONAL_LOCKS', 'User')
        }
    }
    worktrees = $worktreeRecords
    locks = [ordered]@{
        activeCount = $lockRecords.Count
        gitProcessCount = $gitProcesses.Count
        items = $lockRecordArray
        repairActions = $repairActionArray
    }
    eol = Get-EolReport
    refs = [ordered]@{
        localTagCount = $localTags.Count
        remoteTagCount = $remoteTagMap.Count
        remoteHead = $remoteHead
        remoteError = $remoteError
        tagMismatches = $tagMismatchArray
    }
}

if ($Json) {
    $report | ConvertTo-Json -Depth 10
} else {
    Write-Output "Git version: $($report.gitVersion)"
    Write-Output "Repository: $($report.repoRoot)"
    Write-Output "Branch: $($report.branch) ($($report.head.Substring(0, 8)))"
    Write-Output "Remote: $($report.remoteUrl)"
    Write-Output "Locks: $($report.locks.activeCount) active, $($report.locks.gitProcessCount) Git-related processes"
    Write-Output "EOL: $($report.eol.worktreeCrlfCount) unexpected CRLF, $($report.eol.worktreeMixedCount) mixed worktree files, $($report.eol.indexMixedCount) mixed index files"
    Write-Output "Tags: $($report.refs.localTagCount) local, $($report.refs.remoteTagCount) remote, $($report.refs.tagMismatches.Count) mismatches"
    if ($report.refs.remoteError) {
        Write-Output "Remote check: $($report.refs.remoteError)"
    }
    foreach ($action in $report.locks.repairActions) {
        Write-Output "Repair: $action"
    }
}

if ($lockRecords.Count -gt 0 -and -not $RepairStaleLocks) {
    exit 2
}
if ($tagMismatches.Count -gt 0) {
    exit 3
}
if ($remoteError) {
    exit 4
}
if ($report.eol.worktreeCrlfCount -gt 0 -or $report.eol.worktreeMixedCount -gt 0 -or $report.eol.indexCrlfCount -gt 0 -or $report.eol.indexMixedCount -gt 0) {
    exit 5
}
