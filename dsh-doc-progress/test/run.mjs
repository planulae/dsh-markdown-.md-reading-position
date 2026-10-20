import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "D:/dsh-doc-progress";
const PORT = 8123;
const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
];

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (chrome === undefined) throw new Error("no Chrome or Edge executable found");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  let file;
  if (url.pathname === "/plugin/client.js") file = join(ROOT, "lib/client.js");
  else if (url.pathname === "/test/test.html") file = join(ROOT, "test/test.html");
  else if (url.pathname === "/test/test.js") file = join(ROOT, "test/test.js");
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

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const args = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--user-data-dir=" + join(ROOT, "test/.chrome-profile"),
  "--virtual-time-budget=30000",
  "--dump-dom",
  `http://127.0.0.1:${PORT}/test/test.html`
];

const child = spawn(chrome, args, { stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const exitCode = await new Promise((resolve) => child.on("exit", resolve));
server.close();

const marker = "TEST_RESULTS_JSON:";
const index = stdout.lastIndexOf(marker);
if (index < 0) {
  console.error("no test result in Chrome output");
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
  console.error("unterminated result JSON");
  process.exit(1);
}
const result = JSON.parse(stdout.slice(start, end));
console.log(JSON.stringify(result, null, 2));
process.exit(result.passed === result.total ? 0 : 1);
