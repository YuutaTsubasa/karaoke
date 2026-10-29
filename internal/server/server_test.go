package server

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func newTest(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	examples := fstest.MapFS{
		"demo/song.json":         {Data: []byte(`{"title":"Demo","audio":"a.wav","lyrics":"lyrics.lrc"}`)},
		"demo/lyrics.lrc":        {Data: []byte("[00:01.00]<00:01.00>la<00:02.00>\n")},
		"demo/a.wav":             {Data: []byte("0123456789")},
		".hidden/song.json":      {Data: []byte(`{}`)},
		"no-song-json/readme.md": {Data: []byte(`x`)},
	}
	web := fstest.MapFS{"index.html": {Data: []byte("<h1>library</h1>")}, "player.html": {Data: []byte("player")}}
	s, err := New(Options{Library: t.TempDir(), Examples: examples, Web: web, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s)
	t.Cleanup(ts.Close)
	return s, ts
}

func do(t *testing.T, method, url, body string) (*http.Response, string) {
	t.Helper()
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	return res, string(b)
}

func TestSongLifecycle(t *testing.T) {
	s, ts := newTest(t)

	res, body := do(t, "GET", ts.URL+"/api/songs", "")
	if res.StatusCode != 200 || !strings.Contains(body, `"id":"demo"`) || strings.Contains(body, "hidden") || strings.Contains(body, "no-song-json") {
		t.Fatalf("list: %d %s", res.StatusCode, body)
	}

	res, body = do(t, "POST", ts.URL+"/api/songs", `{"title":"春日影 / test","artist":"MyGO"}`)
	if res.StatusCode != 201 {
		t.Fatalf("create: %d %s", res.StatusCode, body)
	}
	var created map[string]any
	json.Unmarshal([]byte(body), &created)
	id := created["id"].(string)
	if id != "春日影-test" {
		t.Fatalf("id = %q", id)
	}

	// duplicate titles get a suffix
	_, body = do(t, "POST", ts.URL+"/api/songs", `{"title":"春日影 / test"}`)
	if !strings.Contains(body, `"id":"春日影-test-2"`) {
		t.Fatalf("second create: %s", body)
	}

	res, body = do(t, "PUT", ts.URL+"/api/songs/"+id+"/audio?name=inst.mp3", "MP3DATA")
	if res.StatusCode != 200 || !strings.Contains(body, `"hasAudio":true`) {
		t.Fatalf("audio: %d %s", res.StatusCode, body)
	}
	res, body = do(t, "PUT", ts.URL+"/api/songs/"+id+"/audio?name=../x.mp3", "x")
	if res.StatusCode != 400 {
		t.Fatalf("bad audio name accepted: %d %s", res.StatusCode, body)
	}
	res, _ = do(t, "PUT", ts.URL+"/api/songs/"+id+"/audio?name=x.exe", "x")
	if res.StatusCode != 400 {
		t.Fatalf("non-audio accepted: %d", res.StatusCode)
	}

	do(t, "PUT", ts.URL+"/api/songs/"+id+"/lyrics?name=lyrics.lrc", "v1")
	res, body = do(t, "PUT", ts.URL+"/api/songs/"+id+"/lyrics?name=lyrics.lrc", "v2")
	if res.StatusCode != 200 {
		t.Fatalf("lyrics: %d %s", res.StatusCode, body)
	}
	if b, _ := os.ReadFile(filepath.Join(s.Library(), id, "lyrics.lrc.bak")); string(b) != "v1" {
		t.Fatalf("backup = %q", b)
	}

	_, body = do(t, "GET", ts.URL+"/api/songs/"+id, "")
	var got map[string]any
	json.Unmarshal([]byte(body), &got)
	if got["lyricsText"] != "v2" || got["artist"] != "MyGO" || got["audioUrl"] == nil {
		t.Fatalf("get: %s", body)
	}

	// PUT drops computed fields and keeps the rest
	got["notes"] = "hi"
	b, _ := json.Marshal(got)
	do(t, "PUT", ts.URL+"/api/songs/"+id, string(b))
	raw, _ := os.ReadFile(filepath.Join(s.Library(), id, "song.json"))
	if strings.Contains(string(raw), "lyricsText") || strings.Contains(string(raw), "hasAudio") || !strings.Contains(string(raw), `"notes": "hi"`) {
		t.Fatalf("song.json = %s", raw)
	}

	res, _ = do(t, "DELETE", ts.URL+"/api/songs/"+id, "")
	if res.StatusCode != 204 {
		t.Fatalf("delete: %d", res.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(s.Library(), id)); !os.IsNotExist(err) {
		t.Fatal("song folder still there")
	}
	trash, _ := os.ReadDir(filepath.Join(s.Library(), ".trash"))
	if len(trash) != 1 {
		t.Fatalf("trash has %d entries", len(trash))
	}
}

func TestExamplesAreReadOnly(t *testing.T) {
	_, ts := newTest(t)
	for _, c := range [][2]string{{"PUT", "/api/songs/demo"}, {"PUT", "/api/songs/demo/lyrics"}, {"DELETE", "/api/songs/demo"}} {
		res, _ := do(t, c[0], ts.URL+c[1], "{}")
		if res.StatusCode != 400 {
			t.Errorf("%s %s = %d", c[0], c[1], res.StatusCode)
		}
	}
	_, body := do(t, "GET", ts.URL+"/api/songs/demo", "")
	if !strings.Contains(body, `"lyricsText":"[00:01.00]`) || !strings.Contains(body, `"source":"example"`) {
		t.Fatalf("example get: %s", body)
	}
}

func TestMediaRange(t *testing.T) {
	_, ts := newTest(t)
	req, _ := http.NewRequest("GET", ts.URL+"/media/demo/a.wav", nil)
	req.Header.Set("Range", "bytes=2-5")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 206 || string(b) != "2345" || res.Header.Get("Content-Type") != "audio/wav" {
		t.Fatalf("range: %d %q %s", res.StatusCode, b, res.Header.Get("Content-Type"))
	}
	res, _ = do(t, "GET", ts.URL+"/media/demo/..%2fsong.json", "")
	if res.StatusCode != 404 {
		t.Fatalf("traversal: %d", res.StatusCode)
	}
}

func TestWebAndUnknown(t *testing.T) {
	_, ts := newTest(t)
	if _, body := do(t, "GET", ts.URL+"/", ""); !strings.Contains(body, "library") {
		t.Fatalf("index: %s", body)
	}
	if _, body := do(t, "GET", ts.URL+"/player.html", ""); body != "player" {
		t.Fatalf("player: %s", body)
	}
	if res, _ := do(t, "GET", ts.URL+"/nope.js", ""); res.StatusCode != 404 {
		t.Fatalf("missing file: %d", res.StatusCode)
	}
	if res, _ := do(t, "GET", ts.URL+"/api/nope", ""); res.StatusCode != 404 {
		t.Fatalf("unknown api: %d", res.StatusCode)
	}
}

func TestCommandsReachPlayers(t *testing.T) {
	_, ts := newTest(t)

	res, err := http.Get(ts.URL + "/api/events?role=player")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	lines := make(chan string, 16)
	go func() {
		sc := bufio.NewScanner(res.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
	}()
	waitFor := func(prefix string) string {
		deadline := time.After(3 * time.Second)
		for {
			select {
			case l := <-lines:
				if strings.HasPrefix(l, prefix) {
					return l
				}
			case <-deadline:
				t.Fatalf("no %q line", prefix)
			}
		}
	}
	waitFor(": hello")

	_, body := do(t, "GET", ts.URL+"/api/command?action=seekBy&delta=-5", "")
	if !strings.Contains(body, `"players":1`) {
		t.Fatalf("command: %s", body)
	}
	waitFor("event: command")
	if l := waitFor("data: "); !strings.Contains(l, `"action":"seekBy"`) || !strings.Contains(l, `"delta":"-5"`) {
		t.Fatalf("data line: %s", l)
	}

	if res, _ := do(t, "POST", ts.URL+"/api/command", `{}`); res.StatusCode != 400 {
		t.Fatalf("missing action: %d", res.StatusCode)
	}
}

func TestSafeName(t *testing.T) {
	for _, bad := range []string{"", ".", "..", ".hidden", "a/b.mp3", `a\b.mp3`, "a:b", "../x"} {
		if _, err := safeName(bad); err == nil {
			t.Errorf("safeName(%q) accepted", bad)
		}
	}
	if n, err := safeName("伴奏 (off vocal).mp3"); err != nil || n != "伴奏 (off vocal).mp3" {
		t.Errorf("good name rejected: %v", err)
	}
}
