// Package server is the local HTTP server of the karaoke app: the song library
// API, audio streaming, live control over server-sent events, and the built
// frontend. It listens on loopback only, because OBS loads the player from it.
//
//	GET    /api/songs                    list songs (library + bundled examples)
//	POST   /api/songs                    create { title, artist } -> song
//	GET    /api/songs/:id                song.json + lyrics text
//	PUT    /api/songs/:id                replace song.json
//	DELETE /api/songs/:id                move the song folder to <library>/.trash
//	PUT    /api/songs/:id/lyrics?name=x  save lyrics text (body = text)
//	PUT    /api/songs/:id/audio?name=x   upload instrumental (body = file)
//	PUT    /api/songs/:id/reference?name=x  upload a reference recording for timing (body = file)
//	GET    /media/:id/:file              audio with Range support
//	GET    /api/events?role=player|control   server-sent events
//	POST   /api/command  { action, ... }     forwarded to players
//	GET    /api/command?action=toggle        same, for Stream Deck "Website" buttons
//	POST   /api/status   { ... }             player state, forwarded to controls
//	GET    /api/info                     library folder and version
package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

var audioTypes = map[string]string{
	".mp3":  "audio/mpeg",
	".m4a":  "audio/mp4",
	".aac":  "audio/aac",
	".ogg":  "audio/ogg",
	".opus": "audio/ogg",
	".wav":  "audio/wav",
	".flac": "audio/flac",
	".webm": "audio/webm",
}

// Options configure a Server.
type Options struct {
	Library  string // folder of the user's songs (created if missing)
	Examples fs.FS  // bundled read-only songs, one folder each; may be nil
	Web      fs.FS  // built frontend; nil serves only the API
	Version  string
}

// Server implements http.Handler.
type Server struct {
	mu       sync.RWMutex
	library  string
	examples fs.FS
	web      http.Handler
	version  string

	clientsMu  sync.Mutex
	clients    map[*client]struct{}
	lastStatus json.RawMessage
}

type client struct {
	role string
	ch   chan []byte
}

type song struct {
	ID     string
	Source string // "library" or "example"
	Dir    string // folder on disk (library) or path inside Examples
}

// New returns a server for opts.
func New(opts Options) (*Server, error) {
	s := &Server{examples: opts.Examples, version: opts.Version, clients: map[*client]struct{}{}}
	if err := s.SetLibrary(opts.Library); err != nil {
		return nil, err
	}
	if opts.Web != nil {
		s.web = spa(opts.Web)
	}
	return s, nil
}

// Library returns the current library folder.
func (s *Server) Library() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.library
}

// SetLibrary switches to another library folder, creating it if needed.
func (s *Server) SetLibrary(dir string) error {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return err
	}
	s.mu.Lock()
	s.library = abs
	s.mu.Unlock()
	return nil
}

// Command sends a command to every connected player, as POST /api/command does.
func (s *Server) Command(cmd map[string]any) int {
	b, _ := json.Marshal(cmd)
	return s.broadcast("player", "command", b)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	parts := splitPath(r.URL.Path)
	if len(parts) == 3 && parts[0] == "media" {
		s.serveMedia(w, r, parts[1], parts[2])
		return
	}
	if len(parts) == 0 || parts[0] != "api" {
		if s.web != nil {
			s.web.ServeHTTP(w, r)
		} else {
			http.NotFound(w, r)
		}
		return
	}
	defer func() {
		if v := recover(); v != nil {
			log.Printf("karaoke api: %v", v)
			sendError(w, http.StatusInternalServerError, fmt.Sprint(v))
		}
	}()
	switch {
	case len(parts) == 2 && parts[1] == "events":
		s.events(w, r)
	case len(parts) == 2 && parts[1] == "command":
		s.command(w, r)
	case len(parts) == 2 && parts[1] == "status" && r.Method == http.MethodPost:
		body, _ := io.ReadAll(r.Body)
		if !json.Valid(body) {
			sendError(w, http.StatusBadRequest, "invalid json")
			return
		}
		s.clientsMu.Lock()
		s.lastStatus = body
		s.clientsMu.Unlock()
		s.broadcast("control", "status", body)
		w.WriteHeader(http.StatusNoContent)
	case len(parts) == 2 && parts[1] == "clients":
		sendJSON(w, http.StatusOK, s.counts())
	case len(parts) == 2 && parts[1] == "info":
		sendJSON(w, http.StatusOK, map[string]any{"library": s.Library(), "version": s.version})
	case len(parts) >= 2 && parts[1] == "songs":
		s.songs(w, r, parts[2:])
	default:
		sendError(w, http.StatusNotFound, "not found")
	}
}

// ---------------------------------------------------------------------------
// realtime

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		sendError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	role := "control"
	if r.URL.Query().Get("role") == "player" {
		role = "player"
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	io.WriteString(w, ": hello\n\n")

	c := &client{role: role, ch: make(chan []byte, 64)}
	s.clientsMu.Lock()
	s.clients[c] = struct{}{}
	last := s.lastStatus
	s.clientsMu.Unlock()
	if role == "control" && last != nil {
		w.Write(event("status", last))
	}
	flusher.Flush()
	counts, _ := json.Marshal(s.counts())
	s.broadcast("control", "clients", counts)

	defer func() {
		s.clientsMu.Lock()
		delete(s.clients, c)
		s.clientsMu.Unlock()
		counts, _ := json.Marshal(s.counts())
		s.broadcast("control", "clients", counts)
	}()
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-c.ch:
			if _, err := w.Write(msg); err != nil {
				return
			}
			flusher.Flush()
		case <-ping.C:
			if _, err := io.WriteString(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func event(name string, data []byte) []byte {
	return []byte("event: " + name + "\ndata: " + string(data) + "\n\n")
}

// broadcast sends an event to the clients of role ("" = all) and returns how many got it.
func (s *Server) broadcast(role, name string, data []byte) int {
	msg := event(name, data)
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	n := 0
	for c := range s.clients {
		if role != "" && c.role != role {
			continue
		}
		select {
		case c.ch <- msg:
			n++
		default: // a stalled client drops events rather than blocking everyone
		}
	}
	return n
}

func (s *Server) counts() map[string]int {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	n := map[string]int{"player": 0, "control": 0}
	for c := range s.clients {
		n[c.role]++
	}
	return n
}

func (s *Server) command(w http.ResponseWriter, r *http.Request) {
	cmd := map[string]any{}
	if r.Method == http.MethodGet {
		for k, v := range r.URL.Query() {
			cmd[k] = v[0]
		}
	} else if err := json.NewDecoder(r.Body).Decode(&cmd); err != nil && !errors.Is(err, io.EOF) {
		sendError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if a, _ := cmd["action"].(string); a == "" {
		sendError(w, http.StatusBadRequest, "action required")
		return
	}
	s.Command(cmd)
	sendJSON(w, http.StatusOK, map[string]any{"ok": true, "players": s.counts()["player"]})
}

// ---------------------------------------------------------------------------
// songs

func (s *Server) songList() []song {
	var out []song
	if s.examples != nil {
		entries, _ := fs.ReadDir(s.examples, ".")
		for _, e := range entries {
			if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
				if _, err := fs.Stat(s.examples, path.Join(e.Name(), "song.json")); err == nil {
					out = append(out, song{ID: e.Name(), Source: "example", Dir: e.Name()})
				}
			}
		}
	}
	lib := s.Library()
	entries, _ := os.ReadDir(lib)
	for _, e := range entries {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			dir := filepath.Join(lib, e.Name())
			if _, err := os.Stat(filepath.Join(dir, "song.json")); err == nil {
				out = append(out, song{ID: e.Name(), Source: "library", Dir: dir})
			}
		}
	}
	return out
}

func (s *Server) find(id string) (song, bool) {
	if id == "" || strings.HasPrefix(id, ".") || strings.ContainsAny(id, `/\`) {
		return song{}, false
	}
	// library songs win over examples of the same name
	var found *song
	for _, sg := range s.songList() {
		if sg.ID == id {
			sg := sg
			found = &sg
		}
	}
	if found == nil {
		return song{}, false
	}
	return *found, true
}

func (s *Server) readFile(sg song, name string) ([]byte, error) {
	if sg.Source == "example" {
		return fs.ReadFile(s.examples, path.Join(sg.Dir, name))
	}
	return os.ReadFile(filepath.Join(sg.Dir, name))
}

func (s *Server) exists(sg song, name string) bool {
	if name == "" {
		return false
	}
	if sg.Source == "example" {
		_, err := fs.Stat(s.examples, path.Join(sg.Dir, name))
		return err == nil
	}
	_, err := os.Stat(filepath.Join(sg.Dir, name))
	return err == nil
}

func (s *Server) readMeta(sg song) (map[string]any, error) {
	b, err := s.readFile(sg, "song.json")
	if err != nil {
		return nil, err
	}
	m := map[string]any{}
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("%s/song.json: %w", sg.ID, err)
	}
	return m, nil
}

func str(m map[string]any, k string) string {
	v, _ := m[k].(string)
	return v
}

// view adds the computed fields the frontend uses.
func (s *Server) view(sg song) (map[string]any, error) {
	m, err := s.readMeta(sg)
	if err != nil {
		return nil, err
	}
	audio := str(m, "audio")
	m["id"] = sg.ID
	m["source"] = sg.Source
	m["hasLyrics"] = s.exists(sg, str(m, "lyrics"))
	m["hasAudio"] = s.exists(sg, audio)
	m["audioUrl"] = nil
	if audio != "" {
		m["audioUrl"] = "/media/" + pathEscape(sg.ID) + "/" + pathEscape(audio)
	}
	m["referenceAudioUrl"] = nil
	if ref, _ := m["reference"].(map[string]any); ref != nil {
		if file := str(ref, "file"); file != "" && s.exists(sg, file) {
			m["referenceAudioUrl"] = "/media/" + pathEscape(sg.ID) + "/" + pathEscape(file)
		}
	}
	return m, nil
}

var computed = []string{"id", "source", "hasLyrics", "hasAudio", "audioUrl", "referenceAudioUrl", "lyricsText"}

func (s *Server) songs(w http.ResponseWriter, r *http.Request, rest []string) {
	if len(rest) == 0 {
		switch r.Method {
		case http.MethodGet:
			list := []map[string]any{}
			for _, sg := range s.songList() {
				v, err := s.view(sg)
				if err != nil {
					log.Printf("karaoke: %v", err)
					continue
				}
				list = append(list, v)
			}
			col := collate.New(language.Japanese)
			sort.SliceStable(list, func(i, j int) bool {
				a, b := list[i], list[j]
				if a["source"] != b["source"] {
					return a["source"] == "library"
				}
				return col.CompareString(title(a), title(b)) < 0
			})
			sendJSON(w, http.StatusOK, list)
		case http.MethodPost:
			s.create(w, r)
		default:
			sendError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}

	sg, ok := s.find(rest[0])
	if !ok {
		sendError(w, http.StatusNotFound, "no such song")
		return
	}
	writable := func() bool {
		if sg.Source != "library" {
			sendError(w, http.StatusBadRequest, "示範曲是唯讀的；請在曲庫新增自己的歌")
			return false
		}
		return true
	}

	switch {
	case len(rest) == 1 && r.Method == http.MethodGet:
		v, err := s.view(sg)
		if err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
		text := ""
		if b, err := s.readFile(sg, str(v, "lyrics")); err == nil && str(v, "lyrics") != "" {
			text = string(b)
		}
		v["lyricsText"] = text
		sendJSON(w, http.StatusOK, v)

	case len(rest) == 1 && r.Method == http.MethodPut:
		if !writable() {
			return
		}
		m := map[string]any{}
		if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
			sendError(w, http.StatusBadRequest, "invalid json")
			return
		}
		for _, k := range computed {
			delete(m, k)
		}
		if err := writeJSON(filepath.Join(sg.Dir, "song.json"), m); err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
		s.sendView(w, sg)

	case len(rest) == 1 && r.Method == http.MethodDelete:
		if !writable() {
			return
		}
		trash := filepath.Join(s.Library(), ".trash")
		os.MkdirAll(trash, 0o755)
		dst := filepath.Join(trash, fmt.Sprintf("%s-%d", sg.ID, time.Now().UnixMilli()))
		if err := os.Rename(sg.Dir, dst); err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)

	case len(rest) == 2 && rest[1] == "lyrics" && r.Method == http.MethodPut:
		if !writable() {
			return
		}
		m, err := s.readMeta(sg)
		if err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
		name := r.URL.Query().Get("name")
		if name == "" {
			name = str(m, "lyrics")
		}
		if name == "" {
			name = "lyrics.lrc"
		}
		if name, err = safeName(name); err != nil {
			sendError(w, http.StatusBadRequest, err.Error())
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			sendError(w, http.StatusBadRequest, err.Error())
			return
		}
		file := filepath.Join(sg.Dir, name)
		if old, err := os.ReadFile(file); err == nil {
			os.WriteFile(file+".bak", old, 0o644)
		}
		if err := writeAtomic(file, body); err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if str(m, "lyrics") != name {
			m["lyrics"] = name
			writeJSON(filepath.Join(sg.Dir, "song.json"), m)
		}
		s.sendView(w, sg)

	case len(rest) == 2 && (rest[1] == "audio" || rest[1] == "reference") && r.Method == http.MethodPut:
		if !writable() {
			return
		}
		name := r.URL.Query().Get("name")
		if name == "" {
			name = "instrumental.mp3"
		}
		name, err := safeName(name)
		if err == nil && rest[1] == "reference" {
			name = "reference-" + name // never overwrite the instrumental
		}
		if err != nil {
			sendError(w, http.StatusBadRequest, err.Error())
			return
		}
		if _, ok := audioTypes[strings.ToLower(filepath.Ext(name))]; !ok {
			sendError(w, http.StatusBadRequest, "unsupported audio type")
			return
		}
		tmp := filepath.Join(sg.Dir, "."+name+".uploading")
		f, err := os.Create(tmp)
		if err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
		_, err = io.Copy(f, r.Body)
		if cerr := f.Close(); err == nil {
			err = cerr
		}
		if err == nil {
			err = os.Rename(tmp, filepath.Join(sg.Dir, name))
		}
		if err != nil {
			os.Remove(tmp)
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
		m, err := s.readMeta(sg)
		if err == nil {
			if rest[1] == "audio" {
				m["audio"] = name
			} else {
				ref, _ := m["reference"].(map[string]any)
				if ref == nil {
					ref = map[string]any{}
				}
				if old := str(ref, "file"); old != "" && old != name {
					os.Remove(filepath.Join(sg.Dir, old))
				}
				ref["file"] = name
				ref["source"] = "file"
				m["reference"] = ref
			}
			err = writeJSON(filepath.Join(sg.Dir, "song.json"), m)
		}
		if err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
		s.sendView(w, sg)

	default:
		sendError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func title(m map[string]any) string {
	if t := str(m, "title"); t != "" {
		return t
	}
	return str(m, "id")
}

func (s *Server) sendView(w http.ResponseWriter, sg song) {
	v, err := s.view(sg)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	sendJSON(w, http.StatusOK, v)
}

func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	var body struct{ Title, Artist, Lyricist, Composer string }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Title) == "" {
		sendError(w, http.StatusBadRequest, "title required")
		return
	}
	taken := map[string]bool{}
	for _, sg := range s.songList() {
		taken[sg.ID] = true
	}
	base := slug(body.Title)
	id := base
	for n := 2; taken[id]; n++ {
		id = fmt.Sprintf("%s-%d", base, n)
	}
	dir := filepath.Join(s.Library(), id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	m := map[string]any{
		"title":        strings.TrimSpace(body.Title),
		"artist":       body.Artist,
		"lyricist":     body.Lyricist,
		"composer":     body.Composer,
		"audio":        nil,
		"lyrics":       "lyrics.lrc",
		"offset":       0,
		"volume":       1,
		"tags":         []string{},
		"notes":        "",
		"performances": []any{},
		"createdAt":    time.Now().Format("2006-01-02"),
	}
	if err := writeJSON(filepath.Join(dir, "song.json"), m); err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	v, _ := s.view(song{ID: id, Source: "library", Dir: dir})
	sendJSON(w, http.StatusCreated, v)
}

// ---------------------------------------------------------------------------
// media

func (s *Server) serveMedia(w http.ResponseWriter, r *http.Request, id, file string) {
	sg, ok := s.find(id)
	name, err := safeName(file)
	if !ok || err != nil {
		http.NotFound(w, r)
		return
	}
	var (
		rs      io.ReadSeeker
		modTime time.Time
	)
	if sg.Source == "example" {
		f, err := s.examples.Open(path.Join(sg.Dir, name))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		seeker, ok := f.(io.ReadSeeker)
		if !ok {
			b, _ := io.ReadAll(f)
			seeker = bytes.NewReader(b)
		}
		rs = seeker
	} else {
		f, err := os.Open(filepath.Join(sg.Dir, name))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		if st, err := f.Stat(); err == nil {
			modTime = st.ModTime()
		}
		rs = f
	}
	if t, ok := audioTypes[strings.ToLower(filepath.Ext(name))]; ok {
		w.Header().Set("Content-Type", t)
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, name, modTime, rs)
}

// spa serves the built frontend: files as they are, "/" as index.html.
func spa(web fs.FS) http.Handler {
	files := http.FileServerFS(web)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p != "" {
			if _, err := fs.Stat(web, p); err != nil {
				http.NotFound(w, r)
				return
			}
		}
		if strings.HasSuffix(p, ".html") || p == "" {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------------------
// helpers

func splitPath(p string) []string {
	var out []string
	for _, seg := range strings.Split(p, "/") {
		if seg == "" {
			continue
		}
		out = append(out, seg) // r.URL.Path is already unescaped
	}
	return out
}

func pathEscape(s string) string { return url.PathEscape(s) }

var badName = regexp.MustCompile(`[\\/:*?"<>|]`)

func safeName(name string) (string, error) {
	base := filepath.Base(name)
	if base == "" || base == "." || strings.HasPrefix(base, ".") || badName.MatchString(base) || base != name {
		return "", errors.New("bad file name")
	}
	return base, nil
}

var slugBad = regexp.MustCompile(`[\\/:*?"<>|.\s]+`)

func slug(title string) string {
	s := slugBad.ReplaceAllString(strings.TrimSpace(title), "-")
	s = strings.Trim(s, "-")
	if r := []rune(s); len(r) > 60 {
		s = string(r[:60])
	}
	if s == "" {
		s = "song-" + strconv.FormatInt(time.Now().Unix(), 10)
	}
	return s
}

func writeAtomic(file string, data []byte) error {
	tmp := file + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, file)
}

func writeJSON(file string, v any) error {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return err
	}
	return writeAtomic(file, buf.Bytes())
}

func sendJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.Encode(v)
}

func sendError(w http.ResponseWriter, status int, msg string) {
	sendJSON(w, status, map[string]string{"error": msg})
}
