# karaoke — 歌回曲庫與卡拉 OK 字幕

悠太翼歌回直播用的小工具，全部跑在本機：

- **曲庫**：歌名、原唱、作詞作曲、標籤、伴奏音檔、歌詞檔、唱過的場次（日期、直播標題、網址）。
- **歌詞對時**：邊播伴奏邊按鍵打點，逐字（音節）時間碼，日文漢字可以加注音（ruby）。
- **OBS 播放器**：透明背景網頁，JOYSOUND 風格的兩行交替歌詞，逐字由左往右變色（描邊＋漸層），同時播放伴奏。
- **控制台**：直播中切歌、播放暫停、跳轉、音量、歌詞偏移、升降 Key、佇列、記錄唱過；可以放進 OBS 的停駐視窗用快捷鍵操作。

技術：桌面殼是 Go + [MyGo](https://mygo.egoist.dev/)（Windows 用內建的 WebView2），本機伺服器也是 Go（`internal/server`，只聽 `127.0.0.1`）；頁面是 Svelte 5 + Vite，介面元件在 `src/lib/ui/`，字型來自 Fontsource。

## 安裝與開啟

用 `npm run build` 建出 `build/windows-amd64/karaoke-setup-<版本>-amd64.exe` 安裝（之後會放到 [Releases](https://github.com/YuutaTsubasa/karaoke/releases)），或直接執行同一個資料夾的 `Karaoke.exe`。之後從開始選單開「歌回 Karaoke」：

- 視窗裡是曲庫、控制台、歌詞對時三頁。
- 右下角系統匣有圖示：**關掉視窗不會結束**，伺服器繼續在背景跑，OBS 照樣有歌詞；要結束從系統匣選「結束」。
- 系統匣選單：開各頁、播放／暫停、複製 OBS 網址、打開／變更曲庫資料夾、開機時自動啟動。
- 再開一次程式只會把原本的視窗叫出來。

| 頁面 | 網址（App 開著時，瀏覽器也能開） |
| --- | --- |
| 曲庫 | http://127.0.0.1:5180/ |
| 控制台 | http://127.0.0.1:5180/control.html |
| 歌詞對時 | http://127.0.0.1:5180/timing.html |
| OBS 播放器 | http://127.0.0.1:5180/player.html |

## 資料放哪裡

曲庫預設在「文件Karaoke」，系統匣的「變更曲庫資料夾…」可以換（設定存在 `%APPDATA%Karaokeconfig.json`）：

```
Karaoke/            ← 你的曲庫（伴奏與有版權的歌詞，不要放進 Git）
  <歌名>/
    song.json       ← 歌曲資料與唱過的場次
    instrumental.mp3
    lyrics.lrc
  .trash/           ← 刪除的歌移到這裡，可以手動救回
```

歌詞存檔前會留一份 `.bak`。

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
5. **參考音源**：打點時可以同時聽人聲。右邊選來源：
   - **YouTube**：貼網址（原曲、カラオケ影片），用官方嵌入播放器播放。上傳者關閉嵌入的影片（YouTube 錯誤 150）不能用。
   - **本機音檔**：選一個檔案（例如買來的原曲、自己唱的錄音），存進這首歌的資料夾（檔名前面加 `reference-`），不會覆蓋伴奏。

   參考會跟著伴奏播放、暫停、跳轉、變速；「聲音」可選伴奏＋參考或只聽其中一邊；兩邊開頭長度不同就用偏移按鈕對齊。來源、網址和偏移跟著歌曲存。
6. 上方預覽即時顯示效果；整體或單行可以 ±0.05 秒微調。存檔寫成 `lyrics.lrc`，文字原稿存在 `song.json` 的 `lyricsSource`，之後改字再套用，已打的行會保留。

## OBS 設定

1. **來源 → ＋ → 瀏覽器**，網址填 `http://127.0.0.1:5180/player.html`，寬 `1920`、高 `1080`。
2. 勾 **「透過 OBS 控制音訊」**（伴奏才會進 OBS 混音器，可以調音量、加濾鏡、決定要不要進監聽）。
3. 「自訂 CSS」維持預設（背景透明）。
4. **停駐視窗 → 自訂瀏覽器停駐視窗**，加一個 `http://127.0.0.1:5180/control.html`，直播時在 OBS 裡就能切歌。停駐視窗有焦點時可以用下面的快捷鍵。

播放器網址參數：

| 參數 | 值 | 說明 |
| --- | --- | --- |
| `theme` | `blue`（預設）／`pink`／`yellow`／`classic` | 配色 |
| `font` | `rounded`（M PLUS Rounded 1c，預設）／`maru`（Zen Maru Gothic）／`gothic`（Noto Sans JP）／`serif`（Noto Serif JP）／`mincho`（Shippori Mincho B1） | 字型 |
| `size` | 數字，畫面高度的 %（預設 8） | 字級 |
| `bottom` | 數字，畫面高度的 %（預設 6） | 歌詞離底部 |
| `song` | 歌曲 id（資料夾名） | 開啟時先載入 |
| `autoplay` | `1` | 跟 `song` 一起用，載入就播放 |
| `title` | `0` | 不顯示開頭的歌名卡 |
| `wrap` | `0` | 太長的行不拆成兩行（改成縮小字） |
| `bg` | `1` | 深色背景，給瀏覽器預覽用（OBS 裡不要加） |

控制台的「OBS 播放器」區可以選配色字型、「套用到播放器」即時改，或複製網址。

### 快捷鍵（控制台與播放器）

| 鍵 | 動作 |
| --- | --- |
| <kbd>Space</kbd> | 播放／暫停 |
| <kbd>←</kbd> <kbd>→</kbd> | 倒退／快轉 5 秒 |
| <kbd>↑</kbd> <kbd>↓</kbd> | 音量（控制台） |
| <kbd>[</kbd> <kbd>]</kbd> | 歌詞提早／延後 0.05 秒（「存到這首歌」會寫進 `song.json` 的 `offset`） |
| <kbd>-</kbd> <kbd>=</kbd> | 降／升 Key 半音，最多 ±7（只變音高不變速度；「存到這首歌」會寫進 `song.json` 的 `key`，下次載入自動套用） |
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

指令：`load`（`id`、`autoplay`）、`play`、`pause`、`toggle`、`stop`、`restart`、`seek`（`time`）、`seekBy`（`delta`）、`volume`（`value` 0–1）、`offset`（`delta` 或 `value`）、`key`（`delta` 或 `value`，半音）、`lyrics`（`show` 省略＝切換）、`style`（`theme`、`font`、`size`、`bottom`）、`unload`、`reload`。

## 練歌頁與家用練歌伺服器

`practice.html`（導覽列「練歌」）是一個畫面就能唱的頁面：選歌 → 全螢幕歌詞，聲音在打開頁面的裝置上播，不用 OBS 也不用第二個畫面。手機、平板、電視的瀏覽器都能用。

- 播放／暫停、±10 秒、拖進度、升降 Key、「伴奏／原唱」切換（有原曲參考音源的歌才有），點畫面叫出按鈕，唱的時候會自動收起。
- 一開始選「誰要唱」（名字可以新增、刪除，不用密碼）：每個人有自己的歌單（☆ 加入），也記得每首歌自己的 Key。這些存在伺服器上（桌面 App 預設 `<曲庫>/.practice/profiles.json`；練歌伺服器預設放在使用者設定資料夾的 `KaraokePractice/profiles.json`，絕不寫進曲庫；`-profiles` 可改），換裝置選同一個名字就看得到；不會改到曲庫裡的歌。
- 歌曲存的 Key 會在按下播放時套用（這個人調過就用他的）。
- 升降 Key 要靠瀏覽器的 AudioWorklet，瀏覽器只在 https 或本機（127.0.0.1）開放。從家裡網路用 `http://` 打開時，Key 按鈕會停用，頁面上會提示改用 https 與安裝憑證的步驟。

要讓家人在家裡網路用，另外跑一台**唯讀的練歌伺服器**（例如一直開著的 Mac mini）：

```bash
npm run build:practice
```

輸出 `build/practice-darwin-arm64/`（其他平台：`npm run build:practice -- linux/amd64`）。整個資料夾複製到那台 Mac，在那裡執行：

```bash
bash install-mac.sh
```

- 裝成登入後自動啟動的 launchd agent，曲庫在 `~/Data/20_Assets/Karaoke`、連接埠 5280（`bash install-mac.sh <曲庫> <連接埠>` 可改）。家人開 `http://<Mac 的名稱>.local:5280/`。
- https：安裝腳本在 `~/Library/Application Support/KaraokePractice/tls/` 建一個自己的憑證機構（只建一次）並簽發伺服器憑證（Mac 的 `.local` 名稱與目前 IP，每次安裝重簽，800 天），https 開在下一個連接埠（5281）。每台家人裝置從練歌頁下載 `/ca.crt` 裝一次、設成信任後，改用 `https://<Mac 的名稱>.local:5281/` 就能升降 Key。Mac 的 IP 變了就重跑一次安裝腳本（或只用 `.local` 名稱）。
- macOS 防火牆開著時要放行一次（安裝腳本會印出指令）；每次更新程式後簽章會變，要再放行一次。
- 練歌伺服器（`-serve -practice -listen :5280`）只提供練歌頁與讀歌：不能新增、修改、刪除歌，也沒有控制台和 OBS 指令。只有這個模式可以對家裡網路開放；桌面 App 一律只聽 127.0.0.1。
- 把這台電腦的曲庫單向同步過去（新增與變更的檔案送過去、這邊刪掉的那邊也刪；`.trash` 和 `*.bak` 不送）：

```bash
npm run sync:practice -- <ssh 主機>
```

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

需要 Node.js 24、Go 1.27 以上（MyGo 的要求）。

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` 同時開 Go 伺服器（只有 API，:5181，曲庫用專案的 `library/`）與 Vite（:5180，代理 `/api`、`/media` 到 Go），改頁面會即時更新；OBS 和瀏覽器一樣連 :5180。開發時不要同時開著安裝版的 App（兩個都要用 5180）。

```bash
npm test
```

```bash
npm run build
```

- `npm test`：歌詞解析、序列化、音節切分、排版時序（`tests/`，Node）與伺服器 API（`internal/server`，Go）。
- `npm run build`：`vite build` → `go tool mygo build`，輸出 `build/windows-amd64/` 的 `Karaoke.exe` 與安裝檔。其他平台：`npm run build -- -platform windows/arm64`。
- `npm run demo`：重新產生示範曲（`scripts/make-demo.js`，旋律與歌詞時間碼由同一份資料產生，所以完全對齊）。
- 圖示：`internal/icon` 畫的，`go run ./scripts/icon` 重新輸出 `resources/icon.png`。
- `main.go` 桌面殼與系統匣；`internal/server` API；`src/lib/lyrics.js` 歌詞格式；`src/lib/schedule.js` 兩行排版；`src/lib/KaraokeLine.svelte` 逐字變色；`src/lib/theme.js` 配色字型。
- 不開視窗只跑伺服器：`go run . -serve`（`-port`、`-library`）；唯讀練歌伺服器加 `-practice`（`-listen` 只在這個模式可用）。`go build -tags headless` 是不含桌面殼的版本，可以交叉編譯（`serve.go` 是兩者共用的部分）。

## 授權

- 程式：[MIT](LICENSE)。桌面殼用 [MyGo](https://github.com/egoist/mygo)（MIT）。升降 Key 用 [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/)（MIT）。
- 字型：M PLUS Rounded 1c、Zen Maru Gothic、Noto Sans JP、Noto Sans TC、Noto Serif JP、Noto Serif TC、Shippori Mincho B1 都是 **SIL Open Font License 1.1**（經由 Fontsource 套件），可商用、可用在直播。
- 示範曲（`examples/demo`，只在 `npm run dev` 出現，不包進 App）：原創旋律與歌詞，CC0。
- `library/` 裡的伴奏與歌詞屬於各自的權利人，不進 Git、不上傳。
