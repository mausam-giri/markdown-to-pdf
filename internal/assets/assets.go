package assets

import (
	"io/fs"
	"net/http"

	"github.com/CAFxX/httpcompression"
	"github.com/tdewolff/minify/v2"
	"github.com/tdewolff/minify/v2/css"
	"github.com/tdewolff/minify/v2/html"
	"github.com/tdewolff/minify/v2/js"
)

// Handler serves static files from fsys, minified (html/css/js) and compressed
// (gzip/brotli/zstd) via library middleware — no custom encode/serve path.
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

	var h http.Handler = http.FileServer(http.FS(fsys))
	h = m.Middleware(h)
	h = compress(h)
	return h, nil
}
