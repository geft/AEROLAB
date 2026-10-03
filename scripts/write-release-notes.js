import fs from 'node:fs';
import path from 'node:path';

const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const entry = /^## (?!Release notes workflow)([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(changelog);
if (!entry || !entry[2].trim()) throw new Error('CHANGELOG.md must contain a non-empty latest release entry.');
const destination = process.argv[2] || 'release/release-notes.md';
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, `${entry[2].trim()}\n`, 'utf8');
console.log(`Release notes written: ${destination}`);
