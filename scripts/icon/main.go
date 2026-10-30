// Writes resources/icon.png (1024×1024), the app icon mygo build uses.
// Run with `go run ./scripts/icon`.
package main

import (
	"log"
	"os"

	"github.com/YuutaTsubasa/karaoke/internal/icon"
)

func main() {
	if err := os.MkdirAll("resources", 0o755); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile("resources/icon.png", icon.PNG(1024), 0o644); err != nil {
		log.Fatal(err)
	}
}
