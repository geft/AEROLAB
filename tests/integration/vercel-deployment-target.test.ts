import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getLinkedVercelProjectId, getVercelDeployArgs } from '../../scripts/vercel-cli.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('Vercel project deployment target', () => {
  it('deploys the artifact directory to the linked project ID regardless of either project name', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-vercel-target-'));
    temporaryDirectories.push(directory);
    const projectLinkDirectory = path.join(directory, '.vercel');
    fs.mkdirSync(projectLinkDirectory);
    const projectLinkPath = path.join(projectLinkDirectory, 'project.json');
    fs.writeFileSync(projectLinkPath, JSON.stringify({ projectId: 'prj_aerolab', orgId: 'team_runner', projectName: 'aerolab-snapshot' }));

    const projectId = getLinkedVercelProjectId(projectLinkPath);
    const deployArgs = getVercelDeployArgs(path.join(directory, 'dist-snapshot'), projectId);

    expect(projectId).toBe('prj_aerolab');
    expect(deployArgs).toContain(path.join(directory, 'dist-snapshot'));
    expect(deployArgs.slice(-2)).toEqual(['--project', 'prj_aerolab']);

    // The artifact folder name must never silently become the Vercel project.
    fs.writeFileSync(projectLinkPath, JSON.stringify({ projectId: 'prj_other', orgId: 'team_runner', projectName: 'dist-snapshot' }));
    expect(getLinkedVercelProjectId(projectLinkPath)).toBe('prj_other');
  });

  it('rejects a missing project ID instead of allowing Vercel to create an unintended project', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-vercel-target-'));
    temporaryDirectories.push(directory);
    const projectLinkPath = path.join(directory, 'project.json');
    fs.writeFileSync(projectLinkPath, JSON.stringify({ orgId: 'team_runner', projectName: 'dist-snapshot' }));

    expect(() => getLinkedVercelProjectId(projectLinkPath)).toThrow('missing its project or organization ID');
    expect(() => getVercelDeployArgs(directory, '')).toThrow('linked Vercel project ID is required');
  });
});
