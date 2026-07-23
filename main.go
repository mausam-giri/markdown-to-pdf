package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/mausam-giri/tools/internal/assets"
	"github.com/mausam-giri/tools/internal/tools"
)

//go:embed all:web
var webFS embed.FS

func main() {
	static, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("embed web: %v", err)
	}

	web, err := assets.Handler(static)
	if err != nil {
		log.Fatalf("assets handler: %v", err)
	}

	mux := http.NewServeMux()

	// Path-based tool routes are folder-backed under web/<tool-id>/
	// Landing: GET /  → web/index.html
	// Tool:    GET /markdown-to-pdf/ → web/markdown-to-pdf/index.html
	mux.Handle("/", web)

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	mux.HandleFunc("GET /api/tools", func(w http.ResponseWriter, r *http.Request) {
		payload, err := tools.JSON()
		if err != nil {
			http.Error(w, `{"error":"encode failed"}`, http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=60")
		_, _ = w.Write(payload)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           withLogging(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("Mausam Giri Tools ready at http://localhost:%s", port)
	for _, t := range tools.All {
		log.Printf("  · %s → %s (%s)", t.Name, t.Path, t.Status)
	}
	log.Fatal(srv.ListenAndServe())
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if r.URL.Path != "/" && r.URL.Path != "/favicon.ico" && r.URL.Path != "/favicon.svg" && r.URL.Path != "/api/health" {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}
