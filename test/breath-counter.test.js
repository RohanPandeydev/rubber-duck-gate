'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BreathCounter } = require('../src/breath-counter');

function sine(periodSeconds, durationSeconds, startTime = 0, amplitude = 1) {
  const samples = [];
  for (let time = startTime; time < startTime + durationSeconds; time += 1 / 30) {
    samples.push({ time, value: amplitude * Math.sin((2 * Math.PI * (time - startTime)) / periodSeconds) });
  }
  return samples;
}

test('three slow breaths complete the gate', () => {
  const counter = new BreathCounter();
  counter.push(sine(6, 6 * 5));
  assert.equal(counter.done, true);
});

test('fast breathing never completes the gate', () => {
  const counter = new BreathCounter();
  const events = counter.push(sine(2, 60));
  assert.equal(counter.done, false);
  assert.equal(counter.count, 0);
  assert.ok(events.some((event) => event.type === 'rushed'));
});

test('rushing a breath resets the count', () => {
  const counter = new BreathCounter();
  counter.push(sine(6, 9));
  assert.equal(counter.count, 1);
  counter.push(sine(2, 8, 9));
  assert.equal(counter.count, 0);
});

test('a flat signal counts nothing', () => {
  const counter = new BreathCounter();
  const samples = Array.from({ length: 900 }, (_, i) => ({ time: i / 30, value: 1 }));
  assert.deepEqual(counter.push(samples), []);
  assert.equal(counter.count, 0);
});

test('noise below the minimum amplitude counts nothing', () => {
  const counter = new BreathCounter({ minAmplitude: 0.5 });
  counter.push(sine(6, 60, 0, 0.1));
  assert.equal(counter.count, 0);
});

test('samples split across batches give the same result', () => {
  const samples = sine(6, 6 * 5);
  const counter = new BreathCounter();
  for (let i = 0; i < samples.length; i += 37) counter.push(samples.slice(i, i + 37));
  assert.equal(counter.done, true);
});

test('repeated and out-of-order timestamps are ignored', () => {
  const samples = sine(6, 6 * 5);
  const counter = new BreathCounter();
  for (const sample of samples) counter.push([sample, sample, { time: sample.time - 1, value: 99 }]);
  assert.equal(counter.done, true);
});

test('a long gap is not counted as a breath', () => {
  const counter = new BreathCounter();
  counter.push(sine(6, 9));
  const before = counter.count;
  counter.push(sine(6, 3, 60));
  assert.equal(counter.count, before);
});

test('level stays between 0 and 1', () => {
  const counter = new BreathCounter();
  for (const sample of sine(6, 30)) {
    counter.push([sample]);
    assert.ok(counter.level >= 0 && counter.level <= 1);
  }
});
