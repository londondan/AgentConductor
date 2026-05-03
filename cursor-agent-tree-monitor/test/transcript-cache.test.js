import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TranscriptCache } from "../src/transcript-cache.js";

test("returns cached JSONL lines when file metadata is unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-cache-"));
  const file = join(dir, "session.jsonl");
  await writeFile(file, `${JSON.stringify({ n: 1 })}\n`);
  const cache = new TranscriptCache();

  const first = await cache.readJsonl(file);
  const second = await cache.readJsonl(file);

  assert.equal(first, second);
  assert.equal(cache.stats().hits, 1);
});

test("parses appended JSONL without discarding previous cached lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-cache-"));
  const file = join(dir, "session.jsonl");
  await writeFile(file, `${JSON.stringify({ n: 1 })}\n`);
  const cache = new TranscriptCache();

  await cache.readJsonl(file);
  await writeFile(file, `${JSON.stringify({ n: 1 })}\n${JSON.stringify({ n: 2 })}\n`);
  const lines = await cache.readJsonl(file);

  assert.deepEqual(lines.map((line) => line.n), [1, 2]);
  assert.equal(cache.stats().incrementalReads, 1);
});

test("fully reparses when a JSONL file shrinks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-cache-"));
  const file = join(dir, "session.jsonl");
  await writeFile(file, `${JSON.stringify({ n: 1 })}\n${JSON.stringify({ n: 2 })}\n`);
  const cache = new TranscriptCache();

  await cache.readJsonl(file);
  await writeFile(file, `${JSON.stringify({ n: 3 })}\n`);
  const lines = await cache.readJsonl(file);

  assert.deepEqual(lines.map((line) => line.n), [3]);
  assert.equal(cache.stats().fullReads, 2);
});

test("does not throw on malformed trailing live JSONL fragments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-cache-"));
  const file = join(dir, "session.jsonl");
  await writeFile(file, `${JSON.stringify({ n: 1 })}\nearly. I know this line is not complete JSON`);
  const cache = new TranscriptCache();

  const lines = await cache.readJsonl(file);

  assert.deepEqual(lines.map((line) => line.n), [1]);
});

test("skips malformed complete non-JSON transcript lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-cache-"));
  const file = join(dir, "session.jsonl");
  await writeFile(file, `${JSON.stringify({ n: 1 })}\n/superpowers:using-superpowers\n${JSON.stringify({ n: 2 })}\n`);
  const cache = new TranscriptCache();

  const lines = await cache.readJsonl(file);

  assert.deepEqual(lines.map((line) => line.n), [1, 2]);
});

test("combines a cached trailing fragment with later appended JSONL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-tree-cache-"));
  const file = join(dir, "session.jsonl");
  await writeFile(file, `${JSON.stringify({ n: 1 })}\n{"n":`);
  const cache = new TranscriptCache();

  await cache.readJsonl(file);
  await writeFile(file, `${JSON.stringify({ n: 1 })}\n{"n":2}\n`);
  const lines = await cache.readJsonl(file);

  assert.deepEqual(lines.map((line) => line.n), [1, 2]);
  assert.equal(cache.stats().incrementalReads, 1);
});
