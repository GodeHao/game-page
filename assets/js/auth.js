/* ================= 星海谣 · 登录 / 注册逻辑 ================= */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 提示工具 ---------- */
  var toastTimer = null;
  function toast(msg, type) {
    var wrap = $('toast-wrap');
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .35s, transform .35s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-12px)';
      setTimeout(function () { el.remove(); }, 360);
    }, 2100);
    if (toastTimer) clearTimeout(toastTimer);
  }

  function showTip(el, msg, ok) {
    el.textContent = msg || '';
    el.className = 'tip' + (msg ? ' show' : '') + (ok ? ' ok' : '');
  }
  function shake(el) {
    el.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' },
       { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }],
      { duration: 320, easing: 'ease-out' }
    );
  }

  /* ---------- 星空背景 ---------- */
  (function bg() {
    var cv = $('sky-canvas'), ctx = cv.getContext('2d');
    var stars = [], nebulas = [], meteors = [], W = 0, H = 0, dpr = 1;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }
    function build() {
      stars = [];
      var n = Math.round(W * H / 5200);
      for (var i = 0; i < n; i++) {
        stars.push({
          x: Math.random() * W, y: Math.random() * H,
          r: Math.random() * 1.5 + .35,
          a: Math.random() * .7 + .25,
          sp: Math.random() * .22 + .04,
          tw: Math.random() * Math.PI * 2,
          ts: Math.random() * .02 + .006,
          hue: Math.random() < .3 ? 320 : (Math.random() < .5 ? 190 : 220)
        });
      }
      nebulas = [];
      for (var j = 0; j < 5; j++) {
        nebulas.push({
          x: Math.random() * W, y: Math.random() * H,
          r: Math.random() * (Math.max(W, H) * .42) + 200,
          hue: [210, 265, 320, 190][j % 4],
          dx: (Math.random() - .5) * .12, dy: (Math.random() - .5) * .12,
          a: Math.random() * .16 + .07
        });
      }
    }
    function spawnMeteor() {
      meteors.push({
        x: Math.random() * W * .9, y: Math.random() * H * .45,
        len: Math.random() * 110 + 70, sp: Math.random() * 6 + 5,
        life: 1, ang: Math.PI / 5 + Math.random() * .18
      });
    }

    var last = performance.now();
    function loop(now) {
      var dt = Math.min((now - last) / 16.67, 3); last = now;

      var g = ctx.createLinearGradient(0, 0, W * .35, H);
      g.addColorStop(0, '#070a1e');
      g.addColorStop(.45, '#101338');
      g.addColorStop(1, '#1b1338');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      ctx.globalCompositeOperation = 'screen';
      for (var i = 0; i < nebulas.length; i++) {
        var n = nebulas[i];
        n.x += n.dx * dt; n.y += n.dy * dt;
        if (n.x < -n.r) n.x = W + n.r; if (n.x > W + n.r) n.x = -n.r;
        if (n.y < -n.r) n.y = H + n.r; if (n.y > H + n.r) n.y = -n.r;
        var rg = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        rg.addColorStop(0, 'hsla(' + n.hue + ',85%,62%,' + n.a + ')');
        rg.addColorStop(.55, 'hsla(' + ((n.hue + 30) % 360) + ',80%,52%,' + n.a * .45 + ')');
        rg.addColorStop(1, 'hsla(' + n.hue + ',80%,45%,0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.2832); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      for (var s = 0; s < stars.length; s++) {
        var st = stars[s];
        st.y -= st.sp * dt;
        if (st.y < -2) { st.y = H + 2; st.x = Math.random() * W; }
        st.tw += st.ts * dt;
        var al = st.a * (0.55 + 0.45 * Math.sin(st.tw));
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, 6.2832);
        ctx.fillStyle = 'hsla(' + st.hue + ',100%,' + (78 + st.r * 6) + '%,' + al + ')';
        ctx.fill();
        if (st.r > 1.45) {
          ctx.beginPath(); ctx.arc(st.x, st.y, st.r * 3.4, 0, 6.2832);
          ctx.fillStyle = 'hsla(' + st.hue + ',100%,80%,' + (al * .09) + ')'; ctx.fill();
        }
      }

      if (Math.random() < .012) spawnMeteor();
      for (var m = meteors.length - 1; m >= 0; m--) {
        var me = meteors[m];
        me.x += Math.cos(me.ang) * me.sp * dt;
        me.y += Math.sin(me.ang) * me.sp * dt;
        me.life -= .012 * dt;
        var tx = me.x - Math.cos(me.ang) * me.len, ty = me.y - Math.sin(me.ang) * me.len;
        var lg = ctx.createLinearGradient(me.x, me.y, tx, ty);
        lg.addColorStop(0, 'rgba(255,255,255,' + Math.max(me.life, 0) * .85 + ')');
        lg.addColorStop(1, 'rgba(180,220,255,0)');
        ctx.strokeStyle = lg; ctx.lineWidth = 1.7; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(me.x, me.y); ctx.lineTo(tx, ty); ctx.stroke();
        if (me.life <= 0 || me.x > W + 160 || me.y > H + 160) meteors.splice(m, 1);
      }
      requestAnimationFrame(loop);
    }
    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(loop);
  })();

  /* ---------- Tab 切换 ---------- */
  var ink = $('tab-ink');
  function switchTab(name) {
    var isReg = name === 'register';
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    ink.classList.toggle('right', isReg);
    $('form-login').classList.toggle('hidden', isReg);
    $('form-register').classList.toggle('hidden', !isReg);
    showTip($('login-tip'), ''); showTip($('reg-tip'), '');
    (isReg ? $('reg-name') : $('login-email')).focus();
  }
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { switchTab(t.dataset.tab); });
  });
  $('to-register').addEventListener('click', function () { switchTab('register'); });

  document.querySelectorAll('.eye').forEach(function (b) {
    b.addEventListener('click', function () {
      var inp = $(b.dataset.eye);
      var show = inp.type === 'text';
      inp.type = show ? 'password' : 'text';
      b.textContent = show ? '◉' : '◌';
      b.style.opacity = show ? .65 : 1;
    });
  });

  /* ---------- 记住的邮箱 ---------- */
  var remembered = Store.remember.get();
  if (remembered) {
    $('login-email').value = remembered;
    $('remember').checked = true;
  }

  /* ---------- 注册 ---------- */
  $('form-register').addEventListener('submit', function (e) {
    e.preventDefault();
    var tip = $('reg-tip');
    var nick = $('reg-name').value.trim();
    var email = $('reg-email').value.trim();
    var pwd = $('reg-pwd').value;
    var pwd2 = $('reg-pwd2').value;

    if (nick.length < 1) { showTip(tip, '请填写昵称'); shake($('reg-name')); return; }
    if (!Store.isQQEmail(email)) {
      showTip(tip, '请输入正确的 QQ 邮箱，例如 123456@qq.com');
      shake($('reg-email')); return;
    }
    if (pwd.length < 6) { showTip(tip, '密码至少需要 6 位'); shake($('reg-pwd')); return; }
    if (!/^(?=.*[A-Za-z])(?=.*\d).{6,20}$/.test(pwd)) {
      showTip(tip, '密码需同时包含字母与数字，6-20 位'); shake($('reg-pwd')); return;
    }
    if (pwd !== pwd2) { showTip(tip, '两次输入的密码不一致'); shake($('reg-pwd2')); return; }
    if (!$('agree').checked) { showTip(tip, '请先勾选同意漫游守则'); return; }

    var res = Store.register(email, pwd, nick);
    if (!res.ok) { showTip(tip, res.msg); shake($('reg-email')); return; }

    showTip(tip, '星舟登记成功，正在前往星海…', true);
    toast('注册成功，欢迎加入夜航 · ' + res.user.nick, 'ok');
    setTimeout(function () { afterLogin(res.user); }, 620);
  });

  /* ---------- 登录 ---------- */
  $('form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    var tip = $('login-tip');
    var email = $('login-email').value.trim();
    var pwd = $('login-pwd').value;

    if (!Store.isQQEmail(email)) {
      showTip(tip, '请输入已注册的 QQ 邮箱'); shake($('login-email')); return;
    }
    if (!pwd) { showTip(tip, '请输入密码'); shake($('login-pwd')); return; }

    var res = Store.login(email, pwd);
    if (!res.ok) { showTip(tip, res.msg); shake($('login-pwd')); return; }

    Store.remember.set($('remember').checked ? email : '');
    showTip(tip, '验证通过，星门开启…', true);
    toast('欢迎回来，' + res.user.nick, 'ok');
    setTimeout(function () { afterLogin(res.user); }, 480);
  });

  /* ---------- 会话 ---------- */
  function afterLogin(user) {
    Store.session.set(user);
    $('login-screen').classList.add('hidden');
    $('game-screen').classList.remove('hidden');
    if (window.Game && Game.enter) Game.enter(user);
  }

  window.Auth = {
    logout: function () {
      Store.session.clear();
      $('game-screen').classList.add('hidden');
      $('login-screen').classList.remove('hidden');
      switchTab('login');
      $('login-pwd').value = '';
      showTip($('login-tip'), '');
      toast('已退出登录，星舟归港');
      if (window.Game && Game.reset) Game.reset();
    },
    toast: toast,
    updateBest: function (best) { }
  };

  /* ---------- 自动恢复登录（可选：默认进入需重新登录） ---------- */
  window.addEventListener('DOMContentLoaded', function () {
    if (!Store.available) {
      toast('浏览器禁用了本地存储，账号数据仅本次有效', 'err');
    }
  });
})();
