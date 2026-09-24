import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractMeginSkillsArchive, MEGIN_SKILL_DIRECTORIES } from '../archive/secureArchive';
import { getProduct } from '../catalog';
import { GitHubReleaseClient, selectMeginAsset, validateSha256, type GitHubRelease } from '../github/releases';
import { compareVersions, parseStableVersionTag } from '../version';
import type { InstallTarget } from '../workspace/target';
import { formatPaths, type InstallInteraction } from './interaction';

const PRODUCT = getProduct('megin')!;
const INSTALL_ROOT = '.agents/skills';
const MARKER_RELATIVE_PATH = '.agents/manage-extensions/megin.json';

export interface MeginInstallMetadata {
  readonly schemaVersion: 1;
  readonly product: 'megin';
  readonly version: string;
  readonly tag: string;
  readonly asset: 'megin-skills.zip';
  readonly assetSha256: string;
  readonly managedDirectories: readonly string[];
}

export interface MeginFileOperations {
  rename(from: string, to: string): Promise<void>;
}

export async function readMeginInstalledVersion(root: string): Promise<string | undefined> {
  try {
    const metadata = await readMetadata(root);
    if (!metadata) return undefined;
    await assertPathChainSafe(root, INSTALL_ROOT, false);
    for (const directory of MEGIN_SKILL_DIRECTORIES) {
      const skillRoot = path.join(root, INSTALL_ROOT, directory);
      const rootStat = await fs.lstat(skillRoot);
      const skillStat = await fs.lstat(path.join(skillRoot, 'SKILL.md'));
      if (rootStat.isSymbolicLink() || isReparsePoint(rootStat) || !rootStat.isDirectory() || skillStat.isSymbolicLink() || isReparsePoint(skillStat) || !skillStat.isFile()) return undefined;
    }
    return metadata.version;
  } catch {
    return undefined;
  }
}

export async function installMegin(
  target: InstallTarget,
  latest: GitHubRelease,
  client: GitHubReleaseClient,
  interaction: InstallInteraction,
  temporaryParent = os.tmpdir(),
  operations: MeginFileOperations = { rename: (from, to) => fs.rename(from, to) }
): Promise<void> {
  const version = parseStableVersionTag(latest.tag_name);
  if (!version) throw new Error(`Invalid Megin release tag ${latest.tag_name}.`);
  const asset = selectMeginAsset(latest);
  if (!asset) throw new Error('Megin release is missing megin-skills.zip.');
  const assetSha256 = validateSha256(asset.digest);
  const archive = await client.downloadProductArchive('megin', latest);
  const extracted = await extractMeginSkillsArchive(archive, temporaryParent, version);
  let oldPackage: Awaited<ReturnType<typeof extractMeginSkillsArchive>> | undefined;
  let stagePath: string | undefined;
  let keepStage = false;
  let createdAgentsDirectory = false;

  try {
    await assertTargetAncestorsSafe(target.root);
    const markerBytes = await readMetadataBytes(target.root);
    const metadata = markerBytes ? parseMetadata(markerBytes.toString('utf8')) : undefined;
    const installedEntries = await listMeginDirectories(path.join(target.root, INSTALL_ROOT));
    if (!metadata && installedEntries.length) {
      await interaction.warn(`An unmanaged Megin skill directory already exists. Resolve it before installing: ${formatPaths(installedEntries).join('\n')}`);
      return;
    }

    let oldInstalledDirectories: string[] = [];
    if (metadata) {
      if (metadata.version === version) {
        if (metadata.assetSha256 !== assetSha256) {
          await interaction.warn(`Megin ${version} is installed, but its recorded asset digest differs from the selected release. No files were changed.`);
          return;
        }
        await interaction.inform(`Megin ${version} is already installed.`);
        return;
      }
      if (compareVersions(metadata.version, version) > 0) {
        await interaction.warn(`Megin ${metadata.version} is newer than the selected release ${version}; no downgrade was applied.`);
        return;
      }

      const historical = await client.getByTag(PRODUCT.repository, metadata.tag);
      if (historical.tag_name !== metadata.tag) throw new Error(`GitHub returned a different Megin release than requested: ${historical.tag_name}.`);
      const oldAsset = selectMeginAsset(historical);
      if (!oldAsset || validateSha256(oldAsset.digest) !== metadata.assetSha256) {
        throw new Error('The installed Megin metadata does not match its historical release asset digest.');
      }
      const oldArchive = await client.downloadProductArchive('megin', historical);
      oldPackage = await extractMeginSkillsArchive(oldArchive, temporaryParent, metadata.version);
      const conflicts: string[] = [];
      for (const directory of MEGIN_SKILL_DIRECTORIES) {
        const installedDirectory = path.join(target.root, INSTALL_ROOT, directory);
        const upstreamDirectory = path.join(oldPackage.packageDirectory, directory);
        if (!await pathExists(installedDirectory)) conflicts.push(`${directory}/(missing directory)`);
        else conflicts.push(...await compareTrees(installedDirectory, upstreamDirectory).then(paths => paths.map(item => `${directory}/${item}`)));
      }
      const extraDirectories = installedEntries.filter(entry => !MEGIN_SKILL_DIRECTORIES.some(directory => directory.toLocaleLowerCase('en-US') === entry.toLocaleLowerCase('en-US')));
      conflicts.push(...extraDirectories.map(directory => `${directory}/(unmanaged directory)`));
      if (conflicts.length) {
        await interaction.warn(`Megin contains local modifications, missing files, or unmanaged skill directories. Resolve these before updating:\n${formatPaths(conflicts).join('\n')}`);
        return;
      }
      oldInstalledDirectories = [...installedEntries];
    }

    const skillChanges = metadata
      ? (await Promise.all(MEGIN_SKILL_DIRECTORIES.map(async directory => {
          const prior = path.join(oldPackage!.packageDirectory, directory);
          const next = path.join(extracted.packageDirectory, directory);
          return (await compareTrees(prior, next)).map(item => path.posix.join(INSTALL_ROOT, directory, item));
        }))).flat()
      : (await listMeginFiles(extracted.packageDirectory)).map(relative => path.posix.join(INSTALL_ROOT, relative));
    const changedPaths = [...skillChanges, MARKER_RELATIVE_PATH];
    const gitNotice = target.isGitRepo
      ? 'Megin v0.1.0 expects a non-Git Group root. Files can be installed here, but Megin workflows are not guaranteed to work from a Git repository root.'
      : 'Megin v0.1.0 is designed to run from the root of a non-Git Group folder.';
    const action = metadata ? `Update ${metadata.version} to ${version}` : `Install all 12 skills into ${path.join(target.root, INSTALL_ROOT)}`;
    if (!await interaction.confirm(
      `Install Megin ${version}?`,
      `${action} (${changedPaths.length} file change(s)).\n\n${gitNotice}`,
      formatPaths(changedPaths, 100)
    )) return;

    const agentsPath = path.join(target.root, '.agents');
    if (!await pathExists(agentsPath)) createdAgentsDirectory = true;
    await fs.mkdir(agentsPath, { recursive: true });
    await assertTargetAncestorsSafe(target.root);
    stagePath = await fs.mkdtemp(path.join(agentsPath, `.megin-stage-${randomUUID()}-`));
    const payload = path.join(stagePath, 'payload');
    const backups = path.join(stagePath, 'backups');
    const stagedSkills = path.join(payload, 'skills');
    const stagedMarker = path.join(payload, 'megin.json');
    await fs.mkdir(stagedSkills, { recursive: true });
    await fs.mkdir(backups, { recursive: true });
    for (const directory of MEGIN_SKILL_DIRECTORIES) {
      await fs.cp(path.join(extracted.packageDirectory, directory), path.join(stagedSkills, directory), { recursive: true, errorOnExist: true, force: false });
    }
    const nextMetadata: MeginInstallMetadata = {
      schemaVersion: 1,
      product: 'megin',
      version,
      tag: latest.tag_name,
      asset: 'megin-skills.zip',
      assetSha256,
      managedDirectories: [...MEGIN_SKILL_DIRECTORIES]
    };
    await fs.writeFile(stagedMarker, `${JSON.stringify(nextMetadata, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

    await assertTargetAncestorsSafe(target.root);
    if (metadata) {
      const currentMarker = await readMetadataBytes(target.root);
      if (!currentMarker || !currentMarker.equals(markerBytes!)) {
        await interaction.warn('Megin metadata changed after the preview. No files were replaced.');
        return;
      }
      const lateConflicts: string[] = [];
      for (const directory of MEGIN_SKILL_DIRECTORIES) {
        lateConflicts.push(...(await compareTrees(path.join(target.root, INSTALL_ROOT, directory), path.join(oldPackage!.packageDirectory, directory))).map(item => `${directory}/${item}`));
      }
      const freshDirectories = await listMeginDirectories(path.join(target.root, INSTALL_ROOT));
      lateConflicts.push(...freshDirectories.filter(entry => !oldInstalledDirectories.some(old => old.toLocaleLowerCase('en-US') === entry.toLocaleLowerCase('en-US'))).map(entry => `${entry}/(new directory)`));
      if (lateConflicts.length) {
        await interaction.warn(`Megin changed after the preview. No files were replaced:\n${formatPaths(lateConflicts).join('\n')}`);
        return;
      }
    } else {
      const currentMarker = await readMetadataBytes(target.root);
      const freshDirectories = await listMeginDirectories(path.join(target.root, INSTALL_ROOT));
      if (currentMarker || freshDirectories.length) {
        await interaction.warn('A Megin installation appeared after the preview. No files were replaced.');
        return;
      }
    }

    await fs.mkdir(path.join(target.root, INSTALL_ROOT), { recursive: true });
    await fs.mkdir(path.dirname(path.join(target.root, MARKER_RELATIVE_PATH)), { recursive: true });
    await assertTargetAncestorsSafe(target.root);
    const replacements: Array<{ target: string; staged: string; backup: string; backupMoved: boolean; installed: boolean; shouldExist: boolean; isDirectory: boolean }> = [
      ...MEGIN_SKILL_DIRECTORIES.map(directory => ({
        target: path.join(target.root, INSTALL_ROOT, directory),
        staged: path.join(stagedSkills, directory),
        backup: path.join(backups, `skill-${directory}`),
        backupMoved: false,
        installed: false,
        shouldExist: metadata !== undefined,
        isDirectory: true
      })),
      {
        target: path.join(target.root, MARKER_RELATIVE_PATH),
        staged: stagedMarker,
        backup: path.join(backups, 'megin.json'),
        backupMoved: false,
        installed: false,
        shouldExist: metadata !== undefined,
        isDirectory: false
      }
    ];
    let concurrentConflicts: string[] = [];
    try {
      for (const replacement of replacements) {
        if (replacement.isDirectory && metadata) {
          const directory = path.basename(replacement.target);
          concurrentConflicts = (await compareTrees(replacement.target, path.join(oldPackage!.packageDirectory, directory)))
            .map(item => `${directory}/${item}`);
          if (concurrentConflicts.length) throw new Error('Megin changed during replacement.');
        }
        if (!replacement.isDirectory && metadata) {
          const currentMarker = await readMetadataBytes(target.root);
          if (!currentMarker || !currentMarker.equals(markerBytes!)) {
            concurrentConflicts = ['.agents/manage-extensions/megin.json'];
            throw new Error('Megin metadata changed during replacement.');
          }
        }
        const exists = await pathExists(replacement.target);
        if (exists !== replacement.shouldExist) throw new Error(`Megin target changed after validation: ${path.relative(target.root, replacement.target)}`);
        if (exists) {
          const stat = await fs.lstat(replacement.target);
          if (stat.isSymbolicLink() || isReparsePoint(stat) || (replacement.isDirectory ? !stat.isDirectory() : !stat.isFile())) {
            throw new Error(`Megin target is not a regular ${replacement.isDirectory ? 'directory' : 'file'}: ${path.relative(target.root, replacement.target)}`);
          }
          await operations.rename(replacement.target, replacement.backup);
          replacement.backupMoved = true;
        }
        await operations.rename(replacement.staged, replacement.target);
        replacement.installed = true;
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const replacement of [...replacements].reverse()) {
        try {
          if (replacement.installed && await pathExists(replacement.target)) await fs.rm(replacement.target, { recursive: true, force: true });
          if (replacement.backupMoved) await operations.rename(replacement.backup, replacement.target);
        } catch (restoreError) {
          rollbackErrors.push(`${path.relative(target.root, replacement.target)}: ${String(restoreError)}`);
        }
      }
      if (rollbackErrors.length) {
        keepStage = true;
        await interaction.warn(`Megin replacement failed and rollback was incomplete. Original files remain in backup ${backups}. ${rollbackErrors.join('; ')}`);
      }
      if (concurrentConflicts.length && !rollbackErrors.length) {
        await interaction.warn(`Megin changed during replacement. All earlier replacements were rolled back:\n${formatPaths(concurrentConflicts).join('\n')}`);
        return;
      }
      throw error;
    }
    await interaction.inform(`Megin ${version} was installed in ${target.name}.`);
  } finally {
    if (stagePath && !keepStage) await fs.rm(stagePath, { recursive: true, force: true });
    await fs.rm(extracted.temporaryDirectory, { recursive: true, force: true });
    if (oldPackage) await fs.rm(oldPackage.temporaryDirectory, { recursive: true, force: true });
    if (createdAgentsDirectory && !keepStage) await removeIfEmpty(path.join(target.root, INSTALL_ROOT));
    if (createdAgentsDirectory && !keepStage) await removeIfEmpty(path.join(target.root, '.agents', 'manage-extensions'));
    if (createdAgentsDirectory && !keepStage) await removeIfEmpty(path.join(target.root, '.agents'));
  }
}

async function readMetadata(root: string): Promise<MeginInstallMetadata | undefined> {
  const bytes = await readMetadataBytes(root);
  return bytes ? parseMetadata(bytes.toString('utf8')) : undefined;
}

async function readMetadataBytes(root: string): Promise<Buffer | undefined> {
  const file = path.join(root, MARKER_RELATIVE_PATH);
  await assertPathChainSafe(root, MARKER_RELATIVE_PATH, true);
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || isReparsePoint(stat) || !stat.isFile()) throw new Error('The Megin version marker is not a regular file.');
    return await fs.readFile(file);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function parseMetadata(text: string): MeginInstallMetadata {
  let value: unknown;
  try { value = JSON.parse(text) as unknown; }
  catch (error) { throw new Error('The Megin version metadata is invalid JSON.', { cause: error }); }
  if (!value || typeof value !== 'object') throw new Error('The Megin version metadata is invalid.');
  const metadata = value as Partial<MeginInstallMetadata>;
  if (metadata.schemaVersion !== 1 || metadata.product !== 'megin' || typeof metadata.version !== 'string' ||
      parseStableVersionTag(metadata.version) !== metadata.version || metadata.tag !== `v${metadata.version}` ||
      metadata.asset !== 'megin-skills.zip' || typeof metadata.assetSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.assetSha256) ||
      !Array.isArray(metadata.managedDirectories) || metadata.managedDirectories.length !== MEGIN_SKILL_DIRECTORIES.length ||
      metadata.managedDirectories.some((directory, index) => directory !== MEGIN_SKILL_DIRECTORIES[index])) {
    throw new Error('The Megin version metadata does not match the supported installation contract.');
  }
  return metadata as MeginInstallMetadata;
}

async function listMeginDirectories(skillsRoot: string): Promise<string[]> {
  try {
    const stat = await fs.lstat(skillsRoot);
    if (stat.isSymbolicLink() || isReparsePoint(stat) || !stat.isDirectory()) throw new Error('The .agents/skills path is not a regular directory.');
    return (await fs.readdir(skillsRoot, { withFileTypes: true }))
      .filter(entry => /^megin(?:-|$)/i.test(entry.name))
      .map(entry => entry.name).sort((a, b) => a.localeCompare(b, 'en'));
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

async function compareTrees(actual: string, expected: string): Promise<string[]> {
  const actualEntries = await treeEntries(actual);
  const expectedEntries = await treeEntries(expected);
  const conflicts: string[] = [];
  for (const [key, expectedEntry] of expectedEntries) {
    const actualEntry = actualEntries.get(key);
    if (!actualEntry) conflicts.push(expectedEntry.path);
    else if (actualEntry.path !== expectedEntry.path || actualEntry.type !== expectedEntry.type || (expectedEntry.type === 'file' && actualEntry.sha256 !== expectedEntry.sha256)) conflicts.push(expectedEntry.path);
  }
  for (const [key, actualEntry] of actualEntries) if (!expectedEntries.has(key)) conflicts.push(actualEntry.path);
  return [...new Set(conflicts)].sort();
}

async function treeEntries(root: string): Promise<Map<string, { path: string; type: 'file' | 'directory'; sha256?: string }>> {
  const result = new Map<string, { path: string; type: 'file' | 'directory'; sha256?: string }>();
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink() || isReparsePoint(stat) || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Megin skill tree contains an unsupported file type: ${relative}`);
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

async function listMeginFiles(root: string): Promise<string[]> {
  const entries = await treeEntries(root);
  return [...entries.values()].filter(entry => entry.type === 'file').map(entry => entry.path).sort();
}

async function hashFile(file: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function assertTargetAncestorsSafe(root: string): Promise<void> {
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink() || isReparsePoint(rootStat) || !rootStat.isDirectory()) throw new Error('The selected Megin target is not a regular directory.');
  await assertPathChainSafe(root, `${INSTALL_ROOT}/megin`, true);
  await assertPathChainSafe(root, MARKER_RELATIVE_PATH, true);
}

async function assertPathChainSafe(root: string, relative: string, allowMissing: boolean): Promise<void> {
  let current = root;
  const parts = relative.split(/[\\/]/);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || isReparsePoint(stat)) throw new Error(`Megin installation path contains a symlink or reparse point: ${current}`);
      if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`Megin installation parent is not a directory: ${current}`);
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

async function removeIfEmpty(directory: string): Promise<void> {
  try { await fs.rmdir(directory); }
  catch (error) { if (!isNotFound(error) && !isDirectoryNotEmpty(error)) throw error; }
}

function isReparsePoint(stat: { isDirectory(): boolean; isFile(): boolean; mode: number }): boolean {
  if (process.platform !== 'win32') return false;
  return (((stat as unknown as { attributes?: number }).attributes ?? 0) & 0x400) !== 0;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isDirectoryNotEmpty(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && ['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '');
}
