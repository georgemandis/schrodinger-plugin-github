# GitHub Plugin for Schrödinger

**When the clip is a GitHub link**

- **Titled reference**: `[tauri-apps/tauri#1: feat(readme) init](…)` for issues and pull requests; `owner/repo@abc1234: subject` for commits; the name and description for repositories; the path and line range for files
- **Details**: title, state (open, closed, merged, draft), author, date and labels; or a repository's description, language, stars and license
- **Permanent link**: a file link on a branch, rewritten to the commit that branch points at now, so it keeps showing the same lines

**When the clip is code copied from a file on GitHub**

- **Code with link**: a fenced block tagged with the file's language, followed by a permanent link to the file (and to the lines, if they were selected in the address)

Knowing which file code came from relies on the browser recording the page on the clipboard. Chrome, Edge, Brave, Arc and Safari do; Firefox does not.

## Limits

Uses GitHub's public API without signing in. That means public repositories only, and GitHub allows 60 lookups an hour per network address. When the limit is reached the plugin says how long until it resets.

## Network access

Contacts `api.github.com` only, when you paste, and sends the repository and the issue, commit or branch being looked up.

## Installation

Install from the Schrödinger Plugin Manager (Settings → Plugins → Browse).

To install manually or develop locally, symlink the plugin into your plugins directory:

```sh
ln -s "$(pwd)" ~/.schrodinger/plugins/github
```

Requires Schrödinger 0.2 or later.

## License

MIT
