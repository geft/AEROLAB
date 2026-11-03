import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ReleaseNotesEntry {
  version: string;
  body: string;
}

/**
 * Split the changelog into one entry per `## ` heading.
 *
 * A heading may carry a date or a title after its version, so only the first
 * token is compared.
 */
export function parseChangelog(changelog: string): ReleaseNotesEntry[] {
  return [...changelog.matchAll(/^## (?!Release notes workflow)([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)]
    .map(match => ({
      version: match[1].trim().split(/\s+/)[0].replace(/^v/, ''),
      body: match[2].trim()
    }));
}

/**
 * The entry for this release.
 *
 * This used to take the first entry in the file, which silently published an
 * older release's notes whenever nobody prepended a new one: v1.5.6 and v1.5.7
 * both shipped the v1.5.5 notes. Selecting by version makes a missing entry a
 * build failure instead of a wrong description.
 */
export function selectReleaseNotes(changelog: string, version: string): string {
  const wanted = version.trim().replace(/^v/, '');
  if (!wanted) throw new Error('No release version given: set RELEASE_VERSION to the version being built.');
  const entries = parseChangelog(changelog);
  if (!entries.length) throw new Error('CHANGELOG.md must contain a release entry.');
  const entry = entries.find(candidate => candidate.version === wanted);
  if (!entry) {
    throw new Error(`CHANGELOG.md has no entry for ${wanted}. Add a "## ${wanted} — <date>" section: release notes come from the matching version, not the newest entry.`);
  }
  if (!entry.body) throw new Error(`CHANGELOG.md entry for ${wanted} is empty.`);
  return entry.body;
}

function main(): void {
  const version = process.env.RELEASE_VERSION?.trim() ?? '';
  const notes = selectReleaseNotes(fs.readFileSync('CHANGELOG.md', 'utf8'), version);
  const destination = process.argv[2] ?? 'release/release-notes.md';
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${notes}\n`, 'utf8');
  console.log(`Release notes for ${version} written: ${destination}`);
}

const invokedDirectly = process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
