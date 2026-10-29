# karaoke

悠太翼歌回用的曲庫、歌詞對時工具與 OBS 卡拉 OK 播放器。使用說明見 README.md；共用規則見 `%USERPROFILE%\Data\10_Projects\tailsmachine-ops\AGENTS.md`，進度寫在 tailsmachine-ops 的 `projects/karaoke/STATUS.md`。

- **`library/` 永遠不進 Git、不上傳**：裡面是伴奏音檔與有版權的歌詞。測試用的歌放 `examples/`，只能是原創或公有領域的內容。
- 字型只用可商用授權（SIL OFL 等），新增字型要在 README 的授權段寫上。
- 伺服器只聽 `127.0.0.1`；不要改成對外。
- 改歌詞格式（`src/lib/lyrics.js`）或排版（`src/lib/schedule.js`）要補 `tests/` 並跑 `npm test`。
- 不要從 Claude 工作階段直接啟動 OBS；OBS 裡的效果請使用者確認。
- 分支 `claude/<主題>`／`codex/<主題>`，成果開 PR，由使用者合併。
