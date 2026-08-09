# Git maintenance for 7S inspection

This repository uses a Windows-safe Git workflow:

- Git for Windows 2.55 or newer.
- Source text is LF-normalized by `.gitattributes`; binary assets are never line-ending converted.
- GitHub transport uses the repository-scoped `github-7s` SSH alias on `ssh.github.com:443`.
- Read-only Git commands run with `GIT_OPTIONAL_LOCKS=0` so `status` and `diff` do not refresh the shared index.
- The canonical clean integration worktree is `.worktrees/git-canonical`; keep feature work in a separate branch/worktree.
- Repository-local defaults set `core.autocrlf=false`, `core.safecrlf=true`, `pull.ff=only`, `fetch.prune=true`, `push.default=upstream`, and `maintenance.auto=false`.
- Do not run index-touching Git commands in parallel against the same worktree.
- With Git for Windows, do not mix an ignored path with tracked paths in one `git add`; stage tracked paths first, then use a separate `git add -f` only for an intentionally tracked ignored file.

Run the diagnostic before a release or when Git reports an unexpected state. It is bound to the worktree containing the script, so it can be called from any directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/git-health.ps1
```

The report checks all linked worktrees, active `index.lock` files, source-file line endings, remote connectivity, and local/remote tag mismatches. If a lock is present and no Git process exists, move it to a timestamped backup instead of deleting it:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/git-health.ps1 -RepairStaleLocks
```

Synchronize refs over the configured SSH transport:

```powershell
git fetch --prune --tags origin
git status --short --branch
```

For normal integration work, start in the clean canonical worktree:

```powershell
Set-Location .worktrees\git-canonical
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\git-health.ps1
```

If a tag mismatch is reported, preserve the local tag under `refs/tags/local-backup/` before fetching the GitHub tag. Never force-push or reset a dirty worktree to make the counters look clean.

If a stale lock is left after an interrupted write, verify that no Git process is running and use `-RepairStaleLocks`; the script moves the lock to a timestamped backup so it can be recovered.
