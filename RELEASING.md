# Releasing Layered Lock Alpha

Repo: `Embody-Games/EGT-UnLeakyLayers`, public.
Working copy on David's machine at
`C:\Users\Filmjolk\AppData\Roaming\.minecraft\resourcepacks\EGT-UnLeakyLayers`,
reachable through the Claude device bridge as `$HOME/mnt/EGT-UnLeakyLayers`.
Do the work there with `device_bash`. Do not stage these files into the cloud container.

There is no build step. "Compiling a new version" means running the release command below.

## The one command

```sh
cd "$HOME/mnt/EGT-UnLeakyLayers"
npm run release -- <major|minor|patch> --title "Short release name" \
  --added "..." --changed "..." --fixed "..."
```

`scripts/release.mjs` runs the checks, bumps `const PLUGIN_VERSION` in the plugin (the only
place the version lives) and `package.json`, inserts the `changelog.json` entry, regenerates
`CHANGELOG.md`, commits `vX.Y.Z: <title>`, tags `vX.Y.Z`, pushes. The checks run before
anything is written, so a failing check leaves the tree untouched. Never do these steps by
hand, and never edit the version in two places.

Useful flags: `--dry-run` to preview the commit and tag, `--no-push` when there is no
credential to push with, `--notes <file.json>` for long entries, `--date YYYY-MM-DD` to
override today. The category flags are repeatable.

Pushing the tag is what publishes the release. `.github/workflows/release.yml` reruns the
checks, refuses if the tag disagrees with `PLUGIN_VERSION`, then publishes a GitHub release
whose body is that version's `changelog.json` entry, with the plugin and `changelog.json`
attached. `.github/workflows/checks.yml` runs the same checks on every push to `main`.

Pick the bump by what changed: `patch` for a fix with no new behaviour, `minor` for new
behaviour or a new setting, `major` for a change that breaks how existing projects paint.

**Repo-only changes do not get a version.** README, CI, scripts, checks: plain commit, no
bump, no tag, no changelog entry. The version is the plugin's, not the repo's.

## Writing the changelog lines

They are the release description, and they are read by David and by anyone installing the
plugin. `changelog.json` is the single source, so the text is never written twice.

- Say what the user sees, not what the code did. "The eraser works on an upper layer again"
  beats "fixed alpha freeze in Painter.edit".
- One sentence per line where it fits, plain words, no em-dashes. Match the voice of the
  existing entries, which explain consequences rather than internals.
- Categories, in this order: Added, Changed, Fixed, Removed, Safeguards.
- Say if a setting changed name or default. Users care.

## Pushing

A fine-grained token scoped to this repository alone lives at `.git/egt-push-token` in the
working copy. `.git` is never tracked and never pushed, so the token cannot leak through a
commit. It expires **2027-09-05**.

```sh
cd "$HOME/mnt/EGT-UnLeakyLayers"
TOKEN=$(tr -d '\r\n' < .git/egt-push-token)
git push --follow-tags "https://x-access-token:$TOKEN@github.com/Embody-Games/EGT-UnLeakyLayers.git" main
git fetch origin      # pushing to a URL does not move refs/remotes/origin/main
```

`scripts/release.mjs` does exactly this for you. The `git fetch` matters: without it the
clone keeps looking "ahead" in GitHub Desktop.

Never write the token into `.git/config`, a tracked file, a project doc or memory. This repo
is public, and GitHub's secret scanning revokes any token that lands in a commit, so a token
in a tracked markdown file stops working the moment it is pushed. `scripts/check.mjs` fails
the release if anything token-shaped is found in a tracked file.

If `.git/egt-push-token` is missing, which is the case on any other computer since `.git` is
per clone, ask David for it or leave the push to him with `--no-push`. Do not invent another
credential path.

SSH and deploy keys do not work from the bridge shell: it has no DNS of its own, so plain
`ssh` cannot resolve github.com. HTTPS with the token is the route.

## Two traps specific to this setup

1. **The mount denies unlink.** A commit made through the bridge leaves `.git/index.lock`,
   `.git/HEAD.lock` and `tmp_obj_*` files behind, and `index.lock` will block git on the
   Windows side. Before committing, get deletion enabled for the folder with
   `device_request_delete_permission`, and afterwards run:
   `find .git \( -name "*.lock" -o -name "tmp_obj_*" \) -delete` then `git fsck`.
   `scripts/release.mjs` sweeps these itself, but only if deletion is already enabled.
2. **Git identity.** The Linux side does not see Windows' global git config. The repo's own
   config is set to `Filmjolk <filmjolk_1@hotmail.com>` to match the other Embody Games
   repos. Check it is still there before committing.
3. **A tag pushed in the same push that adds the workflow does not fire it.** This only bit
   the first commit, and the fix was to delete the remote tag and push it again:
   `git push $URL :refs/tags/vX.Y.Z` then `git push $URL refs/tags/vX.Y.Z`. Normal releases
   push a tag onto a branch that already carries the workflow, so they trigger fine. If a
   release ever seems to have gone nowhere, check `/actions` before assuming the push failed.

## Verifying

After the push, confirm the release actually published rather than assuming:

```sh
TOKEN=$(tr -d '\r\n' < .git/egt-push-token)
curl -sS -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/Embody-Games/EGT-UnLeakyLayers/releases/tags/vX.Y.Z
```

Check `draft: false`, both assets present, and that the body is the changelog entry. The same
API with `/actions/runs?per_page=5` shows whether the workflows went green. Without a token,
the public release page works:
`https://github.com/Embody-Games/EGT-UnLeakyLayers/releases/latest`.

Note that `api.github.com` is reachable from the device bridge shell but not from the cloud
container.
