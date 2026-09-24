import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installMergeReviewer } from '../../src/adapters/mergeReviewerInstaller';
import { installMegin, readMeginInstalledVersion } from '../../src/adapters/meginInstaller';
import { installWiki } from '../../src/adapters/wikiInstaller';
import { GitHubReleaseClient, type GitHubRelease } from '../../src/github/releases';
import type { InstallInteraction } from '../../src/adapters/interaction';
import type { ProcessResult, PythonCommand } from '../../src/process';
import { makeMeginZip, makeSkillZip, makeWikiZip, MEGIN_SKILL_DIRECTORIES } from '../helpers/zip';

test('installs MergeReviewer, is repeat-safe, and upgrades clean managed content', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-test-'));
  const localTarget = { name: 'project', root: sandbox };
  const packages: Record<string, Buffer> = { 'v1.0.0': makeSkillZip('1.0.0'), 'v1.1.0': makeSkillZip('1.1.0', { 'SKILL.md': '# Improved MergeReviewer\n', 'scripts/run.py': 'print("ok")\n' }) };
  const prompts: string[] = [];
  const warnings: string[] = [];
  const interaction = makeInteraction(prompts, warnings);
  const client = fakeReleaseClient(packages);
  try {
    await installMergeReviewer(localTarget, makeRelease('v1.0.0'), client, interaction);
    const installed = path.join(sandbox, '.agents', 'skills', 'merge-reviewer');
    assert.equal(await fs.readFile(path.join(installed, 'VERSION'), 'utf8'), '1.0.0');
    await installMergeReviewer(localTarget, makeRelease('v1.0.0'), client, interaction);
    await installMergeReviewer(localTarget, makeRelease('v1.1.0'), client, interaction);
    assert.equal(await fs.readFile(path.join(installed, 'VERSION'), 'utf8'), '1.1.0');
    assert.equal((await fs.readFile(path.join(installed, 'SKILL.md'), 'utf8')).includes('Improved'), true);
    assert.equal(prompts.length, 2);
    assert.equal(warnings.length, 0);
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('blocks MergeReviewer update on edits and extra files without changing the tree', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-test-'));
  const localTarget = { name: 'project', root: sandbox };
  const packages = { 'v1.0.0': makeSkillZip('1.0.0'), 'v1.1.0': makeSkillZip('1.1.0') };
  const warnings: string[] = [];
  const prompts: string[] = [];
  const client = fakeReleaseClient(packages);
  try {
    await installMergeReviewer(localTarget, makeRelease('v1.0.0'), client, makeInteraction(prompts, warnings));
    const installed = path.join(sandbox, '.agents', 'skills', 'merge-reviewer');
    await fs.writeFile(path.join(installed, 'SKILL.md'), 'local edit\n');
    await fs.writeFile(path.join(installed, 'notes.txt'), 'manual extra\n');
    const before = await snapshot(installed);
    await installMergeReviewer(localTarget, makeRelease('v1.1.0'), client, makeInteraction(prompts, warnings));
    assert.deepEqual(await snapshot(installed), before);
    assert.match(warnings.at(-1) ?? '', /SKILL\.md/);
    assert.match(warnings.at(-1) ?? '', /notes\.txt/);
    assert.equal(prompts.length, 1);
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('a bad asset digest fails before the MergeReviewer destination is created', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-test-'));
  const archive = makeSkillZip('1.0.0');
  const release = makeRelease('v1.0.0');
  release.assets = [{ name: 'merge-reviewer-1.0.0.zip', browser_download_url: 'https://github.com/dennis8499/MergeReviewer/releases/download/v1.0.0/merge-reviewer-1.0.0.zip', digest: `sha256:${'0'.repeat(64)}`, size: archive.length }];
  const client = new GitHubReleaseClient(async () => new Response(archive, { status: 200, headers: { 'content-length': String(archive.length) } }));
  try {
    await assert.rejects(() => installMergeReviewer({ name: 'project', root: sandbox }, release, client, makeInteraction()));
    await assert.rejects(() => fs.stat(path.join(sandbox, '.agents')));
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('corrupt MergeReviewer ZIP and historical GitHub failure leave the install tree untouched', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-test-'));
  const targetLocal = { name: 'project', root: sandbox };
  const warnings: string[] = [];
  const prompts: string[] = [];
  const goodClient = fakeReleaseClient({ 'v1.0.0': makeSkillZip('1.0.0') });
  try {
    await installMergeReviewer(targetLocal, makeRelease('v1.0.0'), goodClient, makeInteraction(prompts, warnings));
    const installed = path.join(sandbox, '.agents', 'skills', 'merge-reviewer');
    const corrupt = fakeReleaseClient({ 'v1.1.0': Buffer.from('not a zip') });
    await assert.rejects(() => installMergeReviewer(targetLocal, makeRelease('v1.1.0'), corrupt, makeInteraction(prompts, warnings)));
    const noHistory = {
      async downloadProductArchive(_id: string, release: GitHubRelease) { return release.tag_name === 'v1.1.0' ? makeSkillZip('1.1.0') : Buffer.alloc(0); },
      async getByTag() { throw new Error('GitHub unavailable'); }
    } as unknown as GitHubReleaseClient;
    await assert.rejects(() => installMergeReviewer(targetLocal, makeRelease('v1.1.0'), noHistory, makeInteraction(prompts, warnings)), /GitHub unavailable/);
    assert.deepEqual(await snapshot(installed), { 'SKILL.md': '# MergeReviewer 1.0.0\n', 'VERSION': '1.0.0' });
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('Wiki installer previews exact Codex coexist arguments and applies only after approval', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-test-'));
  const interaction = makeInteraction();
  const calls: Array<{ args: readonly string[]; cwd?: string }> = [];
  const client = {
    async downloadWikiAssets() { return { manifest: {} as never, zip: makeWikiZip('0.2.1') }; }
  } as unknown as GitHubReleaseClient;
  const python: PythonCommand = { executable: 'py', prefixArguments: ['-3'], version: [3, 14, 7] };
  const runner = async (_exe: string, args: readonly string[], options?: { cwd?: string; timeoutMs?: number; maxOutputBytes?: number }): Promise<ProcessResult> => {
    calls.push({ args, cwd: options?.cwd });
    if (args.includes('--apply')) {
      await fs.mkdir(path.join(sandbox, '.agents', 'skills', 'codebase-wiki'), { recursive: true });
      await fs.writeFile(path.join(sandbox, '.agents', 'skills', 'codebase-wiki', 'VERSION'), '0.2.1');
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, applied: true, framework_version: '0.2.1' }), stderr: '' };
    }
    return { exitCode: 0, stdout: JSON.stringify({ ok: true, changes: ['Codex.md'], preserved: ['wiki/custom.md'], conflicts: [], obsolete_paths: [] }), stderr: '' };
  };
  try {
    await installWiki({ name: 'project', root: sandbox }, makeRelease('v0.2.1'), client, interaction, runner, async () => python);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].args.includes('--apply'), false);
    assert.equal(calls[1].args.includes('--apply'), true);
    assert.deepEqual(calls[0].args.slice(2), ['install', '--target', sandbox, '--surface', 'codex', '--guard-mode', 'coexist', '--format', 'json']);
    assert.equal(await fs.readFile(path.join(sandbox, '.agents', 'skills', 'codebase-wiki', 'VERSION'), 'utf8'), '0.2.1');
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('Wiki upgrade uses upstream upgrade, preserves wiki files, and repeats without applying changes', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-test-'));
  const localWikiFile = path.join(sandbox, 'wiki', 'custom.md');
  const installedVersionFile = path.join(sandbox, '.agents', 'skills', 'codebase-wiki', 'VERSION');
  await fs.mkdir(path.dirname(installedVersionFile), { recursive: true });
  await fs.writeFile(installedVersionFile, '0.2.0');
  await fs.mkdir(path.dirname(localWikiFile), { recursive: true });
  await fs.writeFile(localWikiFile, '# Local wiki content\n');
  const prompts: string[] = [];
  const calls: Array<{ args: readonly string[]; cwd?: string }> = [];
  const interaction = makeInteraction(prompts, []);
  const client = {
    async downloadWikiAssets() { return { manifest: {} as never, zip: makeWikiZip('0.2.1') }; }
  } as unknown as GitHubReleaseClient;
  const python: PythonCommand = { executable: 'py', prefixArguments: ['-3'], version: [3, 14, 7] };
  const runner = async (_exe: string, args: readonly string[], options?: { cwd?: string }): Promise<ProcessResult> => {
    calls.push({ args, cwd: options?.cwd });
    if (args.includes('--apply')) {
      await fs.writeFile(installedVersionFile, '0.2.1');
      return { exitCode: 0, stdout: JSON.stringify({ ok: true, applied: true, framework_version: '0.2.1' }), stderr: '' };
    }
    const repeat = calls.filter(call => !call.args.includes('--apply')).length > 1;
    return {
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, action: 'upgrade', framework_version: '0.2.1', changes: repeat ? [] : ['Codex.md'], preserved: ['wiki/custom.md'], conflicts: [], obsolete_paths: [] }),
      stderr: ''
    };
  };
  try {
    await installWiki({ name: 'project', root: sandbox }, makeRelease('v0.2.1'), client, interaction, runner, async () => python, sandbox);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(call => call.args[2]), ['upgrade', 'upgrade']);
    assert.equal(calls[0].args.includes('--apply'), false);
    assert.equal(calls[1].args.includes('--apply'), true);
    assert.deepEqual(calls.map(call => call.args[call.args.indexOf('--target') + 1]), [sandbox, sandbox]);
    assert.equal((await fs.readFile(installedVersionFile, 'utf8')).trim(), '0.2.1');
    assert.equal(await fs.readFile(localWikiFile, 'utf8'), '# Local wiki content\n');

    await installWiki({ name: 'project', root: sandbox }, makeRelease('v0.2.1'), client, interaction, runner, async () => python, sandbox);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].args[2], 'upgrade');
    assert.equal(calls[2].args.includes('--apply'), false);
    assert.equal(prompts.length, 1);
    assert.equal(await fs.readFile(localWikiFile, 'utf8'), '# Local wiki content\n');
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('Wiki Python or GitHub failure does not apply files', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-test-'));
  const client = { async downloadWikiAssets() { throw new Error('GitHub unavailable'); } } as unknown as GitHubReleaseClient;
  try {
    await assert.rejects(() => installWiki({ name: 'project', root: sandbox }, makeRelease('v0.2.1'), client, makeInteraction()), /GitHub unavailable/);
    const failingClient = { async downloadWikiAssets() { return { manifest: {} as never, zip: makeWikiZip('0.2.1') }; } } as unknown as GitHubReleaseClient;
    await assert.rejects(() => installWiki({ name: 'project', root: sandbox }, makeRelease('v0.2.1'), failingClient, makeInteraction(), async () => { throw new Error('Python 3.11 or newer was not found'); }), /Python 3.11/);
    await assert.rejects(() => fs.stat(path.join(sandbox, '.agents')));
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('Wiki upstream conflicts are shown and never followed by an apply call', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-test-'));
  const calls: string[][] = [];
  const warnings: string[] = [];
  const interaction = makeInteraction([], warnings);
  const client = { async downloadWikiAssets() { return { manifest: {} as never, zip: makeWikiZip('0.2.1') }; } } as unknown as GitHubReleaseClient;
  try {
    await installWiki({ name: 'project', root: sandbox }, makeRelease('v0.2.1'), client, interaction,
      async (_exe, args) => {
        calls.push([...args]);
        return { exitCode: 2, stdout: JSON.stringify({ ok: false, changes: ['Codex.md'], preserved: ['wiki/custom.md'], conflicts: ['.codex/config.toml'], obsolete_paths: [] }), stderr: '' };
      },
      async () => ({ executable: 'py', prefixArguments: ['-3'], version: [3, 11, 0] }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].includes('--apply'), false);
    assert.match(warnings[0], /config\.toml/);
    assert.match(warnings[0], /wiki\/custom\.md/);
    await assert.rejects(() => fs.stat(path.join(sandbox, '.agents')));
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('installs all Megin skills with version metadata, Git-root warning, and repeat-safe status', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-megin-'));
  const packages = { 'v0.1.0': makeMeginZip('0.1.0') };
  const prompts: string[] = [];
  const warnings: string[] = [];
  const informs: string[] = [];
  const interaction = makeInteraction(prompts, warnings);
  const wrapped: InstallInteraction = { ...interaction, async inform(message) { informs.push(message); } };
  try {
    await installMegin({ name: 'repo', root: sandbox, isGitRepo: true }, makeMeginRelease('v0.1.0', packages['v0.1.0']), makeMeginClient(packages), wrapped);
    const skillsRoot = path.join(sandbox, '.agents', 'skills');
    assert.deepEqual((await fs.readdir(skillsRoot)).sort(), [...MEGIN_SKILL_DIRECTORIES].sort());
    for (const directory of MEGIN_SKILL_DIRECTORIES) assert.match(await fs.readFile(path.join(skillsRoot, directory, 'SKILL.md'), 'utf8'), /0\.1\.0/);
    const markerPath = path.join(sandbox, '.agents', 'manage-extensions', 'megin.json');
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8')) as { version: string; tag: string; assetSha256: string; managedDirectories: string[] };
    assert.equal(marker.version, '0.1.0');
    assert.equal(marker.tag, 'v0.1.0');
    assert.equal(marker.assetSha256, createHash('sha256').update(packages['v0.1.0']).digest('hex'));
    assert.deepEqual(marker.managedDirectories, [...MEGIN_SKILL_DIRECTORIES]);
    assert.equal(await readMeginInstalledVersion(sandbox), '0.1.0');
    assert.match(prompts[0], /non-Git|Git repository/i);
    assert.match(prompts[0], /\.agents\/skills\/megin\/SKILL\.md/);
    assert.match(prompts[0], /\.agents\/manage-extensions\/megin\.json/);
    assert.equal(warnings.length, 0);
    await installMegin({ name: 'repo', root: sandbox, isGitRepo: true }, makeMeginRelease('v0.1.0', packages['v0.1.0']), makeMeginClient(packages), wrapped);
    assert.equal(prompts.length, 1);
    assert.match(informs.at(-1) ?? '', /already installed/i);
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('updates clean Megin content but blocks edits, extra files, and unmanaged skill directories', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-megin-'));
  const packages = { 'v0.1.0': makeMeginZip('0.1.0'), 'v0.2.0': makeMeginZip('0.2.0') };
  const warnings: string[] = [];
  const prompts: string[] = [];
  const client = makeMeginClient(packages);
  try {
    await installMegin({ name: 'group', root: sandbox }, makeMeginRelease('v0.1.0', packages['v0.1.0']), client, makeInteraction(prompts, warnings));
    await installMegin({ name: 'group', root: sandbox }, makeMeginRelease('v0.2.0', packages['v0.2.0']), client, makeInteraction(prompts, warnings));
    assert.match(await fs.readFile(path.join(sandbox, '.agents', 'skills', 'megin', 'SKILL.md'), 'utf8'), /0\.2\.0/);
    assert.match(prompts[1], /\.agents\/skills\/megin\/SKILL\.md/);
    assert.match(prompts[1], /\.agents\/manage-extensions\/megin\.json/);
    const marker = JSON.parse(await fs.readFile(path.join(sandbox, '.agents', 'manage-extensions', 'megin.json'), 'utf8')) as { version: string };
    assert.equal(marker.version, '0.2.0');
    assert.equal(warnings.length, 0);

    const edited = path.join(sandbox, '.agents', 'skills', 'megin', 'SKILL.md');
    await fs.writeFile(edited, 'local edit\n');
    await fs.writeFile(path.join(sandbox, '.agents', 'skills', 'megin', 'notes.txt'), 'manual file\n');
    const before = await fullSnapshot(path.join(sandbox, '.agents', 'skills'));
    await installMegin({ name: 'group', root: sandbox }, makeMeginRelease('v0.3.0', makeMeginZip('0.3.0')), makeMeginClient({ 'v0.3.0': makeMeginZip('0.3.0'), 'v0.2.0': packages['v0.2.0'] }), makeInteraction(prompts, warnings));
    assert.deepEqual(await fullSnapshot(path.join(sandbox, '.agents', 'skills')), before);
    assert.match(warnings.at(-1) ?? '', /megin\/SKILL\.md/);
    assert.match(warnings.at(-1) ?? '', /notes\.txt/);

    const unmanaged = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-megin-unmanaged-'));
    try {
      await fs.mkdir(path.join(unmanaged, '.agents', 'skills', 'megin-code-review'), { recursive: true });
      await fs.writeFile(path.join(unmanaged, '.agents', 'skills', 'megin-code-review', 'SKILL.md'), 'local skill\n');
      const unmanagedBefore = await fullSnapshot(path.join(unmanaged, '.agents', 'skills'));
      await installMegin({ name: 'group', root: unmanaged }, makeMeginRelease('v0.1.0', packages['v0.1.0']), client, makeInteraction([], warnings));
      assert.deepEqual(await fullSnapshot(path.join(unmanaged, '.agents', 'skills')), unmanagedBefore);
      assert.match(warnings.at(-1) ?? '', /unmanaged|already exists/i);
    } finally { await fs.rm(unmanaged, { recursive: true, force: true }); }
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('rolls back all Megin skill directories and version metadata when a staged rename fails', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-megin-rollback-'));
  const packages = { 'v0.1.0': makeMeginZip('0.1.0'), 'v0.2.0': makeMeginZip('0.2.0') };
  const client = makeMeginClient(packages);
  try {
    await installMegin({ name: 'group', root: sandbox }, makeMeginRelease('v0.1.0', packages['v0.1.0']), client, makeInteraction());
    const beforeSkills = await fullSnapshot(path.join(sandbox, '.agents', 'skills'));
    const markerPath = path.join(sandbox, '.agents', 'manage-extensions', 'megin.json');
    const beforeMarker = await fs.readFile(markerPath, 'utf8');
    let replacementMoves = 0;
    let failed = false;
    const ops = { async rename(from: string, to: string) {
      if (from.includes(`${path.sep}payload${path.sep}`) && !failed && ++replacementMoves === 5) { failed = true; throw new Error('simulated rename failure'); }
      await fs.rename(from, to);
    } };
    await assert.rejects(() => installMegin({ name: 'group', root: sandbox }, makeMeginRelease('v0.2.0', packages['v0.2.0']), client, makeInteraction(), undefined, ops), /simulated rename failure/);
    assert.equal(failed, true);
    assert.deepEqual(await fullSnapshot(path.join(sandbox, '.agents', 'skills')), beforeSkills);
    assert.equal(await fs.readFile(markerPath, 'utf8'), beforeMarker);
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

test('rejects an invalid Megin archive before creating target files', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-megin-'));
  const invalid = makeMeginZip('0.1.0', { missingSkill: MEGIN_SKILL_DIRECTORIES[0] });
  try {
    await assert.rejects(() => installMegin({ name: 'group', root: sandbox }, makeMeginRelease('v0.1.0', invalid), makeMeginClient({ 'v0.1.0': invalid }), makeInteraction()), /missing.*SKILL\.md/i);
    await assert.rejects(() => fs.stat(path.join(sandbox, '.agents')));
  } finally { await fs.rm(sandbox, { recursive: true, force: true }); }
});

function fakeReleaseClient(packages: Record<string, Buffer>): GitHubReleaseClient {
  return {
    async getByTag(_repository: string, tag: string) { return makeRelease(tag); },
    async downloadProductArchive(_id: string, release: GitHubRelease) {
      const archive = packages[release.tag_name];
      if (!archive) throw new Error(`No fixture for ${release.tag_name}`);
      return archive;
    }
  } as unknown as GitHubReleaseClient;
}

function makeRelease(tag: string): GitHubRelease { return { tag_name: tag, prerelease: false, draft: false, assets: [] }; }

function makeMeginRelease(tag: string, zip: Buffer): GitHubRelease {
  return {
    tag_name: tag, prerelease: false, draft: false,
    assets: [{ name: 'megin-skills.zip', browser_download_url: `https://github.com/dennis8499/Megin/releases/download/${tag}/megin-skills.zip`, digest: `sha256:${createHash('sha256').update(zip).digest('hex')}`, size: zip.length }]
  };
}

function makeMeginClient(packages: Record<string, Buffer>): GitHubReleaseClient {
  return {
    async getByTag(_repository: string, tag: string) {
      const archive = packages[tag];
      if (!archive) throw new Error(`No Megin fixture for ${tag}`);
      return makeMeginRelease(tag, archive);
    },
    async downloadProductArchive(_id: string, release: GitHubRelease) {
      const archive = packages[release.tag_name];
      if (!archive) throw new Error(`No Megin fixture for ${release.tag_name}`);
      return archive;
    }
  } as unknown as GitHubReleaseClient;
}

function makeInteraction(prompts: string[] = [], warnings: string[] = []): InstallInteraction {
  return {
    async confirm(title, message, paths) { prompts.push([title, message, ...paths].join('\n')); return true; },
    async inform() {},
    async warn(message) { warnings.push(message); }
  };
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of await fs.readdir(root)) {
    const fullPath = path.join(root, name);
    const stat = await fs.lstat(fullPath);
    if (stat.isFile()) result[name] = await fs.readFile(fullPath, 'utf8');
  }
  return result;
}

async function fullSnapshot(root: string): Promise<Record<string, string>> {
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
