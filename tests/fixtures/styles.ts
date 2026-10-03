import fs from 'node:fs';
import path from 'node:path';

/** Read the stylesheet as the browser does, including ordered local imports. */
export function readStylesheet(file = path.resolve('src/frontend/styles/index.css')): string {
  return fs.readFileSync(file, 'utf8').replace(/@import\s+["'](\.\/?[^"']+)["'];/g,
    (_match, imported: string) => readStylesheet(path.resolve(path.dirname(file), imported)));
}
