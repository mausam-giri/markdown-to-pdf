(() => {
  "use strict";

  const grid = document.getElementById("tools-grid");
  if (!grid) return;

  function initials(name) {
    return name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  function card(tool) {
    const isLive = tool.status === "live";
    const el = document.createElement(isLive ? "a" : "div");
    el.className = `tool-card${isLive ? "" : " is-soon"}`;
    if (isLive) {
      el.href = tool.path;
      el.setAttribute("aria-label", `Open ${tool.name}`);
    }

    el.innerHTML = `
      <div class="tool-card-top">
        <span class="tool-icon" style="background:${tool.accent || "#0d7a6f"}">${initials(tool.name)}</span>
        <span class="tool-status ${isLive ? "" : "soon"}">${isLive ? "Live" : "Soon"}</span>
      </div>
      <div>
        <h3>${escapeHtml(tool.name)}</h3>
        <p class="tool-tagline">${escapeHtml(tool.tagline || "")}</p>
      </div>
      <p class="tool-desc">${escapeHtml(tool.description || "")}</p>
      <span class="tool-cta">${isLive ? "Open tool →" : "Coming soon"}</span>
    `;
    return el;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  fetch("/api/tools")
    .then((r) => {
      if (!r.ok) throw new Error("Failed to load tools");
      return r.json();
    })
    .then((data) => {
      const tools = data.tools || [];
      grid.innerHTML = "";
      if (!tools.length) {
        grid.innerHTML = `<p class="tools-error">No tools registered yet.</p>`;
        return;
      }
      tools.forEach((t) => grid.appendChild(card(t)));
    })
    .catch(() => {
      grid.innerHTML = `<p class="tools-error">Could not load tools. Refresh and try again.</p>`;
    });
})();
