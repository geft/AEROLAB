import path from 'node:path';

/** Architectural boundaries apply equally to runtime and type-only imports. */
export const boundaryRules = {
  'dependency-boundaries': {
    meta: {
      type: 'problem', schema: [],
      messages: { boundary: 'Dependency {{source}} crosses the {{boundary}} boundary.' }
    },
    create(context) {
      const filename = context.filename.replaceAll('\\', '/');
      function check(node, source) {
        if (typeof source !== 'string') return;
        const target = source.startsWith('.')
          ? path.resolve(path.dirname(context.filename), source).replaceAll('\\', '/') : source;
        let boundary;
        if (filename.includes('/src/backend/domain/') && (
          /\/src\/backend\/(db|routes|services|jobs|application)\//.test(target)
          || /^(better-sqlite3|sqlite3|express|axios|undici|node-fetch|https?|node:https?|node:worker_threads)(\/|$)/.test(target)
        )) boundary = 'domain';
        if (filename.includes('/src/shared/') && /\/src\/(backend|frontend)\//.test(target)) boundary = 'shared';
        const child = /\/src\/frontend\/components\/[^/]+\//.test(filename)
          || (/\/src\/frontend\/features\//.test(filename) && !/\/use[^/]+\.[cm]?[jt]sx?$/.test(filename));
        if (child && /\/(?:[^/]*(?:View|Page)|use[^/]*Controller|useBrowseSelection|useActivityDetail|usePeriodProgress)\.[cm]?[jt]sx?$/.test(target)) {
          boundary = 'feature child';
        }
        if (boundary) context.report({ node, messageId: 'boundary', data: { source, boundary } });
      }
      return {
        ImportDeclaration: node => check(node, node.source.value),
        ExportNamedDeclaration: node => check(node, node.source?.value),
        ExportAllDeclaration: node => check(node, node.source.value),
        ImportExpression: node => check(node, node.source.value),
        TSImportType: node => check(node, node.source?.value),
        CallExpression(node) {
          if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node, node.arguments[0]?.value);
        }
      };
    }
  }
};
