/* ============================================================
 *   星海谣 · Starlight Bloom   主游戏逻辑
 *   操控星舟拾取星屑，避开暗云与陨星，穿越一重又一重星域
 * ============================================================ */
var Game = (function () {
  /* 逻辑世界：高度固定 600 保证纵向玩法一致（下落距离、难度节奏不变），
     宽度随视口比例自适应，从而铺满任意屏幕而不裁掉游戏内容。 */
  var BASE_H = 600;
  var W = 960, H = BASE_H;
  var W_MIN = 820, W_MAX = 1400;
  var cv, ctx, dpr = 1, view = 1, ox = 0, oy = 0, vw = W, vh = H;
  var booted = false;                 // 结构性初始化只做一次
  var painting = false;               // 主循环是否已在稳定出画

  var state = 'idle';                 // idle | playing | paused | over
  var user = null;
  var lastTime = 0, rafId = 0;

  /* ---------------- 数据模型 ---------------- */
  /* 全部给出合法的初始值。绘制函数会在 enter 之前被调用（首屏补画），
     任何 undefined / 0 / 负数进入绘制路径都可能让 draw() 抛错并导致画面永久卡死。 */
  var player = { x: W / 2, y: H - 110, r: 20, trail: [], glow: 0 };
  var drops = [], foes = [], parts = [], pops = [], bgStars = [], nebulas = [];
  var score = 0, life = 3, maxLife = 3, level = 1, levelScore = 0;
  var goal = 300, comboCount = 0, comboTimer = 0, mult = 1;
  var statStars = 0, spawnTimer = 99999, invincible = 0, shakeT = 0, shakeMag = 0, flash = 0, timeScale = 1;
  var buffs = { shield: 0, slow: 0, magnet: 0 };
  var clock = 0, shineT = 0;

  /* ---------------- 工具 ---------------- */
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  var TAU = Math.PI * 2;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 音效（WebAudio 合成，无外部资源） ---------------- */
  var Sound = (function () {
    var ac = null, master = null, musicTimer = null, on = true;
    function ctxOf() {
      if (!ac) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.5;
        master.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(freq, dur, type, vol, slideTo) {
      if (!on) return;
      var a = ctxOf(); if (!a) return;
      var o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, a.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
      g.gain.setValueAtTime(0.0001, a.currentTime);
      g.gain.exponentialRampToValueAtTime(vol || 0.16, a.currentTime + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      o.connect(g); g.connect(master);
      o.start(); o.stop(a.currentTime + dur + 0.02);
    }
    function noise(dur, vol) {
      if (!on) return;
      var a = ctxOf(); if (!a) return;
      var len = Math.floor(a.sampleRate * dur);
      var buf = a.createBuffer(1, len, a.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = a.createBufferSource(); src.buffer = buf;
      var f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      var g = a.createGain(); g.gain.value = vol || 0.2;
      src.connect(f); f.connect(g); g.connect(master);
      src.start();
    }
    var SCALE = [587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];
    return {
      setOn: function (v) { on = v; if (!v && musicTimer) { clearInterval(musicTimer); musicTimer = null; } },
      isOn: function () { return on; },
      pick: function (mult) { tone(660 * (1 + mult * .18), .18, 'sine', .13); tone(1320, .1, 'triangle', .05); },
      core: function () { tone(880, .22, 'triangle', .14); tone(1320, .26, 'sine', .1); tone(1760, .18, 'sine', .05); },
      power: function () { tone(520, .3, 'sine', .13, 1040); tone(1040, .34, 'triangle', .07); },
      hurt: function () { noise(.34, .26); tone(120, .35, 'sawtooth', .14, 60); },
      level: function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { tone(f, .5, 'sine', .12); }, i * 95); }); },
      over: function () { [440, 392, 330, 262].forEach(function (f, i) { setTimeout(function () { tone(f, .6, 'sine', .13); }, i * 150); }); },
      startMusic: function () {
        if (musicTimer || !on) return;
        musicTimer = setInterval(function () {
          if (state !== 'playing' || !on) return;
          var f = SCALE[Math.floor(Math.random() * SCALE.length)];
          tone(f / 2, 1.6, 'sine', .045);
          if (Math.random() < .5) tone(f, 1.4, 'sine', .028);
        }, 1150);
      },
      stopMusic: function () { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
    };
  })();

  /* ---------------- 输入 ---------------- */
  var input = { x: W / 2, y: H - 110, hasPointer: false, kx: 0, ky: 0 };

  function bindInput() {
    if (!cv) return;
    cv.addEventListener('mousemove', function (e) {
      var r = cv.getBoundingClientRect();
      input.x = (e.clientX - r.left - ox) / view;
      input.y = (e.clientY - r.top - oy) / view;
      input.hasPointer = true;
      wakeHud();
    });
    cv.addEventListener('mouseleave', function () { input.hasPointer = false; });
    cv.addEventListener('touchmove', function (e) {
      e.preventDefault();
      var t = e.touches[0], r = cv.getBoundingClientRect();
      input.x = (t.clientX - r.left - ox) / view;
      input.y = (t.clientY - r.top - oy) / view;
      input.hasPointer = true;
    }, { passive: false });

    document.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { input.kx = -1; wakeHud(); }
      if (k === 'ArrowRight' || k === 'd' || k === 'D') { input.kx = 1; wakeHud(); }
      if (k === 'ArrowUp' || k === 'w' || k === 'W') { input.ky = -1; wakeHud(); }
      if (k === 'ArrowDown' || k === 's' || k === 'S') { input.ky = 1; wakeHud(); }
      if (k === 'Escape') {
        if (state === 'playing') pause(); else if (state === 'paused') resume();
      }
      if (k === ' ' || k === 'Spacebar') {
        if (state === 'idle') { e.preventDefault(); start(); }
        else if (state === 'over') { e.preventDefault(); start(); }
      }
      if (k === 'f' || k === 'F') { toggleFullscreen(); }
    });
    document.addEventListener('keyup', function (e) {
      var k = e.key;
      if (['ArrowLeft', 'a', 'A', 'ArrowRight', 'd', 'D'].indexOf(k) >= 0) input.kx = 0;
      if (['ArrowUp', 'w', 'W', 'ArrowDown', 's', 'S'].indexOf(k) >= 0) input.ky = 0;
    });
    window.addEventListener('blur', function () { if (state === 'playing') pause(); });
  }

  /* ---------------- HUD 自动淡出（全屏下减少遮挡） ---------------- */
  var hudIdle = 0, hudDimmed = false;
  function wakeHud() {
    hudIdle = 0;
    if (!hudDimmed) return;
    hudDimmed = false;
    var h = document.querySelector('.hud'), t = document.querySelector('.tips');
    if (h) h.classList.remove('dim');
    if (t) t.classList.remove('dim');
  }
  function tickHudFade(dt) {
    if (state !== 'playing') { wakeHud(); return; }
    if (hudDimmed) return;
    hudIdle += dt;
    if (hudIdle > 160) {          /* 约 2.7 秒无操作就淡出，让画面更沉浸 */
      hudDimmed = true;
      var h = document.querySelector('.hud'), t = document.querySelector('.tips');
      if (h) h.classList.add('dim');
      if (t) t.classList.add('dim');
    }
  }

  /* ---------------- 全屏切换 ---------------- */
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function toggleFullscreen() {
    try {
      var de = document.documentElement;
      if (!isFullscreen()) {
        var req = de.requestFullscreen || de.webkitRequestFullscreen;
        if (req) req.call(de);
      } else {
        var ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (ex) ex.call(document);
      }
    } catch (e) {}
  }
  function syncFullscreenBtn() {
    var b = $('btn-full');
    if (b) b.textContent = isFullscreen() ? '⛗' : '⛶';
    /* 全屏切换后尺寸会变，稍等一拍再校准 */
    setTimeout(resize, 120);
  }

  /* 背景星层按当前世界尺寸铺满；世界宽度变化（换屏幕 / 转全屏）时重建 */
  function rebuildSky() {
    bgStars = []; nebulas = [];
    var count = Math.round(130 * Math.max(1, W / 960));
    for (var i = 0; i < count; i++) {
      bgStars.push({
        x: rnd(0, W), y: rnd(0, H), r: rnd(.4, 1.9), a: rnd(.2, .9),
        sp: rnd(.12, .7), tw: rnd(0, TAU), ts: rnd(.01, .04),
        hue: Math.random() < .25 ? 320 : (Math.random() < .5 ? 190 : 215)
      });
    }
    for (var j = 0; j < 4; j++) {
      nebulas.push({
        x: rnd(0, W), y: rnd(0, H), r: rnd(180, 380),
        hue: [212, 268, 322, 190][j], a: rnd(.06, .14),
        dx: rnd(-.09, .09), dy: rnd(-.05, .05)
      });
    }
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    cv = $('game-canvas');
    if (!cv || !cv.getContext) return;
    ctx = cv.getContext('2d');
    if (booted) { resize(); return; }
    booted = true;
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 150); });
    document.addEventListener('fullscreenchange', syncFullscreenBtn);
    document.addEventListener('webkitfullscreenchange', syncFullscreenBtn);
    bindInput();

    player = { x: W / 2, y: H - 110, r: 20, trail: [], glow: 0 };
    drops = []; foes = []; parts = []; pops = [];
    rebuildSky();

    $('btn-start').addEventListener('click', start);
    $('btn-resume').addEventListener('click', resume);
    $('btn-restart').addEventListener('click', start);
    $('btn-again').addEventListener('click', start);
    $('btn-home').addEventListener('click', function () { window.Auth.logout(); });
    $('btn-pause').addEventListener('click', function () { state === 'playing' ? pause() : resume(); });
    $('btn-quit').addEventListener('click', function () { window.Auth.logout(); });
    $('btn-full').addEventListener('click', toggleFullscreen);
    /* HUD 自身也能唤醒淡出的状态 */
    var hudEl = document.querySelector('.hud');
    if (hudEl) {
      hudEl.addEventListener('mouseenter', wakeHud);
      hudEl.addEventListener('mousemove', wakeHud);
    }
    $('auto-full').addEventListener('change', function () {
      if (this.checked && !isFullscreen()) toggleFullscreen();
    });
    $('btn-sound').addEventListener('click', function () {
      var v = !Sound.isOn();
      Sound.setOn(v); Store.sound.set(v);
      $('btn-sound').textContent = v ? '♪' : '✕';
      $('btn-sound').style.opacity = v ? 1 : .45;
      if (v) Sound.startMusic(); else Sound.stopMusic();
    });

    Sound.setOn(Store.sound.get());
    $('btn-sound').textContent = Store.sound.get() ? '♪' : '✕';
    $('btn-sound').style.opacity = Store.sound.get() ? 1 : .45;

    /* 布局稳定后再校准一次画布尺寸（应对字体加载、缩放变化） */
    window.addEventListener('load', function () { setTimeout(resize, 120); });

    lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  /* 全屏模式：画布铺满整个视口，逻辑世界宽度随屏幕比例自适应 */
  function resize() {
    if (!cv) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    /* 全屏时 stage 就是整个视口；拿不到时用 window 兜底 */
    var st = cv.parentElement;
    var aw = st ? st.clientWidth : 0, ah = st ? st.clientHeight : 0;
    if (!aw || !ah) {
      aw = Math.max(window.innerWidth || 960, 320);
      ah = Math.max(window.innerHeight || 600, 240);
    }
    var w = Math.max(Math.round(aw), 320);
    var h = Math.max(Math.round(ah), 240);
    vw = w; vh = h;

    /* 逻辑世界：高度锁定 BASE_H，宽度按视口比例推出来，并夹到合理区间。
       这样画面正好铺满屏幕，且不裁掉任何游戏内容。 */
    var newW = clamp(Math.round(BASE_H * (w / h)), W_MIN, W_MAX);
    if (newW !== W || H !== BASE_H) {
      W = newW; H = BASE_H;
      if (booted) rebuildSky();
    }

    /* 世界铺满后按较小比例缩放并居中，极端比例下留极少量边也不影响观感 */
    view = Math.min(w / W, h / H);
    ox = (w - W * view) / 2; oy = (h - H * view) / 2;

    /* 幂等保护：尺寸没变就不要重新赋值 canvas.width/height。
       赋值该属性会清空画布并重置上下文，在动画帧之间触发就会闪黑/纯黑。 */
    var pw = Math.max(1, Math.round(w * dpr));
    var ph = Math.max(1, Math.round(h * dpr));
    var sizeChanged = (cv.width !== pw || cv.height !== ph);
    if (sizeChanged) {
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
      cv.width = pw;
      cv.height = ph;
    }
    ctx.setTransform(dpr * view, 0, 0, dpr * view, ox * dpr, oy * dpr);

    var padX = ox, padY = oy;
    var list = document.querySelectorAll('.overlay');
    for (var i = 0; i < list.length; i++) {
      list[i].style.inset = '0';
      list[i].style.left = '0';
      list[i].style.top = '0';
      list[i].style.width = w + 'px';
      list[i].style.height = h + 'px';
      list[i].style.borderRadius = '0';
      list[i].style.transform = 'none';
    }
    var bf = $('buffs');
    if (bf) { bf.style.left = (padX + 14) + 'px'; bf.style.bottom = (padY + 14) + 'px'; }
    var lb = $('level-banner');
    if (lb) {
      lb.style.left = padX + 'px'; lb.style.top = padY + 'px';
      lb.style.width = w + 'px'; lb.style.height = h + 'px';
    }
    /* 赋值 canvas.width/height 会清空画布；若此刻不在主循环内必须补画一帧，
       否则会出现「HUD 正常但游戏区纯黑」的现象 */
    if (sizeChanged && !painting && ctx) { try { draw(); } catch (e) {} }
  }

  /* ---------------- 关卡参数 ---------------- */
  function goalOf(lv) { return Math.round(300 + (lv - 1) * 210); }

  function palette(lv) {
    var sets = [
      { a: '#0a1030', b: '#151a4a', c: '#241a4e', n: [212, 268, 322, 190] },
      { a: '#08142e', b: '#10324e', c: '#132a55', n: [195, 250, 300, 180] },
      { a: '#160b2c', b: '#2a1148', c: '#3a1442', n: [280, 320, 250, 300] },
      { a: '#0b1a20', b: '#123a3c', c: '#1d2a4a', n: [170, 200, 320, 190] },
      { a: '#1a0f18', b: '#33132c', c: '#2a1540', n: [330, 290, 210, 260] }
    ];
    /* JS 取模对负数返回负值（-1 % 5 === -1），sets[负数] 会是 undefined，
       一旦 level 未被初始化就会让整个 draw() 每帧崩溃、画面永久卡死。
       这里强制归一到 [0, len) 区间。 */
    var i = (Math.floor(lv) - 1) % sets.length;
    if (!(i >= 0)) i = 0;
    return sets[i];
  }

  /* ---------------- 生成物 ---------------- */
  function spawnStar(x, y, kind) {
    var d = {
      kind: kind, x: x == null ? rnd(40, W - 40) : x, y: y == null ? -30 : y,
      rot: rnd(0, TAU), vy: 0, vx: 0, dead: false, born: 0
    };
    if (kind === 'star') { d.r = 9; d.vy = rnd(1.5, 2.6); d.score = 10; d.hue = 45; }
    else if (kind === 'core') { d.r = 12; d.vy = rnd(1.2, 2.0); d.score = 30; d.hue = 188; }
    else { d.r = 12; d.vy = rnd(1.6, 2.4); d.hue = kind === 'shield' ? 190 : (kind === 'slow' ? 268 : (kind === 'magnet' ? 322 : 350)); }
    d.vx = rnd(-.5, .5);
    drops.push(d);
  }

  function spawnFoe() {
    var isRock = Math.random() < (.35 + level * .03);
    var f = {
      kind: isRock ? 'rock' : 'cloud',
      x: rnd(50, W - 50), y: -40,
      vy: isRock ? rnd(2.6, 4.2) + level * .18 : rnd(1.6, 2.6) + level * .12,
      vx: rnd(-.7, .7), rot: rnd(0, TAU), rs: rnd(-.03, .03),
      phase: rnd(0, TAU), amp: isRock ? 0 : rnd(.5, 1.4)
    };
    f.r = isRock ? rnd(14, 20) : rnd(24, 34);
    foes.push(f);
  }

  function spawn(dt) {
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = Math.max(16, 52 - level * 3.2) * rnd(.75, 1.25);

    var r = Math.random();
    if (r < .60) spawnStar(null, -30, 'star');
    else if (r < .74) spawnStar(null, -30, 'core');
    else if (r < .79) spawnStar(null, -30, 'shield');
    else if (r < .83) spawnStar(null, -30, 'slow');
    else if (r < .87) spawnStar(null, -30, 'magnet');
    else if (r < .90 && life < maxLife) spawnStar(null, -30, 'heart');
    else spawnFoe();
  }

  /* ---------------- 粒子 ---------------- */
  function burst(x, y, hue, n, spd, life_) {
    for (var i = 0; i < n; i++) {
      var a = rnd(0, TAU), s = rnd(spd * .4, spd);
      parts.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 1, decay: rnd(.012, .03) * (life_ || 1),
        r: rnd(1.2, 3.4), hue: hue + rnd(-18, 18)
      });
    }
  }
  function pop(x, y, text, color) {
    pops.push({ x: x, y: y, text: text, color: color, life: 1 });
  }

  /* ---------------- 开始 / 暂停 / 结束 ---------------- */
  function start() {
    if (!cv) init();
    if (state === 'playing') return;
    resize();
    buffs.shield = 0; buffs.slow = 0; buffs.magnet = 0;
    score = 0; life = maxLife = 3; level = 1; levelScore = 0; goal = goalOf(1);
    comboCount = 0; comboTimer = 0; mult = 1; statStars = 0;
    spawnTimer = 30; invincible = 90; shakeT = 0; shakeMag = 0; flash = 0;
    timeScale = 1; clock = 0; shineT = 0;
    drops = []; foes = []; parts = []; pops = [];
    player.x = W / 2; player.y = H - 110; player.trail = [];
    input.x = W / 2; input.y = H - 110; input.hasPointer = false;

    $('overlay-start').classList.add('hidden');
    $('overlay-pause').classList.add('hidden');
    $('overlay-over').classList.add('hidden');
    $('level-banner').classList.add('hidden');
    state = 'playing';
    syncHud(true);
    renderBuffs();
    draw();
    /* 勾选了「自动全屏」就顺手进全屏（必须在用户点击的调用栈里，否则浏览器会拒绝） */
    var af = $('auto-full');
    if (af && af.checked && !isFullscreen()) toggleFullscreen();
    Sound.startMusic();
    if (window.Auth && Auth.toast) Auth.toast('起航！前往第一重星域', 'ok');
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    $('overlay-pause').classList.remove('hidden');
    Sound.stopMusic();
  }
  function resume() {
    if (state !== 'paused') return;
    state = 'playing';
    $('overlay-pause').classList.add('hidden');
    Sound.startMusic();
  }

  function gameOver() {
    state = 'over';
    Sound.stopMusic(); Sound.over();
    burst(player.x, player.y, 320, 46, 6, .6);
    flash = 1;
    var prev = user ? (user.best || 0) : 0;
    var isNew = user ? Store.submitScore(user.email, score, level) : false;
    $('res-score').textContent = score;
    $('res-level').textContent = level;
    $('res-star').textContent = statStars;
    $('res-best').textContent = '历史最高：' + Math.max(prev, score);
    $('res-new').textContent = isNew ? '✦ 新的个人纪录！星途更进一步' : '';
    $('over-title').textContent = isNew ? '你点亮了新的星图' : '这次夜航的尽头';
    if (user) {
      var fresh = Store.findUser(user.email);
      if (fresh) { $('hud-best').textContent = fresh.best; user.best = fresh.best; }
    }
    setTimeout(function () { $('overlay-over').classList.remove('hidden'); }, 700);
  }

  function hit(px, py) {
    if (invincible > 0) return;
    if (buffs.shield > 0) {
      buffs.shield = 0;
      Sound.power();
      burst(px, py, 190, 26, 5, .8);
      pop(px, py - 24, '护盾碎裂', '#9ff0ff');
      invincible = 40;
      return;
    }
    life--;
    comboCount = 0; mult = 1;
    shakeT = 22; shakeMag = 9; flash = .85; invincible = 110;
    Sound.hurt();
    burst(px, py, 350, 30, 5.5, .8);
    pop(player.x, player.y - 30, '-1 星命', '#ff9db1');
    syncHud(true);
    if (life <= 0) gameOver();
  }

  function levelUp() {
    level++;
    levelScore = 0;
    goal = goalOf(level);
    Sound.level();
    foes.length = 0;
    flash = .6;
    for (var i = 0; i < 60; i++) burst(rnd(0, W), rnd(0, H), rnd(180, 330), 1, 3, .5);
    pop(W / 2, H / 2 - 60, '第 ' + level + ' 重星域', '#ffe08a');
    var b = $('level-banner');
    $('lb-main').textContent = '第 ' + level + ' 重星域';
    b.classList.remove('hidden');
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(levelUp._t);
    levelUp._t = setTimeout(function () { b.classList.add('hidden'); }, 2100);
    syncHud(true);
  }

  /* ---------------- 更新 ---------------- */
  function update(dt) {
    clock += dt;
    timeScale += ((buffs.slow > 0 ? .45 : 1) - timeScale) * .12;
    var d = dt * timeScale;

    /* buff 计时 */
    if (buffs.shield > 0) buffs.shield -= dt;
    if (buffs.slow > 0) buffs.slow -= dt;
    if (buffs.magnet > 0) buffs.magnet -= dt;
    if (invincible > 0) invincible -= dt;
    if (shineT > 0) shineT -= dt;

    /* 玩家移动 */
    var tx = input.x, ty = input.y;
    if (input.kx || input.ky) {
      tx = player.x + input.kx * 90; ty = player.y + input.ky * 90;
      input.hasPointer = false;
    }
    if (input.hasPointer || input.kx || input.ky) {
      player.x += (clamp(tx, 26, W - 26) - player.x) * Math.min(.22 * dt, 1);
      player.y += (clamp(ty, 26, H - 26) - player.y) * Math.min(.22 * dt, 1);
    } else {
      player.x += (W / 2 - player.x) * .05 * dt;
      player.y += (H - 110 - player.y) * .05 * dt;
    }
    player.trail.push({ x: player.x, y: player.y, a: 1 });
    if (player.trail.length > 22) player.trail.shift();
    player.trail.forEach(function (t) { t.a *= .92; });
    player.glow = 1 + Math.sin(clock * .06) * .12;

    /* 背景 */
    bgStars.forEach(function (s) {
      s.y -= s.sp * d * (1 + level * .04);
      if (s.y < -3) { s.y = H + 3; s.x = rnd(0, W); }
      s.tw += s.ts * dt;
    });
    nebulas.forEach(function (n) {
      n.x += n.dx * d; n.y += n.dy * d;
      if (n.x < -n.r) n.x = W + n.r; if (n.x > W + n.r) n.x = -n.r;
      if (n.y < -n.r) n.y = H + n.r; if (n.y > H + n.r) n.y = -n.r;
    });

    spawn(dt);

    /* 掉落物 */
    var magR = buffs.magnet > 0 ? 230 : 105;
    for (var i = drops.length - 1; i >= 0; i--) {
      var o = drops[i];
      o.born += dt;
      o.y += o.vy * d;
      o.x += o.vx * d;
      o.rot += .035 * d;
      if (o.kind === 'star' || o.kind === 'core') {
        var dx = player.x - o.x, dy = player.y - o.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < magR) {
          var pull = (1 - dist / magR) * (buffs.magnet > 0 ? 7 : 3.4);
          o.x += dx / dist * pull * d;
          o.y += dy / dist * pull * d;
        }
      }
      if (o.x < 16 || o.x > W - 16) o.vx *= -1;

      if (dist2(o, player) < o.r + player.r - 4) {
        pickUp(o);
        drops.splice(i, 1);
        continue;
      }
      if (o.y > H + 40) drops.splice(i, 1);
    }

    /* 敌人 */
    for (var j = foes.length - 1; j >= 0; j--) {
      var f = foes[j];
      f.y += f.vy * d;
      f.rot += f.rs * d;
      if (f.kind === 'cloud') {
        f.phase += .04 * d;
        f.x += Math.sin(f.phase) * f.amp * d;
      } else {
        f.x += f.vx * d;
        if (f.x < 24 || f.x > W - 24) f.vx *= -1;
        if (Math.random() < .35) {
          parts.push({
            x: f.x + rnd(-6, 6), y: f.y - f.r * .6, vx: rnd(-.4, .4), vy: rnd(-1.6, -.4),
            life: 1, decay: .045, r: rnd(1.5, 3.4), hue: rnd(10, 40)
          });
        }
      }
      if (dist2(f, player) < f.r + player.r - 6) { hit(f.x, f.y); foes.splice(j, 1); continue; }
      if (f.y > H + 60) foes.splice(j, 1);
    }

    /* 粒子 & 飘字 */
    for (var p = parts.length - 1; p >= 0; p--) {
      var pt = parts[p];
      pt.x += pt.vx * d; pt.y += pt.vy * d;
      pt.vx *= .985; pt.vy *= .985;
      pt.life -= pt.decay * dt;
      if (pt.life <= 0) parts.splice(p, 1);
    }
    for (var q = pops.length - 1; q >= 0; q--) {
      var po = pops[q];
      po.y -= .9 * dt; po.life -= .018 * dt;
      if (po.life <= 0) pops.splice(q, 1);
    }

    if (shakeT > 0) shakeT -= dt;
    if (flash > 0) flash -= .045 * dt;

    tickHudFade(dt);

    /* 连击计时 */
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) { comboCount = 0; mult = 1; syncHud(); }
    }

    if (levelScore >= goal) levelUp();
    if (Math.floor(clock) % 6 === 0) syncHud();
  }

  function dist2(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pickUp(o) {
    if (o.kind === 'star' || o.kind === 'core') {
      comboCount++;
      comboTimer = 130;
      mult = Math.min(1 + Math.floor(comboCount / 4) * .5, 5);
      var gain = Math.round(o.score * mult);
      score += gain; levelScore += gain; statStars++;
      if (o.kind === 'core') { Sound.core(); burst(o.x, o.y, 188, 22, 4.6, .9); }
      else { Sound.pick(mult); burst(o.x, o.y, 45, 13, 3.6, 1.1); }
      pop(o.x, o.y - 14, '+' + gain, o.kind === 'core' ? '#8ef0ff' : '#ffd98a');
      shineT = 12;
      player.glow = 1.4;
    } else if (o.kind === 'heart') {
      life = Math.min(maxLife, life + 1);
      Sound.power(); burst(o.x, o.y, 350, 24, 4.4, .9);
      pop(o.x, o.y - 14, '+1 星命', '#ffb7e5');
      syncHud(true);
    } else {
      Sound.power();
      if (o.kind === 'shield') { buffs.shield = 480; pop(o.x, o.y - 14, '星芒护盾', '#9ff0ff'); burst(o.x, o.y, 190, 26, 4.4, .9); }
      if (o.kind === 'slow') { buffs.slow = 360; pop(o.x, o.y - 14, '时砂缓流', '#c3a8ff'); burst(o.x, o.y, 268, 26, 4.4, .9); }
      if (o.kind === 'magnet') { buffs.magnet = 420; pop(o.x, o.y - 14, '星引磁场', '#ffb7e5'); burst(o.x, o.y, 322, 26, 4.4, .9); }
    }
    syncHud();
  }

  /* ---------------- 绘制 ---------------- */
  function drawBackground() {
    var pal = palette(level);
    var g = ctx.createLinearGradient(0, 0, W * .4, H);
    g.addColorStop(0, pal.a); g.addColorStop(.5, pal.b); g.addColorStop(1, pal.c);
    /* 向外多铺一圈，让世界之外的余量区域也是同一片星海，不留黑边 */
    ctx.fillStyle = g;
    ctx.fillRect(-1200, -1200, W + 2400, H + 2400);

    ctx.globalCompositeOperation = 'screen';
    for (var i = 0; i < nebulas.length; i++) {
      var n = nebulas[i];
      var rg = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      rg.addColorStop(0, 'hsla(' + pal.n[i % 4] + ',80%,60%,' + n.a + ')');
      rg.addColorStop(.5, 'hsla(' + pal.n[(i + 1) % 4] + ',75%,52%,' + n.a * .4 + ')');
      rg.addColorStop(1, 'hsla(' + pal.n[i % 4] + ',70%,45%,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    for (var s = 0; s < bgStars.length; s++) {
      var st = bgStars[s];
      var al = st.a * (.5 + .5 * Math.sin(st.tw));
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, TAU);
      ctx.fillStyle = 'hsla(' + st.hue + ',100%,82%,' + al + ')';
      ctx.fill();
      if (st.r > 1.4) {
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r * 3.2, 0, TAU);
        ctx.fillStyle = 'hsla(' + st.hue + ',100%,80%,' + al * .08 + ')'; ctx.fill();
      }
    }
  }

  function starPath(c, r, rot, inner) {
    c.beginPath();
    for (var i = 0; i < 8; i++) {
      var ang = rot + i * Math.PI / 4;
      var rr = (i % 2 === 0) ? r : r * (inner || .42);
      var x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
  }

  function drawDrop(o) {
    var pulse = 1 + Math.sin(clock * .1 + o.x * .02) * .12;
    ctx.save();
    ctx.translate(o.x, o.y);

    var r = o.r * pulse;
    var rg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3);
    rg.addColorStop(0, 'hsla(' + o.hue + ',100%,78%,.55)');
    rg.addColorStop(.45, 'hsla(' + o.hue + ',100%,70%,.16)');
    rg.addColorStop(1, 'hsla(' + o.hue + ',100%,65%,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(0, 0, r * 3, 0, TAU); ctx.fill();

    if (o.kind === 'star' || o.kind === 'core') {
      ctx.rotate(o.rot);
      ctx.fillStyle = o.kind === 'core' ? '#c9fbff' : '#fff3d0';
      ctx.shadowColor = o.kind === 'core' ? '#6fe6ff' : '#ffd070';
      ctx.shadowBlur = o.kind === 'core' ? 22 : 14;
      starPath(ctx, r * (o.kind === 'core' ? 1.25 : 1), 0, .44);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(0, 0, r * .34, 0, TAU);
      ctx.fillStyle = '#ffffff'; ctx.fill();
    } else if (o.kind === 'heart') {
      ctx.fillStyle = '#ff9ecb'; ctx.shadowColor = '#ff77b6'; ctx.shadowBlur = 20;
      heartPath(ctx, r); ctx.fill(); ctx.shadowBlur = 0;
    } else if (o.kind === 'shield') {
      ctx.strokeStyle = '#9ff0ff'; ctx.lineWidth = 2.4; ctx.shadowColor = '#6fe0ff'; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI * .62, Math.PI * .62); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r, Math.PI * .38, Math.PI * 1.38); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(200,250,255,.85)';
      starPath(ctx, r * .42, clock * .02, .5); ctx.fill();
    } else if (o.kind === 'slow') {
      ctx.fillStyle = '#d7c8ff'; ctx.shadowColor = '#b39cff'; ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(r * .62, -r * .1); ctx.lineTo(0, r);
      ctx.lineTo(-r * .62, -r * .1); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, 0, r * .5, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -r * .5); ctx.lineTo(0, -r * .12);
      ctx.moveTo(0, -r * .12); ctx.lineTo(r * .22, r * .04); ctx.stroke();
    } else if (o.kind === 'magnet') {
      ctx.fillStyle = '#ffb7e5'; ctx.shadowColor = '#ff8fd6'; ctx.shadowBlur = 20;
      ctx.lineWidth = r * .45; ctx.strokeStyle = '#ffb7e5';
      ctx.beginPath(); ctx.arc(0, r * .18, r * .5, Math.PI, TAU); ctx.stroke();
      ctx.fillRect(-r * .78, r * .18, r * .5, r * .5);
      ctx.fillRect(r * .28, r * .18, r * .5, r * .5);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function heartPath(c, r) {
    c.beginPath();
    c.moveTo(0, r * .72);
    c.bezierCurveTo(-r * 1.3, -r * .18, -r * .42, -r * 1.05, 0, -r * .42);
    c.bezierCurveTo(r * .42, -r * 1.05, r * 1.3, -r * .18, 0, r * .72);
    c.closePath();
  }

  function drawFoe(f) {
    ctx.save();
    ctx.translate(f.x, f.y);
    if (f.kind === 'cloud') {
      var rg = ctx.createRadialGradient(0, 0, 0, 0, 0, f.r * 2.1);
      rg.addColorStop(0, 'rgba(58,54,96,.72)');
      rg.addColorStop(.5, 'rgba(44,40,80,.44)');
      rg.addColorStop(1, 'rgba(30,26,62,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(0, 0, f.r * 2.1, 0, TAU); ctx.fill();
      for (var i = 0; i < 6; i++) {
        var a = f.rot * .3 + i * TAU / 6 + Math.sin(clock * .02 + i) * .25;
        var rr = f.r * (.55 + .18 * Math.sin(clock * .04 + i * 1.7));
        ctx.beginPath();
        ctx.arc(Math.cos(a) * f.r * .52, Math.sin(a) * f.r * .42, rr, 0, TAU);
        ctx.fillStyle = 'rgba(46,42,84,.6)'; ctx.fill();
      }
      ctx.strokeStyle = 'rgba(150,130,220,.30)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, f.r * .78, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(190,170,255,.5)';
      ctx.beginPath(); ctx.arc(-f.r * .22, -f.r * .12, 2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(f.r * .26, f.r * .14, 2, 0, TAU); ctx.fill();
    } else {
      ctx.rotate(f.rot);
      var rg2 = ctx.createRadialGradient(0, 0, 0, 0, 0, f.r * 2.4);
      rg2.addColorStop(0, 'rgba(255,130,70,.35)');
      rg2.addColorStop(1, 'rgba(255,90,50,0)');
      ctx.fillStyle = rg2;
      ctx.beginPath(); ctx.arc(0, 0, f.r * 2.4, 0, TAU); ctx.fill();
      ctx.beginPath();
      for (var k = 0; k < 9; k++) {
        var ang = k * TAU / 9;
        var rr2 = f.r * (.78 + .28 * Math.sin(k * 2.1 + f.r));
        var x = Math.cos(ang) * rr2, y = Math.sin(ang) * rr2;
        k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      var gr = ctx.createLinearGradient(-f.r, -f.r, f.r, f.r);
      gr.addColorStop(0, '#5b4266'); gr.addColorStop(.55, '#3a2c4e'); gr.addColorStop(1, '#241b38');
      ctx.fillStyle = gr; ctx.fill();
      ctx.strokeStyle = 'rgba(255,140,90,.55)'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = 'rgba(255,180,120,.35)';
      ctx.beginPath(); ctx.arc(-f.r * .25, -f.r * .22, f.r * .2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawPlayer() {
    var blink = invincible > 0 && Math.floor(clock / 5) % 2 === 0;
    var alpha = blink ? .35 : 1;

    /* 拖尾 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < player.trail.length; i++) {
      var t = player.trail[i];
      var k = i / player.trail.length;
      ctx.beginPath();
      ctx.arc(t.x, t.y, player.r * .72 * k * t.a, 0, TAU);
      ctx.fillStyle = 'rgba(180,220,255,' + (.16 * k * t.a) + ')';
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(player.x, player.y);

    if (buffs.magnet > 0) {
      ctx.strokeStyle = 'rgba(255,180,230,.22)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([7, 12]);
      ctx.lineDashOffset = -clock * 1.2;
      ctx.beginPath(); ctx.arc(0, 0, 230, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }

    var puff = 1 + Math.sin(clock * .07) * .06;
    /* 柔光 */
    var rg = ctx.createRadialGradient(0, 0, 0, 0, 0, player.r * 3.4 * puff);
    rg.addColorStop(0, 'rgba(190,235,255,.55)');
    rg.addColorStop(.35, 'rgba(150,190,255,.20)');
    rg.addColorStop(1, 'rgba(120,160,255,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(0, 0, player.r * 3.4 * puff, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    /* 花瓣 */
    ctx.rotate(Math.sin(clock * .02) * .12);
    for (var p = 0; p < 6; p++) {
      ctx.save();
      ctx.rotate(p * TAU / 6 + clock * .006);
      var lg = ctx.createLinearGradient(0, 0, 0, -player.r * 1.6);
      lg.addColorStop(0, 'rgba(255,255,255,.95)');
      lg.addColorStop(.45, 'rgba(200,240,255,.80)');
      lg.addColorStop(1, 'rgba(255,190,235,.35)');
      ctx.fillStyle = lg;
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-player.r * .72, -player.r * .85, 0, -player.r * 1.62 * puff);
      ctx.quadraticCurveTo(player.r * .72, -player.r * .85, 0, 0);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';

    /* 花心 */
    var cg = ctx.createRadialGradient(0, 0, 0, 0, 0, player.r * .72);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(.4, 'rgba(200,245,255,.9)');
    cg.addColorStop(1, 'rgba(255,190,235,.15)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(0, 0, player.r * .72 * puff, 0, TAU); ctx.fill();

    if (buffs.shield > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(150,240,255,.85)';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, 0, player.r * 1.5, clock * .05, clock * .05 + Math.PI * 1.25); ctx.stroke();
      ctx.strokeStyle = 'rgba(150,240,255,.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, player.r * 1.62, -clock * .07, -clock * .07 + Math.PI * 1.1); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    /* 自定义光标 */
    if (state === 'playing' && input.hasPointer) {
      ctx.save();
      ctx.translate(input.x, input.y);
      ctx.globalAlpha = .55;
      ctx.strokeStyle = '#bfe9ff'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, TAU);
      ctx.fillStyle = '#eaf6ff'; ctx.fill();
      ctx.restore();
    }
  }

  function drawParts() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.4 + p.life * .8), 0, TAU);
      ctx.fillStyle = 'hsla(' + p.hue + ',100%,72%,' + (p.life * .85) + ')';
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPops() {
    ctx.save();
    ctx.textAlign = 'center';
    for (var i = 0; i < pops.length; i++) {
      var p = pops[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.font = '600 17px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 14;
      ctx.fillText(p.text, p.x, p.y);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function drawOverlayFx() {
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + Math.min(flash * .35, .5) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    /* 暗角 */
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * .38, W / 2, H / 2, H * .95);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(4,5,20,.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  function drawIdleAura() {
    if (state !== 'idle') return;
    ctx.save();
    ctx.globalAlpha = .8;
    for (var i = 0; i < 5; i++) {
      var x = W / 2 + Math.cos(clock * .012 + i * 1.25) * 180;
      var y = H / 2 + Math.sin(clock * .017 + i * .9) * 90;
      spawnStarIfIdle(x, y, i);
    }
    ctx.restore();
  }
  function spawnStarIfIdle(x, y, i) {
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, TAU);
    ctx.fillStyle = 'hsla(' + (190 + i * 30) + ',100%,80%,.7)';
    ctx.fill();
  }

  function draw() {
    if (!ctx) return;
    /* 不要在这里假设 dpr/view 的有效性：resize 未跑过时它们可能是初始值，
       但只要 vw/vh > 0 就先铺底色，避免出现整片纯黑的“没内容” */
    var dw = vw > 0 ? vw : W, dh = vh > 0 ? vh : H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05060f';
    ctx.fillRect(0, 0, dw, dh);

    var sx = shakeT > 0 ? rnd(-shakeMag, shakeMag) : 0;
    var sy = shakeT > 0 ? rnd(-shakeMag, shakeMag) : 0;
    ctx.setTransform(dpr * view, 0, 0, dpr * view, (ox + sx) * dpr, (oy + sy) * dpr);

    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

    drawBackground();

    if (state === 'idle') {
      for (var i = 0; i < foes.length; i++) drawFoe(foes[i]);
      drawIdleAura();
      drawPlayer();
      drawParts();
      drawOverlayFx();
      return;
    }

    for (var a = 0; a < drops.length; a++) drawDrop(drops[a]);
    for (var b = 0; b < foes.length; b++) drawFoe(foes[b]);
    drawPlayer();
    drawParts();
    drawPops();
    drawOverlayFx();
  }

  /* ---------------- HUD ---------------- */
  function syncHud(force) {
    if (!user) return;
    var el = $('hud-score'); if (!el) return;
    el.textContent = score;
    var pct = clamp(levelScore / goal * 100, 0, 100);
    $('hud-goal').style.width = pct + '%';
    $('hud-goaltext').textContent = Math.max(0, goal - levelScore);
    $('hud-level').textContent = level;
    $('hud-combo').textContent = '×' + mult.toFixed(1);
    var cb = $('hud-combo-box');
    if (force || shineT > 0) { cb.classList.remove('hot'); void cb.offsetWidth; cb.classList.add('hot'); }
    var hs = $('hud-hearts');
    if (hs.children.length !== maxLife) {
      hs.innerHTML = '';
      for (var i = 0; i < maxLife; i++) hs.appendChild(document.createElement('i'));
    }
    for (var k = 0; k < hs.children.length; k++) {
      hs.children[k].className = k < life ? '' : 'off';
    }
    renderBuffs();
  }

  function renderBuffs() {
    var wrap = $('buffs');
    if (!wrap) return;
    var html = '';
    var defs = [
      ['shield', '护盾', buffs.shield, 480, 'b-shield'],
      ['slow', '缓速', buffs.slow, 360, 'b-slow'],
      ['magnet', '星引', buffs.magnet, 420, 'b-magnet']
    ];
    defs.forEach(function (d) {
      if (d[2] > 0) {
        html += '<div class="buff ' + d[4] + '">' + d[1] +
          '<div class="bar"><i style="width:' + Math.round(d[2] / d[3] * 100) + '%"></i></div>' +
          '<em>' + (d[2] / 60).toFixed(1) + 's</em></div>';
      }
    });
    if (wrap.innerHTML !== html) wrap.innerHTML = html;
  }

  /* 待机时只让世界缓慢流动，保持画面呼吸感 */
  function idleUpdate(dt) {
    var d = dt * .5;
    clock += dt;
    bgStars.forEach(function (s) {
      s.y -= s.sp * d;
      if (s.y < -3) { s.y = H + 3; s.x = rnd(0, W); }
      s.tw += s.ts * dt;
    });
    nebulas.forEach(function (n) {
      n.x += n.dx * d; n.y += n.dy * d;
      if (n.x < -n.r) n.x = W + n.r; if (n.x > W + n.r) n.x = -n.r;
      if (n.y < -n.r) n.y = H + n.r; if (n.y > H + n.r) n.y = -n.r;
    });
    player.trail.push({ x: player.x, y: player.y, a: 1 });
    if (player.trail.length > 22) player.trail.shift();
    player.trail.forEach(function (t) { t.a *= .92; });
  }

  /* ---------------- 主循环 ---------------- */
  function loop(now) {
    if (!ctx) { rafId = requestAnimationFrame(loop); return; }
    var dt = Math.min((now - lastTime) / 16.67, 3);
    if (!(dt > 0)) dt = 1;
    lastTime = now;
    /* 任何一帧的异常都不能中断循环：否则画面会永久定格成“卡住不动”。
       出错时记一次日志（同一种错误只报一次），本帧跳过，下一帧继续。 */
    try {
      if (state === 'playing') update(dt);
      else if (state === 'idle' || state === 'over') idleUpdate(dt);
      draw();
      painting = true;
    } catch (err) {
      var msg = (err && err.message) || String(err);
      if (loop._lastErr !== msg) {
        loop._lastErr = msg;
        if (window.console && console.warn) console.warn('[Starlight] 帧异常已跳过：', msg);
      }
    }
    rafId = requestAnimationFrame(loop);
  }

  /* ---------------- 对外接口 ---------------- */
  return {
    init: init,
    enter: function (u) {
      if (!u || !u.email) return;
      user = u;
      if (!cv) init();

      var nick = (u.nick && String(u.nick).trim()) || '拾星者';
      $('hud-nick').textContent = nick;
      $('hud-avatar').textContent = nick.charAt(0);

      /* 先把所有游戏状态置为合法值，再 resize / 绘制。
         顺序反了会让绘制路径读到上一局的残留状态。 */
      state = 'idle';
      score = 0; life = maxLife = 3; level = 1; levelScore = 0; goal = goalOf(1);
      comboCount = 0; comboTimer = 0; mult = 1; statStars = 0;
      invincible = 0; shineT = 0; spawnTimer = 99999;
      shakeT = 0; shakeMag = 0; flash = 0; timeScale = 1; clock = 0;
      drops = []; foes = []; parts = []; pops = [];
      buffs.shield = buffs.slow = buffs.magnet = 0;
      player.x = W / 2; player.y = H - 110; player.trail = [];
      input.hasPointer = false;
      input.x = W / 2; input.y = H - 110;
      resize();

      var best = 0;
      try {
        var fresh = Store.findUser(u.email);
        if (fresh) { best = fresh.best || 0; user.best = best; }
      } catch (e) {}
      $('hud-best').textContent = best;
      $('start-nick').textContent = nick;

      $('overlay-start').classList.remove('hidden');
      $('overlay-pause').classList.add('hidden');
      $('overlay-over').classList.add('hidden');
      $('level-banner').classList.add('hidden');
      syncHud(true);
      renderBuffs();
      /* 首屏立刻出画，避免玩家看到一片空白 */
      idleUpdate(1);
      draw();
      /* 布局/字体在接下来一两帧内可能还会变，再补两次尺寸校准与重绘 */
      requestAnimationFrame(function () { resize(); idleUpdate(1); draw(); });
      setTimeout(function () { if (state === 'idle') { resize(); idleUpdate(1); draw(); } }, 160);
    },
    reset: function () {
      state = 'idle';
      Sound.stopMusic();
      $('overlay-pause').classList.add('hidden');
      $('overlay-over').classList.add('hidden');
      $('overlay-start').classList.remove('hidden');
    }
  };
})();

window.addEventListener('load', function () { Game.init(); });
/* 兜底：若 load 事件已经过去（脚本后置加载），立即初始化 */
if (document.readyState === 'complete') { try { Game.init(); } catch (e) {} }
