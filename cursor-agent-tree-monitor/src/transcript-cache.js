import { open, readFile, stat } from "node:fs/promises";

export class TranscriptCache {
  constructor() {
    this.entries = new Map();
    this.hitCount = 0;
    this.fullReadCount = 0;
    this.incrementalReadCount = 0;
  }

  async readJsonl(path) {
    const fileStats = await stat(path);
    const cached = this.entries.get(path);

    if (cached && cached.mtimeMs === fileStats.mtimeMs && cached.size === fileStats.size) {
      this.hitCount += 1;
      return cached.lines;
    }

    if (cached && fileStats.size > cached.size) {
      const appended = await readRange(path, cached.size, fileStats.size - cached.size);
      const parsed = parseJsonl(`${cached.remainder ?? ""}${appended}`);
      const lines = [...cached.lines, ...parsed.lines];
      this.entries.set(path, { mtimeMs: fileStats.mtimeMs, size: fileStats.size, lines, remainder: parsed.remainder });
      this.incrementalReadCount += 1;
      return lines;
    }

    const contents = await readFile(path, "utf8");
    const parsed = parseJsonl(contents);
    const lines = parsed.lines;
    this.entries.set(path, { mtimeMs: fileStats.mtimeMs, size: fileStats.size, lines, remainder: parsed.remainder });
    this.fullReadCount += 1;
    return lines;
  }

  stats() {
    return {
      hits: this.hitCount,
      fullReads: this.fullReadCount,
      incrementalReads: this.incrementalReadCount,
      entries: this.entries.size,
    };
  }
}

function parseJsonl(contents) {
  const records = contents.split(/\r?\n/);
  const lines = [];
  let remainder = "";

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;

    try {
      lines.push(JSON.parse(record));
    } catch (error) {
      const isTrailingRecord = index === records.length - 1 && !contents.endsWith("\n") && !contents.endsWith("\r\n");
      if (isTrailingRecord) {
        remainder = record;
        continue;
      }
      continue;
    }
  }

  return { lines, remainder };
}

async function readRange(path, start, length) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
