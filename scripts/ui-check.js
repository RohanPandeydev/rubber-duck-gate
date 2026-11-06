'use strict';

// Drives the real Electron window over the DevTools protocol with a simulated
// signal, so no camera or SDK credits are used. Run with: node scripts/ui-check.js
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOT_DIR;
let nextPort = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(port) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((target) => target.type === 'page' && target.url.startsWith('file://'));
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        let id = 0;
        const pending = new Map();
        socket.onclose = () => {
          for (const resolve of pending.values()) resolve({});
          pending.clear();
        };
        socket.onmessage = (message) => {
          const data = JSON.parse(message.data);
          if (data.id && pending.has(data.id)) pending.get(data.id)(data.result);
        };
        return (method, params = {}) => new Promise((resolve) => {
          if (socket.readyState !== WebSocket.OPEN) { resolve({}); return; }
          id += 1;
          pending.set(id, resolve);
          socket.send(JSON.stringify({ id, method, params }));
        });
      }
    } catch {
      // Window not up yet.
    }
    await sleep(250);
  }
  throw new Error('window never appeared');
}

async function scenario(name, env, script) {
  const port = 9300 + (nextPort += 1);
  const childEnv = { ...process.env, DUCK_DEBUG_PORT: String(port), DUCK_REASON: 'force-push to main', ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const startedAt = Date.now();
  const child = spawn(require(path.join(ROOT, 'node_modules/electron')), [ROOT], { env: childEnv, stdio: process.env.SHOW_APP_LOG ? 'inherit' : 'ignore' });
  const exited = new Promise((resolve) => child.on('exit', (exitCode, signal) => {
    if (process.env.SHOW_EXIT) console.log(`  [${name}] app exited code=${exitCode} signal=${signal} after ${Date.now() - startedAt}ms`);
    resolve(exitCode);
  }));
  const send = await connect(port);
  const read = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (!response.result) throw new Error(`${name}: window closed during "${expression}"`);
    return response.result.value;
  };
  const click = (id) => send('Runtime.evaluate', { expression: `document.getElementById('${id}').click()` });
  const shot = async (file) => {
    if (!SHOTS) return;
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(data, 'base64'));
  };
  for (let i = 0; i < 40 && !(await read(text('reason'))); i += 1) await sleep(100);
  console.log(`  renderer: window.gate=${await read('typeof window.gate')} bridge=${await read('typeof window.__smartspectraBridge')}`);
  try {
    await script({ read, click, shot });
  } finally {
    const timer = setTimeout(() => child.kill(), 30000);
    var code = await exited;
    clearTimeout(timer);
  }
  console.log(`${name}: exit ${code}`);
  return code;
}

const expect = (label, actual, wanted) => {
  if (actual !== wanted) throw new Error(`${label}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`);
  console.log(`  ok ${label}: ${JSON.stringify(actual)}`);
};
const visible = (id) => `!document.getElementById('${id}').hidden`;
const text = (id) => `document.getElementById('${id}').textContent`;

(async () => {
  let code = await scenario('talking unlocks', { DUCK_SIMULATE: 'talk' }, async ({ read, click, shot }) => {
    expect('consent shown first', await read(visible('consent')), true);
    expect('reason', await read(text('reason')), 'force-push to main');
    expect('simulation is labelled', await read(visible('simulated')), true);
    await shot('1-consent.png');
    await click('start');
    await sleep(3000);
    expect('duck is listening', await read("document.getElementById('duck').getAttribute('class')"), 'duck listening');
    expect('first question', await read(text('bubble')), 'What does this change do?');
    await sleep(4000);
    await shot('2-listening.png');
    for (let i = 0; i < 80 && !(await read(visible('done'))); i += 1) await sleep(250);
    expect('unlocked screen', await read(visible('done')), true);
    await shot('4-unlocked.png');
  });
  expect('exit allows the push', code, 0);

  code = await scenario('stopping talking stays locked', { DUCK_SIMULATE: 'pause' }, async ({ read, click, shot }) => {
    await click('start');
    await sleep(10000);
    expect('duck is unimpressed', await read("document.getElementById('duck').getAttribute('class')"), 'duck unimpressed');
    expect('not unlocked', await read(visible('done')), false);
    const before = await read(text('left'));
    await sleep(3000);
    expect('meter has stopped', await read(text('left')), before);
    await shot('3-unimpressed.png');
    await click('cancel');
  });
  expect('cancel blocks the push', code, 1);

  code = await scenario('silence never unlocks', { DUCK_SIMULATE: 'silent' }, async ({ read, click }) => {
    await click('start');
    await sleep(17000);
    expect('still locked', await read(visible('done')), false);
    expect('nothing counted', await read(text('left')), '15s of talking left');
    await click('skip');
  });
  expect('skip allows the push', code, 0);

  code = await scenario('missing key fails visibly', { SMARTSPECTRA_API_KEY: ' ', DUCK_SIMULATE: '' }, async ({ read, click, shot }) => {
    await click('start');
    await sleep(300);
    expect('problem shown', await read(visible('problem')), true);
    expect('problem title', await read(text('problem-title')), 'No API key found');
    expect('skip still offered', await read("!document.getElementById('actions').hidden"), true);
    await shot('5-problem.png');
    await click('cancel');
  });
  expect('cancel blocks the push', code, 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
