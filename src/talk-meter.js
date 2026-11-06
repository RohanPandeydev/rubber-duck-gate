'use strict';

const DEFAULTS = {
  secondsRequired: 15,
  // Speech reads as short bursts with the mouth still between words, so a gap this
  // short still counts as the same sentence.
  holdSeconds: 1.2,
  // A jump this long means samples were lost, and time is not counted across it.
  maxStepSeconds: 0.5,
};

// Adds up how long someone has been explaining, from SmartSpectra's talking flag.
class TalkMeter {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.spokenSeconds = 0;
    this.lastTime = null;
    this.lastDetectedTime = null;
  }

  get progress() {
    return Math.min(this.spokenSeconds / this.options.secondsRequired, 1);
  }

  get done() {
    return this.spokenSeconds >= this.options.secondsRequired;
  }

  get talking() {
    return this.lastDetectedTime !== null && this.lastTime - this.lastDetectedTime <= this.options.holdSeconds;
  }

  // Seconds since the last detected speech. Infinity before any speech.
  get silentSeconds() {
    return this.lastDetectedTime === null ? Infinity : this.lastTime - this.lastDetectedTime;
  }

  push(samples) {
    for (const { time, detected } of samples) {
      if (!Number.isFinite(time)) continue;
      if (this.lastTime !== null && time <= this.lastTime) continue;
      const step = this.lastTime === null ? 0 : time - this.lastTime;
      this.lastTime = time;
      if (detected) this.lastDetectedTime = time;
      if (this.talking && step <= this.options.maxStepSeconds) this.spokenSeconds += step;
    }
  }
}

module.exports = { TalkMeter, DEFAULTS };
