import * as assert from 'assert';
import * as vscode from 'vscode';

suite('ManageExtensions VS Code host', () => {
  test('activates its Activity Bar view and install, update, and check commands', async () => {
    const extension = vscode.extensions.getExtension('dennis8499.manage-extensions');
    assert.ok(extension, 'extension must be discoverable in the VS Code test host');
    await extension.activate();
    assert.equal(vscode.workspace.getConfiguration('manageExtensions').get('checkUpdatesOnStartup'), false);
    const commands = await vscode.commands.getCommands(true);
    for (const command of ['manageExtensions.install', 'manageExtensions.update', 'manageExtensions.checkUpdates', 'manageExtensions.refresh']) {
      assert.ok(commands.includes(command), `${command} should be registered`);
    }
    const manifest = extension.packageJSON as { contributes: { viewsContainers: { activitybar: Array<{ id: string }> }; views: Record<string, Array<{ id: string }>> } };
    assert.ok(manifest.contributes.viewsContainers.activitybar.some(view => view.id === 'manageExtensions'));
    assert.ok(manifest.contributes.views.manageExtensions.some(view => view.id === 'manageExtensions.products'));
    await vscode.commands.executeCommand('manageExtensions.refresh');
  });
});
