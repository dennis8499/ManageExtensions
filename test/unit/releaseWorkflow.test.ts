import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { makeZip } from '../helpers/zip';

type PackageManifest = { name: string; version: string };
type PackageLock = { version: string; packages?: Record<string, { version?: string }> };
type ReleaseVersionTools = {
  validateReleaseVersion(tag: string, manifest: PackageManifest, lock: PackageLock): string;
  verifyVsix(vsixPath: string, manifest: PackageManifest, version: string): Promise<void>;
  vsixFilename(name: string, version: string): string;
};

const { validateReleaseVersion, verifyVsix, vsixFilename } = require(path.join(process.cwd(), 'scripts', 'check-release.cjs')) as ReleaseVersionTools;
const manifest = { name: 'manage-extensions', version: '0.1.0' };
const lock = { version: '0.1.0', packages: { '': { version: '0.1.0' } } };

test('accepts a stable tag when package manifest and lockfile versions match', () => {
  assert.equal(validateReleaseVersion('v0.1.0', manifest, lock), '0.1.0');
  assert.equal(vsixFilename(manifest.name, '0.1.0'), 'manage-extensions-0.1.0.vsix');
});

test('rejects non-stable and mismatched release tags', () => {
  assert.throws(() => validateReleaseVersion('main', manifest, lock), /stable SemVer/);
  assert.throws(() => validateReleaseVersion('v0.1.0-beta.1', manifest, lock), /stable SemVer/);
  assert.throws(() => validateReleaseVersion('v0.2.0', manifest, lock), /does not match/);
});

test('rejects manifest and lockfile version drift', () => {
  assert.throws(() => validateReleaseVersion('v0.1.0', { ...manifest, version: '0.2.0' }, lock), /does not match/);
  assert.throws(() => validateReleaseVersion('v0.1.0', manifest, { ...lock, version: '0.2.0' }), /does not match/);
  assert.throws(() => validateReleaseVersion('v0.1.0', manifest, { ...lock, packages: { '': { version: '0.2.0' } } }), /does not match/);
});

test('checks the VSIX filename and version in its bundled extension manifest', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'manage-ext-vsix-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vsixPath = path.join(directory, 'manage-extensions-0.1.0.vsix');

  await writeFile(vsixPath, makeZip([
    { name: 'extension/package.json', data: JSON.stringify(manifest) }
  ]));
  await verifyVsix(vsixPath, manifest, '0.1.0');

  await writeFile(vsixPath, makeZip([
    { name: 'extension/package.json', data: JSON.stringify({ ...manifest, version: '0.2.0' }) }
  ]));
  await assert.rejects(() => verifyVsix(vsixPath, manifest, '0.1.0'), /VSIX manifest must contain/);
});
