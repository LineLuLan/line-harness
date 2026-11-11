/* Intent: name the repository a path belongs to, storing only a folder name.
 * Status: v5. repoOf(dir) walks up to the nearest folder that contains `.git` (a folder,
 * or a file for worktrees/submodules) and returns that folder's basename; a monorepo
 * subfolder such as `<repo>/datasets` therefore counts as `<repo>`. repoFromUrl(url)
 * returns the last path segment of a remote URL without `.git` (never the owner).
 * Paths that do not exist (or are not in a repo) fall back to the plain basename.
 * Next: none. Blockers: none. Confidence: tests/repo.test.js. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { basename, name } = require('./values');

const MAX_DEPTH = 32;
const cache = new Map();
function hasGit(dir) {
  try { fs.statSync(path.join(dir, '.git')); return true; } catch { return false; }
}
// Only walk local absolute paths. UNC / network paths (\\host\share, //host) could block for an
// SMB timeout per level (or start a WSL VM), and a relative or drive-less path would resolve
// against the hook's own cwd; those fall back to the plain basename.
function walkable(dir) {
  if (/^[\\/]{2}/.test(dir)) return false;
  if (process.platform === 'win32') return /^[A-Za-z]:[\\/]/.test(dir);
  return path.isAbsolute(dir);
}
// Basename of the git root above `dir`, or null when no `.git` is found.
function gitRoot(dir) {
  if (typeof dir !== 'string' || !dir || !walkable(dir)) return null;
  if (cache.has(dir)) return cache.get(dir);
  let current = path.resolve(dir), found = null;
  for (let i = 0; i < MAX_DEPTH; i++) {
    if (hasGit(current)) { found = basename(current); break; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (cache.size >= 1024) cache.clear(); // bounded: a run touches few distinct folders
  cache.set(dir, found);
  return found;
}
function repoOf(dir) { return gitRoot(dir) ?? basename(dir); }
// Repo name from a remote URL: https://host/owner/repo(.git), git@host:owner/repo.git, ssh://host:22/owner/repo.
// Query/fragment are dropped; a URL without an owner/repo pair, or whose last segment holds
// credentials ("@"), gives null so the caller falls back to the folder name.
function repoFromUrl(url) {
  if (typeof url !== 'string') return null;
  const clean = url.trim().replace(/[?#].*$/, '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').replace(/^[^@/:]+@[^:/]+:/, '');
  const parts = clean.split(/[\\/]/).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts.at(-1).replace(/\.git$/i, '');
  return !last || /[@:]/.test(last) ? null : name(last);
}
module.exports = { repoOf, repoFromUrl, gitRoot };
