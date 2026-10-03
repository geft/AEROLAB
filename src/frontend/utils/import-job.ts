import { startImportJob, stageImportJob, finishImportJob, getImportJob, cancelImportJob } from '../api/client.js';
import { IMPORT_BATCH_BYTES, IMPORT_BATCH_SIZE } from '../../shared/import-batch.js';
import type { ImportJobStatus, ImportJobResult } from '../../shared/import-job.js';

/** Overall work estimate; phase counters remain separate from the bar. */
export function importJobPercent(status: ImportJobStatus): number {
  if (status.phase === 'complete') return 100;
  if (status.phase === 'failed') return 0;
  const ranges = { uploading: [0, 20], decoding: [20, 45], importing: [45, 70], reanalysing: [70, 99] };
  const [start, end] = ranges[status.phase];
  const fraction = Math.max(0, Math.min(1, status.completed / Math.max(1, status.total)));
  return Math.floor(start + (end - start) * fraction);
}

export async function encodeUploadFile(file: File): Promise<{ filename: string; content: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return { filename: file.name, content: btoa(binary) };
}

/** Stage bounded requests, then run the entire history update off the server thread. */
export async function uploadImportJob(files: File[], force: boolean, onProgress: (status: ImportJobStatus) => void): Promise<ImportJobResult[]> {
  const job = await startImportJob(files.length, force);
  const results: ImportJobResult[] = new Array(files.length);
  const stagedIndices: number[] = [];
  let started = false;
  try {
    for (let index = 0; index < files.length;) {
      const batch: File[] = [];
      let bytes = 0;
      while (index + batch.length < files.length && batch.length < IMPORT_BATCH_SIZE) {
        const file = files[index + batch.length];
        if (batch.length && bytes + file.size > IMPORT_BATCH_BYTES) break;
        batch.push(file);
        bytes += file.size;
      }
      const prepared = await Promise.allSettled(batch.map(encodeUploadFile));
      const payload: Array<{ filename: string; content: string }> = [];
      prepared.forEach((item, offset) => {
        if (item.status === 'fulfilled') { payload.push(item.value); stagedIndices.push(index + offset); }
        else results[index + offset] = { status: 'error' };
      });
      if (payload.length) onProgress(await stageImportJob(job.jobId, payload));
      index += batch.length;
    }
    if (!stagedIndices.length) { await cancelImportJob(job.jobId); return results; }
    let status = await finishImportJob(job.jobId, stagedIndices.length);
    started = true;
    for (;;) {
      onProgress(status);
      if (status.phase === 'failed') throw new Error(status.error);
      if (status.phase === 'complete') {
        if (!status.results || status.results.length !== stagedIndices.length) throw new Error('Invalid import results');
        stagedIndices.forEach((index, offset) => { results[index] = status.results![offset]; });
        return results;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      status = await getImportJob(job.jobId);
    }
  } catch (error) {
    if (!started) await cancelImportJob(job.jobId).catch(() => {});
    throw error;
  }
}
