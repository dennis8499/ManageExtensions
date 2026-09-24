import { getProduct } from './catalog';
import type { ProductGuide } from './productGuides';

const MAX_EDITED_TEMPLATE_LENGTH = 10_000;

export function guideCopyText(guide: ProductGuide, message: unknown): string {
  if (!message || typeof message !== 'object') throw new Error('無效的複製要求。');
  const request = message as Record<string, unknown>;
  if (request.productId !== guide.productId) throw new Error('複製要求與目前工具不符。');
  if (request.action === 'copy-keyword') return guide.keyword;
  if (request.action !== 'copy-template') throw new Error('不支援的複製要求。');
  if (typeof request.featureId !== 'string' || !guide.features.some(feature => feature.id === request.featureId)) {
    throw new Error('找不到這份模板。');
  }
  if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > MAX_EDITED_TEMPLATE_LENGTH) {
    throw new Error('模板必須有內容且少於 10,000 字元。');
  }
  return request.text;
}

export async function copyGuideRequest(
  guide: ProductGuide,
  message: unknown,
  writeText: (text: string) => PromiseLike<void>
): Promise<void> {
  const text = guideCopyText(guide, message);
  await writeText(text);
}

export function renderProductGuideHtml(guide: ProductGuide, nonce: string): string {
  const product = getProduct(guide.productId);
  if (!product) throw new Error(`Unknown guide product: ${guide.productId}`);
  const productId = escapeHtml(guide.productId);
  const featureCards = guide.features.map((feature, index) => `
    <article class="feature" data-search="${escapeHtml(`${feature.title} ${feature.description} ${feature.template}`.toLocaleLowerCase())}">
      <div class="feature-heading">
        <h2>${escapeHtml(feature.title)}</h2>
        <span class="feature-number">${index + 1}</span>
      </div>
      <p>${escapeHtml(feature.description)}</p>
      <label for="template-${escapeHtml(feature.id)}">可編輯模板</label>
      <textarea id="template-${escapeHtml(feature.id)}" rows="3" spellcheck="false">${escapeHtml(feature.template)}</textarea>
      <div class="template-actions">
        <button type="button" data-action="copy-template" data-feature-id="${escapeHtml(feature.id)}">複製模板</button>
        <button type="button" class="secondary" data-action="reset-template" data-feature-id="${escapeHtml(feature.id)}">重設</button>
      </div>
    </article>`).join('');
  const policy = `default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}">
  <title>${escapeHtml(product.title)} 使用指南</title>
  <style nonce="${escapeHtml(nonce)}">
    :root { color-scheme: light dark; }
    body { max-width: 860px; margin: 0 auto; padding: 24px 28px 48px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); line-height: 1.5; }
    h1 { font-size: 1.8rem; margin: 0 0 8px; }
    h2 { font-size: 1.15rem; margin: 0; }
    p { margin: 8px 0 16px; }
    .intro { color: var(--vscode-descriptionForeground); font-size: 1.05rem; }
    .top-actions, .template-actions, .keyword-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .top-actions { margin: 20px 0; }
    button { border: 1px solid var(--vscode-button-background); border-radius: 5px; padding: 7px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; font: inherit; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-foreground); background: transparent; border-color: var(--vscode-panel-border); }
    button.secondary:hover { background: var(--vscode-list-hoverBackground); }
    button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .keyword { padding: 18px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editor-background); }
    .keyword h2 { margin-bottom: 10px; }
    code { font-family: var(--vscode-editor-font-family); font-size: 1rem; }
    .keyword code { padding: 7px 10px; border-radius: 4px; background: var(--vscode-textCodeBlock-background); user-select: all; }
    .hint { color: var(--vscode-descriptionForeground); font-size: .9rem; }
    .features-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-top: 30px; }
    .features-heading h2 { font-size: 1.35rem; }
    input[type="search"] { box-sizing: border-box; width: 100%; margin: 14px 0 18px; padding: 9px 12px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 5px; font: inherit; }
    .feature { padding: 18px; margin: 0 0 14px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; }
    .feature[hidden] { display: none; }
    .feature-heading { display: flex; justify-content: space-between; gap: 12px; }
    .feature-number { color: var(--vscode-descriptionForeground); font-size: .85rem; }
    .feature p { color: var(--vscode-descriptionForeground); }
    label { display: block; margin: 12px 0 6px; font-weight: 600; }
    textarea { box-sizing: border-box; width: 100%; min-height: 84px; padding: 10px; resize: vertical; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 5px; font: var(--vscode-editor-font-size) var(--vscode-editor-font-family); line-height: 1.5; }
    .template-actions { margin-top: 10px; }
    #status { min-height: 1.5em; margin-top: 16px; color: var(--vscode-descriptionForeground); }
    @media (max-width: 600px) { body { padding: 18px 16px 36px; } }
  </style>
</head>
<body data-product-id="${productId}">
  <header>
    <h1>${escapeHtml(product.title)}</h1>
    <p class="intro">${escapeHtml(guide.summary)}</p>
    <div class="top-actions">
      <button type="button" data-action="install">安裝／更新</button>
      <button type="button" class="secondary" data-action="open-docs">上游使用說明</button>
      <button type="button" class="secondary" data-action="open-release">查看 Release</button>
    </div>
    <p class="hint">安裝與更新沿用側邊欄的流程；閱讀與複製範例不需要先安裝。</p>
  </header>
  <section class="keyword" aria-labelledby="keyword-title">
    <h2 id="keyword-title">Codex 關鍵字</h2>
    <div class="keyword-row"><code>${escapeHtml(guide.keyword)}</code><button type="button" data-action="copy-keyword">複製關鍵字</button></div>
  </section>
  <section aria-labelledby="features-title">
    <div class="features-heading"><h2 id="features-title">功能與模板</h2><span id="result-count" class="hint">${guide.features.length} 個功能</span></div>
    <input id="feature-search" type="search" aria-label="搜尋功能" placeholder="搜尋功能或用途">
    <div id="feature-list">${featureCards}</div>
  </section>
  <p id="status" role="status" aria-live="polite"></p>
  <script nonce="${escapeHtml(nonce)}">
    const vscode = acquireVsCodeApi();
    const productId = document.body.dataset.productId;
    const status = document.getElementById('status');
    const search = document.getElementById('feature-search');
    const features = [...document.querySelectorAll('.feature')];
    search.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase();
      let visible = 0;
      for (const feature of features) {
        feature.hidden = !feature.dataset.search.includes(query);
        if (!feature.hidden) visible++;
      }
      document.getElementById('result-count').textContent = visible + ' 個功能';
    });
    document.addEventListener('click', event => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const featureId = button.dataset.featureId;
      if (action === 'reset-template') {
        const field = document.getElementById('template-' + featureId);
        if (field) field.value = field.defaultValue;
        status.textContent = '模板已重設。';
        return;
      }
      if (action === 'copy-template') {
        const field = document.getElementById('template-' + featureId);
        if (field) vscode.postMessage({ action, productId, featureId, text: field.value });
        return;
      }
      vscode.postMessage({ action, productId });
    });
    window.addEventListener('message', event => {
      if (event.data && event.data.action === 'status') status.textContent = event.data.text;
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
