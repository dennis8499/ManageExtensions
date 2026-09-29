# ManageExtensions

ManageExtensions 是適用於 Windows 的 Visual Studio Code 擴充功能，可將精選的 GitHub Releases 工具安裝或更新到目前開啟的本機工作區。它提供工具狀態、版本檢查、使用指南，以及可編輯和複製的 Codex 範例模板。

擴充功能只會從內建的精選目錄取得工具；不接受任意 GitHub 儲存庫網址。版本檢查只通知更新，不會自動安裝。

## 支援工具

| 工具 | 用途 | 安裝位置 |
| --- | --- | --- |
| Codebase LLM Wiki (Codex) | 建立及維護程式碼庫 Wiki。安裝時會顯示上游安裝器的變更預覽。 | `.agents/skills/codebase-wiki/` |
| MergeReviewer | 使用 Codex 技能檢視 Git 變更。 | `.agents/skills/merge-reviewer/` |
| Megin | 安裝一組用於規劃、執行及檢視工作的 12 個技能。 | `.agents/skills/`，版本資訊位於 `.agents/manage-extensions/megin.json` |

安裝或更新前，ManageExtensions 會驗證精選版本與下載檔案。更新遇到本機修改、缺漏或額外檔案時會停止，避免覆寫無法確認的內容；套用前會先顯示預覽並要求確認。

## 系統需求

- Windows 10 或更新版本，以及 Visual Studio Code 1.95 或更新版本。
- Codebase LLM Wiki 與 MergeReviewer 需要 Git 可從 `PATH` 執行；Megin 可安裝到非 Git 的本機資料夾。
- Codebase LLM Wiki 需要 Python 3.11 或更新版本。
- Codebase LLM Wiki 與 MergeReviewer 需要受信任的本機 Git 儲存庫根目錄。
- Megin 可安裝到受信任的本機資料夾，該資料夾不一定要是 Git 儲存庫。

不支援遠端、虛擬、網路磁碟或未受信任的工作區。多根工作區會要求選擇安裝目標。Megin v0.1.0 的上游使用方式預期從非 Git 的 Group 根目錄啟動；ManageExtensions 仍允許將檔案安裝到 Git 根目錄，但會提示其工作流程不保證可用。

## 安裝

若 [GitHub Releases](https://github.com/dennis8499/ManageExtensions/releases) 已提供 VSIX，下載 `manage-extensions-<版本>.vsix`，在 VS Code 命令面板執行 **Extensions: Install from VSIX...**，再選取下載的檔案。

也可以在專案根目錄自行封裝：

```powershell
npm ci
npm run package
```

封裝檔會輸出至 `dist/manage-extensions-<版本>.vsix`。在 VS Code 執行 **Extensions: Install from VSIX...** 並選取該檔案即可安裝。

## 快速開始

1. 在 VS Code 開啟符合需求的本機工作區，並確認工作區已受信任。
2. 在 Activity Bar 開啟 **Manage Extensions**，再展開 **Repo Tools**。
3. 點選工具以閱讀指南、查看 Codex 關鍵字及範例模板。
4. 選擇 **Install / Update**，檢視變更預覽並確認套用。

閱讀指南和複製文字不需要先安裝工具，也不需要符合安裝工作區條件。完整操作方式請參閱[使用指南](docs/usage.md)。

## 更新與設定

擴充功能啟動時預設會檢查精選工具的穩定版 Release，並在 Repo Tools 顯示已安裝版本及可用更新。檢查不會寫入工具檔案；請手動選擇 **Update** 套用更新。

若要關閉啟動檢查，可在 VS Code 設定中將 `manageExtensions.checkUpdatesOnStartup` 設為 `false`。完整指令、設定與疑難排解請參閱[使用指南](docs/usage.md)。

## 延伸文件

- [使用指南](docs/usage.md)：安裝條件、操作方式、命令與疑難排解。
- [開發指南](docs/development.md)：本機建置、測試與新增精選工具。
- [發版指南](docs/releasing.md)：版本更新、標籤及 GitHub Actions 發版流程。

## 授權狀態

目前 `package.json` 將此套件標記為 `UNLICENSED`，專案尚未提供可供再散布或修改的開源授權條款。
