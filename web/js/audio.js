// HTML5 Web Audio API Synthesizer (Zero External Dependencies)
// Plain JavaScript — this file is loaded directly in the browser, NOT through esbuild.

var SoundManager = (function () {
  function SoundManager() {
    this._ctx = null;
    this._enabled = true;
  }

  SoundManager.prototype._getContext = function () {
    if (!this._enabled) return null;
    if (!this._ctx) {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this._ctx = new AudioCtx();
      }
    }
    if (this._ctx && this._ctx.state === 'suspended') {
      this._ctx.resume();
    }
    return this._ctx;
  };

  SoundManager.prototype.setEnabled = function (val) {
    this._enabled = val;
  };

  SoundManager.prototype.isEnabled = function () {
    return this._enabled;
  };

  SoundManager.prototype.triggerHaptic = function (pattern) {
    pattern = pattern || [100, 50, 150];
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // ignore
      }
    }
  };

  // Play double high-tone bell chime when agent needs approval
  SoundManager.prototype.playApprovalChime = function () {
    this.triggerHaptic([150, 80, 200]);
    var ctx = this._getContext();
    if (!ctx) return;

    var now = ctx.currentTime;
    var frequencies = [587.33, 880];
    for (var idx = 0; idx < frequencies.length; idx++) {
      var freq = frequencies[idx];
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.15);

      gain.gain.setValueAtTime(0.3, now + idx * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.15 + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.15);
      osc.stop(now + idx * 0.15 + 0.5);
    }
  };

  // Play ascending major chord when agent task finishes
  SoundManager.prototype.playCompleteChime = function () {
    this.triggerHaptic([100]);
    var ctx = this._getContext();
    if (!ctx) return;

    var notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    var now = ctx.currentTime;

    for (var idx = 0; idx < notes.length; idx++) {
      var freq = notes[idx];
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.1);

      gain.gain.setValueAtTime(0.2, now + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.6);
    }
  };

  return SoundManager;
})();

window.soundManager = new SoundManager();
