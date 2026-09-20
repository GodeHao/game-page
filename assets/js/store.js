/* ================= 星海谣 · 本地账号仓库 ================= */
var Store = (function () {
  var K_USERS = 'starlight.users';
  var K_SESSION = 'starlight.session';
  var K_REMEMBER = 'starlight.remember';
  var K_SOUND = 'starlight.sound';

  var available = (function () {
    try {
      var k = '__t__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  var mem = {};
  function getRaw(key) {
    if (!available) return mem[key] || null;
    try { return localStorage.getItem(key); } catch (e) { return mem[key] || null; }
  }
  function setRaw(key, val) {
    mem[key] = val;
    if (!available) return;
    try { localStorage.setItem(key, val); } catch (e) {}
  }
  function read(key, def) {
    var raw = getRaw(key);
    if (raw == null) return def;
    try { return JSON.parse(raw); } catch (e) { return def; }
  }
  function write(key, val) { setRaw(key, JSON.stringify(val)); }

  /* 稳定哈希：本地存储用的轻量混淆，替代明文 */
  function hash(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    str = 'starlight::' + str;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  function users() { return read(K_USERS, []) || []; }
  function saveUsers(list) { write(K_USERS, list); }

  function normEmail(email) { return String(email || '').trim().toLowerCase(); }

  return {
    available: available,

    /* QQ 邮箱校验：5-11 位数字 + @qq.com（也兼容 vip / foxmail） */
    isQQEmail: function (email) {
      return /^[1-9]\d{4,10}@(qq\.com|vip\.qq\.com|foxmail\.com)$/.test(normEmail(email));
    },

    findUser: function (email) {
      var e = normEmail(email), list = users();
      for (var i = 0; i < list.length; i++) {
        if (list[i].email === e) return list[i];
      }
      return null;
    },

    register: function (email, pwd, nick) {
      email = normEmail(email);
      if (this.findUser(email)) return { ok: false, msg: '该 QQ 邮箱已注册，请直接登录' };
      var list = users();
      var user = {
        email: email,
        nick: String(nick || '').trim() || ('拾星者' + (list.length + 1)),
        pwd: hash(pwd),
        best: 0,
        bestLevel: 1,
        plays: 0,
        createdAt: new Date().toISOString()
      };
      list.push(user);
      saveUsers(list);
      return { ok: true, user: user };
    },

    login: function (email, pwd) {
      var u = this.findUser(email);
      if (!u) return { ok: false, msg: '该邮箱尚未注册，请先注册星舟' };
      if (u.pwd !== hash(pwd)) return { ok: false, msg: '密码不正确，请重新输入' };
      return { ok: true, user: u };
    },

    session: {
      get: function () { return read(K_SESSION, null); },
      set: function (user) {
        write(K_SESSION, { email: user.email, nick: user.nick, at: Date.now() });
      },
      clear: function () { setRaw(K_SESSION, ''); }
    },

    remember: {
      get: function () { return getRaw(K_REMEMBER) || ''; },
      set: function (v) { setRaw(K_REMEMBER, v || ''); }
    },

    sound: {
      get: function () {
        var v = getRaw(K_SOUND);
        return v === null ? true : v === '1';
      },
      set: function (v) { setRaw(K_SOUND, v ? '1' : '0'); }
    },

    /* 提交成绩，返回是否破纪录 */
    submitScore: function (email, score, level) {
      var u = this.findUser(email);
      if (!u) return false;
      var isNew = score > (u.best || 0);
      if (isNew) u.best = score;
      if (level > (u.bestLevel || 1)) u.bestLevel = level;
      u.plays = (u.plays || 0) + 1;
      var list = users();
      for (var i = 0; i < list.length; i++) {
        if (list[i].email === u.email) { list[i] = u; break; }
      }
      saveUsers(list);
      return isNew;
    },

    userCount: function () { return users().length; }
  };
})();
