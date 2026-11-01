/* ============================================================
   VOLTCORE // Deflect Protocol
   A self-contained canvas arcade defense game.

   Core loop:
   - Aim the shield at incoming fire.
   - Deflect bullets back into the drones that fired them.
   - Perfect parries build flux; spend flux on NOVA.
   - Clear a wave, install an upgrade, repeat.
   ============================================================ */

(() => {
  "use strict";

  /* ============================================================
     Constants, DOM, and persistence
     ============================================================ */

  const TAU = Math.PI * 2;
  const CORE_RADIUS = 24;
  const ARENA_RADIUS = 345;
  const BASE_SHIELD_RADIUS = 118;
  const REDUCED_MOTION = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const $ = (id) => document.getElementById(id);

  const ui = {
    canvas: $("game"),
    hud: $("hud"),
    scoreValue: $("scoreValue"),
    multValue: $("multValue"),
    waveValue: $("waveValue"),
    waveBar: $("waveBar"),
    healthPips: $("healthPips"),
    comboBox: $("comboBox"),
    comboValue: $("comboValue"),
    comboMult: $("comboMult"),
    muteBtn: $("muteBtn"),
    pauseBtn: $("pauseBtn"),
    novaBtn: $("novaBtn"),
    novaPct: $("novaPct"),
    aimHint: $("aimHint"),
    damageFlash: $("damageFlash"),
    toastStack: $("toastStack"),
    startScreen: $("startScreen"),
    pauseScreen: $("pauseScreen"),
    upgradeScreen: $("upgradeScreen"),
    gameOverScreen: $("gameOverScreen"),
    playBtn: $("playBtn"),
    resumeBtn: $("resumeBtn"),
    pauseRestartBtn: $("pauseRestartBtn"),
    pauseMenuBtn: $("pauseMenuBtn"),
    upgradeGrid: $("upgradeGrid"),
    againBtn: $("againBtn"),
    shareBtn: $("shareBtn"),
    menuBtn: $("menuBtn"),
    bestScore: $("bestScore"),
    bestWave: $("bestWave"),
    achCount: $("achCount"),
    achievementList: $("achievementList"),
    finalScore: $("finalScore"),
    finalWave: $("finalWave"),
    finalCombo: $("finalCombo"),
    finalKills: $("finalKills"),
    finalDeflects: $("finalDeflects"),
    finalTime: $("finalTime"),
    newBest: $("newBest"),
    gameOverAch: $("gameOverAch")
  };

  const ctx = ui.canvas.getContext("2d");

  const STORAGE = {
    best: "voltcore.best.v1",
    achievements: "voltcore.achievements.v1",
    muted: "voltcore.muted.v1"
  };

  function readJSON(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      /* Storage can be unavailable in private or file:// contexts. */
    }
  }

  let best = readJSON(STORAGE.best, { score: 0, wave: 1 });
  if (!best || typeof best !== "object") best = { score: 0, wave: 1 };
  best.score = Number(best.score) || 0;
  best.wave = Number(best.wave) || 1;

  const savedAchievements = readJSON(STORAGE.achievements, []);
  let unlocked = new Set(Array.isArray(savedAchievements) ? savedAchievements : []);

  let muted = readJSON(STORAGE.muted, false) === true;

  /* ============================================================
     Achievements
     ============================================================ */

  const ACHIEVEMENTS = [
    { id: "first_blood", name: "First Break", desc: "Destroy your first hostile." },
    { id: "chain_10", name: "Chain Reaction", desc: "Reach a 10x chain." },
    { id: "perfect_wave", name: "Untouched", desc: "Clear a wave without taking core damage." },
    { id: "nova_trio", name: "Critical Mass", desc: "Use NOVA three times in one run." },
    { id: "wave_5", name: "Deep Signal", desc: "Reach wave 5." },
    { id: "score_10k", name: "High Voltage", desc: "Score 10,000 in one run." }
  ];

  /* ============================================================
     Audio engine
     Uses the Web Audio API so the game ships without sound files.
     ============================================================ */

  const Sound = {
    ctx: null,
    master: null,
    noiseBuffer: null,
    ambience: null,
    muted: muted,

    init() {
      if (this.ctx) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      try {
        this.ctx = new AudioContextClass();

        const compressor = this.ctx.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 18;
        compressor.ratio.value = 5;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.2;

        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.22;
        this.master.connect(compressor);
        compressor.connect(this.ctx.destination);

        const length = Math.floor(this.ctx.sampleRate * 0.7);
        this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      } catch (error) {
        this.ctx = null;
        this.master = null;
      }
    },

    resume() {
      if (this.ctx && this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
    },

    setMuted(value) {
      this.muted = value;
      if (this.master && this.ctx) {
        const now = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setTargetAtTime(value ? 0 : 0.22, now, 0.02);
      }
    },

    tone(freq, endFreq, duration, type, volume, delay) {
      if (!this.ctx || !this.master) return;
      const start = this.ctx.currentTime + (delay || 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type || "sine";
      osc.frequency.setValueAtTime(Math.max(20, freq), start);
      if (endFreq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + duration);
      }

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(this.master);
      osc.start(start);
      osc.stop(start + duration + 0.03);
    },

    noise(duration, volume, cutoff, delay) {
      if (!this.ctx || !this.master || !this.noiseBuffer) return;
      const start = this.ctx.currentTime + (delay || 0);
      const source = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      source.buffer = this.noiseBuffer;
      filter.type = "lowpass";
      filter.frequency.value = cutoff || 1000;
      gain.gain.setValueAtTime(Math.max(0.0001, volume), start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start(start);
      source.stop(start + duration + 0.02);
    },

    play(name) {
      if (!this.ctx || this.muted) return;

      switch (name) {
        case "deflect":
          this.tone(520 + Math.random() * 130, 900, 0.085, "triangle", 0.045);
          break;
        case "perfect":
          this.tone(880, 1320, 0.16, "sine", 0.065);
          this.tone(1760, 1760, 0.08, "sine", 0.028, 0.055);
          break;
        case "hit":
          this.tone(125, 42, 0.28, "sawtooth", 0.12);
          this.noise(0.2, 0.08, 700);
          break;
        case "kill":
          this.tone(235, 70, 0.18, "square", 0.052);
          this.noise(0.11, 0.026, 1800);
          break;
        case "nova":
          this.tone(80, 620, 0.5, "sawtooth", 0.075);
          this.tone(620, 90, 0.7, "triangle", 0.06, 0.12);
          this.noise(0.5, 0.09, 1200);
          break;
        case "ready":
          this.tone(740, 1120, 0.12, "sine", 0.045);
          this.tone(1480, 1480, 0.1, "sine", 0.02, 0.08);
          break;
        case "wave":
          this.tone(330, 330, 0.1, "sine", 0.04);
          this.tone(440, 440, 0.12, "sine", 0.035, 0.08);
          break;
        case "upgrade":
          this.tone(523, 523, 0.1, "sine", 0.045);
          this.tone(659, 659, 0.1, "sine", 0.045, 0.08);
          this.tone(784, 784, 0.16, "sine", 0.045, 0.16);
          break;
        case "achieve":
          this.tone(784, 784, 0.1, "sine", 0.045);
          this.tone(1046, 1046, 0.1, "sine", 0.04, 0.08);
          this.tone(1318, 1318, 0.18, "sine", 0.04, 0.16);
          break;
        case "start":
          this.tone(220, 220, 0.1, "triangle", 0.04);
          this.tone(330, 330, 0.1, "triangle", 0.04, 0.08);
          this.tone(440, 440, 0.1, "triangle", 0.04, 0.16);
          this.tone(660, 660, 0.24, "triangle", 0.045, 0.24);
          break;
        case "gameover":
          this.tone(440, 440, 0.15, "sine", 0.05);
          this.tone(330, 330, 0.15, "sine", 0.05, 0.16);
          this.tone(247, 247, 0.18, "sine", 0.05, 0.32);
          this.tone(165, 165, 0.42, "sine", 0.055, 0.5);
          break;
        case "click":
          this.tone(700, 900, 0.03, "square", 0.018);
          break;
        default:
          break;
      }
    },

    startAmbience() {
      if (!this.ctx || !this.master || this.ambience) return;
      const now = this.ctx.currentTime;
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      const oscA = this.ctx.createOscillator();
      const oscB = this.ctx.createOscillator();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();

      filter.type = "lowpass";
      filter.frequency.value = 260;

      oscA.type = "sine";
      oscA.frequency.value = 55;
      oscB.type = "triangle";
      oscB.frequency.value = 82.5;

      lfo.type = "sine";
      lfo.frequency.value = 0.07;
      lfoGain.gain.value = 85;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.052, now + 1.5);

      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);

      oscA.start(now);
      oscB.start(now);
      lfo.start(now);

      this.ambience = { gain, oscA, oscB, lfo };
    },

    stopAmbience() {
      if (!this.ctx || !this.ambience) return;
      const current = this.ambience;
      this.ambience = null;
      const now = this.ctx.currentTime;

      current.gain.gain.cancelScheduledValues(now);
      current.gain.gain.setTargetAtTime(0.0001, now, 0.15);

      window.setTimeout(() => {
        try {
          current.oscA.stop();
          current.oscB.stop();
          current.lfo.stop();
        } catch (error) {
          /* Already stopped. */
        }
      }, 700);
    }
  };

  /* ============================================================
     Small utility functions
     ============================================================ */

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rand = (min, max) => min + Math.random() * (max - min);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const formatScore = (value) => Number(value || 0).toLocaleString("en-US");

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);
    return minutes + ":" + String(remaining).padStart(2, "0");
  }

  function angleDiff(a, b) {
    let diff = (a - b) % TAU;
    if (diff > Math.PI) diff -= TAU;
    if (diff < -Math.PI) diff += TAU;
    return diff;
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }

  function setText(element, value) {
    const text = String(value);
    if (element && element.textContent !== text) element.textContent = text;
  }

  /* ============================================================
     Canvas sizing and star field
     ============================================================ */

  let W = 0;
  let H = 0;
  let DPR = 1;
  let cx = 0;
  let cy = 0;
  let viewScale = 1;
  let bgGrad = null;
  let glowA = null;
  let glowB = null;
  const stars = [];

  function buildStars() {
    stars.length = 0;
    const count = Math.min(150, Math.floor((W * H) / 14000));
    const colors = ["#cfefff", "#7fe8ff", "#ffb8d9", "#ffffff"];

    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: rand(0.35, 1.55),
        a: rand(0.18, 0.72),
        tw: rand(0.5, 2.1),
        ph: rand(0, TAU),
        drift: rand(0.2, 1.4),
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);

    ui.canvas.width = Math.max(1, Math.floor(W * DPR));
    ui.canvas.height = Math.max(1, Math.floor(H * DPR));

    cx = W * 0.5;
    cy = H * 0.5;
    viewScale = Math.min(W / 720, H / 820);

    bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.72);
    bgGrad.addColorStop(0, "#091a31");
    bgGrad.addColorStop(0.42, "#050c19");
    bgGrad.addColorStop(1, "#020309");

    glowA = ctx.createRadialGradient(W * 0.82, H * 0.16, 0, W * 0.82, H * 0.16, Math.max(W, H) * 0.45);
    glowA.addColorStop(0, "rgba(255, 79, 163, 0.075)");
    glowA.addColorStop(1, "rgba(255, 79, 163, 0)");

    glowB = ctx.createRadialGradient(W * 0.16, H * 0.88, 0, W * 0.16, H * 0.88, Math.max(W, H) * 0.5);
    glowB.addColorStop(0, "rgba(95, 245, 255, 0.065)");
    glowB.addColorStop(1, "rgba(95, 245, 255, 0)");

    buildStars();
  }

  /* ============================================================
     Game data
     ============================================================ */

  const ENEMY_DEFS = {
    drone: {
      hp: 2,
      radius: 18,
      orbit: 302,
      orbitSpeed: 0.13,
      fireRate: 2.9,
      bulletSpeed: 190,
      color: "#ff4fa3",
      spin: 1.2,
      score: 90
    },
    lancer: {
      hp: 2,
      radius: 16,
      orbit: 262,
      orbitSpeed: 0.24,
      fireRate: 1.9,
      bulletSpeed: 255,
      color: "#ff9a62",
      spin: 2.1,
      score: 110
    },
    splitter: {
      hp: 3,
      radius: 22,
      orbit: 326,
      orbitSpeed: 0.09,
      fireRate: 3.5,
      bulletSpeed: 155,
      color: "#b48cff",
      spin: 0.8,
      score: 160
    },
    warden: {
      hp: 5,
      radius: 27,
      orbit: 334,
      orbitSpeed: 0.06,
      fireRate: 2.6,
      bulletSpeed: 180,
      color: "#ffd166",
      spin: 0.55,
      score: 260
    }
  };

  const UPGRADES = [
    {
      id: "arc",
      tag: "ARC",
      name: "Wide Guard",
      desc: "Expand the shield arc by 12%. More coverage, more mistakes forgiven.",
      max: 4,
      apply() { game.shieldHalf += 0.06; }
    },
    {
      id: "damage",
      tag: "DMG",
      name: "Hardlight",
      desc: "Deflected shots deal +1 damage. Perfect parries hit even harder.",
      max: 4,
      apply() { game.deflectDamage += 1; }
    },
    {
      id: "flux",
      tag: "FLX",
      name: "Flux Tap",
      desc: "Gain 25% more flux from deflections, kills, and wave clears.",
      max: 3,
      apply() { game.fluxGain *= 1.25; }
    },
    {
      id: "health",
      tag: "HP",
      name: "Core Plating",
      desc: "+1 maximum integrity and repair 1 core segment immediately.",
      max: 3,
      apply() {
        game.maxHealth += 1;
        game.health = Math.min(game.maxHealth, game.health + 1);
      }
    },
    {
      id: "radius",
      tag: "RAD",
      name: "Event Horizon",
      desc: "Push the shield outward by 7%. Easier to intercept, harder to aim.",
      max: 3,
      apply() { game.shieldRadius *= 1.07; }
    },
    {
      id: "perfect",
      tag: "PRF",
      name: "Precision",
      desc: "Perfect parry window grows by 40%. Reward for meeting fire head-on.",
      max: 3,
      apply() { game.perfectHalf += 0.045; }
    },
    {
      id: "speed",
      tag: "SPD",
      name: "Kinetic Edge",
      desc: "Deflected shots fly 15% faster and reach the grid sooner.",
      max: 3,
      apply() { game.deflectSpeed *= 1.15; }
    },
    {
      id: "nova",
      tag: "NOV",
      name: "Nova Cascade",
      desc: "NOVA deals +1 damage and all flux gains improve by 10%.",
      max: 3,
      apply() {
        game.novaDamage += 1;
        game.fluxGain *= 1.1;
      }
    },
    {
      id: "pierce",
      tag: "PIR",
      name: "Phase Rounds",
      desc: "Deflected shots pierce 1 extra target before dissipating.",
      max: 2,
      apply() { game.pierce += 1; }
    }
  ];

  const REPAIR = {
    id: "repair",
    tag: "FIX",
    name: "Core Patch",
    desc: "Repair 2 integrity immediately. A safe choice when the grid bites back.",
    max: Infinity,
    apply() {
      game.health = Math.min(game.maxHealth, game.health + 2);
    }
  };

  /* ============================================================
     Game state
     ============================================================ */

  let state = "menu";
  let game = makeGame();
  let lastTime = performance.now();
  let menuTime = 0;
  let aimHintTimer = 0;
  let flashTimer = 0;
  const keys = new Set();

  function makeGame() {
    return {
      score: 0,
      wave: 1,
      health: 5,
      maxHealth: 5,

      combo: 0,
      comboTimer: 0,
      comboBest: 0,

      flux: 0,
      novaUses: 0,

      shieldAngle: -Math.PI / 2,
      aimAngle: -Math.PI / 2,
      shieldHalf: 0.58,
      perfectHalf: 0.16,
      shieldRadius: BASE_SHIELD_RADIUS,

      deflectDamage: 1,
      deflectSpeed: 430,
      pierce: 0,
      fluxGain: 1,
      novaDamage: 3,

      enemies: [],
      bullets: [],
      particles: [],
      texts: [],
      rings: [],

      spawnRemaining: 0,
      waveTotal: 0,
      spawnTimer: 0,
      spawnInterval: 1.5,
      waveActive: false,
      damageThisWave: false,
      pendingUpgrade: false,
      upgradeDelay: 0,

      time: 0,
      runTime: 0,
      shake: 0,
      slowmo: 0,
      shieldFlash: 0,
      shieldFlashColor: "#5ff5ff",
      damageFlash: 0,
      novaFlash: 0,

      totalDeflects: 0,
      totalKills: 0,
      nextEnemyId: 0,

      upgrades: {
        arc: 0,
        damage: 0,
        flux: 0,
        health: 0,
        radius: 0,
        perfect: 0,
        speed: 0,
        nova: 0,
        pierce: 0
      },

      runAchievements: []
    };
  }

  /* ============================================================
     HUD and persistent records
     ============================================================ */

  function getMultiplier() {
    return 1 + Math.min(4, Math.floor(game.combo / 6) * 0.5);
  }

  function buildHealthPips() {
    ui.healthPips.innerHTML = "";
    for (let i = 0; i < game.maxHealth; i++) {
      const pip = document.createElement("i");
      pip.className = "pip";
      ui.healthPips.appendChild(pip);
    }
    syncHud();
  }

  function syncHud() {
    if (!game) return;

    setText(ui.scoreValue, formatScore(game.score));
    const multiplier = getMultiplier();
    setText(ui.multValue, "x" + multiplier.toFixed(1));
    setText(ui.waveValue, String(game.wave).padStart(2, "0"));

    const pips = ui.healthPips.children;
    for (let i = 0; i < pips.length; i++) {
      pips[i].classList.toggle("on", i < game.health);
    }
    ui.healthPips.classList.toggle("low", game.health <= 2);

    let progress = 0;
    if (!game.waveActive) {
      progress = game.pendingUpgrade ? 1 : 0;
    } else {
      const remaining = game.spawnRemaining + game.enemies.length;
      progress = game.waveTotal ? 1 - remaining / game.waveTotal : 0;
    }
    ui.waveBar.style.transform = "scaleX(" + clamp(progress, 0, 1).toFixed(3) + ")";

    const comboOn = game.combo > 0;
    ui.comboBox.hidden = !comboOn;
    if (comboOn) {
      setText(ui.comboValue, game.combo);
      setText(ui.comboMult, "x" + multiplier.toFixed(1));
    }

    ui.novaBtn.style.setProperty("--p", clamp(game.flux, 0, 100).toFixed(1) + "%");
    const ready = game.flux >= 100;
    const canNova = ready && state === "playing";
    ui.novaBtn.classList.toggle("ready", canNova);
    ui.novaBtn.disabled = !canNova;
    setText(ui.novaPct, ready ? "READY" : Math.floor(game.flux) + "%");
  }

  function updateBestUI() {
    setText(ui.bestScore, formatScore(best.score));
    setText(ui.bestWave, best.wave);
  }

  function updateMuteBtn() {
    ui.muteBtn.textContent = muted ? "SND OFF" : "SND ON";
    ui.muteBtn.classList.toggle("off", muted);
    ui.muteBtn.setAttribute("aria-pressed", String(muted));
  }

  function renderAchievements() {
    ui.achievementList.innerHTML = "";
    let count = 0;

    ACHIEVEMENTS.forEach((achievement) => {
      const isUnlocked = unlocked.has(achievement.id);
      if (isUnlocked) count++;

      const chip = document.createElement("div");
      chip.className = "ach" + (isUnlocked ? " unlocked" : "");
      chip.title = achievement.desc;

      const dot = document.createElement("span");
      dot.className = "dot";

      const label = document.createElement("span");
      label.textContent = achievement.name;

      chip.append(dot, label);
      ui.achievementList.appendChild(chip);
    });

    setText(ui.achCount, count + " / " + ACHIEVEMENTS.length);
  }

  function unlockAchievement(id) {
    if (unlocked.has(id)) return;

    const achievement = ACHIEVEMENTS.find((item) => item.id === id);
    if (!achievement) return;

    unlocked.add(id);
    writeJSON(STORAGE.achievements, Array.from(unlocked));
    game.runAchievements.push(achievement.name);

    showToast("FIELD RECORD // " + achievement.name, "achievement", 3200);
    Sound.play("achieve");
    renderAchievements();
  }

  /* ============================================================
     Feedback helpers
     ============================================================ */

  function showToast(text, type, duration) {
    const toast = document.createElement("div");
    toast.className = "toast " + (type || "info");
    toast.textContent = text;
    ui.toastStack.appendChild(toast);

    while (ui.toastStack.children.length > 3) {
      ui.toastStack.firstElementChild.remove();
    }

    const life = duration || 2600;
    window.setTimeout(() => {
      toast.classList.add("out");
      window.setTimeout(() => toast.remove(), 280);
    }, life);
  }

  function flashScreen(kind) {
    ui.damageFlash.className = "damage-flash";
    void ui.damageFlash.offsetWidth;
    ui.damageFlash.classList.add(kind);

    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      ui.damageFlash.className = "damage-flash";
    }, 650);
  }

  function showAimHint() {
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    ui.aimHint.textContent = coarse ? "DRAG TO ROTATE SHIELD" : "MOVE TO ROTATE SHIELD";
    ui.aimHint.hidden = false;
    void ui.aimHint.offsetWidth;
    ui.aimHint.classList.add("show");

    window.clearTimeout(aimHintTimer);
    aimHintTimer = window.setTimeout(hideAimHint, 3800);
  }

  function hideAimHint() {
    window.clearTimeout(aimHintTimer);
    ui.aimHint.classList.remove("show");
    ui.aimHint.hidden = true;
  }

  /* ============================================================
     State and screen transitions
     ============================================================ */

  function setState(next) {
    state = next;
    keys.clear();

    if (next !== "playing") hideAimHint();

    ui.startScreen.hidden = next !== "menu";
    ui.pauseScreen.hidden = next !== "paused";
    ui.upgradeScreen.hidden = next !== "upgrade";
    ui.gameOverScreen.hidden = next !== "gameover";

    ui.hud.hidden = next === "menu";
    ui.novaBtn.hidden = next !== "playing";
    ui.pauseBtn.hidden = !(next === "playing" || next === "paused");

    if (next !== "playing") {
      ui.novaBtn.classList.remove("ready");
      ui.novaBtn.disabled = true;
    }

    document.body.dataset.state = next;
    if (next !== "menu") syncHud();
  }

  function toggleMute() {
    muted = !muted;
    Sound.init();
    Sound.setMuted(muted);
    writeJSON(STORAGE.muted, muted);
    updateMuteBtn();
    if (!muted) Sound.play("click");
  }

  function startRun() {
    Sound.init();
    Sound.resume();
    Sound.play("start");
    Sound.startAmbience();

    game = makeGame();
    ui.toastStack.innerHTML = "";
    buildHealthPips();
    setState("playing");
    beginWave(1);
    syncHud();
    showAimHint();
    lastTime = performance.now();
  }

  function pauseGame() {
    if (state !== "playing") return;
    keys.clear();
    setState("paused");
    Sound.play("click");
  }

  function resumeGame() {
    if (state !== "paused") return;
    lastTime = performance.now();
    setState("playing");
    Sound.play("click");
  }

  function goToMenu() {
    keys.clear();
    hideAimHint();
    Sound.stopAmbience();
    game = makeGame();
    ui.toastStack.innerHTML = "";
    setState("menu");
    updateBestUI();
    renderAchievements();
    Sound.play("click");
  }

  function endGame() {
    if (state !== "playing") return;

    keys.clear();
    hideAimHint();
    setState("gameover");
    Sound.stopAmbience();
    Sound.play("gameover");

    const newBest = game.score > best.score;
    if (game.score > best.score) best.score = game.score;
    if (game.wave > best.wave) best.wave = game.wave;
    writeJSON(STORAGE.best, best);
    updateBestUI();

    setText(ui.finalScore, formatScore(game.score));
    setText(ui.finalWave, game.wave);
    setText(ui.finalCombo, game.comboBest);
    setText(ui.finalKills, game.totalKills);
    setText(ui.finalDeflects, game.totalDeflects);
    setText(ui.finalTime, formatTime(game.runTime));

    ui.newBest.hidden = !newBest;
    ui.gameOverAch.textContent = game.runAchievements.length
      ? "NEW FIELD RECORDS // " + game.runAchievements.join(" · ")
      : "NO NEW RECORDS // BREAK DEEPER NEXT RUN";

    syncHud();
  }

  async function shareRun() {
    const text =
      "VOLTCORE // " +
      formatScore(game.score) +
      " pts · Wave " +
      game.wave +
      " · Best chain " +
      game.comboBest +
      ". Can you hold the core?";

    try {
      if (navigator.share) {
        await navigator.share({ title: "VOLTCORE", text });
        return;
      }
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast("RUN SUMMARY COPIED TO CLIPBOARD", "info", 2200);
      } else {
        window.prompt("Copy your run:", text);
      }
    } catch (error) {
      window.prompt("Copy your run:", text);
    }
  }

  /* ============================================================
     Upgrades between waves
     ============================================================ */

  function openUpgrade() {
    if (state !== "playing") return;
    game.pendingUpgrade = false;
    setState("upgrade");
    renderUpgradeChoices();
  }

  function renderUpgradeChoices() {
    const available = UPGRADES.filter((upgrade) => {
      return (game.upgrades[upgrade.id] || 0) < upgrade.max;
    });

    shuffle(available);
    const choices = available.slice(0, 3);
    while (choices.length < 3) choices.push(REPAIR);

    ui.upgradeGrid.innerHTML = "";

    choices.forEach((upgrade) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "upgrade-card";

      const levelText = upgrade.id === "repair"
        ? "FIELD PATCH"
        : "LV " + (game.upgrades[upgrade.id] || 0) + " / " + upgrade.max;

      button.innerHTML =
        '<span class="upgrade-icon">' + upgrade.tag + "</span>" +
        '<span class="upgrade-level">' + levelText + "</span>" +
        "<h3>" + upgrade.name + "</h3>" +
        "<p>" + upgrade.desc + "</p>" +
        '<span class="install">INSTALL MOD</span>';

      button.addEventListener("click", () => applyUpgrade(upgrade.id));
      ui.upgradeGrid.appendChild(button);
    });
  }

  function applyUpgrade(id) {
    if (state !== "upgrade") return;

    const upgrade = id === "repair"
      ? REPAIR
      : UPGRADES.find((item) => item.id === id);

    if (!upgrade) return;

    const level = game.upgrades[id] || 0;
    if (upgrade.max !== Infinity && level >= upgrade.max) return;

    game.upgrades[id] = level + 1;
    upgrade.apply();

    if (id === "health") buildHealthPips();

    Sound.play("upgrade");
    showToast(upgrade.name + " // LV " + game.upgrades[id], "upgrade", 1900);
    setState("playing");
    beginWave(game.wave + 1);
    lastTime = performance.now();
  }

  /* ============================================================
     Wave spawning and enemy behavior
     ============================================================ */

  function beginWave(waveNumber) {
    game.wave = waveNumber;
    game.waveActive = true;
    game.pendingUpgrade = false;
    game.spawnRemaining = 3 + Math.floor(waveNumber * 1.7);
    game.waveTotal = game.spawnRemaining;
    game.spawnInterval = Math.max(0.52, 1.55 - waveNumber * 0.055);
    game.spawnTimer = 0.8;
    game.damageThisWave = false;
    game.upgradeDelay = 0;
    game.enemies.length = 0;
    game.bullets.length = 0;

    if (waveNumber >= 5) unlockAchievement("wave_5");

    showToast("WAVE " + waveNumber + " // " + game.waveTotal + " SIGNALS", "wave", 2200);
    Sound.play("wave");
    syncHud();
  }

  function pickEnemyType(waveNumber) {
    const pool = [["drone", Math.max(1.2, 7 - waveNumber * 0.28)]];

    if (waveNumber >= 2) pool.push(["lancer", 1.4 + waveNumber * 0.12]);
    if (waveNumber >= 3) pool.push(["splitter", 1.1 + waveNumber * 0.1]);
    if (waveNumber >= 4) pool.push(["warden", 0.7 + waveNumber * 0.08]);

    let total = 0;
    for (const entry of pool) total += entry[1];

    let roll = Math.random() * total;
    for (const entry of pool) {
      roll -= entry[1];
      if (roll <= 0) return entry[0];
    }

    return "drone";
  }

  function spawnEnemy() {
    const type = pickEnemyType(game.wave);
    const def = ENEMY_DEFS[type];
    const orbitAngle = rand(0, TAU);
    const orbitRadius = def.orbit + rand(-14, 14);
    const hpBonus = Math.floor((game.wave - 1) / 4);
    const maxHp = def.hp + hpBonus;

    const enemy = {
      id: ++game.nextEnemyId,
      type,
      color: def.color,
      radius: def.radius,
      hp: maxHp,
      maxHp,
      angle: orbitAngle,
      baseOrbit: orbitRadius,
      orbit: orbitRadius,
      orbitSpeed: (Math.random() < 0.5 ? -1 : 1) * def.orbitSpeed * rand(0.8, 1.2),
      x: Math.cos(orbitAngle) * orbitRadius,
      y: Math.sin(orbitAngle) * orbitRadius,
      fireRate: def.fireRate * Math.max(0.66, 1 - game.wave * 0.022),
      fireTimer: rand(1.15, 2.3),
      bulletSpeed: def.bulletSpeed * (1 + Math.min(0.28, game.wave * 0.012)),
      spawnT: 0,
      rotation: rand(0, TAU),
      spin: def.spin * rand(0.75, 1.25),
      phase: rand(0, TAU),
      bobSpeed: rand(0.6, 1.4),
      bobAmp: rand(4, 14),
      hitFlash: 0
    };

    game.enemies.push(enemy);
    addRing(enemy.x, enemy.y, enemy.color, enemy.radius * 2.8, 1.5, 0.42);
  }

  function enemyFire(enemy) {
    if (state !== "playing") return;

    const aim = Math.atan2(-enemy.y, -enemy.x);

    if (enemy.type === "warden") {
      for (let offset = -1; offset <= 1; offset++) {
        spawnEnemyBullet(
          enemy.x,
          enemy.y,
          aim + offset * 0.17,
          enemy.bulletSpeed,
          6,
          "normal"
        );
      }
    } else if (enemy.type === "splitter") {
      spawnEnemyBullet(enemy.x, enemy.y, aim, enemy.bulletSpeed, 8, "split");
    } else if (enemy.type === "lancer") {
      spawnEnemyBullet(enemy.x, enemy.y, aim + rand(-0.025, 0.025), enemy.bulletSpeed, 5.5, "fast");
    } else {
      spawnEnemyBullet(enemy.x, enemy.y, aim + rand(-0.03, 0.03), enemy.bulletSpeed, 6, "normal");
    }

    enemy.fireTimer = enemy.fireRate * rand(0.82, 1.18);
    burst(enemy.x, enemy.y, enemy.color, 4, 60, 2);
  }

  function spawnEnemyBullet(x, y, angle, speed, radius, kind) {
    const color = kind === "split"
      ? "#b48cff"
      : kind === "shard"
        ? "#d0b8ff"
        : kind === "fast"
          ? "#ff9a62"
          : "#ff4fa3";

    game.bullets.push({
      x,
      y,
      prevX: x,
      prevY: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: radius,
      color,
      owner: "enemy",
      kind,
      splitAt: kind === "split" ? 185 : 0,
      damage: 1,
      ttl: 8,
      trail: [],
      hitIds: null,
      pierce: 0
    });
  }

  function splitEnemyBullet(bullet) {
    const baseAngle = Math.atan2(-bullet.y, -bullet.x);
    const speed = Math.hypot(bullet.vx, bullet.vy) * 0.95;

    for (let offset = -1; offset <= 1; offset++) {
      spawnEnemyBullet(
        bullet.x,
        bullet.y,
        baseAngle + offset * 0.33,
        speed,
        4.5,
        "shard"
      );
    }

    addRing(bullet.x, bullet.y, "#b48cff", 58, 2, 0.35);
    burst(bullet.x, bullet.y, "#b48cff", 13, 130, 2.5);
  }

  /* ============================================================
     Main update loop
     ============================================================ */

  function update(dt) {
    const timeScale = game.slowmo > 0 ? 0.35 : 1;
    const scaledDt = dt * timeScale;

    game.slowmo = Math.max(0, game.slowmo - dt);
    game.time += scaledDt;
    game.runTime += dt;
    game.shake = Math.max(0, game.shake - dt * 42);
    game.shieldFlash = Math.max(0, game.shieldFlash - dt * 5.5);
    game.damageFlash = Math.max(0, game.damageFlash - dt * 3.2);
    game.novaFlash = Math.max(0, game.novaFlash - dt * 2.2);

    let turn = 0;
    if (keys.has("ArrowLeft") || keys.has("KeyA")) turn -= 1;
    if (keys.has("ArrowRight") || keys.has("KeyD")) turn += 1;
    if (turn) game.aimAngle += turn * 3.2 * dt;

    const aimDelta = angleDiff(game.aimAngle, game.shieldAngle);
    game.shieldAngle += aimDelta * Math.min(1, dt * 26);

    if (game.combo > 0) {
      game.comboTimer -= scaledDt;
      if (game.comboTimer <= 0) {
        game.combo = 0;
        game.comboTimer = 0;
      }
    }

    if (game.pendingUpgrade) {
      game.upgradeDelay -= dt;
      if (game.upgradeDelay <= 0) {
        openUpgrade();
        return;
      }
    }

    if (game.waveActive) {
      const maxActive = 2 + Math.ceil(game.wave * 0.7);
      game.spawnTimer -= scaledDt;

      if (
        game.spawnRemaining > 0 &&
        game.spawnTimer <= 0 &&
        game.enemies.length < maxActive
      ) {
        spawnEnemy();
        game.spawnRemaining--;
        game.spawnTimer = game.spawnInterval * rand(0.75, 1.25);
      }
    }

    updateEnemies(scaledDt);
    updateBullets(scaledDt);

    if (state !== "playing") return;

    updateParticles(scaledDt);
    updateTexts(scaledDt);
    updateRings(scaledDt);

    if (
      game.waveActive &&
      game.spawnRemaining <= 0 &&
      game.enemies.length === 0
    ) {
      completeWave();
    }

    syncHud();
  }

  function updateEnemies(dt) {
    for (const enemy of game.enemies) {
      enemy.spawnT += dt;
      enemy.rotation += enemy.spin * dt;
      enemy.angle += enemy.orbitSpeed * dt;
      enemy.orbit = enemy.baseOrbit + Math.sin(game.time * enemy.bobSpeed + enemy.phase) * enemy.bobAmp;
      enemy.x = Math.cos(enemy.angle) * enemy.orbit;
      enemy.y = Math.sin(enemy.angle) * enemy.orbit;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt * 7);

      if (enemy.spawnT > 0.9) {
        enemy.fireTimer -= dt;
        if (enemy.fireTimer <= 0) enemyFire(enemy);
      }
    }
  }

  function steerDeflectedBullet(bullet, dt) {
    if (!bullet.homing) return;

    const speed = Math.hypot(bullet.vx, bullet.vy);
    if (!speed) return;

    let target = null;
    let bestScore = Infinity;

    for (const enemy of game.enemies) {
      const dx = enemy.x - bullet.x;
      const dy = enemy.y - bullet.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 300) continue;

      const alignment = (dx * bullet.vx + dy * bullet.vy) / (distance * speed);
      if (alignment < 0.15) continue;

      const score = distance * (1.4 - alignment);
      if (score < bestScore) {
        bestScore = score;
        target = enemy;
      }
    }

    if (!target) return;

    const desired = Math.atan2(target.y - bullet.y, target.x - bullet.x);
    const current = Math.atan2(bullet.vy, bullet.vx);
    const turn = clamp(angleDiff(desired, current), -bullet.homing * dt, bullet.homing * dt);
    const nextAngle = current + turn;

    bullet.vx = Math.cos(nextAngle) * speed;
    bullet.vy = Math.sin(nextAngle) * speed;
  }

  function updateBullets(dt) {
    for (let i = game.bullets.length - 1; i >= 0; i--) {
      const bullet = game.bullets[i];

      bullet.prevX = bullet.x;
      bullet.prevY = bullet.y;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.ttl -= dt;

      bullet.trail.unshift({ x: bullet.x, y: bullet.y });
      if (bullet.trail.length > 6) bullet.trail.pop();

      const dist = Math.hypot(bullet.x, bullet.y);

      if (bullet.owner === "enemy") {
        if (bullet.splitAt && dist < bullet.splitAt) {
          splitEnemyBullet(bullet);
          game.bullets.splice(i, 1);
          continue;
        }

        const prevDist = Math.hypot(bullet.prevX, bullet.prevY);
        const bulletAngle = Math.atan2(bullet.y, bullet.x);
        const angularDistance = Math.abs(angleDiff(bulletAngle, game.shieldAngle));
        const insideShieldBand =
          dist <= game.shieldRadius + 14 &&
          prevDist >= game.shieldRadius - 14;

        if (insideShieldBand && angularDistance <= game.shieldHalf + 0.035) {
          deflectBullet(bullet, angularDistance);
          continue;
        }

        if (dist < CORE_RADIUS + bullet.r) {
          game.bullets.splice(i, 1);
          damageCore();
          if (state !== "playing") return;
          continue;
        }

        if (dist > 620 || bullet.ttl <= 0) {
          game.bullets.splice(i, 1);
        }
      } else {
        steerDeflectedBullet(bullet, dt);

        let removeBullet = bullet.ttl <= 0 || dist > 660;

        if (!removeBullet) {
          for (let j = game.enemies.length - 1; j >= 0; j--) {
            const enemy = game.enemies[j];
            if (!enemy) continue;
            if (bullet.hitIds && bullet.hitIds.has(enemy.id)) continue;

            const hitRadius = enemy.radius + bullet.r;
            const dx = enemy.x - bullet.x;
            const dy = enemy.y - bullet.y;

            if (dx * dx + dy * dy <= hitRadius * hitRadius) {
              if (bullet.hitIds) bullet.hitIds.add(enemy.id);
              damageEnemy(enemy, j, bullet.damage);

              if (bullet.pierce > 0) {
                bullet.pierce--;
              } else {
                removeBullet = true;
                break;
              }
            }
          }
        }

        if (removeBullet) game.bullets.splice(i, 1);
      }
    }
  }

  function deflectBullet(bullet, angularDistance) {
    const perfect = angularDistance <= game.perfectHalf;
    const impactAngle = Math.atan2(bullet.y, bullet.x);
    const speed = game.deflectSpeed * (perfect ? 1.12 : 1);

    bullet.owner = "player";
    bullet.kind = perfect ? "perfect" : "deflect";
    bullet.color = perfect ? "#ffd166" : "#5ff5ff";
    bullet.vx = Math.cos(game.shieldAngle) * speed;
    bullet.vy = Math.sin(game.shieldAngle) * speed;
    bullet.x = Math.cos(impactAngle) * game.shieldRadius;
    bullet.y = Math.sin(impactAngle) * game.shieldRadius;
    bullet.prevX = bullet.x;
    bullet.prevY = bullet.y;
    bullet.r = perfect ? 7 : 6;
    bullet.damage = game.deflectDamage + (perfect ? 1 : 0);
    bullet.pierce = game.pierce;
    bullet.homing = perfect ? 6.2 : 4.2;
    bullet.hitIds = new Set();
    bullet.ttl = 2.5;
    bullet.splitAt = 0;
    bullet.trail.length = 0;

    game.totalDeflects++;
    game.shieldFlash = perfect ? 1 : 0.6;
    game.shieldFlashColor = perfect ? "#ffd166" : "#5ff5ff";
    game.shake = Math.max(game.shake, perfect ? 6 : 2.5);

    addFlux((perfect ? 14 : 5) * game.fluxGain);
    addCombo(perfect ? 2 : 1);

    if (perfect) {
      const points = addScore(30);
      addText("PERFECT +" + points, bullet.x, bullet.y, "#ffd166", 22);
      addRing(bullet.x, bullet.y, "#ffd166", 62, 3, 0.45);
      burst(bullet.x, bullet.y, "#ffd166", 16, 180, 2.8);
    } else {
      addScore(8);
      addRing(bullet.x, bullet.y, "#5ff5ff", 38, 2, 0.3);
      burst(bullet.x, bullet.y, "#5ff5ff", 9, 120, 2.2);
    }

    Sound.play(perfect ? "perfect" : "deflect");
  }

  /* ============================================================
     Damage, scoring, and wave completion
     ============================================================ */

  function damageEnemy(enemy, index, amount) {
    if (!game.enemies.includes(enemy)) return;

    enemy.hp -= amount;
    enemy.hitFlash = 1;
    burst(enemy.x, enemy.y, enemy.color, 7, 120, 2.4);

    if (enemy.hp > 0) {
      game.shake = Math.max(game.shake, 3);
      Sound.play("hit");
      return;
    }

    const def = ENEMY_DEFS[enemy.type];
    game.enemies.splice(index, 1);
    game.totalKills++;

    addCombo(1);
    const points = addScore(def.score);
    addFlux(9 * game.fluxGain);
    addText("+" + points, enemy.x, enemy.y, enemy.color, 18);
    addRing(enemy.x, enemy.y, enemy.color, enemy.radius * 4.2, 3, 0.55);
    burst(enemy.x, enemy.y, enemy.color, 26, 220, 3.8);

    game.shake = Math.max(game.shake, 9);
    Sound.play("kill");

    if (game.totalKills === 1) unlockAchievement("first_blood");
  }

  function damageCore() {
    game.health = Math.max(0, game.health - 1);
    game.damageThisWave = true;
    game.combo = 0;
    game.comboTimer = 0;
    game.damageFlash = 1;
    game.shake = Math.max(game.shake, 26);

    flashScreen("hit");
    addRing(0, 0, "#ff4d6d", 110, 5, 0.65);
    burst(0, 0, "#ff4d6d", 34, 260, 4.5);
    Sound.play("damage");

    syncHud();

    if (game.health <= 0) endGame();
  }

  function activateNova() {
    if (state !== "playing" || game.flux < 100) return;

    game.flux = 0;
    game.novaUses++;
    game.novaFlash = 1;
    game.shake = Math.max(game.shake, 20);

    Sound.play("nova");
    flashScreen("nova");
    addRing(0, 0, "#5ff5ff", ARENA_RADIUS * 1.08, 8, 0.95);
    addRing(0, 0, "#ff4fa3", ARENA_RADIUS * 0.82, 6, 0.75);
    burst(0, 0, "#5ff5ff", 52, 380, 4.6);

    for (let i = game.bullets.length - 1; i >= 0; i--) {
      const bullet = game.bullets[i];
      if (bullet.owner === "enemy") {
        burst(bullet.x, bullet.y, bullet.color, 6, 110, 2);
        addScore(3);
        game.bullets.splice(i, 1);
      }
    }

    for (let i = game.enemies.length - 1; i >= 0; i--) {
      damageEnemy(game.enemies[i], i, game.novaDamage);
    }

    if (game.novaUses >= 3) unlockAchievement("nova_trio");
    syncHud();
  }

  function addFlux(amount) {
    const wasReady = game.flux >= 100;
    game.flux = clamp(game.flux + amount, 0, 100);

    if (!wasReady && game.flux >= 100 && state === "playing") {
      Sound.play("ready");
      showToast("NOVA READY // SPACE TO DETONATE", "nova", 1700);
    }
  }

  function addCombo(amount) {
    game.combo += amount;
    game.comboTimer = 2.8;
    if (game.combo > game.comboBest) game.comboBest = game.combo;
    if (game.combo >= 10) unlockAchievement("chain_10");
  }

  function addScore(amount) {
    const points = Math.round(amount * getMultiplier());
    game.score += points;
    if (game.score >= 10000) unlockAchievement("score_10k");
    return points;
  }

  function completeWave() {
    if (!game.waveActive) return;

    game.waveActive = false;

    if (!game.damageThisWave) unlockAchievement("perfect_wave");

    const bonus = addScore(80 + game.wave * 35);
    addFlux(28 * game.fluxGain);
    game.pendingUpgrade = true;
    game.upgradeDelay = 1.25;

    showToast("WAVE CLEAR // +" + bonus + " PTS", "wave", 2200);
    Sound.play("wave");
    syncHud();
  }

  /* ============================================================
     Particle and feedback effects
     ============================================================ */

  function burst(x, y, color, count, speed, life) {
    for (let i = 0; i < count; i++) {
      const angle = rand(0, TAU);
      const velocity = rand(speed * 0.15, speed);
      const maxLife = rand(life * 0.55, life);

      game.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: maxLife,
        maxLife,
        size: rand(1.2, 3.6),
        color,
        drag: rand(1.1, 2.5)
      });
    }
  }

  function addRing(x, y, color, maxRadius, width, life) {
    game.rings.push({
      x,
      y,
      color,
      radius: 0,
      maxRadius,
      width,
      life,
      maxLife: life
    });
  }

  function addText(text, x, y, color, size) {
    game.texts.push({
      text,
      x,
      y,
      color,
      size: size || 16,
      life: 1,
      maxLife: 1
    });
  }

  function updateParticles(dt) {
    for (let i = game.particles.length - 1; i >= 0; i--) {
      const particle = game.particles[i];
      particle.life -= dt;

      if (particle.life <= 0) {
        game.particles.splice(i, 1);
        continue;
      }

      const drag = Math.max(0, 1 - particle.drag * dt);
      particle.vx *= drag;
      particle.vy *= drag;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
  }

  function updateTexts(dt) {
    for (let i = game.texts.length - 1; i >= 0; i--) {
      const text = game.texts[i];
      text.life -= dt;
      text.y -= 30 * dt;

      if (text.life <= 0) game.texts.splice(i, 1);
    }
  }

  function updateRings(dt) {
    for (let i = game.rings.length - 1; i >= 0; i--) {
      const ring = game.rings[i];
      ring.life -= dt;

      if (ring.life <= 0) {
        game.rings.splice(i, 1);
        continue;
      }

      const progress = 1 - ring.life / ring.maxLife;
      ring.radius = ring.maxRadius * easeOutCubic(progress);
    }
  }

  /* ============================================================
     Rendering
     ============================================================ */

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const time = state === "menu" ? menuTime : game.time;
    drawBackdrop(time);

    ctx.save();

    if (state === "menu") {
      drawMenuScene(time);
    } else {
      const shakeX = REDUCED_MOTION ? 0 : (Math.random() - 0.5) * game.shake;
      const shakeY = REDUCED_MOTION ? 0 : (Math.random() - 0.5) * game.shake;
      ctx.translate(cx + shakeX, cy + shakeY);
      ctx.scale(viewScale, viewScale);

      drawArena(time);
      drawCore(time);
      drawShield(time);
      drawEnemies(time);
      drawBullets();
      drawParticles();
      drawRings();
      drawTexts();
    }

    ctx.restore();
  }

  function drawBackdrop(time) {
    ctx.fillStyle = bgGrad || "#04060d";
    ctx.fillRect(0, 0, W, H);

    if (glowA) {
      ctx.fillStyle = glowA;
      ctx.fillRect(0, 0, W, H);
    }
    if (glowB) {
      ctx.fillStyle = glowB;
      ctx.fillRect(0, 0, W, H);
    }

    for (const star of stars) {
      const twinkle = 0.55 + 0.45 * Math.sin(time * star.tw + star.ph);
      ctx.globalAlpha = star.a * twinkle;
      ctx.fillStyle = star.color;
      ctx.beginPath();
      ctx.arc(
        star.x + Math.sin(time * star.drift + star.ph) * 3,
        star.y + Math.cos(time * star.drift * 0.7 + star.ph) * 2,
        star.r,
        0,
        TAU
      );
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  function drawArena(time) {
    const radius = ARENA_RADIUS;

    const floor = ctx.createRadialGradient(0, 0, CORE_RADIUS, 0, 0, radius);
    floor.addColorStop(0, "rgba(20, 58, 86, 0.42)");
    floor.addColorStop(0.55, "rgba(7, 23, 41, 0.24)");
    floor.addColorStop(1, "rgba(3, 8, 17, 0)");

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.fillStyle = floor;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, radius - 2, 0, TAU);
    ctx.clip();

    ctx.strokeStyle = "rgba(95, 245, 255, 0.055)";
    ctx.lineWidth = 1;
    const gridStep = 64;
    for (let x = -radius; x <= radius; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, -radius);
      ctx.lineTo(x, radius);
      ctx.stroke();
    }
    for (let y = -radius; y <= radius; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(-radius, y);
      ctx.lineTo(radius, y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(95, 245, 255, 0.19)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = "rgba(95, 245, 255, 0.06)";
    ctx.lineWidth = 1;
    for (let ring = 1; ring <= 3; ring++) {
      ctx.beginPath();
      ctx.arc(0, 0, radius * (ring / 4), 0, TAU);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255, 79, 163, 0.2)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * TAU;
      const inner = radius - (i % 4 === 0 ? 14 : 6);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      ctx.stroke();
    }

    const danger = game.health <= 2 ? 0.5 + 0.5 * Math.sin(time * 5) : 0;
    ctx.strokeStyle = "rgba(255, 77, 109, " + (0.1 + danger * 0.4) + ")";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 8, 0, TAU);
    ctx.stroke();

    if (game.novaFlash > 0) {
      ctx.strokeStyle = "rgba(95, 245, 255, " + (game.novaFlash * 0.55) + ")";
      ctx.lineWidth = 4 + game.novaFlash * 9;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 4, 0, TAU);
      ctx.stroke();
    }
  }

  function drawCore(time) {
    const healthRatio = game.maxHealth ? game.health / game.maxHealth : 0;
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
    const danger = game.health <= 2;
    const coreColor = danger ? "#ff4d6d" : "#5ff5ff";

    ctx.save();
    ctx.shadowColor = coreColor;
    ctx.shadowBlur = 24 + pulse * 16;
    ctx.strokeStyle = coreColor;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.42;
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS + 16 + pulse * 5, 0, TAU);
    ctx.stroke();

    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS + 36 + pulse * 9, 0, TAU);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.rotate(time * 0.45);
    ctx.strokeStyle = coreColor;
    ctx.lineWidth = 1.6;
    ctx.shadowColor = coreColor;
    ctx.shadowBlur = 14;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * TAU;
      const x = Math.cos(angle) * (CORE_RADIUS + 4);
      const y = Math.sin(angle) * (CORE_RADIUS + 4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    const coreGrad = ctx.createRadialGradient(-7, -8, 2, 0, 0, CORE_RADIUS);
    coreGrad.addColorStop(0, "#ffffff");
    coreGrad.addColorStop(0.16, danger ? "#ff9aab" : "#c9fbff");
    coreGrad.addColorStop(0.55, coreColor);
    coreGrad.addColorStop(1, danger ? "#5f1024" : "#073445");

    ctx.save();
    ctx.shadowColor = coreColor;
    ctx.shadowBlur = 26;
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS - 7, 0, TAU);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS + 8, -Math.PI * 0.8, -Math.PI * 0.2);
    ctx.stroke();

    if (danger) {
      ctx.fillStyle = "rgba(255, 77, 109, " + (0.1 + pulse * 0.2) + ")";
      ctx.beginPath();
      ctx.arc(0, 0, CORE_RADIUS + 50 + pulse * 12, 0, TAU);
      ctx.fill();
    }

    const healthArc = TAU * healthRatio;
    ctx.strokeStyle = healthRatio > 0.5 ? "#5ff5ff" : danger ? "#ff4d6d" : "#ffd166";
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(0, 0, CORE_RADIUS + 28, -Math.PI / 2, -Math.PI / 2 + healthArc);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawShield(time) {
    const radius = game.shieldRadius;
    const half = game.shieldHalf;
    const angle = game.shieldAngle;
    const flash = game.shieldFlash;
    const color = flash > 0 ? game.shieldFlashColor : "#5ff5ff";

    ctx.save();
    ctx.lineCap = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = 18 + flash * 30;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.14 + flash * 0.25;
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.arc(0, 0, radius, angle - half, angle + half);
    ctx.stroke();

    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, angle - half, angle + half);
    ctx.stroke();

    ctx.shadowBlur = 10;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 7, angle - half + 0.02, angle + half - 0.02);
    ctx.stroke();

    ctx.strokeStyle = "#ffd166";
    ctx.globalAlpha = 0.75;
    ctx.shadowColor = "#ffd166";
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 1, angle - game.perfectHalf, angle + game.perfectHalf);
    ctx.stroke();

    ctx.globalAlpha = 0.32;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 13, angle - half, angle - game.perfectHalf);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius - 13, angle + game.perfectHalf, angle + half);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    for (const edge of [-1, 1]) {
      const edgeAngle = angle + half * edge;
      ctx.beginPath();
      ctx.moveTo(Math.cos(edgeAngle) * (radius - 9), Math.sin(edgeAngle) * (radius - 9));
      ctx.lineTo(Math.cos(edgeAngle) * (radius + 9), Math.sin(edgeAngle) * (radius + 9));
      ctx.stroke();
    }

    ctx.globalAlpha = 0.18 + flash * 0.25;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, radius, angle - half, angle + half);
    ctx.arc(0, 0, radius - 16, angle + half, angle - half, true);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    if (state === "playing") {
      const markerRadius = radius + 21;
      ctx.save();
      ctx.translate(Math.cos(angle) * markerRadius, Math.sin(angle) * markerRadius);
      ctx.rotate(angle);
      ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(-4, -4);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawEnemies(time) {
    for (const enemy of game.enemies) {
      const spawnScale = easeOutCubic(clamp(enemy.spawnT / 0.55, 0, 1));
      const r = enemy.radius;

      ctx.save();
      ctx.translate(enemy.x, enemy.y);
      ctx.rotate(enemy.rotation);
      ctx.scale(spawnScale, spawnScale);

      ctx.shadowColor = enemy.color;
      ctx.shadowBlur = enemy.hitFlash > 0 ? 30 : 15;
      ctx.strokeStyle = enemy.hitFlash > 0.1 ? "#ffffff" : enemy.color;
      ctx.fillStyle = enemy.hitFlash > 0.1 ? "rgba(255,255,255,0.75)" : "rgba(4, 10, 20, 0.88)";
      ctx.lineWidth = 2;

      if (enemy.type === "drone") {
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.9, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 0.9, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, -r * 0.45);
        ctx.lineTo(r * 0.4, 0);
        ctx.lineTo(0, r * 0.45);
        ctx.lineTo(-r * 0.4, 0);
        ctx.closePath();
        ctx.stroke();
      } else if (enemy.type === "lancer") {
        ctx.beginPath();
        ctx.moveTo(r * 0.9, 0);
        ctx.lineTo(-r * 0.65, -r * 0.75);
        ctx.lineTo(-r * 0.2, 0);
        ctx.lineTo(-r * 0.65, r * 0.75);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(r * 0.55, 0);
        ctx.lineTo(-r * 0.25, 0);
        ctx.stroke();
      } else if (enemy.type === "splitter") {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * TAU;
          const px = Math.cos(angle) * r;
          const py = Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, r * 0.46, 0, TAU);
        ctx.stroke();

        ctx.fillStyle = enemy.color;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.16, 0, TAU);
        ctx.fill();
      } else {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * TAU;
          const radius = i % 2 === 0 ? r : r * 0.74;
          const px = Math.cos(angle) * radius;
          const py = Math.sin(angle) * radius;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, r * 0.36, 0, TAU);
        ctx.stroke();
      }

      ctx.restore();

      if (enemy.hp < enemy.maxHp) {
        const width = r * 1.8;
        const ratio = clamp(enemy.hp / enemy.maxHp, 0, 1);
        const y = enemy.y - r - 12;

        ctx.fillStyle = "rgba(2, 6, 13, 0.82)";
        ctx.fillRect(enemy.x - width / 2, y, width, 4);
        ctx.fillStyle = enemy.color;
        ctx.fillRect(enemy.x - width / 2, y, width * ratio, 4);
      }

      if (enemy.type === "warden") {
        ctx.strokeStyle = "rgba(255, 209, 102, " + (0.12 + 0.08 * Math.sin(time * 3 + enemy.phase)) + ")";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, r + 10 + Math.sin(time * 2 + enemy.phase) * 3, 0, TAU);
        ctx.stroke();
      }
    }
  }

  function drawBullets() {
    ctx.save();
    ctx.lineCap = "round";

    for (const bullet of game.bullets) {
      if (bullet.trail.length > 1) {
        ctx.globalAlpha = bullet.owner === "player" ? 0.3 : 0.22;
        ctx.strokeStyle = bullet.color;
        ctx.lineWidth = bullet.r * 0.8;
        ctx.beginPath();
        ctx.moveTo(bullet.x, bullet.y);
        for (const point of bullet.trail) {
          ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.shadowColor = bullet.color;
      ctx.shadowBlur = bullet.owner === "player" ? 18 : 12;
      ctx.fillStyle = bullet.color;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.r, 0, TAU);
      ctx.fill();

      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.r * 0.38, 0, TAU);
      ctx.fill();

      if (bullet.kind === "split") {
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = "#d8c8ff";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, bullet.r + 4, 0, TAU);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    for (const particle of game.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * alpha, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRings() {
    ctx.save();
    for (const ring of game.rings) {
      const alpha = clamp(ring.life / ring.maxLife, 0, 1);
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.width * alpha;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, Math.max(1, ring.radius), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTexts() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const text of game.texts) {
      const alpha = clamp(text.life / text.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = text.color;
      ctx.font = '800 ' + text.size + 'px "Bahnschrift", "Segoe UI", sans-serif';
      ctx.shadowColor = text.color;
      ctx.shadowBlur = 10;
      ctx.fillText(text.text, text.x, text.y);
    }
    ctx.restore();
  }

  function drawMenuScene(time) {
    ctx.translate(cx, cy);
    ctx.scale(viewScale, viewScale);

    drawArena(time * 0.35);
    drawCore(time * 0.6);

    ctx.save();
    ctx.rotate(time * 0.16);
    ctx.strokeStyle = "rgba(95, 245, 255, 0.15)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 14]);
    ctx.beginPath();
    ctx.arc(0, 0, game.shieldRadius + 28, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    for (let i = 0; i < 6; i++) {
      const angle = time * 0.22 + (i / 6) * TAU;
      const radius = 286 + Math.sin(time * 0.8 + i) * 10;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const color = i % 3 === 0 ? "#ff4fa3" : i % 3 === 1 ? "#5ff5ff" : "#b48cff";

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(time * 0.7 + i);
      ctx.strokeStyle = color;
      ctx.fillStyle = "rgba(4, 10, 20, 0.7)";
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(10, 0);
      ctx.lineTo(0, 11);
      ctx.lineTo(-10, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    const shieldAngle = -Math.PI / 2 + Math.sin(time * 0.45) * 0.75;
    ctx.save();
    ctx.rotate(shieldAngle + Math.PI / 2);
    ctx.strokeStyle = "rgba(95, 245, 255, 0.65)";
    ctx.shadowColor = "#5ff5ff";
    ctx.shadowBlur = 16;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, game.shieldRadius, -0.5, 0.5);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 209, 102, 0.6)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, game.shieldRadius, -0.12, 0.12);
    ctx.stroke();
    ctx.restore();
  }

  /* ============================================================
     Input and lifecycle
     ============================================================ */

  function updateAimFromEvent(event) {
    if (state !== "playing") return;

    const rect = ui.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;

    if (Math.hypot(x, y) < 14) return;

    game.aimAngle = Math.atan2(y, x);
    hideAimHint();
  }

  function bindInput() {
    window.addEventListener("pointermove", updateAimFromEvent, { passive: true });

    ui.canvas.addEventListener("pointerdown", (event) => {
      Sound.init();
      Sound.resume();
      updateAimFromEvent(event);
    });

    ui.canvas.addEventListener("touchmove", (event) => {
      event.preventDefault();
    }, { passive: false });

    ui.canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });

    window.addEventListener("keydown", (event) => {
      const code = event.code;

      if (event.repeat && (code === "Space" || code === "KeyP" || code === "Escape" || code === "KeyM")) {
        return;
      }

      if (code === "Space") {
        if (state === "playing") {
          event.preventDefault();
          activateNova();
        }
        return;
      }

      if (code === "KeyP" || code === "Escape") {
        if (state === "playing") {
          event.preventDefault();
          pauseGame();
        } else if (state === "paused") {
          event.preventDefault();
          resumeGame();
        }
        return;
      }

      if (code === "KeyM") {
        event.preventDefault();
        toggleMute();
        return;
      }

      if (state === "playing") {
        if (
          code === "ArrowLeft" ||
          code === "ArrowRight" ||
          code === "KeyA" ||
          code === "KeyD"
        ) {
          event.preventDefault();
          keys.add(code);
        }
      }
    });

    window.addEventListener("keyup", (event) => {
      keys.delete(event.code);
    });

    window.addEventListener("blur", () => {
      if (state === "playing") pauseGame();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state === "playing") pauseGame();
    });

    window.addEventListener("resize", resize);

    ui.playBtn.addEventListener("click", startRun);
    ui.againBtn.addEventListener("click", startRun);
    ui.resumeBtn.addEventListener("click", resumeGame);
    ui.pauseBtn.addEventListener("click", pauseGame);
    ui.pauseRestartBtn.addEventListener("click", startRun);
    ui.pauseMenuBtn.addEventListener("click", goToMenu);
    ui.menuBtn.addEventListener("click", goToMenu);
    ui.shareBtn.addEventListener("click", shareRun);
    ui.muteBtn.addEventListener("click", toggleMute);
    ui.novaBtn.addEventListener("click", activateNova);
  }

  function loop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;

    if (state === "menu") menuTime += dt;
    if (state === "playing") update(dt);

    render();
    requestAnimationFrame(loop);
  }

  function init() {
    resize();
    updateBestUI();
    updateMuteBtn();
    renderAchievements();
    buildHealthPips();
    Sound.setMuted(muted);
    bindInput();
    setState("menu");

    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  init();
})();





