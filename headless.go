//go:build headless

package main

// Headless build: the server alone, no window or tray. `-serve` is implied.
func main() {
	f := parseFlags()
	f.serve = true
	serve(f)
}
