#!/usr/bin/env node
/**
 * Cut a release of the UnLeaky Layers plugin.
 *
 *   npm run release -- <major|minor|patch> --title "Short release name" \
 *     --added "..." --changed "..." --fixed "..."
 *
 * Runs the checks, bumps the version in the plugin and package.json, inserts the
 * changelog.json entry, regenerates CHANGELOG.md, commits, tags and pushes.
 * Nothing is written until the checks pass, so a failing check leaves the tree alone.
 *
 * Flags:
 *   --dry-run              print what would happen, write nothing
 *   --no-push              commit and tag locally, do not push
 *   --date YYYY-MM-DD      override today's date on the entry
 *   --notes <file.json>    read categories from a file instead of flags
 *   --added/--changed/--fixed/--removed/--safeguards  repeatable, one line each
 */
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeMarkdown, semverDesc } from './changelog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_FILE = 'unleakylayers.js';
const PLUGIN = join(root, PLUGIN_FILE);
const REPO = 'Embody-Games/EGT-UnLeakyLayers';
const CATEGORY_ORDER = ['Added', 'Changed', 'Fixed', 'Removed', 'Safeguards'];

const die = message => { console.error(`release: ${message}`); process.exit(1); };
const run = (cmd, args, opts = {}) =>
	execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: 'pipe', ...opts }).trim();

// ------------------------------------------------------------------ arguments

const argv = process.argv.slice(2);
let bump = null, title = null, date = null, notesFile = null;
let dryRun = false, push = true;
const categories = new Map();

for (let i = 0; i < argv.length; i++) {
	const arg = argv[i];
	const next = () => {
		const value = argv[++i];
		if (value === undefined) die(`${arg} needs a value`);
		return value;
	};
	if (arg === 'major' || arg === 'minor' || arg === 'patch') bump = arg;
	else if (arg === '--title') title = next();
	else if (arg === '--date') date = next();
	else if (arg === '--notes') notesFile = next();
	else if (arg === '--dry-run') dryRun = true;
	else if (arg === '--no-push') push = false;
	else if (arg.startsWith('--')) {
		const name = arg.slice(2);
		const category = CATEGORY_ORDER.find(c => c.toLowerCase() === name.toLowerCase());
		if (!category) die(`unknown flag ${arg}`);
		if (!categories.has(category)) categories.set(category, []);
		categories.get(category).push(next());
	} else die(`unexpected argument ${arg}`);
}

if (!bump) die('say major, minor or patch');
if (!title) die('--title is required, it is the release name people see');

if (notesFile) {
	const notes = JSON.parse(readFileSync(join(root, notesFile), 'utf8'));
	for (const [name, lines] of Object.entries(notes)) {
		const category = CATEGORY_ORDER.find(c => c.toLowerCase() === name.toLowerCase());
		if (!category) die(`unknown category ${name} in ${notesFile}`);
		categories.set(category, [...(categories.get(category) || []), ...lines]);
	}
}
if (!categories.size) die('a release needs at least one --added/--changed/--fixed line');

// ------------------------------------------------------------------ checks first

console.log('running checks before touching anything...\n');
try {
	execFileSync(process.execPath, [join(root, 'scripts/check.mjs')], { cwd: root, stdio: 'inherit' });
} catch {
	die('checks failed, nothing was written');
}

// ------------------------------------------------------------------ new version

const source = readFileSync(PLUGIN, 'utf8');
const current = (source.match(/^const PLUGIN_VERSION = '([^']+)';/m) || [])[1];
if (!current) die('could not find PLUGIN_VERSION in the plugin');

const [major, minor, patch] = current.split('.').map(Number);
const version = bump === 'major' ? `${major + 1}.0.0`
	: bump === 'minor' ? `${major}.${minor + 1}.0`
	: `${major}.${minor}.${patch + 1}`;

const entryDate = date || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) die(`--date should be YYYY-MM-DD, got ${entryDate}`);

const changelog = JSON.parse(readFileSync(join(root, 'changelog.json'), 'utf8'));
if (changelog[version]) die(`changelog.json already has an entry for ${version}`);

const entry = {
	title,
	date: entryDate,
	author: 'quinten.bench',
	categories: CATEGORY_ORDER
		.filter(c => categories.has(c))
		.map(c => ({ title: c, list: categories.get(c) })),
};

const merged = {};
for (const key of [version, ...Object.keys(changelog)].sort(semverDesc)) {
	merged[key] = key === version ? entry : changelog[key];
}

console.log(`\n${current} -> ${version}  "${title}"  (${entryDate})`);
for (const category of entry.categories) {
	console.log(`  ${category.title}`);
	for (const line of category.list) console.log(`    - ${line}`);
}
console.log(`\ncommit: v${version}: ${title}`);
console.log(`tag:    v${version}`);

if (dryRun) {
	console.log('\n--dry-run, nothing written');
	process.exit(0);
}

// ------------------------------------------------------------------ write

writeFileSync(PLUGIN, source.replace(
	/^const PLUGIN_VERSION = '[^']+';/m,
	`const PLUGIN_VERSION = '${version}';`), 'utf8');

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

writeFileSync(join(root, 'changelog.json'), JSON.stringify(merged, null, 2) + '\n', 'utf8');
writeMarkdown(merged);

console.log('\nfiles written, re-running checks...\n');
try {
	execFileSync(process.execPath, [join(root, 'scripts/check.mjs')], { cwd: root, stdio: 'inherit' });
} catch {
	die('checks failed after writing, fix the tree before committing');
}

// ------------------------------------------------------------------ commit and tag

// The bridge mount denies unlink, so git can leave locks behind that block git on
// the Windows side. Clear them before and after.
const sweepLocks = () => {
	const gitDir = join(root, '.git');
	const walk = dir => {
		for (const item of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, item.name);
			if (item.isDirectory()) walk(path);
			else if (item.name.endsWith('.lock') || item.name.startsWith('tmp_obj_')) {
				try { rmSync(path); } catch { /* best effort */ }
			}
		}
	};
	try { walk(gitDir); } catch { /* best effort */ }
};

sweepLocks();
run('git', ['add', PLUGIN_FILE, 'package.json', 'changelog.json', 'CHANGELOG.md']);
run('git', ['commit', '-m', `v${version}: ${title}`]);
run('git', ['tag', '-a', `v${version}`, '-m', `v${version}: ${title}`]);
sweepLocks();
console.log(`\ncommitted and tagged v${version}`);

// ------------------------------------------------------------------ push

if (!push) {
	console.log('--no-push, so push it yourself:');
	console.log('  git push --follow-tags origin main');
	process.exit(0);
}

const tokenPath = join(root, '.git/egt-push-token');
if (!existsSync(tokenPath)) {
	console.log('\nno .git/egt-push-token on this clone, so nothing was pushed.');
	console.log('See RELEASING.md. Push it yourself with:');
	console.log('  git push --follow-tags origin main');
	process.exit(0);
}

const token = readFileSync(tokenPath, 'utf8').trim();
try {
	run('git', ['push', '--follow-tags',
		`https://x-access-token:${token}@github.com/${REPO}.git`, 'main'], { stdio: 'pipe' });
} catch (error) {
	const detail = String(error.stderr || error.message).replaceAll(token, '***');
	die(`push failed:\n${detail}`);
}
// Pushing to a URL does not move refs/remotes/origin/main, and without this the
// clone keeps looking "ahead" in GitHub Desktop.
try { run('git', ['fetch', 'origin']); } catch { /* not fatal */ }
sweepLocks();

console.log(`\npushed. The tag is what publishes the release:`);
console.log(`  https://github.com/${REPO}/actions`);
console.log(`  https://github.com/${REPO}/releases/tag/v${version}`);
