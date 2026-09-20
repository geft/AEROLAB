#!/usr/bin/env node
/**
 * Reports dictionary keys declared in src/frontend/i18n/types.ts that are never
 * referenced as `t.<path>` anywhere in src/ (outside the i18n folder itself).
 *
 * Usage: node scripts/find-unused-i18n-keys.mjs
 * Exit code 1 when dead keys are found, so it can run in CI.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const typesFile = path.join(rootDir, 'src', 'frontend', 'i18n', 'types.ts');

// Keys whose values are dynamic lookup maps (indexed by a runtime string) rather
// than accessed as literal `t.ns.key` paths.
const DYNAMIC_MAP_KEY = /Record<string,\s*string>/;

const typeSource = fs.readFileSync(typesFile, 'utf8');
const lines = typeSource.split('\n');

// Only the declared interface describes dictionary keys. The file also contains
// const objects (LOCALES, LANGUAGE_LABELS) whose properties are not dictionary
// entries, so restrict parsing to the Translations interface body.
const interfaceStart = lines.findIndex(l => /export interface Translations\s*\{/.test(l));
if (interfaceStart === -1) {
  console.error('Could not locate the Translations interface in types.ts');
  process.exit(2);
}
let interfaceEnd = lines.length;
let depth = 0;
for (let i = interfaceStart; i < lines.length; i++) {
  depth += (lines[i].match(/\{/g) || []).length;
  depth -= (lines[i].match(/\}/g) || []).length;
  if (i > interfaceStart && depth === 0) {
    interfaceEnd = i;
    break;
  }
}

/** @type {{ path: string, line: number, dynamic: boolean }[]} */
const entries = [];
/** @type {{ name: string, indent: number }[]} */
const stack = [];

for (let i = interfaceStart + 1; i < interfaceEnd; i++) {
  const line = lines[i];
  const open = /^(\s*)([A-Za-z_$][\w$]*):\s*\{\s*$/.exec(line);
  if (open) {
    const indent = open[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    stack.push({ name: open[2], indent });
    continue;
  }

  const prop = /^(\s*)([A-Za-z_$][\w$]*):\s*(.+?);?\s*$/.exec(line);
  if (!prop) continue;

  const indent = prop[1].length;
  const name = prop[2];
  const type = prop[3];
  while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
  const nsPath = stack.map(s => s.name).join('.');
  entries.push({ path: nsPath ? `${nsPath}.${name}` : name, line: i + 1, dynamic: DYNAMIC_MAP_KEY.test(type) });
}

// Collect all code (excluding the i18n dictionaries) to search against.
function collectFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

// Only the dictionary definition files are excluded. Consumers such as
// LanguageContext.tsx / coachTranslator.ts live in the same folder and must be
// searched, otherwise their keys look unused.
const DICTIONARY_FILES = ['en.ts', 'zh.ts', 'types.ts'];

const codeFiles = collectFiles(path.join(rootDir, 'src'))
  .filter(f => {
    const dir = path.dirname(f);
    const isI18n = path.basename(dir) === 'i18n';
    return !(isI18n && DICTIONARY_FILES.includes(path.basename(f)));
  });

const code = codeFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');

const unused = [];
const dynamicNamespaceCache = new Map();

for (const entry of entries) {
  // Dynamic maps are consumed via a runtime index, e.g. `t.ns.mapName[label]`.
  if (entry.dynamic) continue;

  const segments = entry.path.split('.');
  const parent = segments.slice(0, -1).join('.');
  const parentLeaf = segments.length > 1 ? segments[segments.length - 2] : null;

  // A namespace indexed at runtime (e.g. `t.runTypes[run.run_type]`, or
  // `(t.browse.defaultTitles as any)[key]`) can never be resolved statically, so
  // treat every key under it as used.
  if (parentLeaf) {
    let indexed = dynamicNamespaceCache.get(parentLeaf);
    if (indexed === undefined) {
      indexed = new RegExp(`\\.${parentLeaf}(?:\\s+as\\s+[\\w<>\\[\\],. ]+)?\\s*\\)?\\s*\\[`).test(code);
      dynamicNamespaceCache.set(parentLeaf, indexed);
    }
    if (indexed) continue;
  }

  const exactPattern = new RegExp(`\\.${entry.path.replace(/\./g, '\\.')}\\b`);
  const leafPattern = new RegExp(`\\.${segments[segments.length - 1]}\\b`);
  if (!exactPattern.test(code) && !leafPattern.test(code)) {
    unused.push(entry);
  }
}

if (unused.length === 0) {
  console.log(`OK — all ${entries.length} dictionary keys are referenced.`);
  process.exit(0);
}

// --json writes machine-readable output to a file for the pruning helper.
// (Written by the script itself so shell redirection cannot change the encoding.)
const jsonFlag = process.argv.indexOf('--json');
if (jsonFlag !== -1) {
  const target = process.argv[jsonFlag + 1];
  const payload = JSON.stringify(unused.map(u => u.path), null, 2);
  if (target && !target.startsWith('--')) {
    fs.writeFileSync(path.resolve(rootDir, target), payload, 'utf8');
    console.log(`Wrote ${unused.length} unused key path(s) to ${target}`);
  } else {
    console.log(payload);
  }
  process.exit(0);
}

console.log(`Found ${unused.length} unused dictionary key(s):\n`);
for (const entry of unused) {
  console.log(`  types.ts:${String(entry.line).padStart(3)}  ${entry.path}`);
}
process.exit(1);
