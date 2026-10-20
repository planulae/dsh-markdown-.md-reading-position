window.__ModuleLoader__.load({
	id: "dsh-doc-progress",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/**
		 * Browser half of dsh-doc-progress.
		 *
		 * The document preview keeps a per-tab scroll offset in memory, but a
		 * session switch can close the tab (or restore it as a fresh occurrence),
		 * so the offset is gone when the file is opened again. This module
		 * mirrors the offset of every Markdown preview into localStorage under a
		 * stable file key and puts it back when the preview mounts again.
		 *
		 * It intentionally works on the rendered DOM instead of the preview's
		 * private store: `data-textpreview-*` attributes are the preview's
		 * public rendering contract, and a DOM observer keeps the plugin valid
		 * across preview upgrades that keep those attributes.
		 */

		const VERSION = "0.1.0";
		const STORAGE_KEY = "dsh.document-reading-progress.v1";
		const MARKDOWN_ID = "@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown";
		const FILE_ADDRESS_PREFIX = "dsh-resource://file/";
		/** Keep the same small margin the preview uses when revealing a source line. */
		const TOP_LINE_OFFSET = 24;
		const DEFAULTS = {
			enabled: true,
			/** Let the built-in restore and navigation effects settle first. */
			restoreDelayMs: 160,
			/** Upper bound for paging forward to a saved offset. */
			maxRestoreMs: 15000,
			/** Prune old files so localStorage never grows without bound. */
			maxDocs: 500,
			debug: false
		};

		/** Coerce config values from the profile patch into safe bounds. */
		function normalizeOptions(config) {
			const source = config !== null && typeof config === "object" ? config : {};
			const options = { ...DEFAULTS };
			for (const key of Object.keys(DEFAULTS)) {
				if (source[key] !== undefined) options[key] = source[key];
			}
			options.enabled = options.enabled !== false;
			options.debug = options.debug === true;
			options.restoreDelayMs = clamp(Number(options.restoreDelayMs), 0, 5000);
			options.maxRestoreMs = clamp(Number(options.maxRestoreMs), 500, 120000);
			options.maxDocs = Math.round(clamp(Number(options.maxDocs), 20, 5000));
			return options;
		}

		/** Clamp one finite number into a closed range. */
		function clamp(value, min, max) {
			if (!Number.isFinite(value)) return min;
			return Math.min(max, Math.max(min, value));
		}

		function delay(ms) {
			return new Promise((resolve) => {
				window.setTimeout(resolve, ms);
			});
		}

		function warn(...values) {
			try {
				console.warn("[dsh-doc-progress]", ...values);
			} catch {}
		}

		/** Normalize a path for use inside a storage key. */
		function normalizePath(value) {
			let text = String(value === undefined || value === null ? "" : value).trim();
			text = text.replace(/\\/g, "/");
			if (text === "") return "";
			if (!text.startsWith("//")) text = text.replace(/\/{2,}/g, "/");
			if (/^[A-Za-z]:\//.test(text)) text = text[0].toLowerCase() + text.slice(1);
			if (text.length > 1) text = text.replace(/\/$/, "");
			return text;
		}

		/** Whether a path is a Host absolute path (drive, POSIX root, or UNC). */
		function isAbsolutePath(value) {
			const text = normalizePath(value);
			return /^[a-z]:\//.test(text) || text.startsWith("/");
		}

		/** Split a `dsh-resource://file/session/<session>/<path>` address. */
		function parseFileAddress(value) {
			if (typeof value !== "string" || !value.startsWith(FILE_ADDRESS_PREFIX)) return null;
			const parts = value.slice(FILE_ADDRESS_PREFIX.length).split("/");
			if (parts.length < 3 || parts[0] !== "session") return null;
			try {
				return {
					sessionId: decodeURIComponent(parts[1]),
					path: parts.slice(2).map((part) => decodeURIComponent(part)).join("/")
				};
			} catch {
				return null;
			}
		}

		/** The preview's absolute display path, once the Host metadata has arrived. */
		function fileKey(root) {
			const label = root.querySelector("[data-textpreview-path]");
			if (label === null) return null;
			const title = label.getAttribute("title");
			if (typeof title !== "string" || !isAbsolutePath(title)) return null;
			return "file:" + normalizePath(title);
		}

		/** The Session address carried by one preview root. */
		function addressOf(root) {
			return parseFileAddress(root.getAttribute("data-textpreview-url"));
		}

		/** Where a save goes: the stable absolute path when known, else the Session-scoped path. */
		function recordKeys(root) {
			const absolute = fileKey(root);
			if (absolute !== null) return [absolute];
			const address = addressOf(root);
			if (address === null) return [];
			const path = normalizePath(address.path);
			const keys = ["session:" + address.sessionId + ":" + path];
			// A path-only alias keeps the position usable across Sessions when the
			// Host metadata (and therefore the absolute path) has not arrived yet.
			if (!isAbsolutePath(path)) keys.push("path:" + path);
			return keys;
		}

		/** Where a restore may look, most portable first. */
		function lookupKeys(root) {
			const keys = [];
			const absolute = fileKey(root);
			if (absolute !== null) keys.push(absolute);
			const address = addressOf(root);
			if (address !== null) {
				const path = normalizePath(address.path);
				if (!isAbsolutePath(path)) keys.push("path:" + path);
				keys.push("session:" + address.sessionId + ":" + path);
			}
			return keys;
		}

		/** Read the persisted map, tolerating corrupt or missing storage. */
		function parseStore(raw) {
			try {
				if (typeof raw !== "string" || raw === "") return null;
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== "object") return null;
				if (parsed.version !== 1 || parsed.docs === null || typeof parsed.docs !== "object") return null;
				return parsed;
			} catch {
				return null;
			}
		}

		/** Remove heading text written by versions before the privacy change. */
		function scrubLegacyAnchors(store) {
			let changed = false;
			for (const record of Object.values(store.docs)) {
				if (record === null || typeof record !== "object") continue;
				const anchor = record.anchor;
				if (anchor === null || typeof anchor !== "object") continue;
				if ("text" in anchor) {
					delete anchor.text;
					changed = true;
				}
				if ("title" in anchor) {
					delete anchor.title;
					changed = true;
				}
			}
			return changed;
		}

		/** Read localStorage once per plugin activation and drop legacy content fields. */
		function readStore() {
			try {
				const store = parseStore(window.localStorage.getItem(STORAGE_KEY)) ?? { version: 1, docs: {} };
				if (scrubLegacyAnchors(store)) {
					try {
						window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
					} catch {}
				}
				return store;
			} catch {
				return { version: 1, docs: {} };
			}
		}

		/** The scrollable range of one preview body. */
		function maxScroll(body) {
			return Math.max(0, body.scrollHeight - body.clientHeight);
		}

		/** A preview root is usable only while it is actually laid out (not a hidden background Session). */
		function isVisible(root) {
			if (!root.isConnected) return false;
			if (root.closest("[hidden]") !== null) return false;
			const rect = root.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		}

		/**
		 * The ordinal of the first block heading at or above the viewport's
		 * reading line, plus its offset. Only the ordinal and offset are
		 * persisted; the heading's text is document content and never leaves
		 * the rendered DOM.
		 */
		function findAnchor(entry) {
			const content = entry.content;
			const body = entry.body;
			if (content === null || body === null) return null;
			const headings = content.querySelectorAll("h1,h2,h3,h4,h5,h6");
			if (headings.length === 0) return null;
			const readingLine = body.getBoundingClientRect().top + TOP_LINE_OFFSET;
			let best = -1;
			for (let index = 0; index < headings.length; index += 1) {
				const rect = headings[index].getBoundingClientRect();
				if (rect.top <= readingLine + 1) best = index;
				else break;
			}
			if (best < 0) return null;
			const heading = headings[best];
			return {
				index: best,
				offset: Math.round(readingLine - heading.getBoundingClientRect().top)
			};
		}

		/** Find the heading at the saved ordinal after a remount. */
		function findAnchorElement(content, anchor) {
			if (content === null || anchor === null || typeof anchor !== "object") return null;
			const headings = content.querySelectorAll("h1,h2,h3,h4,h5,h6");
			if (headings.length === 0) return null;
			const index = Math.round(clamp(Number(anchor.index), 0, headings.length - 1));
			return headings[index] ?? null;
		}

		/** Install the observer. */
		function apply(ctx, config) {
			if (typeof window === "undefined" || typeof document === "undefined") return;
			const options = normalizeOptions(config);
			if (!options.enabled) return;

			let store = readStore();
			const entries = new Map();
			const globalListeners = [];
			let globalObserver = null;
			let intersectionObserver = null;
			let visibilityTimer = 0;
			let persistTimer = 0;
			let started = false;
			let tornDown = false;

			const api = {
				version: VERSION,
				storageKey: STORAGE_KEY,
				options,
				dump() {
					return JSON.parse(JSON.stringify(store));
				},
				stats() {
					return {
						version: VERSION,
						entries: entries.size,
						docs: Object.keys(store.docs).length,
						options
					};
				},
				clear() {
					store = { version: 1, docs: {} };
					persistStore();
					return true;
				},
				forget(fragment) {
					const needle = normalizePath(fragment);
					if (needle === "") return 0;
					let removed = 0;
					for (const key of Object.keys(store.docs)) {
						if (key.includes(needle)) {
							delete store.docs[key];
							removed += 1;
						}
					}
					persistStore();
					return removed;
				},
				saveNow() {
					flushAll();
					return true;
				}
			};

			window.__DSH_DOC_PROGRESS__ = api;

			/** Persist with pruning, and shrink harder if the quota is full. */
			function persistStore(forcePrune) {
				try {
					pruneStore(forcePrune === true);
					window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
				} catch (error) {
					try {
						pruneStore(true);
						window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
					} catch (retryError) {
						if (options.debug) warn("could not persist reading positions", retryError, error);
					}
				}
			}

			/** Drop the least recently read files once the map exceeds its limit. */
			function pruneStore(aggressive) {
				const keys = Object.keys(store.docs);
				const limit = options.maxDocs;
				const target = aggressive ? Math.max(20, Math.floor(limit / 2)) : limit;
				if (keys.length <= target) return;
				keys.sort((left, right) => {
					const a = store.docs[left];
					const b = store.docs[right];
					return (Number(a && a.updatedAt) || 0) - (Number(b && b.updatedAt) || 0);
				});
				for (const key of keys.slice(0, keys.length - target)) delete store.docs[key];
			}

			function schedulePersist() {
				if (persistTimer !== 0) return;
				persistTimer = window.setTimeout(() => {
					persistTimer = 0;
					persistStore(false);
				}, 300);
			}

			function addGlobal(target, type, handler, listenerOptions) {
				target.addEventListener(type, handler, listenerOptions);
				globalListeners.push(() => target.removeEventListener(type, handler, listenerOptions));
			}

			function scanExisting() {
				for (const root of document.querySelectorAll('[data-textpreview-state="text"]')) attachRoot(root);
			}

			function onMutations(records) {
				for (const record of records) {
					if (record.type === "attributes") {
						if (record.target.matches && record.target.matches('[data-textpreview-state="text"]')) attachRoot(record.target);
						continue;
					}
					for (const node of record.addedNodes) {
						if (node.nodeType !== 1) continue;
						if (node.matches && node.matches('[data-textpreview-state="text"]')) attachRoot(node);
						const nested = node.querySelectorAll ? node.querySelectorAll('[data-textpreview-state="text"]') : [];
						for (const root of nested) attachRoot(root);
					}
				}
				cleanupDetached();
			}

			function onIntersect(records) {
				for (const record of records) {
					if (!record.isIntersecting) continue;
					const entry = entries.get(record.target);
					if (entry !== undefined) scheduleSync(entry);
				}
			}

			function attachRoot(root) {
				if (entries.has(root)) return;
				const entry = {
					root,
					body: null,
					content: null,
					observed: null,
					cleanupBody: [],
					syncQueued: false,
					restoreTimer: 0,
					restoreStarted: false,
					restoreDone: false,
					restoreAttempts: 0,
					restoring: false,
					userScrolled: false,
					disposed: false,
					primary: undefined,
					scrollRaf: 0,
					lastTop: -1
				};
				entry.observed = new MutationObserver(() => scheduleSync(entry));
				entry.observed.observe(root, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["data-document-preview", "data-textpreview-url", "title"]
				});
				entries.set(root, entry);
				if (intersectionObserver !== null) intersectionObserver.observe(root);
				scheduleSync(entry);
			}

			function scheduleSync(entry) {
				if (entry.disposed || entry.syncQueued) return;
				entry.syncQueued = true;
				window.setTimeout(() => {
					entry.syncQueued = false;
					sync(entry);
				}, 0);
			}

			function sync(entry) {
				if (entry.disposed) return;
				const root = entry.root;
				if (!root.isConnected) {
					commit(entry);
					disposeEntry(entry);
					return;
				}
				if (!isVisible(root)) return;
				const renderer = root.getAttribute("data-document-preview");
				const content = root.querySelector("[data-document-markdown]");
				if (content === null && renderer !== MARKDOWN_ID) return;
				const body = root.querySelector("[data-textpreview-body]");
				if (body === null) return;
				if (body !== entry.body) {
					unbindBody(entry);
					bindBody(entry, body);
				}
				if (content !== null) entry.content = content;
				const primary = recordKeys(root).join("|");
				if (entry.primary !== undefined && entry.primary !== primary) {
					entry.restoreDone = false;
					entry.restoreStarted = false;
					entry.restoring = false;
					entry.restoreAttempts = 0;
				}
				entry.primary = primary;
				if (!entry.restoreDone && entry.content !== null) scheduleRestore(entry);
			}

			function bindBody(entry, body) {
				entry.body = body;
				entry.lastTop = body.scrollTop;
				const cleanup = [];
				const onScroll = () => handleScroll(entry);
				body.addEventListener("scroll", onScroll, { passive: true });
				cleanup.push(() => body.removeEventListener("scroll", onScroll));
				const onIntent = () => {
					if (entry.restoring) entry.userScrolled = true;
				};
				for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
					body.addEventListener(type, onIntent, { passive: true, capture: true });
					cleanup.push(() => body.removeEventListener(type, onIntent, { capture: true }));
				}
				entry.cleanupBody = cleanup;
			}

			function unbindBody(entry) {
				for (const off of entry.cleanupBody) {
					try {
						off();
					} catch {}
				}
				entry.cleanupBody = [];
				entry.body = null;
				entry.content = null;
			}

			function disposeEntry(entry) {
				if (entry.disposed) return;
				entry.disposed = true;
				if (entry.restoreTimer !== 0) window.clearTimeout(entry.restoreTimer);
				if (entry.scrollRaf !== 0) window.clearTimeout(entry.scrollRaf);
				if (entry.observed !== null) entry.observed.disconnect();
				if (intersectionObserver !== null) intersectionObserver.unobserve(entry.root);
				unbindBody(entry);
				entries.delete(entry.root);
			}

			function cleanupDetached() {
				for (const entry of Array.from(entries.values())) {
					if (entry.root.isConnected) continue;
					commit(entry);
					disposeEntry(entry);
				}
			}

			function handleScroll(entry) {
				if (entry.disposed || entry.restoring) return;
				if (entry.scrollRaf !== 0) return;
				entry.scrollRaf = window.setTimeout(() => {
					entry.scrollRaf = 0;
					commit(entry);
				}, 16);
			}

			function commit(entry) {
				if (entry.disposed) return;
				const body = entry.body;
				if (body === null || !body.isConnected) return;
				const keys = recordKeys(entry.root);
				if (keys.length === 0) return;
				const top = Math.max(0, body.scrollTop);
				const record = {
					top: Math.round(top * 100) / 100,
					ratio: maxScroll(body) > 0 ? Math.round((top / maxScroll(body)) * 10000) / 10000 : 0,
					height: body.scrollHeight,
					viewport: body.clientHeight,
					anchor: findAnchor(entry),
					updatedAt: Date.now()
				};
				for (const key of keys) store.docs[key] = record;
				entry.lastTop = top;
				schedulePersist();
			}

			function lookupRecord(root) {
				for (const key of lookupKeys(root)) {
					const record = store.docs[key];
					if (record !== null && typeof record === "object" && Number.isFinite(Number(record.top))) return record;
				}
				return null;
			}

			function scheduleRestore(entry) {
				if (entry.disposed || entry.restoreDone || entry.restoreStarted || entry.restoreTimer !== 0) return;
				entry.restoreTimer = window.setTimeout(() => {
					entry.restoreTimer = 0;
					restore(entry).catch((error) => {
						entry.restoring = false;
						entry.restoreStarted = false;
						entry.restoreDone = true;
						if (options.debug) warn("restore failed", error);
					});
				}, options.restoreDelayMs);
			}

			/**
			 * Put the saved offset back. When the saved offset is deeper than the
			 * first loaded page, set the body to its bottom repeatedly: the
			 * preview's own scroll handler then loads the next page until the
			 * saved position is reachable.
			 */
			async function restore(entry) {
				if (entry.disposed || entry.restoreDone || entry.restoreStarted) return;
				const body = entry.body;
				if (body === null || !body.isConnected || !isVisible(entry.root)) return;
				const saved = lookupRecord(entry.root);
				if (saved === null) {
					entry.restoreAttempts += 1;
					if (fileKey(entry.root) !== null || entry.restoreAttempts > 5) entry.restoreDone = true;
					return;
				}
				if (!(Number(saved.top) > 2)) {
					entry.restoreDone = true;
					return;
				}
				entry.restoreStarted = true;
				entry.userScrolled = false;
				try {
					await delay(options.restoreDelayMs);
					if (entry.disposed || entry.body !== body || !body.isConnected || !isVisible(entry.root)) return;
					if (body.scrollTop > 4) {
						entry.restoreDone = true;
						return;
					}
					entry.restoring = true;
					const startedAt = Date.now();
					let lastMax = -1;
					let stalls = 0;
					while (!entry.disposed && entry.body === body && !entry.userScrolled && Date.now() - startedAt < options.maxRestoreMs) {
						const max = maxScroll(body);
						if (max + 2 >= Number(saved.top)) break;
						if (entry.root.querySelector("[data-textpreview-failed]") !== null) break;
						const more = entry.root.querySelector("[data-textpreview-more]");
						if (more === null) break;
						if (more.disabled) {
							await delay(120);
							continue;
						}
						if (max === lastMax) {
							stalls += 1;
							if (stalls >= 30) break;
						} else {
							lastMax = max;
							stalls = 0;
						}
						// Ask the preview for the next page directly. Setting scrollTop
						// to the bottom would also work except when the loaded prefix is
						// shorter than the viewport: there is no scroll event then.
						more.click();
						await delay(120);
					}
					if (entry.disposed || entry.body !== body || !body.isConnected || !isVisible(entry.root)) return;
					if (entry.userScrolled) {
						entry.restoreDone = true;
						return;
					}
					const max = maxScroll(body);
					let target = Number(saved.top);
					if (saved.anchor !== null && typeof saved.anchor === "object") {
						const element = findAnchorElement(entry.content, saved.anchor);
						if (element !== null) {
							const offset = Number.isFinite(Number(saved.anchor.offset)) ? Number(saved.anchor.offset) : 0;
							target = body.scrollTop + element.getBoundingClientRect().top - body.getBoundingClientRect().top - (TOP_LINE_OFFSET - offset);
						}
					}
					body.scrollTop = clamp(target, 0, max);
					entry.restoreDone = true;
				} finally {
					entry.restoring = false;
					entry.restoreStarted = false;
					if (entry.restoreDone && !entry.disposed) commit(entry);
				}
			}

			function flushAll() {
				for (const entry of Array.from(entries.values())) {
					if (entry.body !== null && isVisible(entry.root)) commit(entry);
				}
				if (persistTimer !== 0) {
					window.clearTimeout(persistTimer);
					persistTimer = 0;
				}
				persistStore(false);
			}

			function onVisibilityChange() {
				if (document.visibilityState === "hidden") flushAll();
			}

			function onStorage(event) {
				if (event.key !== STORAGE_KEY || typeof event.newValue !== "string") return;
				const next = parseStore(event.newValue);
				if (next !== null) store = next;
			}

			function start() {
				if (started || tornDown) return;
				started = true;
				globalObserver = new MutationObserver(onMutations);
				globalObserver.observe(document.documentElement, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["data-textpreview-state"]
				});
				if (typeof IntersectionObserver === "function") {
					intersectionObserver = new IntersectionObserver(onIntersect, { threshold: 0 });
				}
				// A hidden background Session is revealed by changing an ancestor's
				// `hidden` attribute, which no observer on the preview root sees in
				// every browser. This cheap sweep is the safety net.
				visibilityTimer = window.setInterval(() => {
					if (document.visibilityState === "hidden") return;
					for (const entry of entries.values()) {
						if (!entry.restoreDone && !entry.restoreStarted && isVisible(entry.root)) scheduleSync(entry);
					}
				}, 500);
				addGlobal(window, "pagehide", flushAll);
				addGlobal(window, "beforeunload", flushAll);
				addGlobal(document, "visibilitychange", onVisibilityChange);
				addGlobal(window, "storage", onStorage);
				scanExisting();
			}

			function teardown() {
				if (tornDown) return;
				tornDown = true;
				flushAll();
				if (globalObserver !== null) globalObserver.disconnect();
				if (intersectionObserver !== null) intersectionObserver.disconnect();
				if (visibilityTimer !== 0) window.clearInterval(visibilityTimer);
				globalObserver = null;
				intersectionObserver = null;
				visibilityTimer = 0;
				for (const off of globalListeners) {
					try {
						off();
					} catch {}
				}
				globalListeners.length = 0;
				for (const entry of Array.from(entries.values())) disposeEntry(entry);
				if (window.__DSH_DOC_PROGRESS__ === api) delete window.__DSH_DOC_PROGRESS__;
			}

			if (document.documentElement !== null) start();
			else document.addEventListener("DOMContentLoaded", start, { once: true });

			if (ctx !== null && ctx !== undefined && typeof ctx.effect === "function") {
				ctx.effect(() => () => teardown(), "dsh-doc-progress: reading position");
			}
		}

		exports.apply = apply;
		exports.inject = [];
		return module.exports;
	}
});
