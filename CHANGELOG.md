# Changelog

Generated from `changelog.json` by `scripts/changelog.mjs`. Edit that file, not this one.

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
