---
name: release
description: Create a release commit by selecting a semantic version bump, updating the package version with npm without creating a git tag, and adding a changelog entry. Use only when the user asks to release the current project changes.
---

# Release

Create one release commit for the intended changes on the current branch. Do not
push, create a git tag, or publish a package unless the user explicitly asks for
those actions.

## Scope and safety

- Work from the repository root.
- Inspect `git status --short`, the complete diff, `package.json`,
  `package-lock.json`, and `CHANGELOG.md` before changing anything.
- Release only changes that belong together. Do not silently include unrelated
  existing worktree changes; if the scope is unclear, ask the user before
  staging or committing.
- Do not amend an existing commit or reset/discard changes.
- Do not manually edit the package version. `npm version` must perform the
  version bump.

## Choose the version bump

Select exactly one of `patch`, `minor`, or `major` from the actual change:

- **patch**: a bug fix, small correction, or maintenance change without a new
  backwards-compatible user-facing capability.
- **minor**: a small backwards-compatible user-facing feature.
- **major**: a breaking change or major overhaul. This should be uncommon and
  requires clear evidence in the diff; do not choose it merely because the
  release contains several changes.

If the change mixes categories, use the highest applicable bump. If the size or
compatibility impact cannot be determined confidently, ask the user rather than
guessing.

## Release procedure

1. Determine the bump and summarize the changes that will appear in the
   changelog.
2. Run the version bump from the repository root:

   ```bash
   npm version <patch|minor|major> --no-git-tag-version
   ```

   The `--no-git-tag-version` flag is required. It updates `package.json` and,
   when present, `package-lock.json` without creating npm's git commit or tag.
3. Read the version produced by npm and use it for the changelog heading. Add a
   new entry immediately below `# Changelog`, before the previous release, in
   the existing format:

   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD

   ### Added|Changed|Fixed|Removed|Internal

   - Describe the user-visible or internal changes accurately.
   ```

   Use the current date in ISO format (`date +%F`) and include only relevant
   sections. Do not rewrite existing entries.
4. Verify that the version in `package.json`, the root `version` in
   `package-lock.json`, and the new changelog heading all match. Confirm that
   no tag was created.
5. Run the repository checks:

   ```bash
   npm test
   npm run typecheck
   npm run lint
   ```

   Fix release-related failures before committing. Do not hide unrelated
   failures.
6. Review the final diff and stage only the intended release changes, including
   the source changes being released, the package metadata, and the changelog.
7. Create the release commit with:

   ```text
   chore(release): vX.Y.Z
   ```

8. Verify the commit with `git status --short` and `git show --stat --oneline
   HEAD`. Leave the branch unpushed and untagged.

The result is a single release commit containing the intended changes, the npm
version bump, and the new changelog entry.
