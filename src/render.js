import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BAR = 88;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

const BASE_CSS = `*{margin:0;box-sizing:border-box}
  body{background:#0b0d10;overflow:hidden;color:#f0f3f6;
    font:500 20px/1.2 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}`;

function captionHtml({ file, width, height, commit, index, total }) {
  const pct = total > 1 ? (index / (total - 1)) * 100 : 100;
  return `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}
  body{width:${width}px;height:${height + BAR}px}
  img{display:block;width:${width}px;height:${height}px;object-fit:cover;object-position:top}
  .bar{position:relative;height:${BAR}px;display:flex;align-items:center;gap:20px;padding:0 28px}
  .date{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
  .msg{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#c9d1d9;font-weight:400}
  .n{font-size:17px;font-variant-numeric:tabular-nums;color:#9aa4af;white-space:nowrap}
  .track{position:absolute;left:0;top:0;height:5px;width:100%;background:#1c2128}
  .fill{height:100%;width:${pct}%;background:#58a6ff}
  </style><img src="${dataUrl(file)}">
  <div class="bar"><div class="track"><div class="fill"></div></div>
  <span class="date">${esc(fmtDate(commit.date))}</span>
  <span class="msg">${esc(commit.subject)}</span>
  <span class="n">change ${index + 1} of ${total}</span></div>`;
}

/** Closing card: the first and the latest state side by side. */
function endCardHtml({ first, last, width, height, commitCount, changeCount }) {
  const total = height + BAR;
  const gap = 28;
  // Each pane keeps the screenshot's own shape, so nothing is cropped.
  const paneW = Math.floor(Math.min((width - gap * 3) / 2, ((total - 190) * width) / height));
  const paneH = Math.floor((paneW * height) / width);
  const pane = (f, label) => `<div class="pane"><div class="label"><b>${label}</b><span>${esc(fmtDate(f.commit.date))}</span></div>
    <img src="${dataUrl(f.file)}"></div>`;
  return `<!doctype html><meta charset="utf-8"><style>${BASE_CSS}
  body{width:${width}px;height:${total}px;padding:${gap}px;display:flex;flex-direction:column;justify-content:center;align-items:center}
  h1{font-size:34px;font-weight:700;letter-spacing:-.01em;height:54px;width:${paneW * 2 + gap}px}
  h1 span{color:#9aa4af;font-weight:500}
  .row{display:flex;gap:${gap}px;margin-top:14px}
  .pane{width:${paneW}px}
  .label{display:flex;justify-content:space-between;align-items:baseline;height:40px;font-size:19px}
  .label b{font-weight:700}.label span{color:#9aa4af;font-variant-numeric:tabular-nums}
  img{display:block;width:${paneW}px;height:${paneH}px;
    border-radius:10px;outline:1px solid #2a313a;background:#fff}
  </style><h1>${commitCount} commits <span>· ${changeCount} visible changes</span></h1>
  <div class="row">${pane(first, 'First')}${pane(last, 'Latest')}</div>`;
}

/**
 * How much of the picture differs between two screenshots, from 0 to 1.
 * Compared at low resolution so tiny rendering noise is ignored.
 */
export async function changedFraction(page, fileA, fileB) {
  return page.evaluate(
    async ([a, b]) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = 320;
      const h = Math.max(1, Math.round((ia.height / ia.width) * w));
      const px = (img) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const da = px(ia);
      const db = px(ib);
      let changed = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 40) changed++;
      }
      return changed / (w * h);
    },
    [dataUrl(fileA), dataUrl(fileB)],
  );
}

/** Add the caption bar under each screenshot and, optionally, the closing card. */
export async function composeFrames(browser, frames, { width, height, outDir, scale, endCard, commitCount }) {
  const context = await browser.newContext({ viewport: { width, height: height + BAR }, deviceScaleFactor: scale });
  const page = await context.newPage();
  const files = [];
  const write = async (html) => {
    await page.setContent(html, { waitUntil: 'load' });
    const file = path.join(outDir, `frame_${String(files.length + 1).padStart(4, '0')}.png`);
    await page.screenshot({ path: file });
    files.push(file);
  };
  for (let i = 0; i < frames.length; i++) {
    await write(captionHtml({ file: frames[i].file, width, height, commit: frames[i].commit, index: i, total: frames.length }));
  }
  const hasEndCard = endCard && frames.length > 1;
  if (hasEndCard) {
    await write(endCardHtml({ first: frames[0], last: frames[frames.length - 1], width, height, commitCount, changeCount: frames.length }));
  }
  await context.close();
  return { files, hasEndCard };
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 64 * 1024 * 1024 }, (err, _o, stderr) => {
      if (err) reject(new Error(err.code === 'ENOENT' ? 'ffmpeg not found. Install it (macOS: brew install ffmpeg).' : `ffmpeg failed: ${stderr || err.message}`));
      else resolve();
    });
  });
}

/** Seconds each file stays on screen: commits, then a pause on the latest, then the closing card. */
function durations(count, { hold, endHold, hasEndCard }) {
  return Array.from({ length: count }, (_, i) => {
    if (i === count - 1) return endHold;
    if (hasEndCard && i === count - 2) return Math.max(hold, 1.5);
    return hold;
  });
}

function concatList(files, timing, listFile) {
  const q = (f) => `file '${f.replace(/'/g, "'\\''")}'`;
  const secs = durations(files.length, timing);
  const lines = [];
  files.forEach((f, i) => lines.push(q(f), `duration ${secs[i]}`));
  lines.push(q(files[files.length - 1])); // the concat demuxer needs the last file twice
  fs.writeFileSync(listFile, lines.join('\n'));
  return { list: listFile, seconds: String(secs.reduce((a, b) => a + b, 0)) };
}

/**
 * Each frame is held, then cross-fades into the next: the stream is first
 * stepped at 5 fps, then blended up to 30 fps so only real changes dissolve.
 */
export async function renderVideo(files, { out, tmpDir, ...timing }) {
  const { list, seconds } = concatList(files, timing, path.join(tmpDir, 'frames.txt'));
  await ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', list, '-t', seconds,
    '-vf', 'fps=5,framerate=fps=30:interp_start=0:interp_end=255:scene=100,scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-movflags', '+faststart',
    out,
  ]);
}

/** GIFs get hard cuts (no fades) and a palette built from the whole film, which keeps text crisp. */
export async function renderGif(files, { out, tmpDir, gifWidth, ...timing }) {
  const { list, seconds } = concatList(files, timing, path.join(tmpDir, 'frames-gif.txt'));
  await ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', list, '-t', seconds,
    '-vf', `fps=10,scale=${gifWidth}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
    out,
  ]);
}
