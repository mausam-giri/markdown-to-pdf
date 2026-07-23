(() => {
  "use strict";

  const STORAGE_KEY = "markforge:v3";

  const defaultMarkdown = `# MarkForge Sample

Welcome to a **fast**, client-side Markdown → PDF workflow.

## Why this setup
- Live HTML preview as you type
- Custom CSS scoped to the document only
- PDF preview shows **page breaks** before you export

### Checklist
- [x] Headings, lists, and tables
- [x] Code fences
- [x] Manual page breaks

| Feature | Status |
| --- | --- |
| Preview | Live |
| CSS | Editable |
| PDF | Exportable |

\`\`\`js
function exportReady(doc) {
  return Boolean(doc?.title);
}
\`\`\`

> Tip: use the **Page ↵** toolbar button, or insert \`<div data-pagebreak></div>\`.

<div data-pagebreak></div>

## After the break

This section starts on a **new PDF page**. Open **PDF Preview** to see the dashed break markers.
`;

  const defaultCSS = `/* Styles apply only to the document preview */
body {
  font-family: "Barlow", sans-serif;
  color: #1a2330;
  line-height: 1.65;
}

img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em 0;
  border-radius: 6px;
}

h1 {
  font-family: "Barlow", sans-serif;
  font-weight: 700;
  color: #0b3d38;
  border-bottom: 2px solid #d5e2df;
  padding-bottom: 0.35em;
  margin-top: 0;
}

h2 {
  font-family: "Barlow", sans-serif;
  font-weight: 600;
  color: #134e48;
  margin-top: 1.4em;
}

h3 {
  font-family: "Barlow", sans-serif;
  font-weight: 600;
  color: #1a5c54;
  margin-top: 1.2em;
}

code {
  font-family: "Fira Code", monospace;
  font-size: 0.9em;
  background: #eef3f7;
  padding: 0.15em 0.4em;
  border-radius: 4px;
}

pre {
  font-family: "Fira Code", monospace;
  background: #0f1c2e !important;
  border-radius: 8px;
  padding: 1em;
  overflow: auto;
}

pre code {
  font-family: "Fira Code", monospace;
  background: transparent;
  color: #e8eef4;
  padding: 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.2em 0;
  font-family: "Barlow", sans-serif;
}

thead {
  background: #e8f4f2;
}

th,
td {
  border: 1px solid #d5e2df;
  padding: 0.55em 0.75em;
  text-align: left;
}

th {
  font-weight: 600;
  color: #0b3d38;
}

tbody tr:nth-child(even) {
  background: #f7fafc;
}

blockquote {
  border-left: 4px solid #0d7a6f;
  color: #4a5a6a;
  background: #f3faf8;
  padding: 0.6em 1em;
  margin: 1em 0;
  font-style: italic;
}
`;

  const $ = (id) => document.getElementById(id);

  const markdownInput = $("markdown-input");
  const cssInput = $("css-input");
  const cssEditorHost = $("css-editor-host");
  const htmlPreview = $("html-preview");
  const pdfPages = $("pdf-pages");
  const userStyles = $("user-styles");
  const previewStats = $("preview-stats");
  const pageSize = $("page-size");
  const pdfDialog = $("pdf-dialog");
  const zoomLabel = $("zoom-label");

  const PAGE_BREAK_SEL = '[data-pagebreak], [data-break="page"]';
  const PDF_MARGIN_MM = 10;

  let zoom = 1;
  let exporting = false;
  let cssEditor = null;

  marked.setOptions({
    gfm: true,
    breaks: false,
  });

  function getCSS() {
    return cssEditor ? cssEditor.getValue() : cssInput.value;
  }

  function setCSS(value) {
    if (cssEditor) cssEditor.setValue(value);
    else cssInput.value = value;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveState() {
    const payload = {
      markdown: markdownInput.value,
      css: getCSS(),
      page: pageSize.value,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function initCssEditor(initial) {
    cssInput.value = initial;
    cssEditor = CodeMirror.fromTextArea(cssInput, {
      mode: "css",
      lineNumbers: true,
      lineWrapping: true,
      tabSize: 2,
      indentWithTabs: false,
      autofocus: false,
      autoCloseBrackets: true,
      extraKeys: {
        "Ctrl-Space": "autocomplete",
        "Cmd-Space": "autocomplete",
      },
      hintOptions: {
        completeSingle: false,
      },
    });

    cssEditor.on("change", () => {
      updateStyles();
      persist();
    });

    cssEditor.on("inputRead", (cm, change) => {
      if (change.origin !== "+input" && change.origin !== "*compose") return;
      const text = change.text.join("");
      if (!/[a-zA-Z0-9-%]/.test(text)) return;
      CodeMirror.commands.autocomplete(cm, null, { completeSingle: false });
    });
  }

  // Forward declarations filled after helpers exist
  let persist = () => {};
  let refreshPreview = () => {};
  let refreshStyles = () => {};

  /** Prefix selectors so user CSS only hits document sheets */
  function scopeCSS(css, scopes) {
    const scopeList = scopes.join(", ");
    let out = "";
    let i = 0;
    let buf = "";
    let depth = 0;
    let inString = null;
    let inComment = false;

    const flushRule = (block) => {
      const brace = block.indexOf("{");
      if (brace === -1) {
        out += block;
        return;
      }
      const selectors = block.slice(0, brace).trim();
      const body = block.slice(brace);
      if (!selectors || selectors.startsWith("@")) {
        // Keep @keyframes / @media as-is; nested rules still useful raw
        if (selectors.startsWith("@media") || selectors.startsWith("@supports")) {
          const innerStart = body.indexOf("{");
          const innerEnd = body.lastIndexOf("}");
          if (innerStart !== -1 && innerEnd > innerStart) {
            const inner = body.slice(innerStart + 1, innerEnd);
            out += `${selectors}{${scopeCSS(inner, scopes)}}`;
            return;
          }
        }
        out += block;
        return;
      }
      const scoped = selectors
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          if (s === "body" || s === "html" || s === ":root") {
            return scopeList;
          }
          // Preview roots already have .markdown-body — remap instead of nesting
          if (s === ".markdown-body" || s.startsWith(".markdown-body ")) {
            const rest = s === ".markdown-body" ? "" : s.slice(".markdown-body".length);
            return scopes.map((sc) => `${sc}${rest}`).join(", ");
          }
          return scopes.map((sc) => `${sc} ${s}`).join(", ");
        })
        .join(", ");
      out += `${scoped}${body}`;
    };

    while (i < css.length) {
      const ch = css[i];
      const next = css[i + 1];

      if (inComment) {
        buf += ch;
        if (ch === "*" && next === "/") {
          buf += "/";
          i += 2;
          inComment = false;
          continue;
        }
        i++;
        continue;
      }

      if (inString) {
        buf += ch;
        if (ch === "\\" && next) {
          buf += next;
          i += 2;
          continue;
        }
        if (ch === inString) inString = null;
        i++;
        continue;
      }

      if (ch === "/" && next === "*") {
        buf += "/*";
        i += 2;
        inComment = true;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = ch;
        buf += ch;
        i++;
        continue;
      }

      if (ch === "{") {
        depth++;
        buf += ch;
        i++;
        continue;
      }

      if (ch === "}") {
        depth--;
        buf += ch;
        i++;
        if (depth === 0) {
          flushRule(buf);
          buf = "";
        }
        continue;
      }

      buf += ch;
      i++;
    }

    if (buf.trim()) out += buf;
    return out;
  }

  function renderMarkdown(src) {
    const dirty = marked.parse(src || "");
    return DOMPurify.sanitize(dirty, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["data-pagebreak", "data-break"],
    });
  }

  function wordCount(text) {
    const words = text.trim().match(/\S+/g);
    return words ? words.length : 0;
  }

  function mmToPx(mm) {
    return (mm / 25.4) * 96;
  }

  function pageMetrics() {
    const isLetter = pageSize.value === "letter";
    const pageWidthMm = isLetter ? 215.9 : 210;
    const pageHeightMm = isLetter ? 279.4 : 297;
    // Match html2pdf margins: printable content height inside the sheet
    const contentHeightMm = pageHeightMm - PDF_MARGIN_MM * 2;
    const padMm = 14; // .pdf-sheet padding
    return {
      pageWidthMm,
      pageHeightMm,
      contentHeightMm,
      contentHeightPx: mmToPx(contentHeightMm - padMm * 2),
      padMm,
    };
  }

  function applyPageSize() {
    const { pageWidthMm, pageHeightMm } = pageMetrics();
    document.documentElement.style.setProperty("--page-width", `${pageWidthMm}mm`);
    document.documentElement.style.setProperty("--page-height", `${pageHeightMm}mm`);
    htmlPreview.style.minHeight = `${pageHeightMm}mm`;
    if (pdfDialog.open) renderPdfPreview();
  }

  function isPageBreakNode(node) {
    return (
      node.nodeType === 1 &&
      (node.hasAttribute("data-pagebreak") ||
        node.getAttribute("data-break") === "page")
    );
  }

  function createPdfSheet(pageNo) {
    const wrap = document.createElement("div");
    wrap.className = "pdf-sheet-wrap";

    const sheet = document.createElement("article");
    sheet.className = "markdown-body pdf-sheet";
    sheet.dataset.page = String(pageNo);

    const label = document.createElement("span");
    label.className = "pdf-sheet-label";
    label.textContent = `Page ${pageNo}`;
    sheet.appendChild(label);

    const body = document.createElement("div");
    body.className = "pdf-sheet-body";
    sheet.appendChild(body);

    wrap.appendChild(sheet);
    return { wrap, sheet, body };
  }

  function createBreakMarker(pageNo, kind) {
    const marker = document.createElement("div");
    marker.className = "pdf-break-marker";
    marker.dataset.kind = kind;
    const span = document.createElement("span");
    span.textContent =
      kind === "manual"
        ? `Manual break · Page ${pageNo}`
        : `Page break · Page ${pageNo}`;
    marker.appendChild(span);
    return marker;
  }

  function renderPdfPreview() {
    if (!pdfPages) return;
    const html = renderMarkdown(markdownInput.value);
    const metrics = pageMetrics();

    // Measure blocks in a hidden sheet with matching width/styles
    const probe = document.createElement("div");
    probe.className = "markdown-body pdf-sheet";
    probe.style.cssText = `
      position: absolute; left: -10000px; top: 0; visibility: hidden;
      width: ${metrics.pageWidthMm}mm; height: auto; max-height: none;
      min-height: 0; overflow: visible; padding: ${metrics.padMm}mm;
    `;
    const probeBody = document.createElement("div");
    probeBody.className = "pdf-sheet-body";
    probeBody.innerHTML = html;
    probe.appendChild(probeBody);
    document.body.appendChild(probe);

    // Apply same scoped user CSS against probe via temporary id
    probe.id = "pdf-measure-root";
    const measureStyle = document.createElement("style");
    measureStyle.textContent = scopeCSS(getCSS(), ["#pdf-measure-root"]);
    document.head.appendChild(measureStyle);

    const blocks = [...probeBody.children];
    const pages = [];
    let pageNo = 1;
    let current = createPdfSheet(pageNo);
    pages.push({ ...current, kind: "start" });
    let used = 0;
    const maxH = Math.max(120, metrics.contentHeightPx);

    const startNewPage = (kind) => {
      pageNo += 1;
      const marker = createBreakMarker(pageNo, kind);
      const next = createPdfSheet(pageNo);
      pages.push({ marker, ...next, kind });
      current = next;
      used = 0;
    };

    blocks.forEach((block) => {
      if (isPageBreakNode(block)) {
        if (used > 0 || pages.length === 1) {
          startNewPage("manual");
        }
        return;
      }

      const clone = block.cloneNode(true);
      // Measure height of this block in probe context
      const h = block.getBoundingClientRect().height;
      const gap = used > 0 ? 8 : 0;

      if (used > 0 && used + gap + h > maxH) {
        startNewPage("auto");
      }

      current.body.appendChild(clone);
      used += gap + Math.max(h, 1);
    });

    probe.remove();
    measureStyle.remove();

    pdfPages.innerHTML = "";
    pages.forEach((p, i) => {
      if (p.marker) pdfPages.appendChild(p.marker);
      pdfPages.appendChild(p.wrap);
      // Re-number labels in case
      const label = p.sheet.querySelector(".pdf-sheet-label");
      if (label) label.textContent = `Page ${i + 1}`;
    });

    // Update break marker text with correct following page numbers
    [...pdfPages.querySelectorAll(".pdf-break-marker")].forEach((m, idx) => {
      const nextPage = idx + 2;
      const kind = m.dataset.kind;
      m.querySelector("span").textContent =
        kind === "manual"
          ? `Manual break · starts page ${nextPage}`
          : `Auto break · starts page ${nextPage}`;
    });
  }

  function updatePreview() {
    const html = renderMarkdown(markdownInput.value);
    htmlPreview.innerHTML = html;
    if (pdfDialog.open) renderPdfPreview();
    previewStats.textContent = `${wordCount(markdownInput.value)} words`;
  }

  function updateStyles() {
    const css = getCSS();
    userStyles.textContent = "";
    userStyles.appendChild(document.createTextNode(scopeCSS(css, [
      "#html-preview",
      ".pdf-sheet",
      "#pdf-export-root",
      "#pdf-measure-root",
    ])));
    if (pdfDialog.open) renderPdfPreview();
  }

  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    markdownInput.classList.toggle("active", name === "markdown");
    cssEditorHost.classList.toggle("active", name === "css");
    const mdToolbar = $("md-toolbar");
    if (mdToolbar) mdToolbar.hidden = name !== "markdown";
    if (name === "css" && cssEditor) {
      requestAnimationFrame(() => {
        cssEditor.refresh();
        cssEditor.focus();
      });
    } else if (name === "markdown") {
      markdownInput.focus();
    }
  }

  function setZoom(next) {
    zoom = Math.min(1.5, Math.max(0.6, next));
    pdfPages.style.transform = `scale(${zoom})`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function openPdfPreview() {
    setZoom(1);
    pdfDialog.showModal();
    // Layout after dialog opens so widths are correct
    requestAnimationFrame(() => renderPdfPreview());
  }

  function closePdfPreview() {
    if (pdfDialog.open) pdfDialog.close();
  }

  function pdfOptions() {
    const format = pageSize.value === "letter" ? "letter" : "a4";
    return {
      margin: [PDF_MARGIN_MM, PDF_MARGIN_MM, PDF_MARGIN_MM, PDF_MARGIN_MM],
      filename: "markforge-document.pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      },
      jsPDF: { unit: "mm", format, orientation: "portrait" },
      pagebreak: {
        mode: ["css", "legacy"],
        after: PAGE_BREAK_SEL,
        avoid: ["img", "pre", "table", "blockquote"],
      },
    };
  }

  async function exportPDF() {
    if (exporting) return;
    exporting = true;

    const buttons = [
      $("btn-export"),
      $("btn-export-from-preview"),
    ];
    buttons.forEach((b) => {
      if (b) b.disabled = true;
    });

    // Always export clean rendered HTML (not visual page chrome)
    const clone = document.createElement("article");
    clone.id = "pdf-export-root";
    clone.className = "markdown-body page-sheet";
    clone.style.width = getComputedStyle(document.documentElement)
      .getPropertyValue("--page-width")
      .trim();
    clone.style.minHeight = "auto";
    clone.style.boxShadow = "none";
    clone.style.borderRadius = "0";
    clone.style.margin = "0";
    clone.style.padding = "0";
    clone.innerHTML = renderMarkdown(markdownInput.value);

    const mount = document.createElement("div");
    mount.style.position = "fixed";
    mount.style.left = "-10000px";
    mount.style.top = "0";
    mount.style.width = clone.style.width;
    mount.appendChild(clone);

    const style = document.createElement("style");
    style.textContent = scopeCSS(getCSS(), ["#pdf-export-root"]);
    mount.appendChild(style);
    document.body.appendChild(mount);

    try {
      await html2pdf().set(pdfOptions()).from(clone).save();
    } catch (err) {
      console.error(err);
      alert("PDF export failed. Try a shorter document or refresh the page.");
    } finally {
      mount.remove();
      exporting = false;
      buttons.forEach((b) => {
        if (b) b.disabled = false;
      });
    }
  }

  function initSplitter() {
    const splitter = $("splitter");
    const editor = document.querySelector(".editor-pane");
    const workspace = document.querySelector(".workspace");
    let dragging = false;

    const onMove = (clientX, clientY) => {
      if (!dragging) return;
      const rect = workspace.getBoundingClientRect();
      const vertical = window.matchMedia("(max-width: 860px)").matches;
      if (vertical) {
        const y = clientY - rect.top;
        const pct = Math.min(70, Math.max(28, (y / rect.height) * 100));
        editor.style.flex = `0 0 ${pct}%`;
      } else {
        const x = clientX - rect.left;
        const pct = Math.min(70, Math.max(28, (x / rect.width) * 100));
        editor.style.flex = `0 0 ${pct}%`;
      }
    };

    splitter.addEventListener("pointerdown", (e) => {
      dragging = true;
      splitter.classList.add("active");
      splitter.setPointerCapture(e.pointerId);
    });
    splitter.addEventListener("pointermove", (e) => onMove(e.clientX, e.clientY));
    splitter.addEventListener("pointerup", () => {
      dragging = false;
      splitter.classList.remove("active");
    });
  }

  function resetDefaults() {
    markdownInput.value = defaultMarkdown;
    setCSS(defaultCSS);
    pageSize.value = "a4";
    updatePreview();
    updateStyles();
    applyPageSize();
    saveState();
  }

  function getMdSelection() {
    const start = markdownInput.selectionStart;
    const end = markdownInput.selectionEnd;
    return {
      start,
      end,
      value: markdownInput.value,
      selected: markdownInput.value.slice(start, end),
    };
  }

  function setMdSelection(next, cursorStart, cursorEnd) {
    markdownInput.value = next;
    markdownInput.focus();
    markdownInput.setSelectionRange(cursorStart, cursorEnd);
    markdownInput.dispatchEvent(new Event("input"));
  }

  function wrapSelection(before, after = before, placeholder = "text") {
    const { start, end, value, selected } = getMdSelection();
    const inner = selected || placeholder;
    const next = value.slice(0, start) + before + inner + after + value.slice(end);
    const selStart = start + before.length;
    setMdSelection(next, selStart, selStart + inner.length);
  }

  function prefixLines(prefix, placeholder = "item") {
    const { start, end, value, selected } = getMdSelection();
    const block = selected || placeholder;
    const lined = block
      .split("\n")
      .map((line, i) => {
        const p = typeof prefix === "function" ? prefix(i) : prefix;
        return line.match(/^\s*$/) ? line : `${p}${line}`;
      })
      .join("\n");
    const next = value.slice(0, start) + lined + value.slice(end);
    setMdSelection(next, start, start + lined.length);
  }

  function insertBlock(block, selectOffset = 0, selectLen = 0) {
    const { start, end, value } = getMdSelection();
    const needsLead = start > 0 && value[start - 1] !== "\n" ? "\n\n" : start > 0 ? "\n" : "";
    const needsTrail = end < value.length && value[end] !== "\n" ? "\n\n" : "\n";
    const chunk = needsLead + block + needsTrail;
    const next = value.slice(0, start) + chunk + value.slice(end);
    const selStart = start + needsLead.length + selectOffset;
    setMdSelection(next, selStart, selStart + selectLen);
  }

  function applyMarkdownAction(action) {
    switch (action) {
      case "bold":
        wrapSelection("**", "**", "bold text");
        break;
      case "italic":
        wrapSelection("*", "*", "italic text");
        break;
      case "strike":
        wrapSelection("~~", "~~", "strikethrough");
        break;
      case "highlight":
        wrapSelection("<mark>", "</mark>", "highlighted");
        break;
      case "h1":
        prefixLines("# ", "Heading");
        break;
      case "h2":
        prefixLines("## ", "Heading");
        break;
      case "h3":
        prefixLines("### ", "Heading");
        break;
      case "h4":
        prefixLines("#### ", "Heading");
        break;
      case "link": {
        const { selected } = getMdSelection();
        const label = selected || "link text";
        wrapSelection("[", "](https://)", label);
        break;
      }
      case "image":
        insertBlock("![alt text](https://)", 2, 8);
        break;
      case "code":
        wrapSelection("`", "`", "code");
        break;
      case "codeblock":
        insertBlock("```js\ncode\n```", 6, 4);
        break;
      case "quote":
        prefixLines("> ", "quote");
        break;
      case "ul":
        prefixLines("- ", "item");
        break;
      case "ol":
        prefixLines((i) => `${i + 1}. `, "item");
        break;
      case "task":
        prefixLines("- [ ] ", "task");
        break;
      case "table":
        insertBlock(
          "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| A | B | C |\n| D | E | F |",
          2,
          8
        );
        break;
      case "hr":
        insertBlock("---");
        break;
      case "pagebreak":
        insertBlock('<div data-pagebreak></div>');
        break;
      case "footnote":
        insertBlock("Here is a footnote reference[^1].\n\n[^1]: Footnote definition.", 28, 2);
        break;
      case "toc":
        insertBlock(
          "## Table of Contents\n\n- [Section](#section)\n- [Another](#another)",
          5,
          16
        );
        break;
      default:
        break;
    }
  }

  function initMarkdownToolbar() {
    const bar = $("md-toolbar");
    if (!bar) return;
    bar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-md]");
      if (!btn) return;
      applyMarkdownAction(btn.dataset.md);
    });

    markdownInput.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        applyMarkdownAction("bold");
      } else if (key === "i") {
        e.preventDefault();
        applyMarkdownAction("italic");
      } else if (key === "k") {
        e.preventDefault();
        applyMarkdownAction("link");
      }
    });
  }

  function setPaneVisibility(editorVisible, previewVisible) {
    if (!editorVisible && !previewVisible) return;

    const workspace = document.querySelector(".workspace");
    workspace.classList.toggle("editor-hidden", !editorVisible);
    workspace.classList.toggle("preview-hidden", !previewVisible);

    const btnEditor = $("btn-toggle-editor");
    const btnPreview = $("btn-toggle-preview");
    btnEditor.setAttribute("aria-pressed", String(!editorVisible));
    btnPreview.setAttribute("aria-pressed", String(!previewVisible));
    btnEditor.title = editorVisible ? "Hide editor" : "Show editor";
    btnPreview.title = previewVisible ? "Hide preview" : "Show preview";

    if (editorVisible && cssEditorHost.classList.contains("active") && cssEditor) {
      requestAnimationFrame(() => cssEditor.refresh());
    }
  }

  function initPaneToggles() {
    let editorVisible = true;
    let previewVisible = true;

    $("btn-toggle-editor").addEventListener("click", () => {
      if (editorVisible && !previewVisible) return;
      editorVisible = !editorVisible;
      setPaneVisibility(editorVisible, previewVisible);
    });

    $("btn-toggle-preview").addEventListener("click", () => {
      if (previewVisible && !editorVisible) return;
      previewVisible = !previewVisible;
      setPaneVisibility(editorVisible, previewVisible);
    });
  }

  persist = debounce(saveState, 400);
  refreshPreview = debounce(updatePreview, 80);
  refreshStyles = debounce(updateStyles, 80);

  // Wire UI
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  markdownInput.addEventListener("input", () => {
    refreshPreview();
    persist();
  });
  pageSize.addEventListener("change", () => {
    applyPageSize();
    saveState();
  });

  $("btn-pdf-preview").addEventListener("click", openPdfPreview);
  $("btn-close-preview").addEventListener("click", closePdfPreview);
  $("btn-export").addEventListener("click", exportPDF);
  $("btn-export-from-preview").addEventListener("click", exportPDF);
  $("btn-zoom-in").addEventListener("click", () => setZoom(zoom + 0.1));
  $("btn-zoom-out").addEventListener("click", () => setZoom(zoom - 0.1));
  $("btn-reset").addEventListener("click", resetDefaults);

  pdfDialog.addEventListener("click", (e) => {
    if (e.target === pdfDialog) closePdfPreview();
  });

  markdownInput.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const start = markdownInput.selectionStart;
    const end = markdownInput.selectionEnd;
    markdownInput.value = `${markdownInput.value.slice(0, start)}  ${markdownInput.value.slice(end)}`;
    markdownInput.selectionStart = markdownInput.selectionEnd = start + 2;
    markdownInput.dispatchEvent(new Event("input"));
  });

  // Boot
  const saved = loadState();
  markdownInput.value = saved?.markdown ?? defaultMarkdown;
  pageSize.value = saved?.page ?? "a4";
  initCssEditor(saved?.css ?? defaultCSS);
  initMarkdownToolbar();
  initPaneToggles();

  applyPageSize();
  updatePreview();
  updateStyles();
  initSplitter();
})();
