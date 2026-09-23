import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDatabaseConfigPath, getDatabasePath, saveDatabasePath } from '../../src/backend/db/path.js';

describe('database path selection', () => {
  const original = {
    appData: process.env.APPDATA,
    databasePath: process.env.DATABASE_PATH,
    nodeEnv: process.env.NODE_ENV,
  };
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-db-path-'));
    process.env.APPDATA = root;
    delete process.env.DATABASE_PATH;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    for (const [key, value] of Object.entries({
      APPDATA: original.appData,
      DATABASE_PATH: original.databasePath,
      NODE_ENV: original.nodeEnv,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps development and desktop selections independent', () => {
    const selected = path.join(root, 'my-runs.db');
    const config = getDatabaseConfigPath();
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(config, JSON.stringify({ databasePath: selected }));

    expect(getDatabasePath()).toBe(selected);
    process.env.NODE_ENV = 'production';
    expect(getDatabasePath()).toBe(path.join(root, 'aerolab', 'runs.db'));
    saveDatabasePath(selected);
    expect(getDatabasePath()).toBe(selected);
    expect(getDatabaseConfigPath()).not.toBe(config);
  });

  it('lets DATABASE_PATH override the shared configuration', () => {
    fs.mkdirSync(path.dirname(getDatabaseConfigPath()), { recursive: true });
    fs.writeFileSync(getDatabaseConfigPath(), JSON.stringify({ databasePath: path.join(root, 'configured.db') }));
    process.env.DATABASE_PATH = path.join(root, 'override.db');
    expect(getDatabasePath()).toBe(path.join(root, 'override.db'));
    process.env.DATABASE_PATH = ':memory:';
    expect(getDatabasePath()).toBe(':memory:');
  });

  it('keeps existing development and packaged defaults', () => {
    expect(getDatabasePath()).toBe(path.resolve(process.cwd(), 'data', 'runs.db'));
    process.env.NODE_ENV = 'production';
    expect(getDatabasePath()).toBe(path.join(root, 'aerolab', 'runs.db'));
  });

  it('ignores user configuration in automated tests', () => {
    fs.mkdirSync(path.dirname(getDatabaseConfigPath()), { recursive: true });
    fs.writeFileSync(getDatabaseConfigPath(), JSON.stringify({ databasePath: path.join(root, 'personal.db') }));
    process.env.NODE_ENV = 'test';
    expect(getDatabasePath()).toBe(path.resolve(process.cwd(), 'data', 'runs.db'));
  });

  it('rejects a relative configured path', () => {
    fs.mkdirSync(path.dirname(getDatabaseConfigPath()), { recursive: true });
    fs.writeFileSync(getDatabaseConfigPath(), JSON.stringify({ databasePath: 'runs.db' }));
    expect(() => getDatabasePath()).toThrow('expected an absolute path');
  });

  it('replaces this build selection without leaving a temporary config', () => {
    const first = path.join(root, 'first.db');
    const second = path.join(root, 'second.db');
    saveDatabasePath(first);
    saveDatabasePath(second);
    expect(getDatabasePath()).toBe(second);
    expect(fs.readdirSync(path.dirname(getDatabaseConfigPath()))).toEqual(['development-database-location.json']);
  });
});
