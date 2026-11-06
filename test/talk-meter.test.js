'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TalkMeter } = require('../src/talk-meter');

const STEP = 1 / 30;

function samples(from, to, detected) {
  const out = [];
  for (let time = from; time < to; time += STEP) out.push({ time, detected: detected(time) });
  return out;
}

test('steady talking fills the meter', () => {
  const meter = new TalkMeter();
  meter.push(samples(0, 16, () => true));
  assert.equal(meter.done, true);
  assert.equal(meter.progress, 1);
});

test('silence adds nothing', () => {
  const meter = new TalkMeter();
  meter.push(samples(0, 60, () => false));
  assert.equal(meter.spokenSeconds, 0);
  assert.equal(meter.talking, false);
  assert.equal(meter.silentSeconds, Infinity);
});

test('short pauses between words still count', () => {
  const meter = new TalkMeter();
  meter.push(samples(0, 20, (time) => time % 1 < 0.4));
  assert.equal(meter.done, true);
});

test('a long silence stops the meter and keeps the progress', () => {
  const meter = new TalkMeter();
  meter.push(samples(0, 5, () => true));
  const before = meter.spokenSeconds;
  meter.push(samples(5, 30, () => false));
  assert.ok(meter.spokenSeconds <= before + 1.3);
  assert.equal(meter.talking, false);
  assert.ok(meter.silentSeconds > 20);
  assert.equal(meter.done, false);
});

test('one stray detection in silence adds at most the hold time', () => {
  const meter = new TalkMeter();
  meter.push(samples(0, 30, (time) => Math.abs(time - 10) < STEP / 2));
  assert.ok(meter.spokenSeconds <= 1.3);
});

test('lost samples are not counted as talking', () => {
  const meter = new TalkMeter();
  meter.push([{ time: 0, detected: true }, { time: 1, detected: true }]);
  assert.equal(meter.spokenSeconds, 0);
});

test('repeated and out-of-order timestamps are ignored', () => {
  const meter = new TalkMeter();
  for (const sample of samples(0, 16, () => true)) meter.push([sample, sample, { time: sample.time - 1, detected: true }]);
  assert.ok(Math.abs(meter.spokenSeconds - 16) < 0.1);
});

test('samples split across batches give the same result', () => {
  const all = samples(0, 16, (time) => time % 1 < 0.6);
  const whole = new TalkMeter();
  whole.push(all);
  const split = new TalkMeter();
  for (let i = 0; i < all.length; i += 37) split.push(all.slice(i, i + 37));
  assert.equal(split.spokenSeconds, whole.spokenSeconds);
});
