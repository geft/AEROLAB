import fs from 'fs';
import path from 'path';
import { getDatabaseConfigPath, getDatabasePath, saveDatabasePath } from '../src/backend/db/path.js';

const requested = process.argv[2];
const configPath = getDatabaseConfigPath();

if (!requested) {
  console.log(`Database: ${getDatabasePath()}`);
  console.log(`Location setting: ${configPath}`);
  process.exit(0);
}

if (!path.isAbsolute(requested)) {
  console.error('Provide an absolute path to an existing SQLite database.');
  process.exit(1);
}

const databasePath = path.normalize(requested);
if (!fs.existsSync(databasePath) || !fs.statSync(databasePath).isFile()) {
  console.error(`Database file does not exist: ${databasePath}`);
  process.exit(1);
}

const header = Buffer.alloc(16);
const fd = fs.openSync(databasePath, 'r');
try {
  fs.readSync(fd, header, 0, header.length, 0);
} finally {
  fs.closeSync(fd);
}
if (header.toString('latin1') !== 'SQLite format 3\0') {
  console.error(`File is not a SQLite database: ${databasePath}`);
  process.exit(1);
}

saveDatabasePath(databasePath);
console.log(`Database configured: ${databasePath}`);
console.log(`Configuration saved: ${configPath}`);
console.log('Restart this build to use the selected database.');
