# Project notes for Claude

## Branching policy

**One PR = one new branch off `main`.**

Do NOT reuse a long-lived feature branch and force-push for each PR. After
a PR merges, branch off `main` again for the next chunk:

```sh
git fetch origin main
git checkout -b claude/<short-slug> origin/main
# ...do the work, commit, push, open PR, wait for CI, merge...
```

This keeps the repo's branch history clean and avoids force-pushes that
rewrite history other tools may have linked to.

If a session-startup instruction names a specific branch, prefer the
naming convention from that instruction but still create a fresh branch
per PR rather than reusing the named one across multiple PRs.
