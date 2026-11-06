'use strict';

// Drives the real Electron window over the DevTools protocol with a simulated
// signal, so no camera or SDK credits are used. Run with: node scripts/ui-check.js
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOT_DIR;
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
          for (const resolve of pending.values()) resolve({ result: {} });
          pending.clear();
        };
        socket.onmessage = (message) => {
          const data = JSON.parse(message.data);
          if (data.id && pending.has(data.id)) pending.get(data.id)(data.result);
        };
        return (method, params = {}) => new Promise((resolve) => {
          if (socket.readyState !== WebSocket.OPEN) { resolve({ result: {} }); return; }
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
  const port = 9300 + Math.floor(Math.random() * 500);
  const childEnv = { ...process.env, BREATHE_DEBUG_PORT: String(port), BREATHE_REASON: 'force-push to main', ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(require(path.join(ROOT, 'node_modules/electron')), [ROOT], { env: childEnv, stdio: process.env.SHOW_APP_LOG ? 'inherit' : 'ignore' });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  const send = await connect(port);
  const read = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  const click = (id) => read(`document.getElementById('${id}').click()`);
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
  let code = await scenario('slow breathing unlocks', { BREATHE_SIMULATE: 'slow' }, async ({ read, click, shot }) => {
    expect('consent shown first', await read(visible('consent')), true);
    expect('reason', await read(text('reason')), 'force-push to main');
    expect('simulation is labelled', await read(visible('simulated')), true);
    await shot('1-consent.png');
    await click('start');
    await sleep(8500);
    await shot('2-breathing.png');
    for (let i = 0; i < 60 && !(await read(visible('done'))); i += 1) await sleep(250);
    expect('unlocked screen', await read(visible('done')), true);
    await shot('3-unlocked.png');
  });
  expect('exit allows the push', code, 0);

  code = await scenario('rushed breathing stays locked', { BREATHE_SIMULATE: 'rushed' }, async ({ read, click, shot }) => {
    await click('start');
    await sleep(12000);
    expect('count stays at zero', await read(text('count')), '0 / 3');
    expect('warning shown', await read(text('status')), 'A little slower. Starting the count again.');
    expect('not unlocked', await read(visible('done')), false);
    await shot('4-rushed.png');
    await click('cancel');
  });
  expect('cancel blocks the push', code, 1);

  code = await scenario('skip is always available', { BREATHE_SIMULATE: 'slow' }, async ({ click }) => {
    await click('skip');
  });
  expect('skip allows the push', code, 0);

  code = await scenario('missing key fails visibly', { SMARTSPECTRA_API_KEY: ' ', BREATHE_SIMULATE: '' }, async ({ read, click, shot }) => {
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
