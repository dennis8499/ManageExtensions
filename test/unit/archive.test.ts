import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractReleaseArchive, safeArchivePath, validateArchiveEntry } from '../../src/archive/secureArchive';
import { makeSkillZip, makeZip } from '../helpers/zip';

test('accepts package members and strips only the expected archive root', () => {
  assert.equal(safeArchivePath('merge-reviewer/SKILL.md', 'merge-reviewer'), 'SKILL.md');
  assert.equal(safeArchivePath('wiki-codex-1.2.3/.agents/skills/x/SKILL.md', 'wiki-codex-1.2.3'), '.agents/skills/x/SKILL.md');
});

test('rejects absolute paths, traversal, duplicate separators, and paths outside the package root', () => {
  for (const value of ['../outside.txt', 'merge-reviewer/../../outside', '/root.txt', 'C:/outside', 'merge-reviewer/../outside', 'elsewhere/SKILL.md']) {
    assert.throws(() => safeArchivePath(value, 'merge-reviewer'));
  }
});

test('rejects symlinks, encrypted entries, and unbounded entries', () => {
  assert.throws(() => validateArchiveEntry({ fileName: 'merge-reviewer/link', externalFileAttributes: 0xa1ff0000, uncompressedSize: 1, compressedSize: 1, generalPurposeBitFlag: 0 } as never));
  assert.throws(() => validateArchiveEntry({ fileName: 'merge-reviewer/secret', externalFileAttributes: 0, uncompressedSize: 1, compressedSize: 1, generalPurposeBitFlag: 1 } as never));
  assert.throws(() => validateArchiveEntry({ fileName: 'merge-reviewer/large', externalFileAttributes: 0, uncompressedSize: 101 * 1024 * 1024, compressedSize: 1, generalPurposeBitFlag: 0 } as never));
});

test('extracts a verified release ZIP and rejects corrupt, duplicate, and symlink entries', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-archive-'));
  try {
    const extracted = await extractReleaseArchive(makeSkillZip('1.2.3'), parent, 'merge-reviewer', '1.2.3', 'skill');
    assert.equal(await fs.readFile(path.join(extracted.packageDirectory, 'VERSION'), 'utf8'), '1.2.3');
    await fs.rm(extracted.temporaryDirectory, { recursive: true, force: true });
    await assert.rejects(() => extractReleaseArchive(Buffer.from('corrupt zip'), parent, 'merge-reviewer', '1.2.3', 'skill'));
    const duplicate = makeZip([
      { name: 'merge-reviewer/VERSION', data: '1.2.3' },
      { name: 'merge-reviewer/VERSION', data: '1.2.3' }
    ]);
    await assert.rejects(() => extractReleaseArchive(duplicate, parent, 'merge-reviewer', '1.2.3', 'skill'), /duplicate paths/i);
    const symlink = makeZip([
      { name: 'merge-reviewer/VERSION', data: '1.2.3' },
      { name: 'merge-reviewer/SKILL.md', data: 'link', mode: 0o120777 }
    ]);
    await assert.rejects(() => extractReleaseArchive(symlink, parent, 'merge-reviewer', '1.2.3', 'skill'), /symlink|special file/i);
    const traversal = makeZip([{ name: 'merge-reviewer/../escape.txt', data: 'outside' }]);
    await assert.rejects(() => extractReleaseArchive(traversal, parent, 'merge-reviewer', '1.2.3', 'skill'), /unsafe ZIP path|invalid relative path/i);
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
});
