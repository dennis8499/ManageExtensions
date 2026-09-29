import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isLocalWindowsDrive, resolveInstallTarget, resolveMeginInstallTarget, type WorkspaceCandidate } from '../../src/workspace/target';
import { runProcess } from '../../src/process';

test('rejects non-Windows, untrusted, non-file and non-Git workspaces before selection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-ext-workspace-'));
  const candidate: WorkspaceCandidate = { name: 'workspace', fsPath: root, scheme: 'file' };
  try {
    await assert.rejects(() => resolveInstallTarget({ platform: 'linux', trusted: true, candidates: [candidate] }, async () => undefined));
    await assert.rejects(() => resolveInstallTarget({ platform: 'win32', trusted: false, candidates: [candidate] }, async () => undefined));
    await assert.rejects(() => resolveInstallTarget({ platform: 'win32', trusted: true, candidates: [{ ...candidate, scheme: 'vscode-vfs' }] }, async () => undefined));
    await assert.rejects(() => resolveInstallTarget(
      { platform: 'win32', trusted: true, candidates: [candidate] },
      async () => undefined,
      async () => ({ exitCode: 128, stdout: '', stderr: 'not a Git workspace' }),
      async () => true
    ));
    await assert.rejects(() => resolveMeginInstallTarget({ platform: 'linux', trusted: true, candidates: [candidate] }, async () => undefined));
    await assert.rejects(() => resolveMeginInstallTarget({ platform: 'win32', trusted: false, candidates: [candidate] }, async () => undefined));
    await assert.rejects(() => resolveMeginInstallTarget({ platform: 'win32', trusted: true, candidates: [{ ...candidate, scheme: 'vscode-vfs' }] }, async () => undefined));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('requires a selection in multi-root workspaces and resolves only Git repository roots', async t => {
  if (process.platform !== 'win32') { t.skip('Windows local paths are required by the install boundary.'); return; }
  const tempRoot = await fs.realpath(os.tmpdir());
  const first = await fs.mkdtemp(path.join(tempRoot, 'manage-ext-git-a-'));
  const second = await fs.mkdtemp(path.join(tempRoot, 'manage-ext-git-b-'));
  const initFirst = await runProcess('git', ['init', '--quiet'], { cwd: first });
  const initSecond = await runProcess('git', ['init', '--quiet'], { cwd: second });
  assert.equal(initFirst.exitCode, 0);
  assert.equal(initSecond.exitCode, 0);
  let chosen = false;
  try {
    const target = await resolveInstallTarget({
      platform: 'win32', trusted: true, forceSelection: true,
      candidates: [{ name: 'first', fsPath: first, scheme: 'file' }, { name: 'second', fsPath: second, scheme: 'file' }]
    }, async targets => { chosen = true; return targets[1]; }, runProcess, async () => true);
    assert.equal(chosen, true);
    assert.equal(path.win32.normalize(target.root).toLocaleLowerCase('en-US'), path.win32.normalize(await fs.realpath(second)).toLocaleLowerCase('en-US'));
  } finally {
    await fs.rm(first, { recursive: true, force: true });
    await fs.rm(second, { recursive: true, force: true });
  }
});

test('rejects mapped network drives and unknown drive types for Windows install targets', async () => {
  const query = async (driveType: string, exitCode = 0) => isLocalWindowsDrive('Z:\\', async (executable, args) => {
    assert.equal(executable, 'powershell.exe');
    assert.match(args.at(-1) ?? '', /GetDriveType\('Z:\\'\)/);
    return { exitCode, stdout: driveType, stderr: '' };
  });
  assert.equal(await query('3'), true);
  assert.equal(await isLocalWindowsDrive('E:\\', async () => ({ exitCode: 0, stdout: '2', stderr: '' })), true);
  assert.equal(await query('4'), false);
  assert.equal(await query('5'), false);
  assert.equal(await query('3', 1), false);
  assert.equal(await isLocalWindowsDrive('\\\\server\\share\\', async () => ({ exitCode: 0, stdout: '3', stderr: '' })), false);
});

test('Megin target selection accepts Git and non-Git local roots and requires a multi-root choice', async t => {
  if (process.platform !== 'win32') { t.skip('Windows local paths are required by the install boundary.'); return; }
  const tempRoot = await fs.realpath(os.tmpdir());
  const gitRoot = await fs.mkdtemp(path.join(tempRoot, 'manage-ext-megin-git-'));
  const plainRoot = await fs.mkdtemp(path.join(tempRoot, 'manage-ext-megin-plain-'));
  await runProcess('git', ['init', '--quiet'], { cwd: gitRoot });
  const gitCandidate = { name: 'repo', fsPath: gitRoot, scheme: 'file' };
  const plainCandidate = { name: 'group', fsPath: plainRoot, scheme: 'file' };
  try {
    const runner = async (executable: string, _args: readonly string[], options?: { cwd?: string }) => {
      if (executable === 'git' && options?.cwd === gitRoot) return { exitCode: 0, stdout: gitRoot, stderr: '' };
      return { exitCode: 128, stdout: '', stderr: 'not a git repository' };
    };
    let chose = false;
    const selected = await resolveMeginInstallTarget({
      platform: 'win32', trusted: true, forceSelection: true, candidates: [gitCandidate, plainCandidate]
    }, async targets => { chose = true; return targets[1]; }, runner as never, async () => true);
    assert.equal(chose, true);
    assert.equal(selected.root, await fs.realpath(plainRoot));
    assert.equal(selected.isGitRepo, false);
    const git = await resolveMeginInstallTarget({ platform: 'win32', trusted: true, candidates: [gitCandidate] }, async () => undefined, runner as never, async () => true);
    assert.equal(git.isGitRepo, true);
  } finally {
    await fs.rm(gitRoot, { recursive: true, force: true });
    await fs.rm(plainRoot, { recursive: true, force: true });
  }
});
