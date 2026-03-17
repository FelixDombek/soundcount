'use strict';

/* ==========================================================================
   AudioEngine
   Wraps the Web Audio API.  Detects onsets via short-term vs long-term
   RMS, extracts a normalised FFT spectrum at each onset, and (optionally)
   compares that spectrum against a recorded reference.
========================================================================== */
class AudioEngine {
  constructor () {
    this.ctx       = null;
    this.analyser  = null;
    this.source    = null;
    this.stream    = null;

    this.fftSize = 2048;
    this.bufLen  = 0;
    this._timeData = null;
    this._freqData = null;
    this._animId   = null;
    this._running  = false;

    // Band limits (Hz) used for spectral matching
    this._minBin = 0;
    this._maxBin = 0;

    // Onset detection state
    this._shortTermRms = 0.0001;
    this._longTermRms  = 0.0001;
    this._lastOnsetAt  = 0;

    // Reference recording
    this._refFrames     = [];
    this._capturingRef  = false;
    this.refSpectrum    = null;   // averaged, L2-normalised

    // --- Tuneable settings (can be changed externally) ---
    this.sensitivity     = 5;     // 1 (hard) … 10 (easy)
    this.cooldownMs      = 500;   // min ms between counted events
    this.matchThreshold  = 0.80;  // cosine similarity required (0–1)

    // --- Callbacks ---
    this.onOnset = null;   // (spectrum: Float32Array) => void
    this.onLevel = null;   // (rms: number) => void
  }

  /* ------------------------------------------------------------------
     Lifecycle
  ------------------------------------------------------------------ */
  async start () {
    if (this._running) return;

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation:  false,
        noiseSuppression:  false,
        autoGainControl:   false,
      },
      video: false,
    });

    this.source   = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize               = this.fftSize;
    this.analyser.smoothingTimeConstant = 0.0;   // raw each frame
    this.source.connect(this.analyser);

    this.bufLen    = this.analyser.frequencyBinCount;
    this._timeData = new Float32Array(this.bufLen);
    this._freqData = new Float32Array(this.bufLen);

    // Frequency range to use for spectral matching: 80 Hz – 8 kHz
    const binWidth   = this.ctx.sampleRate / this.fftSize;
    this._minBin = Math.max(1, Math.floor(80   / binWidth));
    this._maxBin = Math.min(this.bufLen - 1, Math.ceil(8000 / binWidth));

    this._running = true;
    this._loop();
  }

  stop () {
    this._running = false;
    if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    if (this.stream)  { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.ctx)     { this.ctx.close(); this.ctx = null; }
    this.analyser = null;
    this.source   = null;
  }

  /* ------------------------------------------------------------------
     Audio processing loop
  ------------------------------------------------------------------ */
  _loop () {
    if (!this._running) return;
    this._animId = requestAnimationFrame(() => this._loop());

    this.analyser.getFloatTimeDomainData(this._timeData);
    this.analyser.getFloatFrequencyData(this._freqData);

    // RMS of the current frame
    let sum = 0;
    for (let i = 0; i < this.bufLen; i++) sum += this._timeData[i] * this._timeData[i];
    const rms = Math.sqrt(sum / this.bufLen);

    if (this.onLevel) this.onLevel(rms);

    // Update exponential moving averages
    this._shortTermRms = 0.15  * rms + 0.85  * this._shortTermRms;
    this._longTermRms  = 0.004 * rms + 0.996 * this._longTermRms;

    // Onset condition: short-term energy >> long-term energy
    //   sensitivity 1 → ratio threshold 7.5  (very hard to trigger)
    //   sensitivity 10 → ratio threshold 1.5  (very easy)
    const ratioThresh   = 1.5 + (10 - this.sensitivity) * 0.6;
    const absRmsThresh  = 0.004 + (10 - this.sensitivity) * 0.0015;
    const now = Date.now();

    if (
      rms > this._longTermRms * ratioThresh &&
      rms > absRmsThresh &&
      now - this._lastOnsetAt > this.cooldownMs
    ) {
      this._lastOnsetAt = now;
      const spectrum = this._extractSpectrum();

      if (this._capturingRef) {
        this._refFrames.push(spectrum);
      } else if (this.onOnset) {
        this.onOnset(spectrum);
      }
    }
  }

  /* ------------------------------------------------------------------
     Spectrum extraction
     Returns a band-limited (80 Hz–8 kHz), L2-normalised Float32Array.
  ------------------------------------------------------------------ */
  _extractSpectrum () {
    const len  = this._maxBin - this._minBin + 1;
    const spec = new Float32Array(len);
    let   norm = 0;

    for (let i = 0; i < len; i++) {
      const db     = this._freqData[this._minBin + i];
      const linear = Math.pow(10, db / 20);
      spec[i] = linear;
      norm   += linear * linear;
    }

    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < len; i++) spec[i] /= norm;
    return spec;
  }

  /* ------------------------------------------------------------------
     Reference recording
  ------------------------------------------------------------------ */
  startCapturingReference () {
    this._refFrames    = [];
    this._capturingRef = true;
  }

  /** Returns true if at least one onset was captured. */
  stopCapturingReference () {
    this._capturingRef = false;
    if (this._refFrames.length === 0) return false;

    // Average all captured spectra then re-normalise
    const len = this._refFrames[0].length;
    const avg = new Float32Array(len);
    for (const f of this._refFrames) for (let i = 0; i < len; i++) avg[i] += f[i];

    let norm = 0;
    for (let i = 0; i < len; i++) { avg[i] /= this._refFrames.length; norm += avg[i] * avg[i]; }
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < len; i++) avg[i] /= norm;

    this.refSpectrum = avg;
    return true;
  }

  hasReference () { return this.refSpectrum !== null; }

  isRunning () { return this._running; }

  cancelCapturingReference () { this._capturingRef = false; }

  /** Cosine similarity against the stored reference. */
  matchesReference (spectrum) {
    if (!this.refSpectrum || spectrum.length !== this.refSpectrum.length) return false;
    let dot = 0;
    for (let i = 0; i < spectrum.length; i++) dot += spectrum[i] * this.refSpectrum[i];
    // Both are L2-normalised → dot product = cosine similarity
    return dot >= this.matchThreshold;
  }
}


/* ==========================================================================
   SoundCounterApp
========================================================================== */
class SoundCounterApp {
  constructor () {
    this.count   = 0;
    this.target  = null;
    this.mode    = 'generic';
    this.running = false;

    this.engine          = new AudioEngine();
    this.engine.onOnset  = spec => this._handleOnset(spec);
    this.engine.onLevel  = rms  => this._handleLevel(rms);

    this._d  = {};   // DOM cache
    this._recIntervalId = null;

    this._initDOM();
    this._bindEvents();
    this._updateAll();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {/* non-fatal */});
    }
  }

  /* ------------------------------------------------------------------
     DOM
  ------------------------------------------------------------------ */
  _initDOM () {
    const ids = [
      'count-number', 'btn-dec', 'btn-inc',
      'progress-bar', 'target-label',
      'level-bar',
      'status', 'status-text',
      'generic-info', 'matched-info',
      'btn-record', 'sample-status',
      'sensitivity', 'sensitivity-out',
      'cooldown', 'cooldown-out',
      'similarity', 'similarity-out', 'similarity-row',
      'target-input', 'btn-clear-target',
      'btn-reset', 'btn-toggle',
      'recording-overlay', 'recording-timer',
      'rec-level-bar', 'btn-cancel-rec',
    ];
    for (const id of ids) this._d[id] = document.getElementById(id);
    this._d.tabBtns = document.querySelectorAll('.tab-btn');
  }

  _bindEvents () {
    this._d['btn-dec'].addEventListener('click',  () => this._adjustCount(-1));
    this._d['btn-inc'].addEventListener('click',  () => this._adjustCount(1));

    // Mode tabs
    this._d.tabBtns.forEach(btn =>
      btn.addEventListener('click', () => { if (!this.running) this._setMode(btn.dataset.mode); })
    );

    // Reference recording
    this._d['btn-record'].addEventListener('click',      () => this._startRefRecording());
    this._d['btn-cancel-rec'].addEventListener('click',  () => this._cancelRefRecording());

    // Sliders
    this._d['sensitivity'].addEventListener('input', e => {
      this.engine.sensitivity = +e.target.value;
      this._d['sensitivity-out'].textContent = e.target.value;
    });
    this._d['cooldown'].addEventListener('input', e => {
      const ms = +e.target.value;
      this.engine.cooldownMs = ms;
      this._d['cooldown-out'].textContent = ms + ' ms';
    });
    this._d['similarity'].addEventListener('input', e => {
      const pct = +e.target.value;
      this.engine.matchThreshold = pct / 100;
      this._d['similarity-out'].textContent = pct + ' %';
    });

    // Target
    this._d['target-input'].addEventListener('change', () => this._applyTarget());
    this._d['target-input'].addEventListener('blur',   () => this._applyTarget());
    this._d['target-input'].addEventListener('keydown', e => { if (e.key === 'Enter') this._applyTarget(); });
    this._d['btn-clear-target'].addEventListener('click', () => {
      this.target = null;
      this._d['target-input'].value = '';
      this._updateBackground();
      this._updateProgress();
    });

    this._d['btn-reset'].addEventListener('click',  () => this._reset());
    this._d['btn-toggle'].addEventListener('click', () => this._toggleCounting());
  }

  /* ------------------------------------------------------------------
     Mode
  ------------------------------------------------------------------ */
  _setMode (mode) {
    this.mode = mode;
    this._d.tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
      btn.setAttribute('aria-selected', btn.dataset.mode === mode ? 'true' : 'false');
    });
    this._d['generic-info'].classList.toggle('hidden', mode !== 'generic');
    this._d['matched-info'].classList.toggle('hidden', mode !== 'matched');
    this._d['similarity-row'].classList.toggle('hidden', mode !== 'matched');
  }

  /* ------------------------------------------------------------------
     Counter mutations
  ------------------------------------------------------------------ */
  _adjustCount (delta) {
    this.count = Math.max(0, this.count + delta);
    this._updateCounter();
    this._updateBackground();
    this._updateProgress();
  }

  _applyTarget () {
    const val = parseInt(this._d['target-input'].value, 10);
    this.target = (!isNaN(val) && val > 0) ? val : null;
    if (!this.target) this._d['target-input'].value = '';
    this._updateBackground();
    this._updateProgress();
  }

  _reset () {
    this.count = 0;
    this._updateCounter();
    this._updateBackground();
    this._updateProgress();
  }

  /* ------------------------------------------------------------------
     Counting (audio engine lifecycle)
  ------------------------------------------------------------------ */
  async _toggleCounting () {
    if (this.running) {
      this._stopCounting();
    } else {
      await this._startCounting();
    }
  }

  async _startCounting () {
    try {
      await this.engine.start();
    } catch (err) {
      alert('Could not access microphone:\n' + err.message);
      return;
    }
    this.running = true;
    this._updateRunningState();
  }

  _stopCounting () {
    this.engine.stop();
    this.running = false;
    this._updateRunningState();
  }

  /* ------------------------------------------------------------------
     Onset / level callbacks
  ------------------------------------------------------------------ */
  _handleOnset (spectrum) {
    if (this.mode === 'matched') {
      if (!this.engine.hasReference())            return;
      if (!this.engine.matchesReference(spectrum)) return;
    }
    this._increment();
  }

  _increment () {
    this.count++;
    this._updateCounter(true);
    this._updateBackground();
    this._updateProgress();
  }

  _handleLevel (rms) {
    const pct = Math.min(100, rms * 700);
    this._d['level-bar'].style.width = pct + '%';

    // Feed recording overlay level meter too
    if (!this._d['recording-overlay'].classList.contains('hidden')) {
      this._d['rec-level-bar'].style.width = pct + '%';
    }
  }

  /* ------------------------------------------------------------------
     Reference recording
  ------------------------------------------------------------------ */
  async _startRefRecording () {
    // Start the engine if it isn't running
    if (!this.engine.isRunning()) {
      try { await this.engine.start(); }
      catch (err) { alert('Could not access microphone:\n' + err.message); return; }
    }

    this._d['recording-overlay'].classList.remove('hidden');
    let remaining = 3;
    this._d['recording-timer'].textContent = remaining;
    this.engine.startCapturingReference();

    this._recIntervalId = setInterval(() => {
      remaining--;
      this._d['recording-timer'].textContent = remaining;
      if (remaining <= 0) {
        clearInterval(this._recIntervalId);
        this._finishRefRecording();
      }
    }, 1000);
  }

  _finishRefRecording () {
    const ok = this.engine.stopCapturingReference();
    this._d['recording-overlay'].classList.add('hidden');

    if (ok) {
      this._d['sample-status'].textContent = '✓ Sample ready';
      this._d['sample-status'].classList.add('ready');
      this._d['btn-record'].textContent = '🎙 Re-record Sample';
      this._d['btn-record'].classList.add('has-sample');
    } else {
      this._d['sample-status'].textContent = 'No sound detected — try again';
      this._d['sample-status'].classList.remove('ready');
    }

    // If we spun up the engine only for recording, stop it
    if (!this.running) this.engine.stop();
  }

  _cancelRefRecording () {
    clearInterval(this._recIntervalId);
    this.engine.cancelCapturingReference();
    this._d['recording-overlay'].classList.add('hidden');
    if (!this.running) this.engine.stop();
  }

  /* ------------------------------------------------------------------
     UI updates
  ------------------------------------------------------------------ */
  _updateAll () {
    this._updateCounter();
    this._updateBackground();
    this._updateProgress();
    this._updateRunningState();
    this._setMode(this.mode);
  }

  _updateCounter (bump = false) {
    this._d['count-number'].textContent = this.count;
    if (bump) {
      const el = this._d['count-number'];
      el.classList.remove('bump');
      void el.offsetWidth;           // force reflow so animation restarts
      el.classList.add('bump');
    }
  }

  _updateBackground () {
    let hue = 120;   // green
    if (this.target && this.target > 0) {
      const progress = Math.min(1, this.count / this.target);
      hue = Math.round(120 * (1 - progress));   // 120 → 0  (green → red)
    }
    document.body.style.backgroundColor = `hsl(${hue}, 50%, 38%)`;
  }

  _updateProgress () {
    if (this.target) {
      const pct = Math.min(100, (this.count / this.target) * 100);
      this._d['progress-bar'].style.width = pct + '%';
      this._d['progress-bar'].parentElement.setAttribute('aria-valuenow', Math.round(pct));
      this._d['target-label'].textContent = `${this.count} / ${this.target}`;
    } else {
      this._d['progress-bar'].style.width = '0%';
      this._d['target-label'].textContent = 'No target set';
    }
  }

  _updateRunningState () {
    const btn        = this._d['btn-toggle'];
    const statusDiv  = this._d['status'];
    const statusText = this._d['status-text'];

    if (this.running) {
      btn.textContent = '■ Stop';
      btn.classList.add('active');
      statusDiv.className = 'status-counting';
      statusText.textContent =
        this.mode === 'matched' ? 'Counting (matched)…' : 'Counting…';
    } else {
      btn.textContent = '▶ Start';
      btn.classList.remove('active');
      statusDiv.className = 'status-idle';
      statusText.textContent = 'Ready';
    }

    // Disable tabs while running
    this._d.tabBtns.forEach(b => (b.disabled = this.running));
  }
}

/* ------------------------------------------------------------------
   Bootstrap
------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => new SoundCounterApp());
