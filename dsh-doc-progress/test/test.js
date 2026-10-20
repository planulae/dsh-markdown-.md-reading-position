/* Browser-side checks for dsh-doc-progress, driven by headless Chrome. */
(() => {
  const KEY = "dsh.document-reading-progress.v1";
  const MARKDOWN_ID = "@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown";
  const results = [];
  let cleanup = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function assert(name, condition, detail) {
    results.push({ name, pass: Boolean(condition), detail: detail === undefined ? "" : String(detail) });
  }

  function reset() {
    if (cleanup !== null) {
      try {
        cleanup();
      } catch (error) {
        results.push({ name: "cleanup", pass: false, detail: String(error) });
      }
      cleanup = null;
    }
    document.getElementById("host").replaceChildren();
    localStorage.removeItem(KEY);
  }

  function applyPlugin(config) {
    const ctx = {
      effect(factory) {
        const disposer = factory();
        cleanup = typeof disposer === "function" ? disposer : null;
        return disposer;
      }
    };
    window.__PLUGIN__.apply(ctx, config);
  }

  function seed(docs) {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, docs }));
  }

  function addressOf(path) {
    return "dsh-resource://file/session/session-test/" + path.split("/").map(encodeURIComponent).join("/");
  }

  function mount(options) {
    const settings = Object.assign({
      absolutePath: "D:\\docs\\test.md",
      urlPath: "docs/test.md",
      height: 3000,
      pages: null,
      hidden: false,
      withHeading: true,
      deferTitle: false
    }, options || {});

    const outer = document.createElement("div");
    if (settings.hidden) outer.hidden = true;
    const root = document.createElement("div");
    root.className = "preview";
    root.setAttribute("data-textpreview-state", "text");
    root.setAttribute("data-textpreview-url", addressOf(settings.urlPath));
    root.setAttribute("data-document-preview", MARKDOWN_ID);

    const header = document.createElement("div");
    header.className = "header";
    const label = document.createElement("span");
    label.setAttribute("data-textpreview-path", "");
    label.setAttribute("title", settings.deferTitle ? settings.urlPath : settings.absolutePath);
    label.textContent = label.getAttribute("title");
    header.appendChild(label);

    const body = document.createElement("div");
    body.className = "body";
    body.setAttribute("data-textpreview-body", "");

    const content = document.createElement("div");
    content.setAttribute("data-document-markdown", "");
    if (settings.withHeading) {
      const heading = document.createElement("h1");
      heading.textContent = "Test document";
      content.appendChild(heading);
    }
    const spacer = document.createElement("div");
    spacer.className = "spacer";
    spacer.style.height = (settings.pages ? settings.pages.step : settings.height) + "px";
    content.appendChild(spacer);
    body.appendChild(content);

    let more = null;
    let loadedHeight = settings.pages ? settings.pages.step : settings.height;
    if (settings.pages) {
      more = document.createElement("button");
      more.type = "button";
      more.className = "more";
      more.setAttribute("data-textpreview-more", "");
      more.textContent = "Load more";
      const step = settings.pages.step;
      const total = settings.pages.total;
      more.addEventListener("click", () => {
        loadedHeight += step;
        spacer.style.height = loadedHeight + "px";
        if (loadedHeight >= total && more !== null) {
          more.remove();
          more = null;
        }
      });
      body.appendChild(more);
    }

    root.appendChild(header);
    root.appendChild(body);
    outer.appendChild(root);
    document.getElementById("host").appendChild(outer);

    return {
      outer,
      root,
      body,
      content,
      label,
      heading: content.querySelector("h1"),
      remove() {
        outer.remove();
      },
      loadedHeight() {
        return loadedHeight;
      },
      morePresent() {
        return more !== null && more.isConnected;
      }
    };
  }

  async function testSimpleRestore() {
    reset();
    applyPlugin();
    const first = mount({ height: 3000 });
    await sleep(120);
    const api = window.__DSH_DOC_PROGRESS__;
    assert("debug api", api !== undefined, api === undefined ? "missing" : JSON.stringify(api.stats()));
    assert("debug scrollable", first.body.scrollHeight - first.body.clientHeight > 1000, first.body.scrollHeight + "/" + first.body.clientHeight + " top=" + first.body.scrollTop + " rect=" + first.root.getBoundingClientRect().height);
    first.body.scrollTop = 1200;
    first.body.dispatchEvent(new Event("scroll"));
    await sleep(650);
    assert("debug dump", true, JSON.stringify(api.dump()));

    const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
    const record = stored.docs && stored.docs["file:d:/docs/test.md"];
    assert("scroll position is persisted", record && Math.abs(record.top - 1200) < 3, record && record.top);

    first.remove();
    await sleep(120);

    const second = mount({ height: 3000 });
    await sleep(900);
    assert("scroll position is restored after remount", Math.abs(second.body.scrollTop - 1200) < 5, second.body.scrollTop);
    second.remove();
    await sleep(80);
  }

  async function testPagedRestore() {
    reset();
    seed({
      "file:d:/docs/paged.md": {
        top: 1800,
        ratio: 0.6,
        height: 3000,
        viewport: 340,
        anchor: null,
        updatedAt: Date.now()
      }
    });
    applyPlugin();
    const preview = mount({
      absolutePath: "D:\\docs\\paged.md",
      urlPath: "docs/paged.md",
      pages: { step: 600, total: 3000 }
    });
    await sleep(1600);
    assert("a deep position pages the preview forward", Math.abs(preview.body.scrollTop - 1800) < 8, preview.body.scrollTop);
    assert("more than one page was requested", preview.loadedHeight() >= 1800, preview.loadedHeight());
    preview.remove();
    await sleep(80);
  }

  async function testHiddenRootDefersRestore() {
    reset();
    seed({
      "file:d:/docs/hidden.md": {
        top: 700,
        ratio: 0.3,
        height: 3000,
        viewport: 340,
        anchor: null,
        updatedAt: Date.now()
      }
    });
    applyPlugin();
    const preview = mount({
      absolutePath: "D:\\docs\\hidden.md",
      urlPath: "docs/hidden.md",
      height: 3000,
      hidden: true
    });
    await sleep(700);
    assert("a hidden preview does not restore in the background", preview.body.scrollTop === 0, preview.body.scrollTop);
    preview.outer.hidden = false;
    await sleep(1000);
    assert("showing the preview restores its position", Math.abs(preview.body.scrollTop - 700) < 5, preview.body.scrollTop);
    preview.remove();
    await sleep(80);
  }

  async function testMetadataArrivesLate() {
    reset();
    seed({
      "file:d:/docs/late.md": {
        top: 900,
        ratio: 0.4,
        height: 3000,
        viewport: 340,
        anchor: null,
        updatedAt: Date.now()
      }
    });
    applyPlugin();
    const preview = mount({
      absolutePath: "D:\\docs\\late.md",
      urlPath: "docs/late.md",
      height: 3000,
      deferTitle: true
    });
    await sleep(500);
    assert("a relative path alone does not jump yet", preview.body.scrollTop === 0, preview.body.scrollTop);
    preview.label.setAttribute("title", "D:\\docs\\late.md");
    await sleep(1000);
    assert("the absolute path arriving later restores the position", Math.abs(preview.body.scrollTop - 900) < 5, preview.body.scrollTop);
    preview.remove();
    await sleep(80);
  }

  async function testNewFileStartsAtTop() {
    reset();
    applyPlugin();
    seed({
      "file:d:/docs/other.md": { top: 1500, anchor: null, updatedAt: Date.now() }
    });
    const preview = mount({ absolutePath: "D:\\docs\\fresh.md", urlPath: "docs/fresh.md", height: 3000 });
    await sleep(700);
    assert("a file with no saved position stays at the top", preview.body.scrollTop === 0, preview.body.scrollTop);
    preview.remove();
    await sleep(80);
  }

  async function run() {
    try {
      await testSimpleRestore();
      await testPagedRestore();
      await testHiddenRootDefersRestore();
      await testMetadataArrivesLate();
      await testNewFileStartsAtTop();
    } catch (error) {
      results.push({ name: "uncaught", pass: false, detail: String(error && error.stack ? error.stack : error) });
    }
    const passed = results.filter((result) => result.pass).length;
    const output = { passed, total: results.length, results };
    window.__TEST_RESULTS__ = output;
    const node = document.getElementById("results");
    node.hidden = false;
    node.textContent = "TEST_RESULTS_JSON:" + JSON.stringify(output);
  }

  window.addEventListener("load", () => {
    void run();
  });
})();
