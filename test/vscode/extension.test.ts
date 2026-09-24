import * as assert from 'assert';
import * as vscode from 'vscode';
import { getProduct } from '../../src/catalog';
import { ProductGuideView } from '../../src/productGuideView';

suite('ManageExtensions VS Code host', () => {
  test('activates its Activity Bar view and install, update, and check commands', async () => {
    const extension = vscode.extensions.getExtension('dennis8499.manage-extensions');
    assert.ok(extension, 'extension must be discoverable in the VS Code test host');
    await extension.activate();
    assert.equal(vscode.workspace.getConfiguration('manageExtensions').get('checkUpdatesOnStartup'), false);
    const commands = await vscode.commands.getCommands(true);
    for (const command of ['manageExtensions.install', 'manageExtensions.update', 'manageExtensions.checkUpdates', 'manageExtensions.refresh', 'manageExtensions.showDetails', 'manageExtensions.copyKeyword']) {
      assert.ok(commands.includes(command), `${command} should be registered`);
    }
    const manifest = extension.packageJSON as { contributes: { viewsContainers: { activitybar: Array<{ id: string }> }; views: Record<string, Array<{ id: string }>> } };
    assert.ok(manifest.contributes.viewsContainers.activitybar.some(view => view.id === 'manageExtensions'));
    assert.ok(manifest.contributes.views.manageExtensions.some(view => view.id === 'manageExtensions.products'));
    await vscode.commands.executeCommand('manageExtensions.refresh');
  });

  test('opens guides and copies a Codex keyword without installing a product', async () => {
    await vscode.commands.executeCommand('manageExtensions.showDetails', 'merge-reviewer');
    await waitForTab('MergeReviewer');
    await vscode.commands.executeCommand('manageExtensions.copyKeyword', 'merge-reviewer');
    assert.equal(await vscode.env.clipboard.readText(), '$merge-reviewer');
    await vscode.commands.executeCommand('manageExtensions.showDetails', 'codebase-llm-wiki');
    await waitForTab('Codebase LLM Wiki');
    await vscode.commands.executeCommand('manageExtensions.showDetails', 'megin');
    await waitForTab('Megin');
    await vscode.commands.executeCommand('manageExtensions.copyKeyword', 'megin');
    assert.equal(await vscode.env.clipboard.readText(), '$megin');
  });

  test('copies an edited webview template exactly and rejects an unknown template', async () => {
    const view = new ProductGuideView();
    const product = getProduct('merge-reviewer')!;
    view.show(product, async () => {});
    try {
      const edited = '$merge-reviewer 快速審查 遠端=upstream\n請檢查這次合併。';
      await view.handleMessage({ action: 'copy-template', productId: product.id, featureId: 'quick-review', text: edited });
      assert.equal(await vscode.env.clipboard.readText(), edited);
      await view.handleMessage({ action: 'copy-template', productId: product.id, featureId: 'unknown', text: 'bad' });
      assert.equal(await vscode.env.clipboard.readText(), edited);
    } finally {
      view.dispose();
    }
  });
});

async function waitForTab(label: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.label.includes(label)))) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`Expected guide tab containing ${label}; found ${vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => tab.label)).join(', ')}`);
}
