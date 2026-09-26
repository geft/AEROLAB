export function getLinkedVercelProjectId(projectLinkPath: string): string;
export function getVercelDeployArgs(deploymentPath: string, projectId: string): string[];
export function getVercelCliInvocation(args: string[]): { command: string; args: string[] };
