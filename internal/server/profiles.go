package server

// Practice profiles: the people who sing on the practice page, each with their own
// song list and key per song. Kept in one small JSON file outside the song folders,
// so the library itself stays read-only on a practice server.
//
//	GET    /api/profiles          { profiles: [{ name, songs: [id], keys: { id: n } }] }
//	PUT    /api/profiles/:name    create or replace { songs, keys }
//	POST   /api/profiles/:name    one change: { add: id } | { remove: id } | { song: id, key: n | null }
//	DELETE /api/profiles/:name
//	GET    /api/practice          { https: port or 0, ca: bool } for the practice page
//	GET    /ca.crt                the practice server's CA certificate, to install on devices

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	maxProfiles     = 30
	maxProfileSongs = 500
	maxKey          = 12
)

type profile struct {
	Name  string         `json:"name"`
	Songs []string       `json:"songs"`
	Keys  map[string]int `json:"keys"`
}

type profileFile struct {
	Profiles []profile `json:"profiles"`
}

func (s *Server) profilesPath() string {
	if s.profiles != "" {
		return s.profiles
	}
	return filepath.Join(s.Library(), ".practice", "profiles.json")
}

func (s *Server) loadProfiles() (profileFile, error) {
	var pf profileFile
	b, err := os.ReadFile(s.profilesPath())
	if errors.Is(err, os.ErrNotExist) {
		return profileFile{Profiles: []profile{}}, nil
	}
	if err != nil {
		return pf, err
	}
	if err := json.Unmarshal(b, &pf); err != nil {
		return pf, err
	}
	if pf.Profiles == nil {
		pf.Profiles = []profile{}
	}
	return pf, nil
}

func (s *Server) saveProfiles(pf profileFile) error {
	p := s.profilesPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(pf, "", "  ")
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func validProfileName(name string) bool {
	n := utf8.RuneCountInString(name)
	if n == 0 || n > 24 || strings.TrimSpace(name) != name {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) || strings.ContainsRune(`/\`, r) {
			return false
		}
	}
	return true
}

func (s *Server) handleProfiles(w http.ResponseWriter, r *http.Request, rest []string) {
	s.profilesMu.Lock()
	defer s.profilesMu.Unlock()
	pf, err := s.loadProfiles()
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(rest) == 0 && r.Method == http.MethodGet {
		sendJSON(w, http.StatusOK, pf)
		return
	}
	if len(rest) != 1 || !validProfileName(rest[0]) {
		sendError(w, http.StatusBadRequest, "bad profile name")
		return
	}
	name := rest[0]
	idx := -1
	for i, p := range pf.Profiles {
		if p.Name == name {
			idx = i
		}
	}
	switch r.Method {
	case http.MethodPut:
		if idx >= 0 && r.URL.Query().Get("create") == "1" {
			sendJSON(w, http.StatusOK, pf.Profiles[idx]) // someone made it meanwhile: keep theirs
			return
		}
		var p profile
		if err := json.NewDecoder(io.LimitReader(r.Body, 256<<10)).Decode(&p); err != nil {
			sendError(w, http.StatusBadRequest, "invalid json")
			return
		}
		p.Name = name
		if p.Songs == nil {
			p.Songs = []string{}
		}
		if p.Keys == nil {
			p.Keys = map[string]int{}
		}
		if len(p.Songs) > maxProfileSongs || len(p.Keys) > maxProfileSongs {
			sendError(w, http.StatusBadRequest, "too many songs")
			return
		}
		for _, id := range p.Songs {
			if id == "" || len(id) > 200 {
				sendError(w, http.StatusBadRequest, "bad song id")
				return
			}
		}
		for id, k := range p.Keys {
			if id == "" || len(id) > 200 || k < -maxKey || k > maxKey {
				sendError(w, http.StatusBadRequest, fmt.Sprintf("bad key for %q", id))
				return
			}
		}
		if idx < 0 {
			if len(pf.Profiles) >= maxProfiles {
				sendError(w, http.StatusBadRequest, "too many profiles")
				return
			}
			pf.Profiles = append(pf.Profiles, p)
		} else {
			pf.Profiles[idx] = p
		}
		if err := s.saveProfiles(pf); err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
		sendJSON(w, http.StatusOK, p)
	case http.MethodPost:
		// One change at a time, applied to the stored profile, so two quick taps
		// or two devices never overwrite each other's songs or keys.
		var op struct {
			Add    string `json:"add"`
			Remove string `json:"remove"`
			Song   string `json:"song"`
			Key    *int   `json:"key"` // with song; null = back to the song's own key
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&op); err != nil {
			sendError(w, http.StatusBadRequest, "invalid json")
			return
		}
		if idx < 0 {
			sendError(w, http.StatusNotFound, "no such profile")
			return
		}
		p := &pf.Profiles[idx]
		if p.Keys == nil {
			p.Keys = map[string]int{}
		}
		for _, id := range []string{op.Add, op.Remove, op.Song} {
			if len(id) > 200 {
				sendError(w, http.StatusBadRequest, "bad song id")
				return
			}
		}
		switch {
		case op.Add != "":
			if !contains(p.Songs, op.Add) {
				if len(p.Songs) >= maxProfileSongs {
					sendError(w, http.StatusBadRequest, "too many songs")
					return
				}
				p.Songs = append(p.Songs, op.Add)
			}
		case op.Remove != "":
			out := p.Songs[:0]
			for _, id := range p.Songs {
				if id != op.Remove {
					out = append(out, id)
				}
			}
			p.Songs = out
		case op.Song != "" && op.Key == nil:
			delete(p.Keys, op.Song)
		case op.Song != "":
			if *op.Key < -maxKey || *op.Key > maxKey || (len(p.Keys) >= maxProfileSongs && p.Keys[op.Song] == 0) {
				sendError(w, http.StatusBadRequest, "bad key")
				return
			}
			p.Keys[op.Song] = *op.Key
		default:
			sendError(w, http.StatusBadRequest, "nothing to change")
			return
		}
		if err := s.saveProfiles(pf); err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
		sendJSON(w, http.StatusOK, *p)
	case http.MethodDelete:
		if idx < 0 {
			sendError(w, http.StatusNotFound, "no such profile")
			return
		}
		pf.Profiles = append(pf.Profiles[:idx], pf.Profiles[idx+1:]...)
		if err := s.saveProfiles(pf); err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		sendError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func (s *Server) serveCA(w http.ResponseWriter, r *http.Request) {
	b, err := os.ReadFile(s.caCert)
	if s.caCert == "" || err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/x-x509-ca-cert")
	w.Header().Set("Content-Disposition", `attachment; filename="karaoke-practice-ca.crt"`)
	w.Write(b)
}
