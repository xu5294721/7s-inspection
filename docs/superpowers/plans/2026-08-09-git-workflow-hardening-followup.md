# Git Workflow Hardening Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository's Windows Git workflow deterministic across worktrees, line endings, locks, and GitHub transport.

**Architecture:** Keep the user's existing root checkout and dirty feature work untouched. Use `git-canonical` as the clean release/integration worktree, bind diagnostics to the directory containing the diagnostic script, and store repository-specific safety defaults in `.git/config` plus versioned documentation and smoke tests.

**Tech Stack:** Git for Windows 2.55+, PowerShell, `.gitattributes`, `.editorconfig`, SSH over `ssh.github.com:443`.

## Global Constraints

- Never reset, force-push, or delete user worktrees with uncommitted changes.
- Preserve original user files and local tag history before changing refs.
- Run index-touching Git commands sequentially within one worktree.
- Use the repository-scoped SSH alias instead of GitHub HTTPS for this project.

---

### Task 1: Bind health checks to their own worktree

**Files:**
- Modify: `scripts/test-git-health.ps1`
- Modify: `scripts/git-health.ps1`

- [x] **Step 1: Write the failing test**

Assert that the reported repository root equals the parent of the test script, even when the caller is in another checkout.

- [x] **Step 2: Run the test to verify it fails**

Run from `C:\Users\xj\Desktop\7s管理`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .worktrees\git-canonical\scripts\test-git-health.ps1
```

Expected failure: the health script reports the root checkout instead of `.worktrees\git-canonical`.

- [x] **Step 3: Write the minimal implementation**

Resolve the parent of `$PSScriptRoot` and call `Set-Location` before any Git command in `git-health.ps1`.

- [x] **Step 4: Run the test to verify it passes**

Run the same command and expect `git-health smoke test passed`.

### Task 2: Apply repository-level defaults

**Files:**
- Modify: local repository `.git/config` through `git config`
- Modify: `docs/git-maintenance.md`

- [x] **Step 1: Configure deterministic defaults**

Set `core.autocrlf=false`, `core.safecrlf=true`, `fetch.prune=true`, `pull.ff=only`, `push.default=upstream`, `rerere.enabled=true`, and `maintenance.auto=false` in the canonical worktree repository configuration.

- [x] **Step 2: Verify the effective configuration**

Run `git config --show-origin --get-regexp` and confirm the values are local to this repository.

### Task 3: Remove only redundant clean Git state

**Files:**
- Git worktree administration for the clean `git-hardening` worktree only

- [x] **Step 1: Verify the candidate is clean**

Run `git -C .worktrees\git-hardening status --short --branch` and confirm no changes.

- [x] **Step 2: Remove the redundant worktree registration**

Remove only `.worktrees\git-hardening`; retain its branch and remote ref as recoverable history.

### Task 4: Verify the complete workflow

**Files:**
- No source changes

- [x] **Step 1: Run health and smoke checks**

Run `scripts\git-health.ps1`, `scripts\test-git-health.ps1`, and ten sequential `git status --short --branch` calls from the canonical worktree.

- [x] **Step 2: Verify remote and tags**

Run `git ls-remote origin HEAD refs/heads/main refs/tags/v1.0.2` and confirm the expected remote object IDs.

- [x] **Step 3: Verify repository integrity**

Run `git fsck --full` and require no missing or corrupt objects.

- [x] **Step 4: Commit the hardening follow-up**

Stage the versioned script, test, documentation, and plan, then commit with `chore: make git diagnostics worktree-safe`.
