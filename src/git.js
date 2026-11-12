import { execFileSync } from 'node:child_process';

export function git(cwd, args, opts = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  }).trim();
}

export function repoRoot(dir) {
  try {
    return git(dir, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new Error(`${dir} is not inside a git repository`);
  }
}

/** Commits oldest first, following the main line of history only. */
export function listCommits(root, { since, until, paths = [] } = {}) {
  const args = ['log', '--first-parent', '--reverse', '--format=%H%x1f%cI%x1f%s'];
  if (since) args.push(`--since=${since}`);
  if (until) args.push(`--until=${until}`);
  if (paths.length) args.push('--', ...paths);
  const out = git(root, args);
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [sha, date, subject] = line.split('\x1f');
    return { sha, date, subject };
  });
}

/** Pick at most `max` commits spread evenly, always keeping the first and last. */
export function sample(commits, max) {
  if (commits.length <= max) return commits;
  if (max <= 1) return [commits[commits.length - 1]];
  const picked = [];
  for (let i = 0; i < max; i++) {
    picked.push(commits[Math.round((i * (commits.length - 1)) / (max - 1))]);
  }
  return [...new Set(picked)];
}

export function addWorktree(root, dir, sha) {
  git(root, ['worktree', 'add', '--detach', '--force', dir, sha]);
}

export function checkout(worktree, sha) {
  git(worktree, ['checkout', '--detach', '--force', sha]);
  // Remove files left over from the previous commit. Ignored files
  // (node_modules, build caches) stay, which keeps installs fast.
  git(worktree, ['clean', '-fd']);
}

export function removeWorktree(root, dir) {
  try {
    git(root, ['worktree', 'remove', '--force', dir]);
  } catch {
    /* already gone */
  }
  try {
    git(root, ['worktree', 'prune']);
  } catch {
    /* ignore */
  }
}
