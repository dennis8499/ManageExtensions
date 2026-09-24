import * as vscode from 'vscode';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getProduct, PRODUCT_CATALOG, type ProductDefinition } from './catalog';
import { installMergeReviewer } from './adapters/mergeReviewerInstaller';
import { type InstallInteraction } from './adapters/interaction';
import { installWiki } from './adapters/wikiInstaller';
import { GitHubReleaseClient, type GitHubRelease } from './github/releases';
import { compareVersions, parseStableVersionTag } from './version';
import { eligibleGitWorkspace, resolveInstallTarget, type InstallTarget, type WorkspaceCandidate } from './workspace/target';
import { copyProductKeyword, ProductGuideView } from './productGuideView';

const CHECK_CACHE_KEY = 'manageExtensions.releaseChecks';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface ReleaseCheck {
  readonly version?: string;
  readonly tag?: string;
  readonly url?: string;
  readonly checkedAt: number;
  readonly error?: string;
}

class ProductTreeItem extends vscode.TreeItem {
  constructor(readonly productId: string) {
    super('', vscode.TreeItemCollapsibleState.None);
    this.id = productId;
    this.contextValue = 'manageExtensions.product.notInstalled';
  }
}

class ProductProvider implements vscode.TreeDataProvider<ProductTreeItem> {
  private readonly emitter = new vscode.EventEmitter<ProductTreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh(): void { this.emitter.fire(undefined); }
  dispose(): void { this.emitter.dispose(); }
  getTreeItem(item: ProductTreeItem): vscode.TreeItem { return item; }

  async getChildren(): Promise<ProductTreeItem[]> {
    const target = await this.resolveDisplayTarget();
    const checks = this.context.globalState.get<Record<string, ReleaseCheck>>(CHECK_CACHE_KEY, {});
    const products = await Promise.all(PRODUCT_CATALOG.map(async product => {
      const item = new ProductTreeItem(product.id);
      item.label = product.title;
      item.command = { command: 'manageExtensions.showDetails', title: '查看功能與模板', arguments: [product.id] };
      const check = checks[product.id];
      if (target) {
        const installed = await readInstalledVersion(target.root, product);
        if (installed) {
          const available = check?.version && isNewer(check.version, installed);
          item.description = check?.error
            ? `Installed ${installed} · update check failed`
            : available
              ? `Installed ${installed} · update available ${check.version}`
              : `Installed ${installed}${check?.version ? ' · up to date' : ''}`;
          item.contextValue = available ? 'manageExtensions.product.outdated' : 'manageExtensions.product.installed';
        } else {
          item.description = check?.version ? `Not installed · latest ${check.version}` : check?.error ? 'Not installed · release check failed' : 'Not installed';
          item.contextValue = 'manageExtensions.product.notInstalled';
        }
      } else if (!isWindowsTrusted()) {
        item.description = process.platform !== 'win32' ? 'Windows required' : 'Trust a workspace to install';
        item.contextValue = 'manageExtensions.product.unavailable';
      } else {
        item.description = 'Select a local Git repository to show status';
        item.contextValue = 'manageExtensions.product.unavailable';
      }
      if (!check && !item.description) item.description = 'Release status not checked';
      return item;
    }));
    return products;
  }

  private async resolveDisplayTarget(): Promise<InstallTarget | undefined> {
    if (!isWindowsTrusted()) return undefined;
    const folders = vscode.workspace.workspaceFolders ?? [];
    let folder: vscode.WorkspaceFolder | undefined;
    if (folders.length === 1) folder = folders[0];
    else {
      const active = vscode.window.activeTextEditor?.document.uri;
      if (active) folder = vscode.workspace.getWorkspaceFolder(active);
    }
    if (!folder) return undefined;
    const candidate = candidateFromFolder(folder);
    return candidate ? eligibleGitWorkspace(candidate) : undefined;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const client = new GitHubReleaseClient();
  const provider = new ProductProvider(context);
  const guideView = new ProductGuideView();
  context.subscriptions.push(provider, guideView, vscode.window.registerTreeDataProvider('manageExtensions.products', provider));

  context.subscriptions.push(
    vscode.commands.registerCommand('manageExtensions.install', async (argument?: unknown) => {
      await runInstallCommand(context, client, provider, argument);
    }),
    vscode.commands.registerCommand('manageExtensions.update', async (argument?: unknown) => {
      await runInstallCommand(context, client, provider, argument);
    }),
    vscode.commands.registerCommand('manageExtensions.checkUpdates', async () => {
      await checkUpdates(context, client, provider, true);
    }),
    vscode.commands.registerCommand('manageExtensions.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('manageExtensions.showDetails', async (argument?: unknown) => {
      const product = productFromArgument(argument) ?? await selectProduct();
      if (product) guideView.show(product, () => runInstallCommand(context, client, provider, product.id));
    }),
    vscode.commands.registerCommand('manageExtensions.copyKeyword', async (argument?: unknown) => {
      const product = productFromArgument(argument) ?? await selectProduct();
      if (!product) return;
      try {
        const keyword = await copyProductKeyword(product.id);
        vscode.window.setStatusBarMessage(`已複製 ${keyword}`, 3000);
      } catch (error) {
        await vscode.window.showErrorMessage(errorMessage(error));
      }
    }),
    vscode.commands.registerCommand('manageExtensions.openRelease', async (argument?: unknown) => {
      const product = productFromArgument(argument) ?? await selectProduct();
      if (product) await vscode.env.openExternal(vscode.Uri.parse(product.releasePage));
    })
  );

  const setting = vscode.workspace.getConfiguration('manageExtensions').get<boolean>('checkUpdatesOnStartup', true);
  if (setting) {
    const checks = context.globalState.get<Record<string, ReleaseCheck>>(CHECK_CACHE_KEY, {});
    const newestCheck = Math.max(0, ...Object.values(checks).map(check => check.checkedAt));
    if (Date.now() - newestCheck >= CHECK_INTERVAL_MS) void checkUpdates(context, client, provider, false);
  }
}

export function deactivate(): void { /* VS Code disposes the registered providers. */ }

async function runInstallCommand(context: vscode.ExtensionContext, client: GitHubReleaseClient, provider: ProductProvider, argument?: unknown): Promise<void> {
  const product = productFromArgument(argument) ?? await selectProduct();
  if (!product) return;
  try {
    const target = await selectTarget();
    const release = await client.getLatest(product.repository);
    await storeRelease(context, product, release);
    const interaction = vscodeInteraction();
    if (product.kind === 'wiki') await installWiki(target, release, client, interaction);
    else await installMergeReviewer(target, release, client, interaction);
    provider.refresh();
    await context.globalState.update('manageExtensions.lastTarget', target.root);
  } catch (error) {
    await vscode.window.showErrorMessage(errorMessage(error));
  }
}

async function selectTarget(): Promise<InstallTarget> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const candidates = folders.flatMap(folder => {
    const candidate = candidateFromFolder(folder);
    return candidate ? [candidate] : [];
  });
  return resolveInstallTarget({ platform: process.platform, trusted: vscode.workspace.isTrusted, candidates, forceSelection: folders.length > 1 }, async targets => {
    const choices = targets.map(target => ({ label: target.name, description: target.root, target }));
    return (await vscode.window.showQuickPick(choices, { placeHolder: 'Choose the local Git repository to install into' }))?.target;
  });
}

function candidateFromFolder(folder: vscode.WorkspaceFolder): WorkspaceCandidate | undefined {
  return { name: folder.name, fsPath: folder.uri.fsPath, scheme: folder.uri.scheme };
}

function isWindowsTrusted(): boolean { return process.platform === 'win32' && vscode.workspace.isTrusted; }

function productFromArgument(argument: unknown): ProductDefinition | undefined {
  if (typeof argument === 'string') return getProduct(argument);
  if (argument && typeof argument === 'object' && 'productId' in argument && typeof (argument as { productId?: unknown }).productId === 'string') {
    return getProduct((argument as { productId: string }).productId);
  }
  if (argument && typeof argument === 'object' && 'id' in argument && typeof (argument as { id?: unknown }).id === 'string') return getProduct((argument as { id: string }).id);
  return undefined;
}

async function selectProduct(): Promise<ProductDefinition | undefined> {
  const choices = PRODUCT_CATALOG.map(product => ({ label: product.title, description: product.repository, product }));
  return (await vscode.window.showQuickPick(choices, { placeHolder: 'Choose a curated repository tool' }))?.product;
}

async function checkUpdates(context: vscode.ExtensionContext, client: GitHubReleaseClient, provider: ProductProvider, showSummary: boolean): Promise<void> {
  const oldChecks = context.globalState.get<Record<string, ReleaseCheck>>(CHECK_CACHE_KEY, {});
  const checkedAt = Date.now();
  const results: Array<readonly [string, ReleaseCheck]> = await Promise.all(PRODUCT_CATALOG.map(async (product): Promise<readonly [string, ReleaseCheck]> => {
    try {
      const release: GitHubRelease = await client.getLatest(product.repository);
      const version = parseStableVersionTag(release.tag_name);
      if (!version) throw new Error(`Release tag ${release.tag_name} is not stable SemVer.`);
      return [product.id, { version, tag: release.tag_name, url: release.html_url ?? product.releasePage, checkedAt }] as const;
    } catch (error) {
      return [product.id, { ...oldChecks[product.id], checkedAt, error: errorMessage(error) }] as const;
    }
  }));
  const checks = Object.fromEntries(results);
  await context.globalState.update(CHECK_CACHE_KEY, checks);
  provider.refresh();
  if (showSummary) {
    const fresh = results.filter(([, check]) => !check.error).map(([id, check]) => `${getProduct(id)!.title}: ${check.version}`);
    const failed = results.filter(([, check]) => check.error).map(([id, check]) => `${getProduct(id)!.title}: ${check.error}`);
    const message = [...fresh, ...failed].join('\n') || 'No curated releases were found.';
    if (failed.length) await vscode.window.showWarningMessage(`Release check completed with errors.\n${message}`);
    else await vscode.window.showInformationMessage(`Latest stable releases:\n${message}`);
  }
}

async function storeRelease(context: vscode.ExtensionContext, product: ProductDefinition, release: GitHubRelease): Promise<void> {
  const checks = context.globalState.get<Record<string, ReleaseCheck>>(CHECK_CACHE_KEY, {});
  const version = parseStableVersionTag(release.tag_name);
  if (!version) return;
  await context.globalState.update(CHECK_CACHE_KEY, {
    ...checks,
    [product.id]: { version, tag: release.tag_name, url: release.html_url ?? product.releasePage, checkedAt: Date.now() }
  });
}

async function readInstalledVersion(root: string, product: ProductDefinition): Promise<string | undefined> {
  let file = root;
  const parts = [...product.installRelativePath.split(/[\\/]/), 'VERSION'];
  for (let index = 0; index < parts.length; index++) {
    file = path.join(file, parts[index]);
    try {
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink() || hasReparseAttribute(stat)) return undefined;
      if (index < parts.length - 1 && !stat.isDirectory()) return undefined;
      if (index === parts.length - 1 && !stat.isFile()) return undefined;
    } catch { return undefined; }
  }
  try {
    const version = (await fs.readFile(file, 'utf8')).trim();
    return parseStableVersionTag(version);
  } catch { return undefined; }
}

function isNewer(available: string, installed: string): boolean {
  try { return compareVersions(available, installed) > 0; }
  catch { return false; }
}

function vscodeInteraction(): InstallInteraction {
  return {
    async confirm(title, message, paths) {
      const detail = paths.length ? paths.join('\n') : 'No file paths were reported.';
      return await vscode.window.showInformationMessage(`${title}\n${message}`, { modal: true, detail }, 'Apply', 'Cancel') === 'Apply';
    },
    async inform(message) { await vscode.window.showInformationMessage(message); },
    async warn(message) { await vscode.window.showWarningMessage(message); }
  };
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function hasReparseAttribute(stat: object): boolean {
  if (process.platform !== 'win32') return false;
  const attributes = (stat as { attributes?: number }).attributes ?? 0;
  return (attributes & 0x400) !== 0;
}
