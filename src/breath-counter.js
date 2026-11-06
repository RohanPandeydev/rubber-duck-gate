'use strict';

const DEFAULTS = {
  breathsRequired: 3,
  // A full breath shorter than this counts as rushing: 4s is 15 breaths a minute.
  minBreathSeconds: 4,
  // Longer than this and we lost the signal rather than saw a very long breath.
  maxBreathSeconds: 20,
  // The waveform swings wildly while the SDK settles: a live run jumped to 12.6
  // against a later range of about 5, which then hid real breaths from the range.
  settleSeconds: 8,
  smoothingSeconds: 0.4,
  rangeWindowSeconds: 20,
  // A turn in the waveform must retrace this share of the recent range...
  hysteresisShare: 0.3,
  // ...and this absolute amount, so sensor noise while sitting still is not a breath.
  minAmplitude: 0,
};

// Turns the SmartSpectra chest waveform into a count of slow breaths. One breath
// is one peak-to-peak cycle of the trace. Samples arrive in windowed batches.
class BreathCounter {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.count = 0;
    this.lastTime = null;
    this.firstTime = null;
    this.smoothed = null;
    this.history = [];
    this.direction = 0;
    this.low = Infinity;
    this.high = -Infinity;
    this.extreme = null;
    this.extremeTime = null;
    this.lastPeakTime = null;
    this.events = [];
  }

  get done() {
    return this.count >= this.options.breathsRequired;
  }

  // Where the chest sits in its recent range, 0 (out) to 1 (in). Drives the orb.
  get level() {
    if (this.smoothed === null) return 0.5;
    const { min, max } = this.range();
    return max > min ? (this.smoothed - min) / (max - min) : 0.5;
  }

  range() {
    let min = Infinity;
    let max = -Infinity;
    for (const { value } of this.history) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return { min, max };
  }

  // Returns the events produced by this batch: 'breath' and 'rushed'.
  push(samples) {
    this.events = [];
    for (const { time, value } of samples) {
      if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
      if (this.lastTime !== null && time <= this.lastTime) continue;
      if (this.firstTime === null) this.firstTime = time;
      if (time - this.firstTime < this.options.settleSeconds) {
        this.lastTime = time;
        continue;
      }
      this.step(time, value);
    }
    return this.events;
  }

  step(time, value) {
    const { smoothingSeconds, rangeWindowSeconds, hysteresisShare, minAmplitude } = this.options;
    const dt = time - this.lastTime;
    const alpha = 1 - Math.exp(-dt / smoothingSeconds);
    this.smoothed = this.smoothed === null ? value : this.smoothed + alpha * (value - this.smoothed);
    this.lastTime = time;

    this.history.push({ time, value: this.smoothed });
    while (this.history[0].time < time - rangeWindowSeconds) this.history.shift();

    const { min, max } = this.range();
    const threshold = Math.max((max - min) * hysteresisShare, minAmplitude);
    if (threshold <= 0) return;

    if (this.direction === 0) {
      this.low = Math.min(this.low, this.smoothed);
      this.high = Math.max(this.high, this.smoothed);
      if (this.smoothed - this.low >= threshold) this.turn(1, time);
      else if (this.high - this.smoothed >= threshold) this.turn(-1, time);
    } else if (this.direction === 1) {
      if (this.smoothed > this.extreme) {
        this.extreme = this.smoothed;
        this.extremeTime = time;
      } else if (this.extreme - this.smoothed >= threshold) {
        this.onPeak(this.extremeTime);
        this.turn(-1, time);
      }
    } else if (this.smoothed < this.extreme) {
      this.extreme = this.smoothed;
    } else if (this.smoothed - this.extreme >= threshold) {
      this.turn(1, time);
    }
  }

  turn(direction, time) {
    this.direction = direction;
    this.extreme = this.smoothed;
    this.extremeTime = time;
  }

  onPeak(peakTime) {
    const previous = this.lastPeakTime;
    this.lastPeakTime = peakTime;
    if (previous === null || this.done) return;

    const seconds = peakTime - previous;
    const { minBreathSeconds, maxBreathSeconds } = this.options;
    if (seconds < minBreathSeconds) {
      this.count = 0;
      this.events.push({ type: 'rushed', seconds });
    } else if (seconds <= maxBreathSeconds) {
      this.count += 1;
      this.events.push({ type: 'breath', seconds, count: this.count });
    }
  }
}

module.exports = { BreathCounter, DEFAULTS };
