const STABLE_VERSION = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseStableVersionTag(tag: string): string | undefined {
  return STABLE_VERSION.exec(tag)?.slice(1).join('.');
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseStableVersionTag(left);
  const rightParts = parseStableVersionTag(right);
  if (!leftParts || !rightParts) throw new Error('Cannot compare invalid stable versions.');
  const a = leftParts.split('.').map(Number);
  const b = rightParts.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}
