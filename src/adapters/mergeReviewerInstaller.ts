import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractReleaseArchive, type ExtractedPackage } from '../archive/secureArchive';
import { getProduct } from '../catalog';
import { GitHubReleaseClient, type GitHubRelease } from '../github/releases';
import { parseStableVersionTag, compareVersions } from '../version';
import type { InstallTarget } from '../workspace/target';
import { formatPaths, type InstallInteraction } from './interaction';

const SKILL_RELATIVE_PATH = getProduct('merge-reviewer')!.installRelativePath;

export async function installMergeReviewer(
  target: InstallTarget,
  latest: GitHubRelease,
  client: GitHubReleaseClient,
  interaction: InstallInteraction,
  temporaryParent = os.tmpdir()
): Promise<void> {
  const product = getProduct('merge-reviewer')!;
  const version = parseStableVersionTag(latest.tag_name);
  if (!version) throw new Error(`Invalid MergeReviewer release tag ${latest.tag_name}.`);
  const archive = await client.downloadProductArchive('merge-reviewer', latest);
  const parent = path.join(target.root, '.agents', 'skills');
  const installedPath = path.join(target.root, SKILL_RELATIVE_PATH);
  const archiveRoot = product.archiveRoot(version);
  const extracted = await extractReleaseArchive(archive, temporaryParent, archiveRoot, version, 'skill');
  let oldPackage: ExtractedPackage | undefined;
  let stagePath: string | undefined;
  let backupPath: string | undefined;
  let keepBackup = false;
  try {
    await assertPathChainSafe(target.root, SKILL_RELATIVE_PATH, true);
    const existing = await pathExists(installedPath);
    let installedVersion: string | undefined;
    if (existing) {
      const status = await fs.lstat(installedPath);
      if (status.isSymbolicLink() || !status.isDirectory()) throw new Error('The MergeReviewer installation path is not a regular directory.');
      installedVersion = await readVersion(installedPath);
      if (compareVersions(installedVersion, version) > 0) {
        await interaction.warn(`MergeReviewer ${installedVersion} is newer than the selected release ${version}; no downgrade was applied.`);
        return;
      }
      if (installedVersion === version) {
        await interaction.inform(`MergeReviewer ${version} is already installed.`);
        return;
      }
      const oldRelease = await client.getByTag(product.repository, `v${installedVersion}`);
      const oldZip = await client.downloadProductArchive('merge-reviewer', oldRelease);
      oldPackage = await extractReleaseArchive(oldZip, temporaryParent, product.archiveRoot(installedVersion), installedVersion, 'skill');
      const conflicts = await compareInstalled(installedPath, oldPackage.packageDirectory);
      if (conflicts.length) {
        await interaction.warn(`MergeReviewer contains local modifications or extra files. Resolve these before updating:\n${formatPaths(conflicts).join('\n')}`);
        return;
      }
    }
    const changedPaths = existing
      ? await compareTrees(extracted.packageDirectory, oldPackage!.packageDirectory)
      : await listFiles(extracted.packageDirectory);
    if (!(await interaction.confirm(
      `Install MergeReviewer ${version}?`,
      `${existing ? `Update ${installedVersion} to ${version}` : `Install into ${path.relative(target.root, installedPath)}`} (${changedPaths.length} file change(s)).`,
      formatPaths(changedPaths)
    ))) return;

    await fs.mkdir(parent, { recursive: true });
    await assertPathChainSafe(target.root, SKILL_RELATIVE_PATH, true);
    stagePath = await fs.mkdtemp(path.join(parent, '.merge-reviewer-stage-'));
    const stagedPayload = path.join(stagePath, 'payload');
    await fs.cp(extracted.packageDirectory, stagedPayload, { recursive: true, errorOnExist: true, force: false });
    if (existing && oldPackage) {
      const lateConflicts = await compareInstalled(installedPath, oldPackage.packageDirectory);
      if (lateConflicts.length) {
        await interaction.warn(`MergeReviewer changed after the preview. No files were replaced:\n${formatPaths(lateConflicts).join('\n')}`);
        return;
      }
    } else if (await pathExists(installedPath)) {
      await interaction.warn('The MergeReviewer destination appeared after the preview. No files were replaced.');
      return;
    }
    if (existing) {
      backupPath = path.join(parent, `.merge-reviewer-backup-${randomUUID()}`);
      await fs.rename(installedPath, backupPath);
    }
    try {
      await fs.rename(stagedPayload, installedPath);
    } catch (error) {
      if (backupPath) {
        try {
          await fs.rename(backupPath, installedPath);
          backupPath = undefined;
        } catch (restoreError) {
          keepBackup = true;
          await interaction.warn(`The new version could not be installed and the previous directory could not be restored. The backup remains at ${backupPath}: ${String(restoreError)}`);
        }
      }
      throw error;
    }
    if (backupPath) {
      await fs.rm(backupPath, { recursive: true, force: true });
      backupPath = undefined;
    }
    await interaction.inform(`MergeReviewer ${version} was installed in ${target.name}.`);
  } finally {
    if (stagePath) await fs.rm(stagePath, { recursive: true, force: true });
    if (backupPath && !(await pathExists(installedPath))) {
      try { await fs.rename(backupPath, installedPath); backupPath = undefined; }
      catch (restoreError) { keepBackup = true; await interaction.warn(`Could not restore the previous MergeReviewer directory from ${backupPath}: ${String(restoreError)}`); }
    }
    if (backupPath && !keepBackup) await fs.rm(backupPath, { recursive: true, force: true });
    await fs.rm(extracted.temporaryDirectory, { recursive: true, force: true });
    if (oldPackage) await fs.rm(oldPackage.temporaryDirectory, { recursive: true, force: true });
  }
}

async function compareInstalled(installed: string, upstream: string): Promise<string[]> {
  return compareTrees(installed, upstream);
}

async function compareTrees(actual: string, expected: string): Promise<string[]> {
  const actualEntries = await treeEntries(actual);
  const expectedEntries = await treeEntries(expected);
  const conflicts: string[] = [];
  for (const [relative, expectedEntry] of expectedEntries) {
    const actualEntry = actualEntries.get(relative.toLocaleLowerCase('en-US'));
    if (!actualEntry) {
      conflicts.push(expectedEntry.path);
      continue;
    }
    if (actualEntry.path !== expectedEntry.path || actualEntry.type !== expectedEntry.type || (expectedEntry.type === 'file' && actualEntry.sha256 !== expectedEntry.sha256)) conflicts.push(expectedEntry.path);
  }
  for (const actualEntry of actualEntries.values()) if (!expectedEntries.has(actualEntry.path.toLocaleLowerCase('en-US'))) conflicts.push(actualEntry.path);
  return [...new Set(conflicts)].sort();
}

async function treeEntries(root: string): Promise<Map<string, { path: string; type: 'file' | 'directory'; sha256?: string }>> {
  const result = new Map<string, { path: string; type: 'file' | 'directory'; sha256?: string }>();
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink() || isReparsePoint(stat) || (!stat.isFile() && !stat.isDirectory())) throw new Error(`MergeReviewer tree contains an unsupported file type: ${relative}`);
      if (stat.isDirectory()) {
        result.set(relative.toLocaleLowerCase('en-US'), { path: relative, type: 'directory' });
        await visit(full, relative);
      } else {
        result.set(relative.toLocaleLowerCase('en-US'), { path: relative, type: 'file', sha256: await hashFile(full) });
      }
    }
  }
  await visit(root, '');
  return result;
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await treeEntries(root);
  return [...entries.values()].filter(entry => entry.type === 'file').map(entry => entry.path).sort();
}

async function hashFile(file: string): Promise<string> {
  const bytes = await fs.readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

async function readVersion(root: string): Promise<string> {
  const versionPath = path.join(root, 'VERSION');
  const stat = await fs.lstat(versionPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('The MergeReviewer VERSION marker is not a regular file.');
  const version = (await fs.readFile(versionPath, 'utf8')).trim();
  if (!parseStableVersionTag(version)) throw new Error(`The installed MergeReviewer version is invalid: ${version || '(empty)'}.`);
  return version;
}

async function assertPathChainSafe(root: string, relative: string, allowMissing: boolean): Promise<void> {
  let current = root;
  const parts = relative.split(/[\\/]/);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || isReparsePoint(stat)) throw new Error(`MergeReviewer path contains a symlink or reparse point: ${current}`);
      if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`MergeReviewer parent path is not a directory: ${current}`);
    } catch (error) {
      if (isNotFound(error) && allowMissing) continue;
      throw error;
    }
  }
}

async function pathExists(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true; }
  catch (error) { if (isNotFound(error)) return false; throw error; }
}

function isReparsePoint(stat: { isDirectory(): boolean; isFile(): boolean; mode: number }): boolean {
  if (process.platform !== 'win32') return false;
  const withAttributes = stat as unknown as { attributes?: number };
  return ((withAttributes.attributes ?? 0) & 0x400) !== 0;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
