# Changelog

Generated from `changelog.json` by `scripts/changelog.mjs`. Edit that file, not this one.

## v1.3.2 - Brush painting stays fast

_2026-09-09_

### Fixed

- Using the Shape or Gradient tool once made every brush stroke after it slower, for the rest of the session: each dab re-checked the whole layer instead of just the area under the brush, and checked it against the shape stroke rather than the current pixels. On a partly transparent layer that also let alpha creep down as you painted. Brush strokes now do the small per-dab check they were meant to, whatever you used before them.

## v1.3.1 - Lock Alpha stays layer aware

_2026-09-09_

### Fixed

- Lock Alpha could quietly stop being layer aware on a layer for the rest of the session. If anything went wrong while a stroke was starting, that layer was left marked as busy and every later stroke on it skipped the layer-aware check without saying anything. Reloading the plugin was the only way to clear it.

## v1.3.0 - Layer-Aware Alpha Lock button

_2026-09-08_

### Added

- A Layer-Aware Alpha Lock button next to Lock Alpha in the paint toolbar, so you can switch between locking against the layer you are painting on and locking against all of them without opening settings.

### Changed

- The setting called UnLeaky Layers is now called Layer-Aware Alpha Lock, to match the new button. It is the same switch and your choice is kept.

## v1.2.1 - UnLeaky Layers

_2026-09-05_

### Changed

- The plugin now shows up as 'UnLeaky Layers' in Blockbench's plugin list, and the master toggle under Settings > Paint is named the same. v1.2.0 renamed the file and the id but left the displayed name behind.

## v1.2.0 - Renamed to UnLeakyLayers

_2026-09-05_

### Changed

- The plugin file is now unleakylayers.js and its id is 'unleakylayers', matching the repo and the other Embody Games plugins. Blockbench treats this as a different plugin, so remove the old Layered Lock Alpha entry and load the new file once. Painting behaviour is unchanged.
- The direct download link is now https://raw.githubusercontent.com/Embody-Games/EGT-UnLeakyLayers/main/unleakylayers.js

## v1.1.0 - Layer-aware Lock Alpha

_2026-09-04_

### Added

- Lock Alpha Channel now looks at every layer in the texture instead of only the one you are painting on. A pixel is paintable wherever any layer is visible, so an empty layer above your artwork is no longer dead to the brush.
- Strokes are clipped to the combined silhouette of the texture, so a low opacity brush cannot leave faint pixels outside the artwork.
- Two settings under Paint: 'Layer-aware Lock Alpha' to turn the behaviour off, and a clamp toggle for how alpha is capped against the combined mask.

### Changed

- The Lock Alpha tooltip now says what the toggle actually does with this plugin loaded, and is restored when the plugin is unloaded.

### Fixed

- The eraser works on an upper layer again. Vanilla froze alpha outright; lowering alpha is now blocked only where the active layer is the sole thing holding the pixel up, so erasing above your artwork reveals what is underneath.
