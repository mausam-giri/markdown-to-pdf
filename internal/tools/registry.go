package tools

import "encoding/json"

// Tool describes a path-routed utility on the hub.
type Tool struct {
	ID          string `json:"id"`
	Path        string `json:"path"`
	Name        string `json:"name"`
	Tagline     string `json:"tagline"`
	Description string `json:"description"`
	Status      string `json:"status"` // live | soon
	Accent      string `json:"accent"`
}

// All is the registry of tools. Add new entries here and place files under web/<id>/.
var All = []Tool{
	{
		ID:          "markdown-to-pdf",
		Path:        "/markdown-to-pdf/",
		Name:        "MarkForge",
		Tagline:     "Markdown → HTML → PDF",
		Description: "Live Markdown preview, custom CSS, page-break control, and one-click PDF export.",
		Status:      "live",
		Accent:      "#0d7a6f",
	},
}

// ByID returns a tool by id, or false if missing.
func ByID(id string) (Tool, bool) {
	for _, t := range All {
		if t.ID == id {
			return t, true
		}
	}
	return Tool{}, false
}

// JSON returns the registry as JSON bytes.
func JSON() ([]byte, error) {
	return json.Marshal(struct {
		Tools []Tool `json:"tools"`
	}{Tools: All})
}
