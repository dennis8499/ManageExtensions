export interface InstallInteraction {
  confirm(title: string, message: string, paths: readonly string[]): Promise<boolean>;
  inform(message: string): Promise<void>;
  warn(message: string): Promise<void>;
}

export function formatPaths(paths: readonly string[], limit = 18): string[] {
  const sorted = [...new Set(paths)].sort();
  const shown = sorted.slice(0, limit);
  if (sorted.length > limit) shown.push(`…and ${sorted.length - limit} more`);
  return shown;
}
