import fs from 'node:fs';
import path from 'node:path';

export function getLinkedVercelProjectId(projectLinkPath) {
  const link = JSON.parse(fs.readFileSync(projectLinkPath, 'utf8'));
  if (typeof link.projectId !== 'string' || !link.projectId || typeof link.orgId !== 'string' || !link.orgId) {
    throw new Error('The local Vercel project link is missing its project or organization ID.');
  }
  return link.projectId;
}

export function getVercelDeployArgs(deploymentPath, projectId) {
  if (!projectId) throw new Error('A linked Vercel project ID is required for deployment.');
  return ['deploy', deploymentPath, '--prod', '--yes', '--project', projectId];
}

export function getVercelCliInvocation(args) {
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(npmCli)) {
    return {
      command: process.execPath,
      args: [npmCli, 'exec', '--yes', '--package=vercel', '--', 'vercel', ...args]
    };
  }

  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--yes', 'vercel', ...args]
  };
}
