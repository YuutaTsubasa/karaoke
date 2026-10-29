# karaoke — 歌回曲庫與卡拉 OK 字幕

悠太翼歌回直播用的小工具，全部跑在本機：

- **曲庫**：歌名、原唱、作詞作曲、標籤、伴奏音檔、歌詞檔、唱過的場次（日期、直播標題、網址）。
- **歌詞對時**：邊播伴奏邊按鍵打點，逐字（音節）時間碼，日文漢字可以加注音（ruby）。
- **OBS 播放器**：透明背景網頁，JOYSOUND 風格的兩行交替歌詞，逐字由左往右變色（描邊＋漸層），同時播放伴奏。
- **控制台**：直播中切歌、播放暫停、跳轉、音量、歌詞偏移、佇列、記錄唱過；可以放進 OBS 的停駐視窗用快捷鍵操作。

技術：Svelte 5 + Vite，介面元件在 `src/lib/ui/`，字型來自 Fontsource。本機 API 掛在 Vite 伺服器上（`server/api.js`），只聽 `127.0.0.1`。

## 開始

```bash
npm install
```

```bash
npm start
```

打開 http://127.0.0.1:5180 。第一次啟動會產生示範曲的伴奏（`examples/demo/instrumental.wav`）。

| 頁面 | 網址 |
| --- | --- |
| 曲庫 | http://127.0.0.1:5180/ |
| 控制台 | http://127.0.0.1:5180/control.html |
| 歌詞對時 | http://127.0.0.1:5180/timing.html |
| OBS 播放器 | http://127.0.0.1:5180/player.html |

## 資料放哪裡

```
library/            ← 不進 Git（伴奏與有版權的歌詞）
  <歌名>/
    song.json       ← 歌曲資料與唱過的場次
    instrumental.mp3
    lyrics.lrc
examples/demo/      ← 示範曲（原創，CC0），歌詞與 song.json 進 Git，wav 由腳本產生
```

想把曲庫放在別的地方（例如 `Data\20_Assets`）就設環境變數 `KARAOKE_LIBRARY` 指向那個資料夾再 `npm start`。刪除歌曲會把資料夾移到 `library/.trash/`，不會直接刪掉；歌詞存檔前會留一份 `.bak`。

## 新增一首歌

1. 曲庫頁輸入歌名、原唱 →「新增歌曲」。
2. 在編輯區上傳伴奏（mp3／m4a／ogg／opus／wav／flac）。
3. 歌詞三選一：
   - 已經有 `.lrc`（含 Enhanced LRC）或 `.ass`（`{\k}` 卡拉 OK 標記）→ 直接上傳。
   - 只有歌詞文字 → 上傳 `.txt`，或到「歌詞對時」貼上。
4. 到「歌詞對時」逐字打點（見下節），存檔。
5. 「預覽」會開深色背景的播放器確認效果。

## 歌詞對時

1. 選歌，在右邊貼歌詞文字（一行一句），按「套用文字」。注音寫法：
   - `{明日|あした}`：整組注音，整組算一個音節。
   - `{一緒|いっ|しょ}`：每個字各自的讀音，各自打點。
   - 小字假名（ゃ、っ…）、長音、標點會自動併進前一個音節；英文以單字為單位。
2. 按「播放」（<kbd>Enter</kbd>），每唱到一個音節按一下 <kbd>Space</kbd>（或 <kbd>F</kbd>、<kbd>J</kbd>）。
   - **點擊模式**（預設）：按下＝這個音節開始，前一個音節同時結束。**每行最後一個音節要按住，唱完再放開**，放開的時間就是這行結束。
   - **按住模式**：每個音節都是按下開始、放開結束，適合中間有停頓的歌。
3. 打錯按 <kbd>Backspace</kbd> 退一個（會倒回 2 秒重打）；點任何音節可以從那裡重打。
4. 難打的段落把速度調到 0.75× 或 0.5×。「反應補償」會把每一下往前扣（預設 0.05 秒）。
5. 上方預覽即時顯示效果；整體或單行可以 ±0.05 秒微調。存檔寫成 `lyrics.lrc`，文字原稿存在 `song.json` 的 `lyricsSource`，之後改字再套用，已打的行會保留。

## OBS 設定

1. **來源 → ＋ → 瀏覽器**，網址填 `http://127.0.0.1:5180/player.html`，寬 `1920`、高 `1080`。
2. 勾 **「透過 OBS 控制音訊」**（伴奏才會進 OBS 混音器，可以調音量、加濾鏡、決定要不要進監聽）。
3. 「自訂 CSS」維持預設（背景透明）。
4. **停駐視窗 → 自訂瀏覽器停駐視窗**，加一個 `http://127.0.0.1:5180/control.html`，直播時在 OBS 裡就能切歌。停駐視窗有焦點時可以用下面的快捷鍵。

播放器網址參數：

| 參數 | 值 | 說明 |
| --- | --- | --- |
| `theme` | `blue`（預設）／`pink`／`yellow`／`classic` | 配色 |
| `font` | `rounded`（M PLUS Rounded 1c，預設）／`maru`（Zen Maru Gothic）／`gothic`（Noto Sans JP） | 字型 |
| `size` | 數字，畫面高度的 %（預設 8） | 字級 |
| `bottom` | 數字，畫面高度的 %（預設 6） | 歌詞離底部 |
| `song` | 歌曲 id（資料夾名） | 開啟時先載入 |
| `autoplay` | `1` | 跟 `song` 一起用，載入就播放 |
| `title` | `0` | 不顯示開頭的歌名卡 |
| `bg` | `1` | 深色背景，給瀏覽器預覽用（OBS 裡不要加） |

控制台的「OBS 播放器」區可以選配色字型、「套用到播放器」即時改，或複製網址。

### 快捷鍵（控制台與播放器）

| 鍵 | 動作 |
| --- | --- |
| <kbd>Space</kbd> | 播放／暫停 |
| <kbd>←</kbd> <kbd>→</kbd> | 倒退／快轉 5 秒 |
| <kbd>↑</kbd> <kbd>↓</kbd> | 音量（控制台） |
| <kbd>[</kbd> <kbd>]</kbd> | 歌詞提早／延後 0.05 秒（「存到這首歌」會寫進 `song.json` 的 `offset`） |
| <kbd>R</kbd> | 從頭 |
| <kbd>S</kbd> | 停止（控制台） |
| <kbd>H</kbd> | 隱藏／顯示歌詞 |
| <kbd>N</kbd> | 播佇列的下一首（控制台） |

### Stream Deck 等外部按鈕

`GET` 也能下指令，Stream Deck 的「網站」動作（勾「在背景 GET 請求」）填：

```
http://127.0.0.1:5180/api/command?action=toggle
http://127.0.0.1:5180/api/command?action=seekBy&delta=-5
http://127.0.0.1:5180/api/command?action=load&id=<歌曲id>&autoplay=1
```

指令：`load`（`id`、`autoplay`）、`play`、`pause`、`toggle`、`stop`、`restart`、`seek`（`time`）、`seekBy`（`delta`）、`volume`（`value` 0–1）、`offset`（`delta` 或 `value`）、`lyrics`（`show` 省略＝切換）、`style`（`theme`、`font`、`size`、`bottom`）、`unload`、`reload`。

## 歌詞格式

原生格式是 **Enhanced LRC** 加注音標記：

```
[ti:青い風（示範曲）]
[ar:悠太翼]
[offset:0]
[00:09.60]<00:09.60>{青|あお}<00:10.20>い<00:10.80>{風|かぜ}<00:11.40>が<00:12.00>…る<00:14.10>
[00:28.20]
[00:33.60]<00:33.60>今<00:33.90>天…
```

- `[mm:ss.xx]` 開始一行；`<mm:ss.xx>` 是下一個音節的開始（也是上一個的結束），行尾最後一個 `<>` 是這行結束。兩個 `<>` 連在一起表示中間停頓。
- `{漢字|かんじ}` 是注音；其他 LRC 播放器會把它當成普通文字。
- 空白的 `[mm:ss.xx]` 行表示間奏（前一行在這裡結束）。
- 沒有 `<>` 的普通 LRC 行會在這行到下一行之間平均變色（逐句）。
- `[offset:毫秒]` 照 LRC 慣例處理；`song.json` 的 `offset`（秒）另外疊加。
- 也能讀 ASS／SSA 的 `{\k}`、`{\kf}`、`{\ko}`（唯讀匯入，存檔一律寫成 LRC）。

## 顯示規則（JOYSOUND 風格）

- 第 1、3、5… 行在上排靠左，第 2、4、6… 行在下排靠右。
- 一行最多在開唱前 3.2 秒出現；同一排的上一行唱完 0.25 秒後才換上。
- 前面空了 4.5 秒以上的行，開唱前 2.4 秒會出現四顆倒數點；間奏後一律從上排開始。
- 一開始會顯示歌名卡（歌名、原唱、作詞、作曲），第一行出現前消失。
- 太長的行會自動縮小到放得下。

## 開發

```bash
npm test
```

```bash
npm run build
```

```bash
npm run demo
```

- `npm test`：歌詞解析、序列化、音節切分、排版時序的單元測試（`tests/`）。
- `npm run demo`：重新產生示範曲（`scripts/make-demo.js`，旋律與歌詞時間碼由同一份資料產生，所以完全對齊）。
- `src/lib/lyrics.js` 格式；`src/lib/schedule.js` 兩行排版；`src/lib/KaraokeLine.svelte` 逐字變色；`src/lib/theme.js` 配色字型。

## 授權

- 程式：[MIT](LICENSE)。
- 字型：M PLUS Rounded 1c、Zen Maru Gothic、Noto Sans JP、Noto Sans TC 都是 **SIL Open Font License 1.1**（經由 Fontsource 套件），可商用、可用在直播。
- 示範曲（`examples/demo`）：原創旋律與歌詞，CC0。
- `library/` 裡的伴奏與歌詞屬於各自的權利人，不進 Git、不上傳。
