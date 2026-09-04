#!/usr/bin/env node
/**
 * changelog.json is the single source. Blockbench's Changelog tab, CHANGELOG.md and
 * the GitHub release body all render from it, so the text is never written twice.
 *
 *   node scripts/changelog.mjs            regenerate CHANGELOG.md
 *   node scripts/changelog.mjs 1.1.0      print one version's notes (release body)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = () => JSON.parse(readFileSync(join(root, 'changelog.json'), 'utf8'));

export const semverDesc = (a, b) => {
	const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
	return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2];
};

export function renderOne(version, entry) {
	return [
		...entry.categories.flatMap(category => [
			`### ${category.title}`,
			'',
			...category.list.map(line => `- ${line}`),
			'',
		]),
	].join('\n').trimEnd();
}

export function renderAll(changelog = load()) {
	const body = Object.keys(changelog).sort(semverDesc).flatMap(version => {
		const entry = changelog[version];
		return [`## v${version} - ${entry.title}`, '', `_${entry.date}_`, '', renderOne(version, entry), ''];
	});
	return [
		'# Changelog',
		'',
		'Generated from `changelog.json` by `scripts/changelog.mjs`. Edit that file, not this one.',
		'',
		...body,
	].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function writeMarkdown(changelog) {
	writeFileSync(join(root, 'CHANGELOG.md'), renderAll(changelog), 'utf8');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const version = process.argv[2];
	if (version) {
		const changelog = load();
		if (!changelog[version]) {
			console.error(`no changelog.json entry for ${version}`);
			process.exit(1);
		}
		process.stdout.write(renderOne(version, changelog[version]) + '\n');
	} else {
		writeMarkdown();
		console.log('CHANGELOG.md regenerated');
	}
}
