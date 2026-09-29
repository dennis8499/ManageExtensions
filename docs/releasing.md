# 發版指南

[返回專案首頁](../README.md)

發版由 `.github/workflows/release.yml` 處理。工作流程只接受新建立的穩定版 `vX.Y.Z` 標籤；標籤版本必須與 `package.json` 和 `package-lock.json` 相符，且標籤提交必須已進入 `main`。

## 發版前準備

1. 在功能變更完成後，依 SemVer 更新版本。例如：

   ```powershell
   npm version patch --no-git-tag-version
   ```

   也可依變更幅度使用 `minor` 或 `major`。確認 `package.json` 與 `package-lock.json` 的版本一致。

2. 執行測試與封裝：

   ```powershell
   npm ci
   npm test
   npm run package
   ```

   封裝檔應為 `dist/manage-extensions-<版本>.vsix`。

3. 將版本變更提交並合併至 `main`。發版標籤只能指向可從 `main` 到達的提交。

## 建立並推送標籤

在已同步的 `main` 工作目錄中，從 `package.json` 讀取版本並建立標籤：

```powershell
$version = node -p "require('./package.json').version"
git tag -a "v$version" -m "v$version"
git push origin "v$version"
```

標籤必須是尚未使用的新標籤。不要重用既有標籤；若版本或提交有誤，先依專案發版政策處理，再建立新的正確版本。

## GitHub Actions 驗證與發布

推送 `v*.*.*` 標籤會啟動發版工作流程。CI 會檢查版本與標籤、確認提交位於 `main`、安裝相依套件、執行完整測試、封裝 VSIX，並確認檔名和封裝內的擴充功能版本相符。通過後，工作流程會上傳已驗證的 VSIX，建立只含該 VSIX 的草稿 Release，檢查草稿內容，再將其發布。

如工作流程失敗，先檢查 GitHub Actions 的失敗步驟與日誌。版本驗證失敗時，核對標籤、`package.json`、`package-lock.json`；測試或封裝失敗時，先在本機重現並修正，再依發版政策使用正確的新標籤。

## 安裝已發布的 VSIX

從專案的 [GitHub Releases](https://github.com/dennis8499/ManageExtensions/releases) 下載對應版本的 VSIX。在 VS Code 命令面板執行 **Extensions: Install from VSIX...**，再選取下載檔案。

更多本機建置和測試方式請參閱[開發指南](development.md)；使用說明請參閱[使用指南](usage.md)。
