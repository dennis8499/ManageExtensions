# 開發指南

[返回專案首頁](../README.md)

## 環境準備

- Windows 10 或更新版本。
- Node.js 與 npm；GitHub Actions 發版工作流程使用 Node.js 24，本機使用相同主版本可減少環境差異。
- Codebase LLM Wiki 與 MergeReviewer 的本機工作區偵測需要 Git 可從 `PATH` 執行；Megin 可使用非 Git 資料夾。
- 測試 VS Code 擴充功能需要下載穩定版 VS Code 測試執行環境；第一次執行時可能需要網路連線。

在專案根目錄安裝鎖定的相依套件：

```powershell
npm ci
```

## 建置與測試

| 命令 | 用途 |
| --- | --- |
| `npm run compile` | 使用 TypeScript 編譯程式與測試。 |
| `npm run test:unit` | 執行單元測試。 |
| `npm run test:acceptance` | 執行 Cucumber 驗收情境。 |
| `npm run test:vscode` | 在 VS Code 測試主機中執行擴充功能測試。 |
| `npm test` | 編譯並依序執行單元、驗收及 VS Code 測試。 |
| `npm run package` | 編譯並封裝 VSIX 至 `dist/`。 |

完整本機驗證流程：

```powershell
npm ci
npm test
npm run package
```

## 新增精選工具

工具來源必須由專案維護者明確加入精選目錄，不能接受使用者提供的任意儲存庫網址。新增來源時，請依序更新：

1. 在 `src/catalog.ts` 加入精確的 GitHub 擁有者/儲存庫、Release 資產名稱、壓縮檔根目錄與安裝路徑。
2. 若上游有專屬安裝或更新流程，在 `src/adapters/` 實作產品安裝器，並接到 `src/extension.ts`。
3. 在 `src/productGuides.ts` 加入指南、關鍵字及可複製模板。
4. 為版本、摘要、壓縮檔路徑、更新保護及錯誤狀況新增單元或驗收測試；行為驗收情境放在 `features/manage-extensions.feature`。
5. 更新首頁與[使用指南](usage.md)的支援工具說明。

下載的 Release 資產須依目前的安全流程驗證版本與 SHA-256 摘要，並驗證壓縮檔路徑後才能寫入工作區。Wiki、單一技能與多技能套件的安裝契約不同，應沿用對應的產品安裝器行為。

## 相關文件

- [使用指南](usage.md)：使用者操作與支援條件。
- [發版指南](releasing.md)：版本更新與 GitHub Actions 發版程序。
