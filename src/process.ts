import { spawn } from 'node:child_process';

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export class ProcessExecutionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProcessExecutionError';
  }
}

export function runProcess(executable: string, args: readonly string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let settled = false;
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const timeout = setTimeout(() => {
      child.kill();
      finishReject(new ProcessExecutionError(`${executable} exceeded the ${timeoutMs} ms timeout.`));
    }, timeoutMs);
    const finishReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        child.kill();
        finishReject(new ProcessExecutionError(`${executable} exceeded the output size limit.`));
      } else stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        child.kill();
        finishReject(new ProcessExecutionError(`${executable} exceeded the output size limit.`));
      } else stderr += chunk.toString('utf8');
    });
    child.once('error', error => finishReject(new ProcessExecutionError(`Could not start ${executable}: ${error.message}`, { cause: error })));
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === null) reject(new ProcessExecutionError(`${executable} exited after ${signal ?? 'an unknown signal'}.`));
      else resolve({ exitCode: code, stdout, stderr });
    });
  });
}

export interface PythonCommand {
  readonly executable: string;
  readonly prefixArguments: readonly string[];
  readonly version: readonly [number, number, number];
}

export async function findPython311(): Promise<PythonCommand> {
  const candidates: Array<{ executable: string; prefixArguments: string[] }> = [
    { executable: 'py', prefixArguments: ['-3'] },
    { executable: 'python', prefixArguments: [] },
    { executable: 'python3', prefixArguments: [] }
  ];
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const result = await runProcess(candidate.executable, [...candidate.prefixArguments, '--version'], { timeoutMs: 10_000, maxOutputBytes: 16 * 1024 });
      const text = `${result.stdout}\n${result.stderr}`;
      const match = /Python\s+(\d+)\.(\d+)\.(\d+)/i.exec(text);
      if (result.exitCode === 0 && match) {
        const version: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
        if (version[0] === 3 && version[1] >= 11) return { ...candidate, version };
        failures.push(`${candidate.executable} is Python ${version.join('.')}; Python 3.11 or newer is required.`);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new ProcessExecutionError(failures.join('\n') || 'Python 3.11 or newer was not found on PATH.');
}
