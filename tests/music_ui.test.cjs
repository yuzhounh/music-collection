const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

function load() {
  const source = readFileSync(new URL('../docs/assets/app.js', `file://${__filename.replaceAll('\\', '/')}`), 'utf8');
  const listeners = {};
  const intervals = new Map();
  const nodes = new Map();
  let nextId = 0;
  const document = {
    hidden: false,
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { value: '', style: { setProperty() {} }, setAttribute() {} });
      return nodes.get(selector);
    },
    querySelectorAll: () => [],
    addEventListener(name, listener) { listeners[name] = listener; },
  };
  const context = vm.createContext({ document, location: { hostname: 'localhost' },
    setInterval(fn) { const id = ++nextId; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
  });
  vm.runInContext(source.slice(0, source.indexOf('if (elements.playAll)')) + `
    updatePlayAll = () => {};
    renderRows = () => {};
    globalThis.app = { state, player, elements, setStatus, applyFilters };
  `, context);
  return { ...context.app, document, listeners, intervals };
}

test('progress polling stops while paused or hidden and catches up on return without pausing audio', () => {
  const app = load();
  let current = 12;
  app.player.videoId = 'video';
  app.player.yt = { getVideoData: () => ({ video_id: 'video' }), getDuration: () => 120, getCurrentTime: () => current };
  app.setStatus('playing', 1);
  app.setStatus('playing', 1);
  assert.equal(app.intervals.size, 1);
  app.document.hidden = true;
  app.listeners.visibilitychange();
  assert.equal(app.intervals.size, 0);
  assert.equal(app.player.status, 'playing');
  current = 42;
  app.document.hidden = false;
  app.listeners.visibilitychange();
  assert.equal(app.intervals.size, 1);
  assert.equal(app.elements.playerSeek.value, '42');
  for (const status of ['paused', 'loading', 'idle']) {
    app.setStatus(status);
    assert.equal(app.intervals.size, 0);
  }
});

test('cached search preserves case, playlist, category and platform matching across repeated queries', () => {
  const app = load();
  let titleReads = 0;
  const track = { get title() { titleReads++; return 'Hello'; }, artists: '歌手', album: '专辑', category: '流行歌曲', playlist_names: ['收藏歌单'], platforms: ['netease'] };
  app.state.all = [track];
  for (const query of ['HELLO', '歌手', '专辑', '收藏歌单', '流行歌曲']) {
    app.elements.search.value = query;
    app.applyFilters();
    assert.equal(app.state.filtered.length, 1);
  }
  assert.equal(titleReads, 1);
  app.state.platform = 'kuwo';
  app.applyFilters();
  assert.equal(app.state.filtered.length, 0);
  app.state.platform = 'all';
  app.state.category = '纯音乐';
  app.applyFilters();
  assert.equal(app.state.filtered.length, 0);
});
test("i18n correctly translates all four category labels and all/全部", () => {
  const source = readFileSync(new URL("../docs/assets/i18n.js", `file://${__filename.replaceAll("\\", "/")}`), "utf8");
  const storage = new Map();
  const mockWindow = { addEventListener() {} };
  const mockDoc = {
    readyState: "complete",
    body: {},
    documentElement: {},
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    createTreeWalker: () => ({ nextNode: () => null })
  };
  const context = vm.createContext({
    window: mockWindow,
    document: mockDoc,
    localStorage: {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, String(v)),
    },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
  });
  vm.runInContext(source, context);
  const i18n = mockWindow.I18n;
  assert.ok(i18n);

  // Default Chinese
  i18n.setLang("zh");
  assert.equal(i18n.isEn(), false);
  assert.equal(i18n.tCategory("流行歌曲"), "流行歌曲");
  assert.equal(i18n.tCategory("外文歌曲"), "外文歌曲");
  assert.equal(i18n.tCategory("影视原声"), "影视原声");
  assert.equal(i18n.tCategory("纯音乐"), "纯音乐");
  assert.equal(i18n.tCategory("all"), "全部");
  assert.equal(i18n.tCategory("全部"), "全部");

  // English mode
  i18n.setLang("en");
  assert.equal(i18n.isEn(), true);
  assert.equal(i18n.tCategory("流行歌曲"), "Pop");
  assert.equal(i18n.tCategory("外文歌曲"), "International");
  assert.equal(i18n.tCategory("影视原声"), "Soundtrack");
  assert.equal(i18n.tCategory("纯音乐"), "Instrumental");
  assert.equal(i18n.tCategory("all"), "All");
  assert.equal(i18n.tCategory("全部"), "All");
});
