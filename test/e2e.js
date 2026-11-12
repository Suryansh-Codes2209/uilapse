// End-to-end check: builds a throwaway repo whose history goes from a single
// HTML file to an app with its own dev server, then films it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uilapse-test-'));
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo);

const git = (...args) =>
  execFileSync('git', args, {
    cwd: repo,
    stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' },
  });
const write = (file, body) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), body);
};
const commit = (msg) => {
  git('add', '-A');
  git('commit', '-m', msg);
};
const page = (body, css = '') =>
  `<!doctype html><meta charset="utf-8"><title>Demo</title><style>body{font-family:system-ui;margin:0}${css}</style>${body}`;

git('init', '-q', '-b', 'main');

write('README.md', '# demo\n');
commit('Start the project'); // nothing to show: should be skipped

write('index.html', page('<h1>Hello</h1>'));
commit('Add a heading');

write('index.html', page('<h1>Hello</h1><p>A small demo site.</p>', 'h1{color:#2563eb;padding:40px}p{padding:0 40px}'));
commit('Add intro text and colour');

write('NOTES.md', 'nothing visible\n');
commit('Add notes (no visible change)');

write(
  'index.html',
  page(
    '<header>Demo</header><main><h1>Hello</h1><p>A small demo site.</p><button>Get started</button></main>',
    'header{background:#111;color:#fff;padding:16px 40px}main{padding:40px}h1{color:#2563eb}button{background:#2563eb;color:#fff;border:0;padding:12px 20px;border-radius:8px}',
  ),
);
commit('Add header and button');

// The project grows a dev server that prints its address, like real ones do.
fs.rmSync(path.join(repo, 'index.html'));
write('package.json', JSON.stringify({ name: 'demo', private: true, scripts: { dev: 'node server.js' } }, null, 2));
write(
  'server.js',
  `const http = require('http');
const port = Number(process.env.PORT) + 1; // deliberately not the port we were given
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(${JSON.stringify(page('<header>Demo</header><main><h1>Dashboard</h1><div class="grid"><div>Users 12</div><div>Sales 40</div><div>Visits 310</div></div></main>', 'header{background:#111;color:#fff;padding:16px 40px}main{padding:40px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.grid div{background:#eef2ff;padding:32px;border-radius:12px}'))});
}).listen(port, () => console.log('  ready - Local: http://localhost:' + port + '/'));
`,
);
commit('Move to a dev server with a dashboard');

write('server.js', 'process.exit(1);\n');
commit('Break the build'); // should be skipped, not fatal

git('revert', '--no-edit', 'HEAD');

const out = path.join(tmp, 'out.mp4');
const framesDir = path.join(tmp, 'frames');
const stdout = execFileSync(
  process.execPath,
  [path.join(here, '..', 'bin', 'uilapse.js'), repo, '-o', out, '--gif', '--keep-frames', framesDir, '--wait', '100', '--timeout', '20'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);

assert.ok(stdout.includes(out), 'prints the video path');
assert.ok(fs.statSync(out).size > 5000, 'video was written');
assert.ok(fs.statSync(out.replace('.mp4', '.gif')).size > 5000, 'gif was written');

// 8 commits: 1 has nothing to show, 1 is broken, 1 changes nothing visible,
// and the revert looks the same as the commit before the break.
const frames = fs.readdirSync(framesDir).filter((f) => f.endsWith('.png'));
assert.equal(frames.length, 4, `expected 4 frames, got ${frames.length}`);

const probe = execFileSync(
  'ffprobe',
  ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name:format=duration', '-of', 'json', out],
  { encoding: 'utf8' },
);
const info = JSON.parse(probe);
assert.equal(info.streams[0].codec_name, 'h264');
assert.equal(info.streams[0].width, 1280);
assert.equal(info.streams[0].height, 864);
assert.ok(Math.abs(Number(info.format.duration) - 4.3) < 0.3, `duration ${info.format.duration}`);

// The user's repo must be left exactly as it was.
assert.equal(execFileSync('git', ['worktree', 'list'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').length, 1);
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim(), '');

console.log(`ok — ${frames.length} frames, ${Number(info.format.duration).toFixed(1)}s, ${info.streams[0].width}x${info.streams[0].height}`);
console.log(`kept for inspection: ${tmp}`);
