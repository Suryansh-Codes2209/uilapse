import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addWorktree, checkout, listCommits, removeWorktree, repoRoot, sample } from './git.js';
import { addCaptions, renderGif, renderVideo } from './render.js';
import { depsFingerprint, detect, runCommand, serveStatic, sleep, startServer } from './serve.js';

async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright is not installed. Run: npm install playwright');
  }
  try {
    return await chromium.launch();
  } catch (err) {
    if (/Executable doesn't exist|playwright install/i.test(String(err))) {
      throw new Error('Chromium for Playwright is missing. Run: npx playwright install chromium');
    }
    throw err;
  }
}

async function shoot(context, url, { wait, fullPage, file }) {
  const page = await context.newPage();
  try {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
    } catch {
      // Pages that never go quiet (polling, streaming) still get captured.
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    }
    // Hide framework dev badges and overlays so they don't appear in the film.
    await page
      .addStyleTag({ content: 'nextjs-portal,[data-nextjs-toast],vite-error-overlay,astro-dev-toolbar,#__next-build-watcher{display:none!important}' })
      .catch(() => {});
    if (wait) await sleep(wait);
    await page.screenshot({ path: file, fullPage, animations: 'disabled' });
  } finally {
    await page.close();
  }
}

export async function run(opts, log = console.error) {
  const root = repoRoot(path.resolve(opts.repo));
  const all = listCommits(root, { since: opts.since, until: opts.until, paths: opts.only });
  if (!all.length) throw new Error('No commits found for that range.');
  const commits = sample(all, opts.frames);
  log(`${all.length} commits in range, capturing ${commits.length}.`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uilapse-'));
  const worktree = path.join(tmp, 'worktree');
  const rawDir = path.join(tmp, 'raw');
  const outFrames = opts.keepFrames ? path.resolve(opts.keepFrames) : path.join(tmp, 'frames');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(outFrames, { recursive: true });

  let browser;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    removeWorktree(root, worktree);
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  const onSignal = () => {
    cleanup();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    browser = await launchBrowser();
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: opts.scale,
      isMobile: opts.mobile,
      hasTouch: opts.mobile,
      colorScheme: opts.dark ? 'dark' : 'light',
      reducedMotion: 'reduce',
    });

    addWorktree(root, worktree, commits[0].sha);

    const frames = [];
    const skipped = [];
    let lastHash = null;
    let lastDeps = null;

    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      const label = `[${i + 1}/${commits.length}] ${commit.sha.slice(0, 7)} ${commit.subject.slice(0, 60)}`;
      let server = null;
      try {
        checkout(worktree, commit.sha);
        for (const rel of opts.copy) {
          const src = path.join(root, rel);
          if (fs.existsSync(src)) fs.cpSync(src, path.join(worktree, rel), { recursive: true });
        }

        const appDir = path.join(worktree, opts.cwd || '.');
        if (!fs.existsSync(appDir)) throw new Error(`${opts.cwd} does not exist at this commit`);
        const plan = detect(appDir, opts);
        if (!plan) throw new Error('nothing to show yet (no index.html, dev or start script)');

        if (plan.install) {
          const deps = depsFingerprint(appDir);
          if (deps !== lastDeps || !fs.existsSync(path.join(appDir, 'node_modules'))) {
            log(`${label}\n    installing dependencies…`);
            await runCommand(plan.install, appDir);
            lastDeps = deps;
          }
        }

        if (plan.mode === 'static') {
          if (plan.build) await runCommand(plan.build, appDir);
          server = await serveStatic(plan.staticDir);
        } else {
          server = await startServer(plan.cmd, appDir, { timeoutMs: opts.timeout * 1000 });
        }

        const file = path.join(rawDir, `${String(i).padStart(4, '0')}.png`);
        await shoot(context, server.url + opts.path, { wait: opts.wait, fullPage: false, file });

        const hash = createHash('sha1').update(fs.readFileSync(file)).digest('hex');
        if (hash === lastHash && !opts.keepDuplicates) {
          log(`${label}  (no visible change)`);
          fs.rmSync(file);
        } else {
          lastHash = hash;
          frames.push({ file, commit });
          log(`${label}  ✓`);
        }
      } catch (err) {
        skipped.push({ commit, reason: String(err.message || err).split('\n')[0] });
        log(`${label}  skipped: ${String(err.message || err).split('\n')[0]}`);
        if (opts.verbose) log(String(err.message || err));
      } finally {
        if (server) await server.stop();
      }
    }

    await context.close();
    if (!frames.length) {
      throw new Error('No frames were captured. Run with --verbose to see why each commit was skipped.');
    }

    log(`Rendering ${frames.length} frames…`);
    const files = await addCaptions(browser, frames, {
      width: opts.width,
      height: opts.height,
      outDir: outFrames,
      scale: opts.scale,
    });

    const out = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await renderVideo(files, { out, hold: opts.hold, endHold: opts.endHold, tmpDir: tmp });
    const outputs = [out];
    if (opts.gif) {
      const gif = out.replace(/\.[^.]+$/, '') + '.gif';
      await renderGif(files, { out: gif, hold: opts.hold, endHold: opts.endHold, tmpDir: tmp, gifWidth: Math.min(opts.width, 720) });
      outputs.push(gif);
    }
    return { outputs, frames: frames.length, skipped, total: commits.length };
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (browser) await browser.close().catch(() => {});
    cleanup();
  }
}
