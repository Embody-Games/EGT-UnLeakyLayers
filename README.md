# Layered Lock Alpha

A Blockbench plugin that makes **Lock Alpha Channel** respect every layer in a texture
instead of only the one you are painting on.

Blockbench's built-in Lock Alpha looks at the alpha of the active layer. On a fresh, empty
layer above your artwork that means everything is locked and the brush does nothing. This
plugin builds a combined alpha mask from all layers, so a pixel is locked only when it is
fully transparent on every one of them. Anywhere the texture is visible you can paint, and
the result is clipped to the combined silhouette.

That clipping is the point: with a low opacity brush you no longer get faint stray pixels
outside the artwork. The stroke is reconciled against the mask before it is committed, so
locked pixels are restored and unlocked pixels keep their colour with alpha clamped to the
combined alpha.

Erasing follows from the same idea. Vanilla freezes alpha outright, which makes the eraser
useless on an upper layer even though the artwork underneath still holds the silhouette.
Here a second mask tracks the alpha of every layer except the active one, and lowering alpha
is blocked only where that backdrop is empty. Erasing on a layer above your artwork just
reveals what is beneath it.

## Install

Blockbench 4.10.0 or newer, in either variant (app or web).

1. Download `layered_lock_alpha.js` from the [latest release](https://github.com/Embody-Games/EGT-UnLeakyLayers/releases/latest).
2. In Blockbench, **File > Plugins > Load Plugin from File** and pick it.

Then turn Lock Alpha Channel on as usual. The tooltip updates to describe the new behaviour.

## Settings

Both live under **Settings > Paint**.

| Setting | What it does |
| --- | --- |
| Layer-aware Lock Alpha | Turn the whole behaviour off and fall back to vanilla Lock Alpha. |
| Clamp alpha to the combined mask | Cap painted alpha at the combined alpha rather than letting a stroke exceed it. |

## Repo layout

| Path | What it is |
| --- | --- |
| `layered_lock_alpha.js` | The plugin. `const PLUGIN_VERSION` near the top is the only place the version lives. |
| `changelog.json` | Single source for the changelog. Blockbench's Changelog tab, `CHANGELOG.md` and the GitHub release body all render from it. |
| `CHANGELOG.md` | Generated. Do not edit by hand. |
| `scripts/check.mjs` | The checks that gate a release. |
| `scripts/release.mjs` | Bump, changelog, commit, tag, push. |
| `scripts/changelog.mjs` | Renders `changelog.json` into markdown. |
| `RELEASING.md` | How to cut a release, and how pushing works from this clone. |

## Releasing

See [RELEASING.md](RELEASING.md). Short version:

```sh
npm run release -- patch --title "Short release name" --fixed "What the user sees."
```

## License

MIT.
