// Command karaoke is the desktop app: a window with the song library and the
// live control page, a tray icon, and the local server that OBS loads the
// player from (http://127.0.0.1:5180/player.html). Closing the window keeps the
// server running in the tray; Quit in the tray menu stops it.
//
// `karaoke -serve` runs the server alone, without a window (used by `npm run dev`).
package main

import (
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/egoist/mygo"

	"github.com/YuutaTsubasa/karaoke/internal/icon"
	"github.com/YuutaTsubasa/karaoke/internal/server"
)

//go:embed all:dist
var dist embed.FS

const defaultPort = 5180

type config struct {
	Library string `json:"library"`
	Port    int    `json:"port"`
}

func main() {
	serve := flag.Bool("serve", false, "run the server only, without a window")
	port := flag.Int("port", 0, "port to listen on (default 5180, or the config's)")
	library := flag.String("library", "", "song library folder (default: the config's, else Documents/Karaoke)")
	noWeb := flag.Bool("no-web", false, "serve the API only (the Vite dev server serves the pages)")
	flag.Parse()

	if *serve {
		cfg := loadConfig("")
		lib := firstNonEmpty(*library, os.Getenv("KARAOKE_LIBRARY"), cfg.Library, "library")
		srv, ln := start(lib, pick(*port, cfg.Port), !*noWeb)
		log.Printf("karaoke: library %s", srv.Library())
		log.Printf("karaoke: listening on http://%s/", ln.Addr())
		log.Fatal(http.Serve(ln, srv))
	}

	if !mygo.App.RequestSingleInstanceLock() {
		return // the running app shows its window (OnSecondInstance)
	}
	mygo.App.SetName("Karaoke")
	runApp(*library, *port)
}

func runApp(libFlag string, portFlag int) {
	dataDir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		log.Fatal(err)
	}
	cfg := loadConfig(dataDir)
	if cfg.Library == "" {
		docs, _ := mygo.App.Path(mygo.PathDocuments)
		cfg.Library = filepath.Join(docs, "Karaoke")
	}
	lib := firstNonEmpty(libFlag, os.Getenv("KARAOKE_LIBRARY"), cfg.Library)
	p := pick(portFlag, cfg.Port)

	var (
		srv  *server.Server
		ln   net.Listener
		win  *mygo.Window
		tray *mygo.Tray
	)
	base := fmt.Sprintf("http://127.0.0.1:%d", p)

	mygo.App.WhenReady(func() {
		var err error
		srv, err = newServer(lib)
		if err == nil {
			ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		}
		if err != nil {
			mygo.Dialog.Error("歌回 Karaoke 無法啟動",
				fmt.Sprintf("無法在 %s 開啟本機伺服器：%v\n\n可能有另一個程式（例如開發用的 npm run dev）佔用了這個連接埠。", base, err))
			mygo.App.Quit()
			return
		}
		go func() {
			if err := http.Serve(ln, srv); err != nil && !errors.Is(err, net.ErrClosed) {
				log.Print(err)
			}
		}()

		win = mygo.NewWindow(mygo.WindowOptions{
			Title:     "歌回 Karaoke",
			URL:       base + "/",
			Width:     1280,
			Height:    860,
			MinWidth:  720,
			MinHeight: 480,
		})
		var quitting bool
		mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { quitting = true })
		win.OnClose(func(e *mygo.CloseEvent) {
			if !quitting && tray != nil {
				e.PreventDefault()
				win.Hide()
			}
		})
		show := func(path string) {
			if path != "" {
				win.Page().LoadURL(base + path)
			}
			win.Show()
			win.Focus()
		}
		mygo.App.OnSecondInstance(func([]string, string) { show("") })

		tray, err = mygo.NewTray(mygo.TrayOptions{Icon: icon.PNG(64), ToolTip: "歌回 Karaoke（OBS：" + base + "/player.html）"})
		if err != nil {
			log.Print("no tray icon: ", err)
			return
		}
		tray.OnClick(func() { show("") })
		tray.SetMenu(mygo.NewMenu([]*mygo.MenuItem{
			{Label: "曲庫", Click: func(*mygo.MenuItem, *mygo.Window) { show("/") }},
			{Label: "控制台", Click: func(*mygo.MenuItem, *mygo.Window) { show("/control.html") }},
			{Label: "歌詞對時", Click: func(*mygo.MenuItem, *mygo.Window) { show("/timing.html") }},
			mygo.Separator(),
			{Label: "播放／暫停", Click: func(*mygo.MenuItem, *mygo.Window) { srv.Command(map[string]any{"action": "toggle"}) }},
			{Label: "複製 OBS 播放器網址", Click: func(*mygo.MenuItem, *mygo.Window) {
				mygo.Clipboard.WriteText(base + "/player.html")
			}},
			mygo.Separator(),
			{Label: "打開曲庫資料夾", Click: func(*mygo.MenuItem, *mygo.Window) { mygo.Shell.OpenPath(srv.Library()) }},
			{Label: "變更曲庫資料夾…", Click: func(*mygo.MenuItem, *mygo.Window) {
				paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Title: "選擇曲庫資料夾", DefaultPath: srv.Library(), Directory: true})
				if err != nil || len(paths) == 0 {
					return
				}
				if err := srv.SetLibrary(paths[0]); err != nil {
					mygo.Dialog.Error("無法使用這個資料夾", err.Error())
					return
				}
				cfg.Library = paths[0]
				saveConfig(dataDir, cfg)
				win.Page().Reload()
			}},
			{Label: "開機時自動啟動", Type: mygo.MenuItemCheckbox, Checked: mygo.App.OpenAtLogin(),
				Click: func(it *mygo.MenuItem, _ *mygo.Window) {
					if err := mygo.App.SetOpenAtLogin(it.Checked); err != nil {
						log.Print(err)
					}
				}},
			mygo.Separator(),
			{Label: "結束", Role: mygo.RoleQuit},
		}))
		mygo.App.OnWillQuit(func(*mygo.QuitEvent) {
			tray.Destroy()
			if ln != nil {
				ln.Close()
			}
		})
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

func newServer(lib string) (*server.Server, error) {
	return server.New(server.Options{Library: lib, Web: webFS(), Version: mygo.App.Version()})
}

// start is the -serve mode: no window, fail loudly.
func start(lib string, port int, web bool) (*server.Server, net.Listener) {
	opts := server.Options{Library: lib, Examples: os.DirFS("examples"), Version: "dev"} // the demo song, for development only
	if web {
		opts.Web = webFS()
	}
	srv, err := server.New(opts)
	if err != nil {
		log.Fatal(err)
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		log.Fatal(err)
	}
	return srv, ln
}

func webFS() fs.FS {
	sub, _ := fs.Sub(dist, "dist")
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil // built without the frontend (npm run dev serves it)
	}
	return sub
}

func loadConfig(dir string) config {
	var c config
	if dir == "" {
		return c
	}
	if b, err := os.ReadFile(filepath.Join(dir, "config.json")); err == nil {
		json.Unmarshal(b, &c)
	}
	return c
}

func saveConfig(dir string, c config) {
	os.MkdirAll(dir, 0o755)
	b, _ := json.MarshalIndent(c, "", "  ")
	tmp := filepath.Join(dir, fmt.Sprintf("config.json.%d.tmp", time.Now().UnixNano()))
	if err := os.WriteFile(tmp, b, 0o644); err == nil {
		os.Rename(tmp, filepath.Join(dir, "config.json"))
	}
}

func pick(flagPort, cfgPort int) int {
	if flagPort > 0 {
		return flagPort
	}
	if cfgPort > 0 {
		return cfgPort
	}
	return defaultPort
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}
