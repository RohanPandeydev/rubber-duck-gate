'use strict';

const { SmartSpectraSDK, ProcessingStatus, ValidationCode, breathingMetrics } = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
const { BreathCounter } = require('../src/breath-counter');

const SESSION_LIMIT_MS = 3 * 60 * 1000;
const UNLOCK_PAUSE_MS = 1400;

const VALIDATION_HINTS = {
  [ValidationCode.kNoFaceFound]: 'Look at the camera so it can find you',
  [ValidationCode.kMultipleFacesFound]: 'Only one person in frame, please',
  [ValidationCode.kFaceNotCentered]: 'Centre your face in the frame',
  [ValidationCode.kFaceSizeOutOfRange]: 'Move a little closer or further away',
  [ValidationCode.kTooDark]: 'It is too dark, find some more light',
  [ValidationCode.kTooBright]: 'It is too bright, try turning away from the light',
  [ValidationCode.kChestNotVisible]: 'Sit back so your chest is in frame',
  [ValidationCode.kCameraTuning]: 'Adjusting the camera',
  [ValidationCode.kFrameRateTooLow]: 'The camera is running slowly',
  [ValidationCode.kExcessiveMotion]: 'Try to keep still',
  [ValidationCode.kFaceTooClose]: 'Move back a little',
  [ValidationCode.kFaceTooFar]: 'Move a little closer',
  [ValidationCode.kFaceTooHigh]: 'Lower the camera or sit taller',
  [ValidationCode.kFaceTooLow]: 'Raise the camera or sit lower',
  [ValidationCode.kFaceNotForward]: 'Face the camera',
};

const $ = (id) => document.getElementById(id);
const counter = new BreathCounter();

let config = null;
let sdk = null;
let sessionTimer = null;
let simulationTimer = null;
let finished = false;
let hasSignal = false;

function show(screen) {
  for (const id of ['consent', 'session', 'done', 'problem']) $(id).hidden = id !== screen;
}

function setStatus(text, warn = false) {
  $('status').textContent = text;
  $('status').classList.toggle('warn', warn);
}

function renderProgress() {
  $('count').textContent = `${Math.min(counter.count, 3)} / 3`;
  for (let i = 1; i <= 3; i += 1) $(`arc-${i}`).classList.toggle('filled', counter.count >= i);
  $('orb').style.transform = `scale(${0.55 + counter.level * 0.45})`;
}

function secondsOf(timestamp) {
  const raw = typeof timestamp?.toNumber === 'function' ? timestamp.toNumber() : Number(timestamp);
  return raw / 1_000_000;
}

function feed(samples) {
  if (samples.length === 0 || finished) return;
  if (!hasSignal) {
    hasSignal = true;
    $('orb').classList.add('live');
    setStatus('Breathe in slowly, then out');
  }
  for (const event of counter.push(samples)) {
    if (event.type === 'rushed') {
      setStatus('A little slower. Starting the count again.', true);
    } else if (event.type === 'breath') {
      setStatus(event.count < 3 ? 'Good. Keep it slow.' : 'That is three.');
    }
    config.debug && window.gate.trace(`[breathe] ${event.type} ${event.seconds.toFixed(1)}s count=${counter.count}`);
  }
  renderProgress();
  if (counter.done) unlock();
}

function onMetrics(buffer) {
  const metrics = decodeMetrics(buffer);
  const trace = metrics.breathing?.upperTrace ?? [];
  if (config.debug && trace.length > 0) {
    const rate = metrics.breathing?.rate?.at(-1)?.value;
    const values = trace.map((sample) => sample.value);
    window.gate.trace(`[breathe] n=${trace.length} first=${JSON.stringify(trace[0])} min=${Math.min(...values).toFixed(4)} max=${Math.max(...values).toFixed(4)} rate=${rate ?? '-'}`);
  }
  feed(trace.map((sample) => ({ time: secondsOf(sample.timestamp), value: sample.value })));
}

function clearTimers() {
  clearTimeout(sessionTimer);
  clearInterval(simulationTimer);
}

async function stopCamera() {
  clearTimers();
  $('preview').srcObject = null;
  const current = sdk;
  sdk = null;
  if (!current) return;
  try {
    await current.stop();
  } catch {
    // Already stopped.
  }
  try {
    await current.destroy();
  } catch {
    // Already destroyed.
  }
}

function fail(title, detail) {
  if (finished) return;
  stopCamera();
  $('problem-title').textContent = title;
  $('problem-detail').textContent = detail;
  show('problem');
}

async function end(outcome) {
  if (finished) return;
  finished = true;
  await stopCamera();
  window.gate.finish(outcome);
}

async function unlock() {
  if (finished) return;
  finished = true;
  await stopCamera();
  $('actions').hidden = true;
  show('done');
  setTimeout(() => window.gate.finish('passed'), UNLOCK_PAUSE_MS);
}

// Plays a synthetic chest waveform through the real counter, so the interface can
// be checked without a camera. The window always says when this is happening.
function simulate(mode) {
  const period = mode === 'rushed' ? 2 : 5;
  const started = performance.now();
  let lastTime = 0;
  simulationTimer = setInterval(() => {
    const now = (performance.now() - started) / 1000;
    const samples = [];
    for (let time = lastTime + 1 / 30; time <= now; time += 1 / 30) {
      samples.push({ time, value: Math.sin((2 * Math.PI * time) / period) });
      lastTime = time;
    }
    feed(samples);
  }, 100);
}

function startSdk() {
  sdk = new SmartSpectraSDK({
    apiKey: config.apiKey,
    requestedMetrics: [...breathingMetrics],
    enableTelemetry: false,
  });
  sdk.on('streamAvailable', (stream) => {
    $('preview').srcObject = stream;
    $('preview').play().catch(() => {});
  });
  sdk.on('processingStatus', (status) => {
    if (status === ProcessingStatus.kStarting) setStatus('Starting camera');
    if (status === ProcessingStatus.kRunning && !hasSignal) setStatus('Sit still for a moment while it finds your breathing');
  });
  sdk.on('validationStatus', (code) => {
    const hint = VALIDATION_HINTS[code];
    if (hint) setStatus(hint, code !== ValidationCode.kCameraTuning);
    else if (hasSignal && code === ValidationCode.kOk) setStatus('Breathe in slowly, then out');
    if (config.debug) window.gate.trace(`[breathe] validation ${code}`);
  });
  sdk.on('metrics', onMetrics);
  sdk.on('error', (code, message) => {
    window.gate.trace(`[breathe] sdk error ${code}: ${message}`);
    fail('The breathing check could not run', `${message} You can try again, cancel, or continue anyway.`);
  });
  return sdk.start();
}

async function begin() {
  finished = false;
  hasSignal = false;
  counter.reset();
  $('orb').classList.remove('live');
  renderProgress();
  show('session');
  setStatus('Starting camera');

  sessionTimer = setTimeout(() => {
    fail('That took a while, so the camera is off', 'You can try again, cancel, or continue anyway.');
  }, SESSION_LIMIT_MS);

  if (config.simulate) {
    simulate(config.simulate);
    return;
  }
  if (!config.apiKey) {
    fail('No API key found', 'Add SMARTSPECTRA_API_KEY to the .env file. You can cancel or continue anyway.');
    return;
  }
  try {
    await startSdk();
  } catch (error) {
    fail('The camera could not start', `${error.message} You can try again, cancel, or continue anyway.`);
  }
}

async function init() {
  config = await window.gate.config();
  $('reason').textContent = config.reason;
  $('simulated').hidden = !config.simulate;
  $('start').addEventListener('click', begin);
  $('retry').addEventListener('click', begin);
  $('cancel').addEventListener('click', () => end('cancelled'));
  $('skip').addEventListener('click', () => end('skipped'));
}

init();
