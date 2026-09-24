import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runProcess, type ProcessOptions, type ProcessResult } from '../process';

export interface WorkspaceCandidate {
  readonly name: string;
  readonly fsPath: string;
  readonly scheme: string;
}

export interface TargetEnvironment {
  readonly platform: string;
  readonly trusted: boolean;
  readonly candidates: readonly WorkspaceCandidate[];
  readonly forceSelection?: boolean;
}

export interface InstallTarget {
  readonly name: string;
  readonly root: string;
  readonly isGitRepo?: boolean;
  readonly repositoryRoot?: string;
}

export type ProcessRunner = (executable: string, args: readonly string[], options?: ProcessOptions) => Promise<ProcessResult>;

export type LocalDriveChecker = (driveRoot: string, runner: ProcessRunner) => Promise<boolean>;

/** Win32 GetDriveType reports fixed and removable local volumes as 3 and 2; mapped drives report 4. */
export async function isLocalWindowsDrive(driveRoot: string, runner: ProcessRunner = runProcess): Promise<boolean> {
  if (!/^[A-Za-z]:\\$/.test(driveRoot)) return false;
  try {
    const result = await runner('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class ManageExtensionsDrive { [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern uint GetDriveType(string root); }'; [Console]::Out.Write([ManageExtensionsDrive]::GetDriveType('${driveRoot}'))`
    ], { timeoutMs: 10_000, maxOutputBytes: 16 * 1024 });
    if (result.exitCode !== 0) return false;
    const driveType = Number(result.stdout.trim());
    return driveType === 2 || driveType === 3;
  } catch {
    return false;
  }
}

export async function eligibleGitWorkspace(
  candidate: WorkspaceCandidate,
  runner: ProcessRunner = runProcess,
  localDriveChecker: LocalDriveChecker = isLocalWindowsDrive
): Promise<InstallTarget | undefined> {
  const local = await eligibleLocalWorkspace(candidate, runner, localDriveChecker);
  if (!local?.repositoryRoot || path.win32.normalize(local.root).toLocaleLowerCase('en-US') !== path.win32.normalize(local.repositoryRoot).toLocaleLowerCase('en-US')) return undefined;
  return { ...local, root: local.repositoryRoot, isGitRepo: true };
}

export async function eligibleLocalWorkspace(
  candidate: WorkspaceCandidate,
  runner: ProcessRunner = runProcess,
  localDriveChecker: LocalDriveChecker = isLocalWindowsDrive
): Promise<InstallTarget | undefined> {
  if (candidate.scheme !== 'file' || !path.win32.isAbsolute(candidate.fsPath) || candidate.fsPath.startsWith('\\\\')) return undefined;
  try {
    const root = await fs.realpath(candidate.fsPath);
    if (path.win32.normalize(candidate.fsPath).toLocaleLowerCase('en-US') !== path.win32.normalize(root).toLocaleLowerCase('en-US')) return undefined;
    if (!await localDriveChecker(path.win32.parse(root).root, runner)) return undefined;
    const stats = await fs.stat(root);
    if (!stats.isDirectory()) return undefined;
    let repositoryRoot: string | undefined;
    try {
      const git = await runner('git', ['rev-parse', '--show-toplevel'], { cwd: root });
      if (git.exitCode === 0) repositoryRoot = await fs.realpath(git.stdout.trim());
    }
    catch { /* Non-Git folders are supported for Megin. */ }
    return { name: candidate.name, root, isGitRepo: repositoryRoot !== undefined, repositoryRoot };
  } catch {
    return undefined;
  }
}

export async function resolveInstallTarget(
  environment: TargetEnvironment,
  choose: (targets: readonly InstallTarget[]) => Promise<InstallTarget | undefined>,
  runner: ProcessRunner = runProcess,
  localDriveChecker: LocalDriveChecker = isLocalWindowsDrive
): Promise<InstallTarget> {
  if (environment.platform !== 'win32') throw new Error('Repository tool installation is supported on Windows only.');
  if (!environment.trusted) throw new Error('Trust this VS Code workspace before installing repository tools.');
  const targets = (await Promise.all(environment.candidates.map(candidate => eligibleGitWorkspace(candidate, runner, localDriveChecker))))
    .filter((target): target is InstallTarget => target !== undefined);
  if (targets.length === 0) throw new Error('Open the repository root of a local Windows Git workspace before installing.');
  if (!environment.forceSelection && environment.candidates.length <= 1 && targets.length === 1) return targets[0];
  const selected = await choose(targets);
  if (!selected || !targets.some(target => target.root === selected.root)) throw new Error('Choose a repository before installing.');
  return selected;
}

export async function resolveMeginInstallTarget(
  environment: TargetEnvironment,
  choose: (targets: readonly InstallTarget[]) => Promise<InstallTarget | undefined>,
  runner: ProcessRunner = runProcess,
  localDriveChecker: LocalDriveChecker = isLocalWindowsDrive
): Promise<InstallTarget> {
  if (environment.platform !== 'win32') throw new Error('Megin skill installation is supported on Windows only.');
  if (!environment.trusted) throw new Error('Trust this VS Code workspace before installing Megin skills.');
  const targets = (await Promise.all(environment.candidates.map(candidate => eligibleLocalWorkspace(candidate, runner, localDriveChecker))))
    .filter((target): target is InstallTarget => target !== undefined);
  if (targets.length === 0) throw new Error('Open a local Windows folder before installing Megin skills.');
  if (!environment.forceSelection && environment.candidates.length <= 1 && targets.length === 1) return targets[0];
  const selected = await choose(targets);
  if (!selected || !targets.some(target => target.root === selected.root)) throw new Error('Choose a local workspace folder before installing Megin skills.');
  return selected;
}
