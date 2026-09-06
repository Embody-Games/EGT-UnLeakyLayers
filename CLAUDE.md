# UnLeaky Layers — notes for Claude

Blockbench plugin that makes Lock Alpha Channel respect every layer rather than only
the flattened texture. `README.md` explains what it does. `RELEASING.md` is the
authority on cutting a release, including how to push from a Cowork session. Read
that before releasing anything; this file is orientation.

## Shape of the repo

There is **no build step**. The plugin is one hand-written file that ships as-is.

| Path | What it is |
|---|---|
| `unleakylayers.js` | The entire plugin. `const PLUGIN_VERSION` near the top is the only place the version lives. |
| `changelog.json` | Blockbench's changelog format. **The only place release notes are written.** |
| `CHANGELOG.md` | Generated. Never hand-edit it; run `npm run changelog`. |
| `scripts/` | `release.mjs`, `changelog.mjs`, `check.mjs`, `discord_notify.mjs`. |

There is no `test/` directory here. `npm test` runs `scripts/check.mjs`, which is
static checks over the plugin file rather than a behavioural suite. One of those
checks refuses a credential in the tracked tree; leave it in place.

This repo has no icon PNG, so its Discord posts fall back to the webhook's default
avatar. Adding `unleakylayers_icon.png` and pointing `PLUGIN_ICON_URL` at it would
fix that.

## Releasing

```sh
npm run release -- patch --title "Short name" --fixed "What the user sees."
```

**Pushing the tag is the button.** That command checks, bumps, writes the changelog
entry, commits, tags and pushes. Everything after that is automatic.

Repo-only changes — CI, README, scripts, this file — get a plain commit. No version
bump, no tag, no changelog entry. The version belongs to the plugin, not the repo.

## What happens once the tag lands

`.github/workflows/release.yml`, on a GitHub runner:

1. Reruns the checks.
2. Refuses if the tag disagrees with `PLUGIN_VERSION`.
3. Publishes the GitHub release. Body is that version's `changelog.json` entry,
   with `unleakylayers.js` and `changelog.json` attached.
4. Posts that same entry to Discord.
5. Ends. Nothing stays running.

## The Discord post

There is **no bot**. No hosted process, nothing invited to the server, nothing
listening. Step 4 above is a single HTTP POST to a Discord webhook, and then the
workflow exits. Discord labels webhook messages **APP**, which is not a bot account.

`scripts/discord_notify.mjs` reads the version's `changelog.json` entry and posts it
as an embed. Configuration is the `env:` block at the top of `release.yml`:

| Variable | Why |
|---|---|
| `PLUGIN_FILE` | Reads the version out of it; also builds the install link. |
| `PLUGIN_NAME` | The name the message posts under. |
| `PLUGIN_ICON_URL` | The avatar. Not set here, see above. |
| `PLUGIN_COLOR` | Embed stripe colour, hex without the `#`. |
| `DISCORD_THREAD_ID` | The forum post it goes into. **`1545338164627906570` for this plugin.** |

The webhook URL is the repo/org secret `DISCORD_WEBHOOK_URL`. It is never in the
repo. All four plugin repos can read it.

Every plugin posts through **one** webhook on the `#addons` forum channel and lands
in its own thread via `?thread_id=`. Each post overrides `username` and
`avatar_url`, so it arrives as the plugin rather than as one shared identity.

Preview a post without sending anything:

```sh
PLUGIN_NAME="UnLeaky Layers" PLUGIN_FILE=unleakylayers.js \
  GITHUB_REPOSITORY=Embody-Games/EGT-UnLeakyLayers \
  node scripts/discord_notify.mjs 1.2.1 --dry-run
```

The step is `continue-on-error`. A Discord outage must never fail a good release.

## Traps

- `release.mjs` imports `writeMarkdown` and `semverDesc` from `changelog.mjs`.
  Changing that module's exports breaks releasing, not just the changelog.
- Renaming the plugin file changes the plugin id, because Blockbench derives the id
  from the filename. Repo name, filename and id are kept matching on purpose
  (`EGT-<Name>` / `<name>.js` / `<name>`) so the raw handout link reads cleanly.
- Users are given `https://raw.githubusercontent.com/Embody-Games/EGT-UnLeakyLayers/main/unleakylayers.js`.
  Anything that reaches `main` reaches them immediately. There is no staging step.

## Changelog voice

Say what the user sees, not what the code did. Categories, in order: Added, Changed,
Fixed, Removed, Safeguards.
