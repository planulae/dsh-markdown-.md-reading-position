import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, independent of where the checkout lives. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge"
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (chrome === undefined) {
  console.error("No Chrome or Edge executable found. Set CHROME_PATH to one.");
  process.exit(1);
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const routes = new Map([
  ["/plugin/client.js", join(ROOT, "lib/client.js")],
  ["/test/test.html", join(ROOT, "test/test.html")],
  ["/test/test.js", join(ROOT, "test/test.js")]
]);

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const file = routes.get(pathname);
  if (file === undefined) {
    response.writeHead(404).end("not found");
    return;
  }
  try {
    const body = await readFile(file);
    const extension = file.slice(file.lastIndexOf("."));
    response.writeHead(200, { "content-type": contentTypes[extension] ?? "application/octet-stream" });
    response.end(body);
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
const port = typeof address === "object" && address !== null ? address.port : 0;
const profileDir = await mkdtemp(join(tmpdir(), "dsh-doc-progress-"));

const args = [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  `--user-data-dir=${profileDir}`,
  "--virtual-time-budget=30000",
  "--dump-dom",
  `http://127.0.0.1:${port}/test/test.html`
];

let child;
try {
  child = spawn(chrome, args, { stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  console.error("Could not start the browser:", error);
  server.close();
  await rm(profileDir, { recursive: true, force: true });
  process.exit(1);
}

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const timeout = setTimeout(() => child.kill(), 120000);
const exitCode = await new Promise((resolveExit) => {
  child.on("error", (error) => {
    stderr += String(error);
    resolveExit(1);
  });
  child.on("exit", (code) => resolveExit(code ?? 1));
});
clearTimeout(timeout);
server.close();
await rm(profileDir, { recursive: true, force: true });

const marker = "TEST_RESULTS_JSON:";
const index = stdout.lastIndexOf(marker);
if (index < 0) {
  console.error("No test result in browser output.");
  console.error("exit code:", exitCode);
  console.error("stderr:", stderr.slice(-4000));
  console.error("stdout tail:", stdout.slice(-4000));
  process.exit(1);
}

const start = index + marker.length;
let depth = 0;
let end = -1;
for (let cursor = start; cursor < stdout.length; cursor += 1) {
  const character = stdout[cursor];
  if (character === "{") depth += 1;
  else if (character === "}") {
    depth -= 1;
    if (depth === 0) {
      end = cursor + 1;
      break;
    }
  }
}
if (end < 0) {
  console.error("Unterminated test result JSON.");
  process.exit(1);
}

const result = JSON.parse(stdout.slice(start, end));
console.log(JSON.stringify(result, null, 2));
process.exit(result.passed === result.total ? 0 : 1);
