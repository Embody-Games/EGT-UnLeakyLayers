/**
 * UnLeaky Layers
 *
 * Blockbench's built-in "Lock Alpha Channel" only looks at the alpha of the layer
 * you are currently painting on. On a fresh (empty) layer above your artwork that
 * means everything is locked and the brush does nothing.
 *
 * This plugin makes Lock Alpha consider the *combined* alpha of every layer in the
 * texture: a pixel is only locked when it is fully transparent on all of them.
 * Anywhere the texture is visible you can paint, even on an empty layer, and the
 * result is clipped to the combined silhouette.
 *
 * Implementation notes
 * --------------------
 * Every paint tool ends up in Painter.edit(texture, callback, options), which resolves
 * the active layer canvas and hands its context to the tool. We wrap that function:
 *
 *   1. Build a "combined alpha" mask for the texture once per stroke, by compositing
 *      all layers the same way Texture#updateLayerChanges does.
 *   2. Turn Painter.lock_alpha off for the duration of the callback, so every tool
 *      paints unrestricted (this covers the per-pixel JS paths *and* the paths that
 *      rely on the 'source-atop' composite operation).
 *   3. Reconcile the result against the mask before it is committed: locked pixels are
 *      restored, and unlocked pixels keep their new colour with the alpha clamped to the
 *      combined alpha.
 *
 * Erasing follows from the same idea. Vanilla freezes alpha outright, which makes the
 * eraser useless on an upper layer even though the artwork underneath still holds the
 * silhouette. Here a second mask tracks the alpha of every layer *except* the active one,
 * and lowering alpha is blocked only where that backdrop is empty - i.e. only where this
 * layer is the sole thing holding the pixel up, which is the case vanilla actually cares
 * about. Erasing on a layer above your artwork just reveals what is beneath it.
 *
 * Step 3 runs on the small region passed to putImageData for brush-like tools, and on
 * the whole layer for the tools that redraw wholesale (fill / shape / gradient).
 *
 * NOTE ON THE FILENAME: Blockbench derives a file-loaded plugin's id from its filename
 * (pathToName in plugin_loader.ts) and matches it against the id passed to
 * BBPlugin.register below. Rename this file and it will refuse to load with
 * "could not load plugin". Keep the two in sync.
 */

(function () {

// Must match the filename: unleakylayers.js
const PLUGIN_ID = 'unleakylayers';
const PLUGIN_VERSION = '1.3.2';   // single source of truth, bumped by scripts/release.mjs
const LOG = '[UnLeaky Layers]';

const MUTATORS = ['fill', 'fillRect', 'stroke', 'strokeRect', 'clearRect', 'drawImage'];

// The only two tools Blockbench builds a Painter.current.clear for. See getStrokeBaseline.
const CLEAR_TOOLS = ['draw_shape_tool', 'gradient_tool'];

let originals = {};
let added_settings = [];
let toolbar_toggle = null;   // the Layer-Aware Alpha Lock button in the paint toolbar
let original_lock_alpha_description = null;

// Per-stroke caches
let stroke_active = false;
let stroke_masks = new Map();   // texture uuid -> {width, height, alpha: Uint8Array}
let baseline_cache = null;      // {canvas, data: ImageData} for shape / gradient tools
let stroke_uses_clear = false;  // this stroke is one Blockbench keeps a Painter.current.clear for
let intercepting = new Set();   // re-entrancy guard, keyed by canvas context

// ---------------------------------------------------------------- settings

function pref(id, fallback) {
	let setting = typeof settings != 'undefined' && settings[id];
	return setting ? setting.value : fallback;
}

// ---------------------------------------------------------------- mask

/**
 * Alpha union of the given layers, in texture pixel space.
 * Mirrors Texture#updateLayerChanges, except that colour blend modes are ignored -
 * for a silhouette only the alpha union matters.
 */
function renderLayerAlpha(texture, skip_layer) {
	let width = texture.width;
	let height = texture.height;

	let canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	let ctx = canvas.getContext('2d', {willReadFrequently: true});
	ctx.imageSmoothingEnabled = false;

	let include_hidden = pref('lla_include_hidden', false);

	for (let layer of texture.layers) {
		if (layer === skip_layer) continue;
		if (!include_hidden && (layer.visible === false || layer.opacity === 0)) continue;
		// Alpha masks subtract coverage rather than adding it, so they never widen
		// the paintable area. Leaving them out keeps the mask conservative.
		if (layer.blend_mode === 'alpha_mask') continue;

		let opacity = include_hidden ? 100 : layer.opacity;
		if (typeof opacity != 'number') opacity = 100;
		opacity = Math.min(100, Math.max(0, opacity));

		ctx.filter = opacity === 100 ? 'none' : `opacity(${opacity / 100})`;
		ctx.drawImage(layer.canvas, layer.offset[0], layer.offset[1], layer.scaled_width, layer.scaled_height);
	}
	ctx.filter = 'none';

	let data = ctx.getImageData(0, 0, width, height).data;
	let alpha = new Uint8Array(width * height);
	for (let p = 0, i = 3; p < alpha.length; p++, i += 4) {
		alpha[p] = data[i];
	}
	return alpha;
}

/**
 * `alpha`    - combined alpha of every layer. Decides where painting is allowed.
 * `backdrop` - combined alpha of every layer *except* the one being painted on.
 *              Where this is above zero the silhouette survives without the active
 *              layer, so erasing there cannot open a hole in it.
 */
function buildMask(texture, active_layer) {
	let width = texture.width;
	let height = texture.height;
	if (!width || !height) return null;
	return {
		width,
		height,
		alpha: renderLayerAlpha(texture, null),
		backdrop: renderLayerAlpha(texture, active_layer)
	};
}

function getMask(texture, active_layer) {
	if (!stroke_active) return buildMask(texture, active_layer);
	let key = texture.uuid + '/' + active_layer.uuid;
	let mask = stroke_masks.get(key);
	if (!mask) {
		mask = buildMask(texture, active_layer);
		if (mask) stroke_masks.set(key, mask);
	}
	return mask;
}

/**
 * The shape and gradient tools rebuild the layer from Painter.current.clear on every
 * pointer move, so the correct "before" state for them is the start of the stroke -
 * not whatever the previous frame left behind.
 *
 * Only for those two, and that has to be decided from the tool rather than from whether
 * Painter.current.clear happens to be there. Blockbench creates that canvas in the
 * draw_shape_tool / gradient_tool branch of startPaintTool, and stopPaintTool does not
 * delete it: it deletes nine other Painter.current keys and leaves `clear` behind. So
 * after one shape or gradient stroke it sits there for the rest of the session.
 *
 * Trusting it, with only a size check, sent every later brush stroke down the wrong
 * path: the whole-layer reconcile instead of the per-dab one, on every mouse move, and
 * against a "before" from a stroke that ended minutes ago. Brush painting got slower the
 * longer the session ran, and alpha crept down on a partly transparent layer.
 *
 * stroke_uses_clear is set in the startPaintTool wrapper from the same Toolbox.selected
 * core is about to read, so the two always agree on what kind of stroke this is.
 */
function getStrokeBaseline(layer) {
	if (!stroke_uses_clear) return null;
	let clear = Painter.current && Painter.current.clear;
	if (!clear || !clear.width) return null;
	if (clear.width !== layer.canvas.width || clear.height !== layer.canvas.height) return null;
	if (baseline_cache && baseline_cache.canvas === clear) return baseline_cache.data;

	let ctx = clear.getContext('2d');
	if (!ctx) return null;
	let data = ctx.getImageData(0, 0, clear.width, clear.height);
	baseline_cache = {canvas: clear, data};
	return data;
}

// ---------------------------------------------------------------- reconcile

/**
 * Vanilla Lock Alpha freezes alpha completely, which makes the eraser a no-op even when
 * the pixel is held up by a layer underneath. "Set Opacity" is the one blend mode vanilla
 * lets lower alpha regardless, so it keeps a blanket exemption here.
 *
 * Everything else is decided per pixel against the backdrop mask - see reconcile().
 */
function alphaDecreaseAlwaysAllowed() {
	if (Painter.erase_mode) return false;
	if (Toolbox.selected && Toolbox.selected.id === 'eraser') return false;
	return !!(BarItems.blend_mode && BarItems.blend_mode.value === 'set_opacity');
}

/**
 * @param after  Uint8ClampedArray the tool just produced (modified in place)
 * @param before Uint8ClampedArray the same region before the tool ran
 * @param dx,dy  top-left of the region in layer canvas pixels
 */
function reconcile(after, before, dx, dy, width, height, layer, mask, always_allow_decrease) {
	let clamp_to_composite = pref('lla_clamp', true);
	let erase_over_backdrop = pref('lla_allow_erase', true);
	let off_x = layer.offset[0];
	let off_y = layer.offset[1];
	let scale_x = (layer.scale && layer.scale[0]) || 1;
	let scale_y = (layer.scale && layer.scale[1]) || 1;
	let mask_width = mask.width;
	let mask_height = mask.height;
	let mask_alpha = mask.alpha;
	let mask_backdrop = mask.backdrop;

	for (let row = 0; row < height; row++) {
		let ty = Math.floor(off_y + (dy + row) * scale_y);
		let row_inside = ty >= 0 && ty < mask_height;
		let mask_row = ty * mask_width;

		for (let col = 0; col < width; col++) {
			let i = (row * width + col) * 4;
			let before_alpha = before[i + 3];

			let combined = 0;
			let backdrop = 0;
			if (row_inside) {
				let tx = Math.floor(off_x + (dx + col) * scale_x);
				if (tx >= 0 && tx < mask_width) {
					combined = mask_alpha[mask_row + tx];
					backdrop = mask_backdrop[mask_row + tx];
				}
			}

			// Locked: transparent on this layer and on every other one.
			if (combined === 0 && before_alpha === 0) {
				after[i]     = before[i];
				after[i + 1] = before[i + 1];
				after[i + 2] = before[i + 2];
				after[i + 3] = before_alpha;
				continue;
			}

			let alpha = after[i + 3];

			if (alpha < before_alpha) {
				// Lowering alpha only threatens the silhouette where this layer is the
				// only thing holding the pixel up. Anywhere another layer still covers
				// it, erasing just reveals what is underneath.
				let allowed = always_allow_decrease || (erase_over_backdrop && backdrop > 0);
				if (!allowed) {
					// Restore the colour too, or the tool's zeroed RGB would show
					// through once the alpha is put back.
					after[i]     = before[i];
					after[i + 1] = before[i + 1];
					after[i + 2] = before[i + 2];
					after[i + 3] = before_alpha;
				}
				continue;
			}

			if (clamp_to_composite) {
				let limit = before_alpha > combined ? before_alpha : combined;
				if (alpha > limit) after[i + 3] = limit;
			}
		}
	}
}

// ---------------------------------------------------------------- interception

function runIntercepted(layer, mask, run) {
	let ctx = layer.ctx;
	if (intercepting.has(ctx)) return run();
	intercepting.add(ctx);

	let proto = CanvasRenderingContext2D.prototype;
	let native_get = proto.getImageData;
	let native_put = proto.putImageData;

	let baseline = null;
	let allow_decrease = false;
	let full_before = null;
	let needs_full = false;
	let hooked = [];

	function snapshotFull() {
		needs_full = true;
		if (full_before) return;
		try {
			full_before = native_get.call(ctx, 0, 0, layer.canvas.width, layer.canvas.height);
		} catch (error) {
			console.error(LOG, 'could not snapshot layer', error);
		}
	}

	// Setting up is inside the try along with the stroke itself, so that a throw while
	// reading the baseline or installing the hooks still reaches the finally. It used to
	// sit outside, and a throw there left this context in `intercepting` for good: every
	// later stroke on the layer took the early exit above and skipped the reconcile, so
	// Lock Alpha went quietly inert on it until the plugin was reloaded.
	try {
		baseline = getStrokeBaseline(layer);
		allow_decrease = alphaDecreaseAlwaysAllowed();
		full_before = baseline || null;
		needs_full = !!baseline;

		// Brush-like tools mutate through putImageData on a small region - reconcile there
		// instead of scanning the whole layer on every dab. Tools that redraw from a
		// stroke baseline are handled by the single full pass below.
		if (!baseline) {
			ctx.putImageData = function (imagedata, dx, dy) {
				try {
					let region_before = native_get.call(ctx, dx, dy, imagedata.width, imagedata.height).data;
					reconcile(imagedata.data, region_before, dx, dy, imagedata.width, imagedata.height, layer, mask, allow_decrease);
				} catch (error) {
					console.error(LOG, 'region reconcile failed', error);
				}
				return native_put.apply(this, arguments);
			};
			hooked.push('putImageData');
		}

		for (let name of MUTATORS) {
			let native = proto[name];
			ctx[name] = function () {
				snapshotFull();
				return native.apply(this, arguments);
			};
			hooked.push(name);
		}

		run();
	} finally {
		for (let name of hooked) delete ctx[name];
		intercepting.delete(ctx);
	}

	if (needs_full && full_before) {
		try {
			let width = layer.canvas.width;
			let height = layer.canvas.height;
			if (full_before.width === width && full_before.height === height) {
				let after = native_get.call(ctx, 0, 0, width, height);
				reconcile(after.data, full_before.data, 0, 0, width, height, layer, mask, allow_decrease);
				native_put.call(ctx, after, 0, 0);
			}
		} catch (error) {
			console.error(LOG, 'full reconcile failed', error);
		}
	}
}

function shouldHandle(texture) {
	if (!Painter.lock_alpha) return false;
	if (!pref('lla_enabled', true)) return false;
	if (!texture || !texture.layers_enabled) return false;
	if (!texture.layers || texture.layers.length < 2) return false;
	return true;
}

// ---------------------------------------------------------------- toolbar

/**
 * Put the toggle in the paint toolbar, directly after Lock Alpha.
 *
 * Blockbench stores a customised toolbar as a list of bar item ids, and an id it cannot
 * resolve while building the toolbar is parked in Toolbar#postload until whatever owns it
 * registers. update(true) drains that list, so a button the user has since moved or removed
 * keeps their arrangement; the insert below only runs the first time, before anything is
 * stored. The `true` matters: update() returns early without touching postload while the
 * toolbar is hidden, which it is whenever the plugin loads outside paint mode.
 */
function placeToggleInToolbar(toggle) {
	let bar = typeof Toolbars != 'undefined' && Toolbars.brush;
	if (!bar || !Array.isArray(bar.children)) return;
	try {
		bar.update(true);
	} catch (error) {
		// A stored position could not be restored, so fall through and place it by hand.
	}
	if (bar.children.includes(toggle)) return;
	let lock_alpha_at = bar.children.indexOf(BarItems.lock_alpha);
	bar.add(toggle, lock_alpha_at === -1 ? undefined : lock_alpha_at + 1);
}

// ---------------------------------------------------------------- plugin

BBPlugin.register(PLUGIN_ID, {
	title: 'UnLeaky Layers',
	icon: 'fas.fa-chess-board',
	author: 'quinten.bench',
	description: 'Makes Lock Alpha Channel respect every layer, so a pixel is only locked when it is transparent on all of them. Lets you paint on empty layers above your artwork with Lock Alpha enabled.',
	tags: ['Paint', 'Layers'],
	version: PLUGIN_VERSION,
	min_version: '4.10.0',
	variant: 'both',
	has_changelog: true,

	onload() {
		added_settings.push(new Setting('lla_enabled', {
			category: 'paint',
			value: true,
			name: 'Layer-Aware Alpha Lock',
			description: 'Lock Alpha Channel locks a pixel only when it is fully transparent on every layer, instead of only on the layer being painted.'
		}));
		added_settings.push(new Setting('lla_clamp', {
			category: 'paint',
			value: true,
			name: 'Clip painting to combined opacity',
			description: 'Limit painted pixels to the combined opacity of all layers, so strokes fade out along semi-transparent edges instead of ending in a hard edge. Turn off to paint at full opacity anywhere the texture is not completely transparent.'
		}));
		added_settings.push(new Setting('lla_allow_erase', {
			category: 'paint',
			value: true,
			name: 'Allow erasing over other layers',
			description: 'With Lock Alpha on, let the eraser work wherever another layer still covers the pixel, so erasing reveals what is underneath instead of punching a hole in the combined silhouette. Turn off to freeze alpha completely, like vanilla Lock Alpha.'
		}));
		added_settings.push(new Setting('lla_include_hidden', {
			category: 'paint',
			value: false,
			name: 'Count hidden layers',
			description: 'Also treat hidden layers and layers at 0% opacity as paintable area when deciding what Lock Alpha locks.'
		}));

		// A button beside Lock Alpha, so the mode can be flipped while painting instead of
		// through the settings dialog. linked_setting keeps the two in step both ways: a click
		// writes lla_enabled and saves it, and Blockbench's settings dialog writes back to any
		// Toggle pointing at the setting it just changed. Name and description have to be given
		// explicitly - a linked Toggle otherwise looks them up as translation keys, which a
		// plugin's own setting does not have.
		try {
			let ToggleClass = typeof Toggle != 'undefined' ? Toggle : (typeof Blockbench != 'undefined' && Blockbench.Toggle);
			if (ToggleClass) {
				toolbar_toggle = new ToggleClass('lla_toggle', {
					name: 'Layer-Aware Alpha Lock',
					description: 'Lock Alpha Channel counts a pixel as paintable when any layer is visible there, not just the layer being painted on. Off leaves Lock Alpha behaving like vanilla Blockbench.',
					icon: 'layers',
					category: 'paint',
					condition: () => Modes.paint,
					linked_setting: 'lla_enabled'
				});
				placeToggleInToolbar(toolbar_toggle);
			}
		} catch (error) {
			console.error(LOG, 'could not add the toolbar button', error);
		}

		originals.edit = Painter.edit;
		Painter.edit = function (texture, callback, options) {
			if (!shouldHandle(texture)) {
				return originals.edit.call(this, texture, callback, options);
			}
			let layer = texture.getActiveLayer && texture.getActiveLayer();
			if (!layer || !layer.ctx) {
				return originals.edit.call(this, texture, callback, options);
			}
			let mask = getMask(texture, layer);
			if (!mask) {
				return originals.edit.call(this, texture, callback, options);
			}
			let wrapped = function (canvas, current) {
				let previous_lock = Painter.lock_alpha;
				Painter.lock_alpha = false;
				try {
					runIntercepted(layer, mask, () => callback(canvas, current));
				} finally {
					Painter.lock_alpha = previous_lock;
				}
			};
			return originals.edit.call(this, texture, wrapped, options);
		};

		originals.startPaintTool = Painter.startPaintTool;
		Painter.startPaintTool = function () {
			stroke_masks.clear();
			baseline_cache = null;
			stroke_active = true;
			stroke_uses_clear = !!(typeof Toolbox !== 'undefined' && Toolbox.selected
				&& CLEAR_TOOLS.includes(Toolbox.selected.id));
			return originals.startPaintTool.apply(this, arguments);
		};

		originals.stopPaintTool = Painter.stopPaintTool;
		Painter.stopPaintTool = function () {
			try {
				return originals.stopPaintTool.apply(this, arguments);
			} finally {
				stroke_active = false;
				stroke_uses_clear = false;
				stroke_masks.clear();
				baseline_cache = null;
			}
		};

		try {
			let toggle = BarItems.lock_alpha;
			if (toggle) {
				original_lock_alpha_description = toggle.description;
				toggle.description = 'Only paint on pixels that are not transparent. Layer-aware: a pixel counts as paintable when any layer is visible there.';
			}
		} catch (error) {
			console.error(LOG, 'could not update the Lock Alpha tooltip', error);
		}
	},

	onunload() {
		if (toolbar_toggle) {
			// Takes it out of the toolbar and the keybind list as well.
			try { toolbar_toggle.delete(); } catch (error) { console.error(LOG, error); }
			toolbar_toggle = null;
		}

		if (originals.edit) Painter.edit = originals.edit;
		if (originals.startPaintTool) Painter.startPaintTool = originals.startPaintTool;
		if (originals.stopPaintTool) Painter.stopPaintTool = originals.stopPaintTool;
		originals = {};

		added_settings.forEach(setting => {
			try { setting.delete(); } catch (error) { console.error(LOG, error); }
		});
		added_settings = [];

		try {
			if (BarItems.lock_alpha && original_lock_alpha_description !== null) {
				BarItems.lock_alpha.description = original_lock_alpha_description;
			}
		} catch (error) { /* nothing to restore */ }
		original_lock_alpha_description = null;

		stroke_masks.clear();
		baseline_cache = null;
		intercepting.clear();
		stroke_active = false;
		stroke_uses_clear = false;
	}
});

})();
