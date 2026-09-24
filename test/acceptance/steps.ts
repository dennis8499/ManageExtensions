import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { After, Given, Then, When, setWorldConstructor } from '@cucumber/cucumber';
import { PRODUCT_CATALOG } from '../../src/catalog';
import { installMergeReviewer } from '../../src/adapters/mergeReviewerInstaller';
import { type InstallInteraction } from '../../src/adapters/interaction';
import { installWiki } from '../../src/adapters/wikiInstaller';
import { safeArchivePath, validateArchiveEntry, extractReleaseArchive } from '../../src/archive/secureArchive';
import { GitHubReleaseClient, validateWikiManifest, type GitHubRelease } from '../../src/github/releases';
import { runProcess, type ProcessResult, type PythonCommand } from '../../src/process';
import { compareVersions, parseStableVersionTag } from '../../src/version';
import { isLocalWindowsDrive, resolveInstallTarget, type InstallTarget, type WorkspaceCandidate } from '../../src/workspace/target';
import { makeSkillZip, makeWikiZip, makeZip } from '../helpers/zip';

class AcceptanceWorld {
  root?: string;
  extraRoots: string[] = [];
  target?: InstallTarget;
  candidates: WorkspaceCandidate[] = [];
  productNames: string[] = [];
  latest?: GitHubRelease;
  client?: GitHubReleaseClient;
  interaction?: InstallInteraction;
  processCalls: Array<{ args: readonly string[]; cwd?: string }> = [];
  warnings: string[] = [];
  prompts: string[] = [];
  installedVersion?: string;
  beforeTree?: Record<string, string>;
  applied = false;

  async createRoot(): Promise<string> {
    if (this.root) this.extraRoots.push(this.root);
    this.root = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-accept-'));
    this.target = { name: 'acceptance-project', root: this.root };
    return this.root;
  }

  makeInteraction(approved = true): InstallInteraction {
    this.interaction = {
      async confirm(title, message, paths) { thisWorld.prompts.push([title, message, ...paths].join('\n')); return approved; },
      async inform(message) { thisWorld.prompts.push(message); },
      async warn(message) { thisWorld.warnings.push(message); }
    };
    const thisWorld = this;
    return this.interaction;
  }
}
setWorldConstructor(AcceptanceWorld);

After(async function(this: AcceptanceWorld) {
  if (this.root) await fs.rm(this.root, { recursive: true, force: true });
  for (const root of this.extraRoots) await fs.rm(root, { recursive: true, force: true });
});

Given('the extension is running in a trusted Windows workspace', async function(this: AcceptanceWorld) {
  const root = await this.createRoot();
  this.candidates = [{ name: 'acceptance-project', fsPath: root, scheme: 'file' }];
});

When('the product view is opened', function(this: AcceptanceWorld) {
  this.productNames = PRODUCT_CATALOG.map(product => product.title);
});

Then('Codebase LLM Wiki and MergeReviewer are listed with their installation status', function(this: AcceptanceWorld) {
  assert.deepEqual(this.productNames, ['Codebase LLM Wiki (Codex)', 'MergeReviewer']);
});

Then('an untrusted, non-Windows, virtual, mapped network, or non-Git workspace cannot start installation', async function(this: AcceptanceWorld) {
  const folder = this.candidates[0];
  await assert.rejects(() => resolveInstallTarget({ platform: 'win32', trusted: false, candidates: [folder] }, async () => undefined));
  await assert.rejects(() => resolveInstallTarget({ platform: 'linux', trusted: true, candidates: [folder] }, async () => undefined));
  await assert.rejects(() => resolveInstallTarget({ platform: 'win32', trusted: true, candidates: [{ ...folder, scheme: 'vscode-vfs' }] }, async () => undefined));
  await assert.rejects(() => resolveInstallTarget(
    { platform: 'win32', trusted: true, candidates: [folder] },
    async () => undefined,
    async () => ({ exitCode: 128, stdout: '', stderr: 'not a git repository' }),
    async () => true
  ));
  assert.equal(await isLocalWindowsDrive('Z:\\', async (_executable, args) => {
    assert.match(args.at(-1) ?? '', /GetDriveType\('Z:\\'\)/);
    return { exitCode: 0, stdout: '4', stderr: '' };
  }), false);
  assert.equal(await isLocalWindowsDrive('C:\\', async () => ({ exitCode: 0, stdout: '3', stderr: '' })), true);
});

Given('a valid SHA-verified stable Codebase LLM Wiki release with a Codex package', async function(this: AcceptanceWorld) {
  await this.createRoot();
  this.latest = release('v0.2.1');
  const archive = makeWikiZip('0.2.1');
  this.client = { async downloadWikiAssets() { return { manifest: {} as never, zip: archive }; } } as unknown as GitHubReleaseClient;
});

Given('Python 3.11 or newer is available', function(this: AcceptanceWorld) {
  assert.ok(this.latest);
});

When('I request installation and approve the displayed dry-run changes', async function(this: AcceptanceWorld) {
  const target = this.target!;
  const python: PythonCommand = { executable: 'py', prefixArguments: ['-3'], version: [3, 14, 7] };
  const runner = async (_executable: string, args: readonly string[], options?: { cwd?: string }): Promise<ProcessResult> => {
    this.processCalls.push({ args, cwd: options?.cwd });
    if (args.includes('--apply')) {
      this.applied = true;
      const marker = path.join(target.root, '.agents', 'skills', 'codebase-wiki', 'VERSION');
      await fs.mkdir(path.dirname(marker), { recursive: true });
      await fs.writeFile(marker, '0.2.1');
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, applied: true, framework_version: '0.2.1' }), stderr: '' };
    }
    return { exitCode: 0, stdout: JSON.stringify({ ok: true, changes: ['Codex.md'], preserved: ['wiki/custom.md'], conflicts: [], obsolete_paths: [] }), stderr: '' };
  };
  await installWiki(target, this.latest!, this.client!, this.makeInteraction(), runner, async () => python);
});

Then('the upstream installer applies the Codex surface in coexist mode', function(this: AcceptanceWorld) {
  assert.equal(this.processCalls.length, 2);
  assert.equal(this.processCalls[0].args.includes('--apply'), false);
  assert.equal(this.processCalls[1].args.includes('--apply'), true);
  assert.deepEqual(this.processCalls[0].args.slice(2), ['install', '--target', this.target!.root, '--surface', 'codex', '--guard-mode', 'coexist', '--format', 'json']);
});

Then('the installed VERSION matches the downloaded release', async function(this: AcceptanceWorld) {
  const marker = path.join(this.target!.root, '.agents', 'skills', 'codebase-wiki', 'VERSION');
  assert.equal(await fs.readFile(marker, 'utf8'), '0.2.1');
  this.installedVersion = '0.2.1';
});

Given('a valid stable MergeReviewer release ZIP and an empty local Git repository', async function(this: AcceptanceWorld) {
  const root = await this.createRoot();
  const init = await runProcess('git', ['init', '--quiet'], { cwd: root });
  assert.equal(init.exitCode, 0, init.stderr);
  this.latest = release('v0.1.2');
  const archives: Record<string, Buffer> = { 'v0.1.2': makeSkillZip('0.1.2') };
  this.client = fakeSkillClient(archives);
});

Then('the verified skill is installed in the repository project skill directory', async function(this: AcceptanceWorld) {
  const skill = path.join(this.target!.root, '.agents', 'skills', 'merge-reviewer', 'SKILL.md');
  assert.match(await fs.readFile(skill, 'utf8'), /MergeReviewer/);
});

Then('its VERSION matches the release tag', async function(this: AcceptanceWorld) {
  const marker = path.join(this.target!.root, '.agents', 'skills', 'merge-reviewer', 'VERSION');
  this.installedVersion = (await fs.readFile(marker, 'utf8')).trim();
  assert.equal(this.installedVersion, parseStableVersionTag(this.latest!.tag_name));
});

Given('an older installation of either product', async function(this: AcceptanceWorld) {
  const root = await this.createRoot();
  this.latest = release('v1.1.0');
  this.client = fakeSkillClient({ 'v1.0.0': makeSkillZip('1.0.0'), 'v1.1.0': makeSkillZip('1.1.0') });
  await installMergeReviewer(this.target!, release('v1.0.0'), this.client, this.makeInteraction());
  const skill = path.join(root, '.agents', 'skills', 'merge-reviewer');
  await fs.writeFile(path.join(skill, 'SKILL.md'), 'local edit\n');
  this.beforeTree = await treeSnapshot(skill);
});

When('I request an update and a managed file differs from that installed release', async function(this: AcceptanceWorld) {
  await installMergeReviewer(this.target!, this.latest!, this.client!, this.makeInteraction());
});

Then('the update reports the conflicting path and changes no target files', async function(this: AcceptanceWorld) {
  const skill = path.join(this.target!.root, '.agents', 'skills', 'merge-reviewer');
  assert.match(this.warnings.join('\n'), /SKILL\.md/i);
  assert.deepEqual(await treeSnapshot(skill), this.beforeTree);
});

When('an unchanged installation updates to the selected stable release', async function(this: AcceptanceWorld) {
  this.warnings = [];
  const root = await this.createRoot();
  this.target = { name: 'clean-project', root };
  this.latest = release('v1.1.0');
  this.client = fakeSkillClient({ 'v1.0.0': makeSkillZip('1.0.0'), 'v1.1.0': makeSkillZip('1.1.0') });
  await installMergeReviewer(this.target, release('v1.0.0'), this.client, this.makeInteraction());
  await installMergeReviewer(this.target, this.latest, this.client, this.makeInteraction());
});

Then('the selected stable release is installed without a conflict', async function(this: AcceptanceWorld) {
  const marker = path.join(this.target!.root, '.agents', 'skills', 'merge-reviewer', 'VERSION');
  assert.equal((await fs.readFile(marker, 'utf8')).trim(), '1.1.0');
  assert.equal(this.warnings.length, 0);
});

Given('a release with a missing or mismatched asset digest, an invalid manifest, or a corrupt archive', async function(this: AcceptanceWorld) {
  await this.createRoot();
  const zip = makeSkillZip('1.0.0');
  const badDigestRelease = release('v1.0.0');
  badDigestRelease.assets = [{ name: 'merge-reviewer-1.0.0.zip', browser_download_url: 'https://github.com/dennis8499/MergeReviewer/releases/download/v1.0.0/merge-reviewer-1.0.0.zip', digest: `sha256:${'f'.repeat(64)}`, size: zip.length }];
  this.client = new GitHubReleaseClient(async () => new Response(zip, { status: 200, headers: { 'content-length': String(zip.length) } }));
  this.latest = badDigestRelease;
});

When('I request installation', async function(this: AcceptanceWorld) {
  if (this.latest!.assets.length) {
    await assert.rejects(() => installMergeReviewer(this.target!, this.latest!, this.client!, this.makeInteraction()));
  } else {
    await installMergeReviewer(this.target!, this.latest!, this.client!, this.makeInteraction());
  }
});

Then('the operation fails with a useful error and leaves the repository unchanged', async function(this: AcceptanceWorld) {
  await assert.rejects(() => fs.stat(path.join(this.target!.root, '.agents')));
  assert.throws(() => validateWikiManifest({ schema_version: 1 }, release('v0.2.1')), /manifest/i);
  await assert.rejects(() => extractReleaseArchive(Buffer.from('broken'), os.tmpdir(), 'merge-reviewer', '1.0.0', 'skill'));
});

Then('absolute, traversal, duplicate, and symlink ZIP entries are rejected', async function() {
  for (const value of ['/root.txt', '../outside.txt', 'merge-reviewer/../outside.txt', 'merge-reviewer//duplicate.txt']) assert.throws(() => safeArchivePath(value, 'merge-reviewer'));
  assert.throws(() => validateArchiveEntry({ fileName: 'merge-reviewer/link', externalFileAttributes: 0xa1ff0000, uncompressedSize: 1, compressedSize: 1, generalPurposeBitFlag: 0 }));
  const duplicate = makeZip([{ name: 'merge-reviewer/VERSION', data: '1.0.0' }, { name: 'merge-reviewer/VERSION', data: '1.0.0' }]);
  await assert.rejects(() => extractReleaseArchive(duplicate, os.tmpdir(), 'merge-reviewer', '1.0.0', 'skill'), /duplicate paths/i);
});

Given('startup update checks are enabled', function(this: AcceptanceWorld) {
  assert.equal(PRODUCT_CATALOG.length, 2);
});

When('a newer stable release is found', async function(this: AcceptanceWorld) {
  assert.equal(compareVersions('1.1.0', '1.0.0'), 1);
  const root = await this.createRoot();
  this.latest = release('v1.1.0');
  this.client = { async downloadWikiAssets() { return { manifest: {} as never, zip: makeWikiZip('1.1.0') }; } } as unknown as GitHubReleaseClient;
  await installWiki(this.target!, this.latest, this.client, this.makeInteraction(false), async (_exe, args) => {
    this.processCalls.push({ args });
    return { exitCode: 0, stdout: JSON.stringify({ ok: true, changes: ['Codex.md'], preserved: [], conflicts: [], obsolete_paths: [] }), stderr: '' };
  }, async () => ({ executable: 'py', prefixArguments: ['-3'], version: [3, 11, 0] }));
  assert.equal(await fs.stat(root).then(stat => stat.isDirectory()), true);
});

Then('the view shows the newer version and offers a manual update action', function(this: AcceptanceWorld) {
  assert.equal(parseStableVersionTag(this.latest!.tag_name), '1.1.0');
  assert.equal(this.prompts.length, 1);
});

Then('no release content is written until I explicitly choose to install or update', async function(this: AcceptanceWorld) {
  assert.equal(this.processCalls.length, 1);
  assert.equal(this.processCalls[0].args.includes('--apply'), false);
  await assert.rejects(() => fs.stat(path.join(this.target!.root, '.agents')));
});

Given('two trusted local Git repositories are open in VS Code', async function(this: AcceptanceWorld) {
  const first = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-a-'));
  const second = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-b-'));
  this.extraRoots = [first, second];
  await runProcess('git', ['init', '--quiet'], { cwd: first });
  await runProcess('git', ['init', '--quiet'], { cwd: second });
  this.candidates = [{ name: 'first', fsPath: first, scheme: 'file' }, { name: 'second', fsPath: second, scheme: 'file' }];
});

When('I request an installation', async function(this: AcceptanceWorld) {
  this.target = await resolveInstallTarget({ platform: 'win32', trusted: true, candidates: this.candidates, forceSelection: true }, async targets => targets[1]);
});

Then('I must select one repository before any files are written', function(this: AcceptanceWorld) {
  assert.equal(path.basename(this.target!.root), path.basename(this.candidates[1].fsPath));
  assert.equal(this.productNames.length, 0);
});

Given('a Codebase LLM Wiki workspace with local managed changes', async function(this: AcceptanceWorld) {
  const root = await this.createRoot();
  await fs.mkdir(path.join(root, '.codex'), { recursive: true });
  await fs.writeFile(path.join(root, '.codex', 'config.toml'), '# local Codex configuration\n');
  this.latest = release('v0.2.1');
  this.client = { async downloadWikiAssets() { return { manifest: {} as never, zip: makeWikiZip('0.2.1') }; } } as unknown as GitHubReleaseClient;
});

When('I request a Wiki update', async function(this: AcceptanceWorld) {
  await installWiki(this.target!, this.latest!, this.client!, this.makeInteraction(), async (_exe, args) => {
    this.processCalls.push({ args });
    return { exitCode: 2, stdout: JSON.stringify({ ok: false, changes: ['Codex.md'], preserved: [], conflicts: ['.codex/config.toml'], obsolete_paths: [] }), stderr: '' };
  }, async () => ({ executable: 'py', prefixArguments: ['-3'], version: [3, 11, 0] }));
});

Then('the upstream conflict is shown without asking to apply', function(this: AcceptanceWorld) {
  assert.match(this.warnings.join('\n'), /\.codex\/config\.toml/);
  assert.equal(this.prompts.length, 0);
  assert.equal(this.processCalls.length, 1);
  assert.equal(this.processCalls[0].args.includes('--apply'), false);
});

Then('the local target files remain unchanged', async function(this: AcceptanceWorld) {
  assert.equal(await fs.readFile(path.join(this.target!.root, '.codex', 'config.toml'), 'utf8'), '# local Codex configuration\n');
});

Given('an older Codebase LLM Wiki installation and a local wiki file', async function(this: AcceptanceWorld) {
  const root = await this.createRoot();
  const installDirectory = path.join(root, '.agents', 'skills', 'codebase-wiki');
  await fs.mkdir(installDirectory, { recursive: true });
  await fs.writeFile(path.join(installDirectory, 'VERSION'), '0.2.0');
  await fs.mkdir(path.join(root, 'wiki'), { recursive: true });
  await fs.writeFile(path.join(root, 'wiki', 'custom.md'), '# Local wiki content\n');
  this.latest = release('v0.2.1');
  this.client = { async downloadWikiAssets() { return { manifest: {} as never, zip: makeWikiZip('0.2.1') }; } } as unknown as GitHubReleaseClient;
});

When('I request a Wiki upgrade and approve the dry-run', async function(this: AcceptanceWorld) {
  const marker = path.join(this.target!.root, '.agents', 'skills', 'codebase-wiki', 'VERSION');
  const runner = async (_executable: string, args: readonly string[], options?: { cwd?: string }): Promise<ProcessResult> => {
    this.processCalls.push({ args, cwd: options?.cwd });
    if (args.includes('--apply')) {
      this.applied = true;
      await fs.writeFile(marker, '0.2.1');
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, applied: true, framework_version: '0.2.1' }), stderr: '' };
    }
    return { exitCode: 0, stdout: JSON.stringify({ ok: true, action: 'upgrade', framework_version: '0.2.1', changes: ['Codex.md'], preserved: ['wiki/custom.md'], conflicts: [], obsolete_paths: [] }), stderr: '' };
  };
  await installWiki(this.target!, this.latest!, this.client!, this.makeInteraction(), runner,
    async () => ({ executable: 'py', prefixArguments: ['-3'], version: [3, 11, 0] }));
});

Then('the upstream upgrade is previewed and exact-version apply preserves wiki content', async function(this: AcceptanceWorld) {
  assert.equal(this.processCalls.length, 2);
  assert.equal(this.processCalls[0].args[2], 'upgrade');
  assert.equal(this.processCalls[0].args.includes('--apply'), false);
  assert.equal(this.processCalls[1].args[2], 'upgrade');
  assert.equal(this.processCalls[1].args.includes('--apply'), true);
  assert.equal(this.processCalls[0].args[this.processCalls[0].args.indexOf('--target') + 1], this.target!.root);
  assert.equal(this.processCalls[1].args[this.processCalls[1].args.indexOf('--target') + 1], this.target!.root);
  assert.equal(await fs.readFile(path.join(this.target!.root, '.agents', 'skills', 'codebase-wiki', 'VERSION'), 'utf8'), '0.2.1');
  assert.equal(await fs.readFile(path.join(this.target!.root, 'wiki', 'custom.md'), 'utf8'), '# Local wiki content\n');
});

When('I repeat installation of the current Wiki release', async function(this: AcceptanceWorld) {
  await installWiki(this.target!, this.latest!, this.client!, this.makeInteraction(), async (_executable, args) => {
    this.processCalls.push({ args });
    return { exitCode: 0, stdout: JSON.stringify({ ok: true, action: 'upgrade', framework_version: '0.2.1', changes: [], preserved: ['wiki/custom.md'], conflicts: [], obsolete_paths: [] }), stderr: '' };
  }, async () => ({ executable: 'py', prefixArguments: ['-3'], version: [3, 11, 0] }));
});

Then('the upstream upgrade preview runs without applying or prompting again', function(this: AcceptanceWorld) {
  assert.equal(this.processCalls.length, 3);
  assert.equal(this.processCalls[2].args[2], 'upgrade');
  assert.equal(this.processCalls[2].args.includes('--apply'), false);
  assert.equal(this.applied, true);
  assert.equal(this.prompts.filter(prompt => prompt.startsWith('Apply Codebase LLM Wiki')).length, 1);
});

function release(tag: string): GitHubRelease { return { tag_name: tag, prerelease: false, draft: false, assets: [] }; }

function fakeSkillClient(packages: Record<string, Buffer>): GitHubReleaseClient {
  return {
    async getByTag(_repository: string, tag: string) { return release(tag); },
    async downloadProductArchive(_id: string, version: GitHubRelease) {
      const archive = packages[version.tag_name];
      if (!archive) throw new Error(`Missing fixture asset ${version.tag_name}`);
      return archive;
    }
  } as unknown as GitHubReleaseClient;
}

async function treeSnapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full, relative);
      else result[relative] = await fs.readFile(full, 'utf8');
    }
  }
  await visit(root, '');
  return result;
}
