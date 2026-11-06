'use strict';

const { SmartSpectraSDK, SmartSpectraErrorCode, ValidationCode, faceMetrics } = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
const { TalkMeter } = require('../src/talk-meter');

const SESSION_LIMIT_MS = 3 * 60 * 1000;
const UNLOCK_PAUSE_MS = 1600;
const UNIMPRESSED_AFTER_SECONDS = 4;
const REMARK_HOLD_MS = 4000;
const REMARK_MIN_CONFIDENCE = 60;
const NETWORK_RETRY_DELAY_MS = 1500;

const QUESTIONS = ['What does this change do?', 'What could it break?', 'How would you undo it?'];

const NUDGES = ['Go on. I have all day.', 'That was not an explanation.', 'Still here. Still a duck.'];

const REMARKS = {
  HAPPY: 'Why are you smiling? What did you do?',
  ANGRY: "Don't look at me. I didn't write it.",
  SURPRISE: 'You just found the bug, didn\'t you?',
  SAD: "It's only a merge conflict.",
  FEAR: 'Is this your first time in production?',
};

const VALIDATION_HINTS = {
  [ValidationCode.kNoFaceFound]: 'The duck cannot see you. Look at the camera.',
  [ValidationCode.kMultipleFacesFound]: 'One person at a time, please.',
  [ValidationCode.kFaceNotCentered]: 'Centre your face in the frame.',
  [ValidationCode.kFaceSizeOutOfRange]: 'Move a little closer or further away.',
  [ValidationCode.kTooDark]: 'It is too dark. Find some more light.',
  [ValidationCode.kTooBright]: 'It is too bright. Turn away from the light.',
  [ValidationCode.kFrameRateTooLow]: 'The camera is running slowly.',
  [ValidationCode.kExcessiveMotion]: 'Try to keep still.',
  [ValidationCode.kFaceTooClose]: 'Move back a little.',
  [ValidationCode.kFaceTooFar]: 'Move a little closer.',
  [ValidationCode.kFaceTooHigh]: 'Lower the camera or sit taller.',
  [ValidationCode.kFaceTooLow]: 'Raise the camera or sit lower.',
  [ValidationCode.kFaceNotForward]: 'Face the camera.',
};

const $ = (id) => document.getElementById(id);
const meter = new TalkMeter();

let config = null;
let sdk = null;
let sessionTimer = null;
let simulationTimer = null;
let finished = false;
let networkRetried = false;
let remark = null;
let remarkUntil = 0;
let nudge = 0;
let wasSilent = false;

function show(screen) {
  for (const id of ['consent', 'session', 'done', 'problem']) $(id).hidden = id !== screen;
  document.body.dataset.screen = screen;
}

function setDuck(state) {
  $('duck').setAttribute('class', `duck ${state}`);
}

function currentQuestion() {
  return QUESTIONS[Math.min(Math.floor(meter.progress * QUESTIONS.length), QUESTIONS.length - 1)];
}

function render() {
  $('meter').setAttribute('stroke-dasharray', `${meter.progress} 1`);
  $('meter').classList.toggle('empty', meter.progress === 0);
  const left = Math.ceil(meter.options.secondsRequired - meter.spokenSeconds);
  $('left').textContent = `${Math.max(left, 0)}s of talking left`;

  const silent = meter.silentSeconds > UNIMPRESSED_AFTER_SECONDS && meter.spokenSeconds > 0;
  if (silent && !wasSilent) nudge = (nudge + 1) % NUDGES.length;
  wasSilent = silent;

  setDuck(meter.talking ? 'listening' : silent ? 'unimpressed' : '');
  if (remark && performance.now() < remarkUntil) $('bubble').textContent = remark;
  else if (silent) $('bubble').textContent = NUDGES[nudge];
  else $('bubble').textContent = currentQuestion();
}

function secondsOf(timestamp) {
  const raw = typeof timestamp?.toNumber === 'function' ? timestamp.toNumber() : Number(timestamp);
  return raw / 1_000_000;
}

function feed(samples) {
  if (finished || samples.length === 0) return;
  meter.push(samples);
  render();
  if (meter.done) unlock();
}

function react(expression) {
  if (!expression?.scores?.length || performance.now() < remarkUntil) return;
  const top = expression.scores.reduce((best, score) => (score.confidence > best.confidence ? score : best));
  const line = REMARKS[top.type];
  if (!line || top.confidence < REMARK_MIN_CONFIDENCE) return;
  remark = line;
  remarkUntil = performance.now() + REMARK_HOLD_MS;
}

function onMetrics(buffer) {
  const face = decodeMetrics(buffer).face;
  if (!face) return;
  react(face.expression?.at(-1));
  const talking = face.talking ?? [];
  if (config.debug && talking.length > 0) window.gate.trace(`[duck] talking=${talking.at(-1).detected ? 1 : 0} spoken=${meter.spokenSeconds.toFixed(1)}`);
  feed(talking.map((sample) => ({ time: secondsOf(sample.timestamp), detected: Boolean(sample.detected) })));
}

async function stopCamera() {
  clearTimeout(sessionTimer);
  clearInterval(simulationTimer);
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

function fail(title, detail, cameraBlocked = false) {
  if (finished) return;
  window.gate.trace(`[duck] problem: ${title}: ${detail}`);
  $('settings').hidden = !cameraBlocked;
  stopCamera();
  setDuck('unimpressed');
  $('bubble').textContent = 'Well, this is awkward.';
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

function quack() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(520, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(240, context.currentTime + 0.22);
    gain.gain.setValueAtTime(0.18, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.25);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
  } catch {
    // The quack is optional.
  }
}

async function unlock() {
  if (finished) return;
  finished = true;
  await stopCamera();
  $('meter').setAttribute('stroke-dasharray', '1 1');
  $('actions').hidden = true;
  $('bubble').textContent = 'I understood none of that. Approved.';
  setDuck('quack');
  quack();
  show('done');
  setTimeout(() => window.gate.finish('passed'), UNLOCK_PAUSE_MS);
}

// Plays a synthetic talking flag through the real meter, so the interface can be
// checked without a camera. The window always says when this is happening.
function simulate(mode) {
  const started = performance.now();
  let lastTime = 0;
  simulationTimer = setInterval(() => {
    const now = (performance.now() - started) / 1000;
    const samples = [];
    for (let time = lastTime + 1 / 30; time <= now; time += 1 / 30) {
      samples.push({ time, detected: mode === 'talk' && time % 1 < 0.6 });
      lastTime = time;
    }
    if (mode === 'pause') {
      for (const sample of samples) sample.detected = sample.time < 3 && sample.time % 1 < 0.6;
    }
    feed(samples);
  }, 100);
}

function startSdk() {
  sdk = new SmartSpectraSDK({
    apiKey: config.apiKey,
    requestedMetrics: [...faceMetrics],
    enableTelemetry: false,
  });
  sdk.on('streamAvailable', (stream) => {
    $('preview').srcObject = stream;
    $('preview').play().catch(() => {});
  });
  sdk.on('validationStatus', (code) => {
    $('hint').textContent = VALIDATION_HINTS[code] ?? '';
  });
  sdk.on('metrics', onMetrics);
  sdk.on('error', async (code, message) => {
    window.gate.trace(`[duck] sdk error ${code}: ${message}`);
    // Presage's server sometimes takes longer than the SDK's 3 second limit.
    if (code === SmartSpectraErrorCode.kNetworkError && !networkRetried && !finished) {
      networkRetried = true;
      $('hint').textContent = 'Slow connection, trying again.';
      await stopCamera();
      setTimeout(() => begin({ keepRetryState: true }), NETWORK_RETRY_DELAY_MS);
      return;
    }
    fail('The duck could not start', `${message} You can try again, cancel, or continue anyway.`);
  });
  return sdk.start();
}

async function begin(options = {}) {
  finished = false;
  if (!options.keepRetryState) networkRetried = false;
  meter.reset();
  remark = null;
  remarkUntil = 0;
  show('session');
  $('hint').textContent = '';
  render();

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
  if (!(await window.gate.cameraAccess())) {
    fail(
      'macOS is blocking the camera',
      'Turn on Electron under Privacy & Security > Camera, then try again. You can also cancel or continue anyway.',
      true,
    );
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
  $('bubble').textContent = 'Before this goes anywhere, talk me through it.';
  $('start').addEventListener('click', () => begin());
  $('retry').addEventListener('click', () => begin());
  $('settings').addEventListener('click', () => window.gate.openCameraSettings());
  $('cancel').addEventListener('click', () => end('cancelled'));
  $('skip').addEventListener('click', () => end('skipped'));
}

init();
