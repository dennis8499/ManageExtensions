import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { ProductDefinition } from './catalog';
import { getProductGuide } from './productGuides';
import { copyGuideRequest, renderProductGuideHtml } from './productGuidePage';

export async function copyProductKeyword(productId: string): Promise<string> {
  const guide = getProductGuide(productId);
  if (!guide) throw new Error('找不到這個工具的使用指南。');
  await copyGuideRequest(guide, { action: 'copy-keyword', productId }, text => vscode.env.clipboard.writeText(text));
  return guide.keyword;
}

export class ProductGuideView implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private selectedProduct: ProductDefinition | undefined;
  private installSelected: (() => Promise<void>) | undefined;

  show(product: ProductDefinition, install: () => Promise<void>): void {
    const guide = getProductGuide(product.id);
    if (!guide) throw new Error(`Unknown guide product: ${product.id}`);
    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel('manageExtensions.productGuide', '', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true
      });
      this.panel = panel;
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.selectedProduct = undefined;
        this.installSelected = undefined;
      });
      panel.webview.onDidReceiveMessage(message => { void this.handleMessage(message); });
    } else {
      this.panel.reveal(vscode.ViewColumn.Active);
    }
    this.selectedProduct = product;
    this.installSelected = install;
    this.panel.title = `${product.title} · 使用指南`;
    this.panel.webview.html = renderProductGuideHtml(guide, randomBytes(16).toString('hex'));
  }

  dispose(): void {
    this.panel?.dispose();
  }

  async handleMessage(message: unknown): Promise<void> {
    const product = this.selectedProduct;
    if (!product || !message || typeof message !== 'object') return;
    const request = message as Record<string, unknown>;
    if (request.productId !== product.id) return;
    const guide = getProductGuide(product.id);
    if (!guide) return;
    try {
      switch (request.action) {
        case 'copy-keyword':
        case 'copy-template': {
          await copyGuideRequest(guide, request, text => vscode.env.clipboard.writeText(text));
          await this.postStatus(product.id, request.action === 'copy-keyword' ? '關鍵字已複製。' : '模板已複製，可貼上後繼續修改。');
          return;
        }
        case 'install':
          await this.installSelected?.();
          return;
        case 'open-docs':
          await vscode.env.openExternal(vscode.Uri.parse(guide.sourceUrl));
          return;
        case 'open-release':
          await vscode.env.openExternal(vscode.Uri.parse(product.releasePage));
          return;
        default:
          return;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.postStatus(product.id, `操作失敗：${reason}`);
    }
  }

  private async postStatus(productId: string, text: string): Promise<void> {
    if (this.panel && this.selectedProduct?.id === productId) {
      await this.panel.webview.postMessage({ action: 'status', text });
    }
  }
}
