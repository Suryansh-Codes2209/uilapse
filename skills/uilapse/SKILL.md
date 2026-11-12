---
name: uilapse
description: Use when the user wants a time-lapse, video, GIF or before-and-after of how a web app's or website's interface changed over its git history, or asks to film, replay or visualise a repo's UI evolution commit by commit.
---

# uilapse

`uilapse` runs a web project as it was at each commit, screenshots it, and joins the screenshots into an MP4 with the date and commit message under each frame. Work happens in a temporary git worktree; the user's working tree is not touched.

## Before running

- **It executes the repo's code** at every sampled commit: install scripts and dev servers. On the user's own repo, go ahead. On anyone else's repo, tell the user this and get a yes before cloning or filming. A site that is plain HTML can be filmed with `--dir .`, which serves files without running install or build scripts.
- `<repo>` is a local path to a full clone (not a URL, not a shallow clone).
- Needs `ffmpeg` and Playwright's Chromium. If one is missing, the error names the fix.
- Each commit means starting the app, so runs take minutes. Run in the background; progress prints one line per commit.

## Run

```bash
npx uilapse <repo> -o <out>.mp4 --gif --keep-frames <frames-dir>
```

`--gif` also writes `<out>.gif`. `--keep-frames` saves the captioned frames as PNGs so the result can be checked. Put all output outside the repo being filmed so it does not show up as untracked files. `npx uilapse --help` lists every option.

## Pick options from the project

| Situation | Add |
| --- | --- |
| App lives in a subfolder | `--cwd apps/web` (relative to the repo root) |
| App needs an untracked env file | `--copy apps/web/.env.local` (relative to the repo root, repeatable) |
| Site must be built, then served | `--build "npm run build" --dir dist` (both relative to `--cwd`) |
| Dev command is not `dev` or `start` | `--cmd "<command>"` |
| A page other than the home page | `--path /pricing` |
| Limit the period | `--since "2026-01-01"` or `--since "6 months ago"` (any date git accepts), `--until` |
| Long history | `-n 150`; by default 60 commits are sampled evenly across the range |
| Page has random or rotating content | `--min-change 5` so noise is not counted as a change |
| Phone layout or dark theme | `--mobile`, `--dark` |
| Sharper video | `--scale 2` |

## Read the result

The last line reads `F frames from T commits, S skipped`. `T` commits were tried, `S` failed to install, start or serve the page, and the rest that are not frames ran fine but looked the same as the frame before. Report all three numbers.

- **Many skipped:** rerun with `--verbose` to see each reason. Old commits that no longer install are normal; narrow the range with `--since`. A 404 means the page did not exist yet. If every commit fails, the app needs something that is not in git: use `--copy`, or `--build` with `--dir`.
- **Few frames, few skipped:** most commits changed nothing in the first screenful, which is all that is captured; there is no full-page option. Film a different `--path` where the changes happened, or tell the user the history has few visible changes.

Open one of the kept frames and confirm it shows the real page, not an error screen, before telling the user the video is good.
