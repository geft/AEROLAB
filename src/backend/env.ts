import path from 'node:path';
import { config } from 'dotenv';

/**
 * Load local secrets before any module reads `process.env`.
 *
 * `.env.local` is read first so it wins over `.env`; an explicitly exported
 * shell variable still wins over both. Tests do not read developer secrets.
 */
if (process.env.NODE_ENV !== 'test') {
  config({ path: path.resolve(process.cwd(), '.env.local') });
  config();
}
