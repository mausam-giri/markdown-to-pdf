package assets

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/CAFxX/httpcompression"
	"github.com/tdewolff/minify/v2"
	"github.com/tdewolff/minify/v2/css"
	"github.com/tdewolff/minify/v2/html"
	"github.com/tdewolff/minify/v2/js"
)

// Handler serves static files from fsys, minified (html/css/js) and compressed
// (gzip/brotli/zstd), with trailing-slash redirects for tool directories.
func Handler(fsys fs.FS) (http.Handler, error) {
	m := minify.New()
	m.AddFunc("text/css", css.Minify)
	m.AddFunc("text/html", html.Minify)
	m.AddFunc("application/javascript", js.Minify)
	m.AddFunc("text/javascript", js.Minify)

	compress, err := httpcompression.DefaultAdapter()
	if err != nil {
		return nil, err
	}

	files := http.FileServer(http.FS(fsys))
	var h http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Ensure /markdown-to-pdf → /markdown-to-pdf/ so relative assets resolve
		p := r.URL.Path
		if p != "/" && !strings.HasSuffix(p, "/") && !strings.Contains(strings.TrimPrefix(p, "/"), ".") {
			if st, err := fs.Stat(fsys, strings.TrimPrefix(p, "/")+"/index.html"); err == nil && !st.IsDir() {
				http.Redirect(w, r, p+"/", http.StatusMovedPermanently)
				return
			}
		}
		files.ServeHTTP(w, r)
	})
	h = m.Middleware(h)
	h = compress(h)
	return h, nil
}
