import zlib from 'zlib';

export interface ExtractedZipEntry {
  filename: string;
  buffer: Buffer;
}

/**
 * Lightweight, zero-dependency ZIP archive parser using Node.js built-in zlib.inflateRawSync.
 * Supports both Deflate (method 8) and Stored (method 0) ZIP entries.
 */
export function extractZipEntries(zipBuffer: Buffer): ExtractedZipEntry[] {
  const entries: ExtractedZipEntry[] = [];
  let offset = 0;
  const len = zipBuffer.length;

  while (offset + 30 <= len) {
    const signature = zipBuffer.readUInt32LE(offset);
    // 0x04034b50 is the local file header signature ("PK\x03\x04")
    if (signature !== 0x04034b50) {
      break; // Reached Central Directory or end of entries
    }

    const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const fileNameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraFieldLen = zipBuffer.readUInt16LE(offset + 28);

    const headerEnd = offset + 30;
    const fileName = zipBuffer.toString('utf8', headerEnd, headerEnd + fileNameLen);
    const dataStart = headerEnd + fileNameLen + extraFieldLen;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > len) {
      break; // Malformed entry
    }

    const compressedSlice = zipBuffer.subarray(dataStart, dataEnd);

    // Skip directory entries
    if (!fileName.endsWith('/') && !fileName.endsWith('\\')) {
      try {
        let fileData: Buffer;
        if (compressionMethod === 8) {
          fileData = zlib.inflateRawSync(compressedSlice);
        } else if (compressionMethod === 0) {
          fileData = Buffer.from(compressedSlice);
        } else {
          // Unsupported compression method, skip
          fileData = Buffer.alloc(0);
        }

        if (fileData.length > 0) {
          entries.push({
            filename: fileName.replace(/\\/g, '/').split('/').pop() || fileName,
            buffer: fileData
          });
        }
      } catch {
        // Corrupted single entry, skip and continue to next
      }
    }

    // Advance to next entry
    offset = dataEnd;
  }

  return entries;
}

export function isZipBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 4) return false;
  return buf.readUInt32LE(0) === 0x04034b50;
}
