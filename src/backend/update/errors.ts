import type { UpdateErrorCode } from '../../shared/update.js';

/** Failure that carries a stable `code` for the frontend dictionary lookup. */
export class UpdateServiceError extends Error {
  constructor(
    public readonly code: UpdateErrorCode,
    message: string,
    public readonly status: number = 502
  ) {
    super(message);
    this.name = 'UpdateServiceError';
  }
}
