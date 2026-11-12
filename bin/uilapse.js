#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { run } from '../src/index.js';

const HELP = `uilapse — a time-lapse video of your interface, commit by commit

Usage
  uilapse [repo] [options]

Output
  -o, --out <file>        Video file to write (default: uilapse.mp4)
      --gif               Also write a GIF next to the video
      --keep-frames <dir> Save the captioned frames as PNGs

Which commits
  -n, --frames <n>        Most commits to capture, spread evenly (default: 60)
      --since <date>      Only commits after this date (any format git accepts)
      --until <date>      Only commits before this date
      --only <path>       Only commits that touched this path (repeatable)

How to show the app (auto-detected for each commit when omitted)
      --cmd <command>     Command that starts the app, e.g. "npm run dev"
      --install <command> Command that installs dependencies
      --build <command>   Build first, then serve --dir as static files
      --dir <folder>      Folder of static files to serve, e.g. dist
      --cwd <folder>      Folder inside the repo where the app lives
      --copy <file>       Copy an untracked file such as .env.local into each
                          commit (repeatable)
      --path <path>       Page to capture (default: /)
      --timeout <sec>     How long to wait for the app to start (default: 90)
      --wait <ms>         Extra pause before each screenshot (default: 600)

How it looks
      --width <px>        Viewport width (default: 1280)
      --height <px>       Viewport height (default: 800)
      --mobile            Phone viewport (390 x 844, touch)
      --dark              Ask the page for its dark theme
      --scale <n>         Pixel density, 2 for sharper video (default: 1)
      --hold <sec>        Time each commit stays on screen (default: 0.6)
      --end-hold <sec>    Time the final frame stays on screen (default: 2.5)
      --min-change <pct>  Drop commits that changed less than this share of
                          the picture (default: 0.1)
      --keep-duplicates   Keep every commit, even with no visible change
      --no-end-card       Leave out the closing first-versus-now card
      --gif-width <px>    Width of the GIF (default: 960)

  -v, --verbose           Print full errors for skipped commits
  -h, --help              Show this help
`;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o', default: 'uilapse.mp4' },
      gif: { type: 'boolean', default: false },
      'keep-frames': { type: 'string' },
      frames: { type: 'string', short: 'n', default: '60' },
      since: { type: 'string' },
      until: { type: 'string' },
      only: { type: 'string', multiple: true, default: [] },
      cmd: { type: 'string' },
      install: { type: 'string' },
      build: { type: 'string' },
      dir: { type: 'string' },
      cwd: { type: 'string' },
      copy: { type: 'string', multiple: true, default: [] },
      path: { type: 'string', default: '/' },
      timeout: { type: 'string', default: '90' },
      wait: { type: 'string', default: '600' },
      width: { type: 'string' },
      height: { type: 'string' },
      mobile: { type: 'boolean', default: false },
      dark: { type: 'boolean', default: false },
      scale: { type: 'string', default: '1' },
      hold: { type: 'string', default: '0.6' },
      'end-hold': { type: 'string', default: '2.5' },
      'keep-duplicates': { type: 'boolean', default: false },
      'min-change': { type: 'string', default: '0.1' },
      'no-end-card': { type: 'boolean', default: false },
      'gif-width': { type: 'string', default: '960' },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
} catch (err) {
  console.error(`${err.message}\n\nRun "uilapse --help" for usage.`);
  process.exit(2);
}

const { values: v, positionals } = parsed;
if (v.help) {
  console.log(HELP);
  process.exit(0);
}

function num(name, { min = 0, integer = false } = {}) {
  const n = Number(v[name]);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
    console.error(`--${name} must be ${integer ? 'a whole number' : 'a number'} of at least ${min}.`);
    process.exit(2);
  }
  return n;
}

const even = (n) => n - (n % 2);
if (v.width === undefined) v.width = v.mobile ? '390' : '1280';
if (v.height === undefined) v.height = v.mobile ? '844' : '800';

const opts = {
  repo: positionals[0] || '.',
  out: v.out,
  gif: v.gif,
  keepFrames: v['keep-frames'],
  frames: num('frames', { min: 1, integer: true }),
  since: v.since,
  until: v.until,
  only: v.only,
  cmd: v.cmd,
  install: v.install,
  build: v.build,
  staticDir: v.dir,
  cwd: v.cwd,
  copy: v.copy,
  path: v.path.startsWith('/') ? v.path : `/${v.path}`,
  timeout: num('timeout', { min: 1 }),
  wait: num('wait'),
  width: even(num('width', { min: 200, integer: true })),
  height: even(num('height', { min: 200, integer: true })),
  mobile: v.mobile,
  dark: v.dark,
  scale: num('scale', { min: 1 }),
  hold: num('hold', { min: 0.2 }),
  endHold: num('end-hold', { min: 0.2 }),
  keepDuplicates: v['keep-duplicates'],
  minChange: num('min-change'),
  endCard: !v['no-end-card'],
  gifWidth: even(num('gif-width', { min: 200, integer: true })),
  verbose: v.verbose,
};

try {
  const result = await run(opts);
  console.error('');
  for (const file of result.outputs) console.log(file);
  console.error(
    `${result.frames} frames from ${result.total} commits` +
      (result.skipped.length ? `, ${result.skipped.length} skipped (use --verbose for details)` : ''),
  );
} catch (err) {
  console.error(`\nuilapse: ${err.message}`);
  process.exit(1);
}
