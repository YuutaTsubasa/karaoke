# karaoke

悠太翼歌回用的曲庫、歌詞對時工具與 OBS 卡拉 OK 播放器。使用說明見 README.md；共用規則見 `%USERPROFILE%\Data\10_Projects\tailsmachine-ops\AGENTS.md`，進度寫在 tailsmachine-ops 的 `projects/karaoke/STATUS.md`。

- **`library/` 永遠不進 Git、不上傳**：裡面是伴奏音檔與有版權的歌詞。測試用的歌放 `examples/`，只能是原創或公有領域的內容。
- **這是 public repo**：不要提交私人資料、私人 repo 的程式（例如 bluebolt-ui）、金鑰或本機路徑。
- 字型只用可商用授權（SIL OFL 等），新增字型要在 README 的授權段寫上。
- 桌面 App 是 Go + MyGo（`main.go`），本機伺服器在 `internal/server`（Go），只聽 `127.0.0.1`；不要改成對外。OBS 依賴固定的 `http://127.0.0.1:5180/player.html`。
- 開發：`npm run dev`（Go API :5181＋Vite :5180）；建置：`npm run build`（輸出 `build/windows-amd64/`）；測試：`npm test`（Node＋`go test ./...`）。需要 Go 1.27.3 以上。
- 測試建好的 exe 要用 `glazewm command shell-exec <exe>` 啟動，不要從 Claude 直接執行（MSIX 會把它的 AppData 轉存走）。
- 改 API 要補 `internal/server/server_test.go`。改歌詞格式（`src/lib/lyrics.js`）或排版（`src/lib/schedule.js`）要補 `tests/` 並跑 `npm test`。
- 不要從 Claude 工作階段直接啟動 OBS；OBS 裡的效果請使用者確認。
- 分支 `claude/<主題>`／`codex/<主題>`，成果開 PR，由使用者合併。
