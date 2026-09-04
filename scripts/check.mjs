#!/usr/bin/env node
/**
 * The gate that runs before every release. There is no build step for this
 * plugin, so these checks are what stands between a bad edit and a tag.
 *
 *   node scripts/check.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(root, 'layered_lock_alpha.js');

let failures = [];
const check = (name, fn) => {
	try {
		fn();
		console.log(`  ok    ${name}`);
	} catch (error) {
		failures.push(name);
		console.log(`  FAIL  ${name}\n        ${error.message}`);
	}
};
const assert = (cond, message) => { if (!cond) throw new Error(message); };

const source = readFileSync(PLUGIN, 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const changelog = JSON.parse(readFileSync(join(root, 'changelog.json'), 'utf8'));

console.log('checks:');

check('plugin parses', () => {
	execFileSync(process.execPath, ['--check', PLUGIN], { stdio: 'pipe' });
});

check('plugin declares exactly one PLUGIN_VERSION', () => {
	const hits = source.match(/^const PLUGIN_VERSION = '([^']+)';/gm) || [];
	assert(hits.length === 1, `found ${hits.length} declarations, expected 1`);
});

const version = (source.match(/^const PLUGIN_VERSION = '([^']+)';/m) || [])[1];

check('version is semver', () => {
	assert(/^\d+\.\d+\.\d+$/.test(version || ''), `PLUGIN_VERSION is ${version}`);
});

check('register() uses the constant, not a literal', () => {
	assert(/\bversion: PLUGIN_VERSION,/.test(source), 'BBPlugin.register should read version: PLUGIN_VERSION');
	assert(!/\bversion: '\d+\.\d+\.\d+'/.test(source), 'a hardcoded version string is still in the plugin');
});

check('package.json version matches the plugin', () => {
	assert(pkg.version === version, `package.json says ${pkg.version}, plugin says ${version}`);
});

check('changelog has an entry for this version', () => {
	const entry = changelog[version];
	assert(entry, `no changelog.json entry for ${version}`);
	assert(entry.title, 'entry has no title');
	assert(/^\d{4}-\d{2}-\d{2}$/.test(entry.date || ''), 'entry date should be YYYY-MM-DD');
	assert(Array.isArray(entry.categories) && entry.categories.length, 'entry has no categories');
	for (const category of entry.categories) {
		assert(category.title, 'a category has no title');
		assert(Array.isArray(category.list) && category.list.length, `category ${category.title} is empty`);
	}
});

check('changelog versions are all semver and unique', () => {
	const keys = Object.keys(changelog);
	assert(keys.length === new Set(keys).size, 'duplicate versions');
	for (const key of keys) assert(/^\d+\.\d+\.\d+$/.test(key), `${key} is not semver`);
});

check('plugin registers the expected id', () => {
	assert(/BBPlugin\.register\(PLUGIN_ID,/.test(source), 'BBPlugin.register(PLUGIN_ID, ...) not found');
	assert(/const PLUGIN_ID = 'layered_lock_alpha';/.test(source), 'PLUGIN_ID changed');
});

check('onload has a matching onunload', () => {
	assert(/\bonload\(\)/.test(source) && /\bonunload\(\)/.test(source), 'a plugin without onunload cannot be disabled cleanly');
});

check('no credential in the tracked tree', () => {
	let tracked = [];
	try {
		tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
	} catch { /* not a repo yet */ }
	const secret = /(github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,})/;
	for (const file of tracked) {
		if (!existsSync(join(root, file))) continue;
		const body = readFileSync(join(root, file), 'utf8');
		assert(!secret.test(body), `${file} contains something that looks like a GitHub token`);
	}
});

console.log('');
if (failures.length) {
	console.error(`${failures.length} check(s) failed: ${failures.join(', ')}`);
	process.exit(1);
}
console.log(`all checks passed (v${version})`);
