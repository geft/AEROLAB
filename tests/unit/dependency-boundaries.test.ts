import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();
async function boundaries(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter(m => m.ruleId === 'architecture/dependency-boundaries');
}
describe('dependency boundaries including type-only imports', () => {
  it.each([
    ['src/backend/domain/fixture.ts', "import type { Row } from '../db/rows.js';"],
    ['src/backend/domain/fixture.ts', "export * from 'better-sqlite3';"],
    ['src/backend/domain/fixture.ts', "const load = () => import('../jobs/maintenance-worker.js');"],
    ['src/backend/domain/fixture.ts', "type Row = import('../db/rows.js').Row;"],
    ['src/shared/fixture.ts', "import type { Record } from '../backend/domain/telemetry.js';"],
    ['src/frontend/components/browse/fixture.tsx', "import type { Props } from '../BrowseView.js';"],
    ['src/frontend/features/browse/fixture.ts', "import type { State } from './useActivityDetail.js';"]
  ])('rejects %s: %s', async (file, code) => {
    expect(await boundaries(code, file)).toHaveLength(1);
  });
  it.each([
    ['src/backend/domain/fixture.ts', "import type { Message } from '../../shared/coaching.js';"],
    ['src/shared/fixture.ts', "export * from './activity.js';"],
    ['src/frontend/components/browse/fixture.tsx', "import type { Activity } from '../../types/activity.js';"],
    ['src/frontend/components/BrowseView.tsx', "import { useActivityDetail } from '../features/browse/useActivityDetail.js';"]
  ])('allows %s: %s', async (file, code) => {
    expect(await boundaries(code, file)).toHaveLength(0);
  });
});
