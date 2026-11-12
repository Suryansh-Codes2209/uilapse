import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.wasm': 'application/wasm',
};

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Minimal static file server. Returns { url, stop }. */
export async function serveStatic(rootDir) {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = path.join(root, rel);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      else if (!fs.existsSync(file) && fs.existsSync(`${file}.html`)) file = `${file}.html`;
      const body = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    }
  });
  const port = await freePort();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function packageManager(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return { run: 'pnpm run', install: 'pnpm install --frozen-lockfile' };
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return { run: 'yarn run', install: 'yarn install --frozen-lockfile' };
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock')))
    return { run: 'bun run', install: 'bun install' };
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) return { run: 'npm run', install: 'npm ci' };
  return { run: 'npm run', install: 'npm install' };
}

/**
 * Work out how to show this commit. The answer can change through history:
 * a project may begin as one HTML file and later grow a dev server.
 */
export function detect(dir, opts) {
  const pkg = readJson(path.join(dir, 'package.json'));
  const pm = packageManager(dir);
  const hasDeps =
    pkg && (Object.keys(pkg.dependencies || {}).length > 0 || Object.keys(pkg.devDependencies || {}).length > 0);
  const install = opts.install ?? (hasDeps ? pm.install : null);

  if (opts.cmd) return { mode: 'server', cmd: opts.cmd, install };

  if (opts.staticDir || opts.build) {
    const staticDir = path.join(dir, opts.staticDir || '.');
    return { mode: 'static', staticDir, build: opts.build || null, install: opts.build ? install : null };
  }

  const script = pkg?.scripts?.dev ? 'dev' : pkg?.scripts?.start ? 'start' : null;
  if (script) return { mode: 'server', cmd: `${pm.run} ${script}`, install };

  for (const candidate of ['.', 'public', 'docs', 'dist', 'build']) {
    if (fs.existsSync(path.join(dir, candidate, 'index.html'))) {
      return { mode: 'static', staticDir: path.join(dir, candidate), build: null, install: null };
    }
  }
  return null;
}

/** Hash of the files that decide what gets installed. */
export function depsFingerprint(dir) {
  const hash = createHash('sha1');
  for (const f of ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock']) {
    const file = path.join(dir, f);
    if (fs.existsSync(file)) hash.update(f).update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

/** Run a shell command to completion. Rejects with the tail of its output on failure. */
export function runCommand(cmd, cwd, { timeoutMs = 600_000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { cwd, shell: true, detached: true, env: { ...process.env, ...env } });
    let log = '';
    const add = (d) => {
      log = (log + d).slice(-4000);
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error(`"${cmd}" timed out`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`"${cmd}" exited with code ${code}\n${log.trim().split('\n').slice(-6).join('\n')}`));
    });
  });
}

function killTree(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already dead */
    }
  }
}

async function responds(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
    return true;
  } catch {
    return false;
  }
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d+)/;

/**
 * Start a dev server and wait until it answers. The port is taken from the
 * address the server prints (Vite, Next, Astro and others all print one);
 * if it prints nothing we fall back to the PORT we asked for.
 */
export async function startServer(cmd, cwd, { timeoutMs = 90_000 } = {}) {
  const port = await freePort();
  const child = spawn(cmd, {
    cwd,
    shell: true,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      BROWSER: 'none',
      NEXT_TELEMETRY_DISABLED: '1',
      ASTRO_TELEMETRY_DISABLED: '1',
      FORCE_COLOR: '0',
    },
  });

  let log = '';
  let printedPort = null;
  let exited = false;
  const onData = (d) => {
    const text = String(d).replace(ANSI, '');
    log = (log + text).slice(-4000);
    if (!printedPort) {
      const m = LOCAL_URL.exec(log);
      if (m) printedPort = Number(m[1]);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', () => {
    exited = true;
  });
  child.on('error', () => {
    exited = true;
  });

  const stop = async () => {
    killTree(child, 'SIGTERM');
    const deadline = Date.now() + 3000;
    while (!exited && Date.now() < deadline) await sleep(100);
    if (!exited) killTree(child, 'SIGKILL');
  };

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (exited) {
      throw new Error(`"${cmd}" exited before serving\n${log.trim().split('\n').slice(-6).join('\n')}`);
    }
    const candidates = printedPort ? [printedPort] : Date.now() - started > 4000 ? [port] : [];
    for (const p of candidates) {
      const url = `http://localhost:${p}`;
      if (await responds(url)) return { url, stop };
    }
    await sleep(300);
  }
  await stop();
  throw new Error(`"${cmd}" did not start serving within ${Math.round(timeoutMs / 1000)}s`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
