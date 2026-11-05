package main

// The server-only part of the program, shared by the desktop app (main.go) and the
// headless build (headless.go, `go build -tags headless`), which has no window and
// so cross-compiles anywhere (e.g. GOOS=darwin GOARCH=arm64 for a Mac practice server).

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/YuutaTsubasa/karaoke/internal/server"
)

//go:embed all:dist
var dist embed.FS

const defaultPort = 5180

type config struct {
	Library string `json:"library"`
	Port    int    `json:"port"`
}

type flags struct {
	serve    bool
	port     int
	library  string
	noWeb    bool
	practice bool
	listen   string
	profiles string
	tlsCert  string
	tlsKey   string
	tlsAt    string
	caCert   string
}

func parseFlags() flags {
	var f flags
	flag.BoolVar(&f.serve, "serve", false, "run the server only, without a window")
	flag.IntVar(&f.port, "port", 0, "port to listen on (default 5180, or the config's)")
	flag.StringVar(&f.library, "library", "", "song library folder (default: the config's, else Documents/Karaoke)")
	flag.BoolVar(&f.noWeb, "no-web", false, "serve the API only (the Vite dev server serves the pages)")
	flag.BoolVar(&f.practice, "practice", false, "with -serve: read-only practice server")
	flag.StringVar(&f.listen, "listen", "", "with -serve -practice: address to listen on, e.g. :5280 (default 127.0.0.1)")
	flag.StringVar(&f.profiles, "profiles", "", "practice profiles file (default <library>/.practice/profiles.json)")
	flag.StringVar(&f.tlsCert, "tls-cert", "", "with -practice: certificate for an https listener as well")
	flag.StringVar(&f.tlsKey, "tls-key", "", "with -practice: key for -tls-cert")
	flag.StringVar(&f.tlsAt, "tls-listen", ":5281", "with -tls-cert: https address")
	flag.StringVar(&f.caCert, "ca-cert", "", "with -practice: CA certificate offered at /ca.crt")
	flag.Parse()
	return f
}

// serve runs the server alone and does not return.
func serve(f flags) {
	if (f.listen != "" || f.tlsCert != "") && !f.practice {
		log.Fatal("-listen and -tls-cert are only allowed with -practice")
	}
	cfg := loadConfig("")
	lib := firstNonEmpty(f.library, os.Getenv("KARAOKE_LIBRARY"), cfg.Library, "library")
	opts := server.Options{Profiles: f.profiles, CACert: f.caCert}
	if f.tlsCert != "" {
		_, p, err := net.SplitHostPort(f.tlsAt)
		if err != nil {
			log.Fatal(err)
		}
		opts.HTTPSPort, _ = strconv.Atoi(p)
	}
	srv, ln := start(lib, pick(f.port, cfg.Port), !f.noWeb, f.practice, f.listen, opts)
	log.Printf("karaoke: library %s", srv.Library())
	log.Printf("karaoke: listening on http://%s/", ln.Addr())
	if f.tlsCert != "" {
		go func() {
			log.Printf("karaoke: listening on https://%s/", f.tlsAt)
			log.Fatal(http.ListenAndServeTLS(f.tlsAt, f.tlsCert, f.tlsKey, srv))
		}()
	}
	log.Fatal(http.Serve(ln, srv))
}

// start is the -serve mode: no window, fail loudly.
func start(lib string, port int, web, practice bool, addr string, opts server.Options) (*server.Server, net.Listener) {
	opts.Library, opts.Version, opts.Practice = lib, "dev", practice
	if !practice {
		opts.Examples = os.DirFS("examples") // the demo song, for development only
	}
	if web {
		opts.Web = webFS()
	}
	srv, err := server.New(opts)
	if err != nil {
		log.Fatal(err)
	}
	if addr == "" {
		addr = fmt.Sprintf("127.0.0.1:%d", port)
	}
	ln, err := net.Listen("tcp", addr)
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
