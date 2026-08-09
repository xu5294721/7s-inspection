# Git maintenance for 7S inspection

This repository uses a Windows-safe Git workflow:

- Git for Windows 2.55 or newer.
- Source text is LF-normalized by `.gitattributes`; binary assets are never line-ending converted.
- GitHub transport uses the repository-scoped `github-7s` SSH alias on `ssh.github.com:443`.
- Read-only Git commands run with `GIT_OPTIONAL_LOCKS=0` so `status` and `diff` do not refresh the shared index.
- Do not run index-touching Git commands in parallel against the same worktree.

Run the diagnostic before a release or when Git reports an unexpected state:

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

If a tag mismatch is reported, preserve the local tag under `refs/tags/local-backup/` before fetching the GitHub tag. Never force-push or reset a dirty worktree to make the counters look clean.
