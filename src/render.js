import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BAR = 64;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function captionHtml({ image, width, height, commit, index, total }) {
  const date = new Date(commit.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const pct = total > 1 ? (index / (total - 1)) * 100 : 100;
  return `<!doctype html><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box}
  body{width:${width}px;height:${height + BAR}px;background:#0b0d10;overflow:hidden;
    font:500 17px/1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e8eaed}
  img{display:block;width:${width}px;height:${height}px;object-fit:cover;object-position:top}
  .bar{position:relative;height:${BAR}px;display:flex;align-items:center;gap:14px;padding:0 22px}
  .date{font-variant-numeric:tabular-nums;white-space:nowrap}
  .sha{font:500 14px ui-monospace,SFMono-Regular,Menlo,monospace;color:#8b949e}
  .msg{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#b6bcc4;font-weight:400}
  .n{font-variant-numeric:tabular-nums;color:#8b949e;white-space:nowrap}
  .track{position:absolute;left:0;top:0;height:3px;width:100%;background:#1c2128}
  .fill{height:100%;width:${pct}%;background:#58a6ff}
  </style><img src="data:image/png;base64,${image.toString('base64')}">
  <div class="bar"><div class="track"><div class="fill"></div></div>
  <span class="date">${esc(date)}</span><span class="sha">${esc(commit.sha.slice(0, 7))}</span>
  <span class="msg">${esc(commit.subject)}</span><span class="n">${index + 1} / ${total}</span></div>`;
}

/** Add a caption bar (date, commit, message, progress) under each screenshot. */
export async function addCaptions(browser, frames, { width, height, outDir, scale }) {
  const context = await browser.newContext({
    viewport: { width, height: height + BAR },
    deviceScaleFactor: scale,
  });
  const page = await context.newPage();
  const files = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    await page.setContent(
      captionHtml({ image: fs.readFileSync(f.file), width, height, commit: f.commit, index: i, total: frames.length }),
      { waitUntil: 'load' },
    );
    const file = path.join(outDir, `frame_${String(i + 1).padStart(4, '0')}.png`);
    await page.screenshot({ path: file });
    files.push(file);
  }
  await context.close();
  return files;
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 64 * 1024 * 1024 }, (err, _o, stderr) => {
      if (err) reject(new Error(err.code === 'ENOENT' ? 'ffmpeg not found. Install it (macOS: brew install ffmpeg).' : `ffmpeg failed: ${stderr || err.message}`));
      else resolve();
    });
  });
}

function concatList(files, { hold, endHold, listFile }) {
  const q = (f) => `file '${f.replace(/'/g, "'\\''")}'`;
  const lines = [];
  files.forEach((f, i) => {
    lines.push(q(f), `duration ${i === files.length - 1 ? endHold : hold}`);
  });
  lines.push(q(files[files.length - 1])); // the concat demuxer needs the last file twice
  fs.writeFileSync(listFile, lines.join('\n'));
  return { list: listFile, seconds: String(hold * (files.length - 1) + endHold) };
}

/**
 * Each frame is held, then cross-fades into the next: the stream is first
 * stepped at 5 fps, then blended up to 30 fps so only real changes dissolve.
 */
export async function renderVideo(files, { out, hold, endHold, tmpDir }) {
  const { list, seconds } = concatList(files, { hold, endHold, listFile: path.join(tmpDir, 'frames.txt') });
  await ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', list, '-t', seconds,
    '-vf', 'fps=5,framerate=fps=30:interp_start=0:interp_end=255:scene=100,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart',
    out,
  ]);
}

export async function renderGif(files, { out, hold, endHold, tmpDir, gifWidth }) {
  const { list, seconds } = concatList(files, { hold, endHold, listFile: path.join(tmpDir, 'frames-gif.txt') });
  await ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', list, '-t', seconds,
    '-vf', `fps=8,scale=${gifWidth}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
    out,
  ]);
}
