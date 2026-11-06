#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { riskyReasons, DEFAULT_PROTECTED } = require('../src/risk');

const ROOT = path.resolve(__dirname, '..');
const HOOK_MARKER = '# installed by breathe-before-you-push';
const FORWARDED_ENV = ['BREATHE_REASON', 'BREATHE_SIMULATE', 'BREATHE_DEBUG', 'BREATHE_DEBUG_PORT', 'SMARTSPECTRA_API_KEY'];

function git(args, options = {}) {
  return spawnSync('git', args, { encoding: 'utf8', ...options });
}

function hookPath() {
  const result = git(['rev-parse', '--git-path', 'hooks/pre-push']);
  if (result.status !== 0) throw new Error('Not inside a git repository.');
  return path.resolve(result.stdout.trim());
}

function openGate(reason) {
  if (!fs.existsSync(path.join(ROOT, 'app/dist/renderer.bundle.js'))) {
    console.error(`breathe: app is not built. Run "npm run build" in ${ROOT}.`);
    return 1;
  }
  const env = { ...process.env, BREATHE_REASON: reason };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.platform === 'darwin') return openGateOnMac(env);
  const result = spawnSync(require('electron'), [ROOT], { env, stdio: 'inherit' });
  return result.status ?? 1;
}

// macOS asks the app that launched a process for camera access. Started from an
// editor or terminal without that permission, the camera is refused with no prompt.
// Launching through `open` makes the app ask for itself, but its exit code is lost,
// so the outcome comes back through a temporary file. No file means cancelled.
function openGateOnMac(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'breathe-'));
  const resultFile = path.join(dir, 'result');
  const appBundle = path.resolve(require('electron'), '../../..');
  const passed = { ...pick(env, FORWARDED_ENV), BREATHE_RESULT_FILE: resultFile };
  const args = ['-W', '-n', appBundle];
  for (const [key, value] of Object.entries(passed)) args.push('--env', `${key}=${value}`);
  if (env.BREATHE_DEBUG_LOG) args.push('--stderr', env.BREATHE_DEBUG_LOG);
  args.push('--args', ROOT);
  try {
    const launched = spawnSync('open', args, { stdio: 'inherit' });
    if (launched.status !== 0) return 1;
    return fs.readFileSync(resultFile, 'utf8').trim() === 'allow' ? 0 : 1;
  } catch {
    return 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function pick(source, keys) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function install() {
  const target = hookPath();
  if (fs.existsSync(target) && !fs.readFileSync(target, 'utf8').includes(HOOK_MARKER)) {
    console.error(`breathe: ${target} already exists and is not ours, so it was left alone.`);
    return 1;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const script = `#!/bin/sh\n${HOOK_MARKER}\nexec node ${JSON.stringify(path.join(ROOT, 'bin/breathe.js'))} hook\n`;
  fs.writeFileSync(target, script, { mode: 0o755 });
  console.log(`breathe: pre-push hook installed at ${target}`);
  return 0;
}

function uninstall() {
  const target = hookPath();
  if (!fs.existsSync(target) || !fs.readFileSync(target, 'utf8').includes(HOOK_MARKER)) {
    console.log('breathe: no hook of ours to remove.');
    return 0;
  }
  fs.unlinkSync(target);
  console.log(`breathe: removed ${target}`);
  return 0;
}

function hook() {
  const protectedBranches = process.env.BREATHE_PROTECTED
    ? process.env.BREATHE_PROTECTED.split(',').map((name) => name.trim()).filter(Boolean)
    : DEFAULT_PROTECTED;
  const isAncestor = (a, b) => git(['merge-base', '--is-ancestor', a, b]).status === 0;
  const reasons = riskyReasons(fs.readFileSync(0, 'utf8'), { isAncestor, protectedBranches });
  if (reasons.length === 0) return 0;

  console.error(`breathe: ${reasons.join(', ')}. Waiting for three slow breaths...`);
  const code = openGate(reasons[0]);
  if (code !== 0) console.error('breathe: push cancelled.');
  return code;
}

function run(command) {
  if (command.length === 0) {
    console.error('Usage: breathe run -- <command> [args...]');
    return 2;
  }
  const code = openGate(`run ${command.join(' ')}`);
  if (code !== 0) {
    console.error('breathe: cancelled, command not run.');
    return code;
  }
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
  if (result.error) {
    console.error(`breathe: ${result.error.message}`);
    return 127;
  }
  return result.status ?? 1;
}

function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case 'install': return install();
    case 'uninstall': return uninstall();
    case 'hook': return hook();
    case 'gate': return openGate(rest.join(' ') || 'take a moment');
    case 'run': return run(rest[0] === '--' ? rest.slice(1) : rest);
    default:
      console.log('Usage: breathe <install|uninstall|gate [reason]|run -- <command>>');
      return command ? 2 : 0;
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`breathe: ${error.message}`);
  process.exitCode = 1;
}
