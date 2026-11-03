// Lightweight bilingual (Simplified Chinese / English) runtime for Music Collection.
// Default language is Simplified Chinese; persisted in localStorage and switchable
// via 1-click toggle button in desktop navbar and mobile drawer settings.

(function () {
  const STORAGE_KEY = "music_collection_lang";
  const SUPPORTED = ["zh", "en"];

  const EN = {
    "我的音乐收藏": "My Music Collection",
    "PERSONAL MUSIC ARCHIVE": "PERSONAL MUSIC ARCHIVE",
    "汇集个人音乐收藏，合并去重后按类别浏览。": "Personal music collection, deduplicated and organised by category.",
    "首歌曲": "songs",
    "个类别": "categories",
    "个来源平台": "platforms",
    "音乐类别": "Music Categories",
    "全部": "All",
    "当前分类": "Current Category",
    "切换音乐类别": "Switch Music Category",
    "切换类别": "Switch Category",
    "MUSIC COLLECTION": "MUSIC COLLECTION",
    "搜索歌名、歌手、专辑或原歌单": "Search track, artist, album, or playlist",
    "搜索音乐": "Search music",
    "来源": "Source",
    "全部平台": "All Platforms",
    "网易云音乐": "NetEase Cloud Music",
    "酷我音乐": "Kuwo Music",
    "每页": "Per page",
    "正在载入音乐收藏…": "Loading music collection…",
    "播放控制": "Playback Controls",
    "播放全部": "Play All",
    "暂停全部": "Pause All",
    "#": "#",
    "歌曲": "Track",
    "歌手": "Artist",
    "专辑": "Album",
    "类别": "Category",
    "播放": "Play",
    "歌曲分页": "Pagination",
    "首页": "First",
    "上一页": "Prev",
    "第": "Page",
    "页": "",
    "跳转": "Go",
    "下一页": "Next",
    "末页": "Last",
    "/ 1 页": "/ 1",
    "歌曲信息来自个人收藏歌单，仅用于整理与索引；本站不存储或提供音频文件。": "Song metadata from personal playlists, for indexing and study only; this site does not store or host audio files.",
    "音乐播放器": "Music Player",
    "播放进度": "Playback Progress",
    "上一首": "Previous",
    "下一首": "Next",
    "尚未播放": "Not Playing",
    "选择歌曲或播放全部": "Select a track or play all",
    "静音": "Mute",
    "取消静音": "Unmute",
    "音量": "Volume",
    "循环：关闭": "Repeat: Off",
    "单曲循环": "Repeat: One",
    "列表循环": "Repeat: All",
    "随机播放": "Shuffle",
    "功能导航": "Navigation",
    "搜索音乐收藏": "Search collection",
    "外观主题": "Theme",
    "界面语言": "Language",
    "GitHub 仓库": "GitHub Repository",
    "选择要查看的音乐分类：": "Select a category to view:",
    "关闭类别切换弹窗": "Close category modal",
    "切换外观主题": "Toggle Theme",
    "打开导航与设置菜单": "Open navigation and settings",
    "关闭菜单": "Close menu",
    "GitHub 源代码": "GitHub Source",
    "流行歌曲": "Pop",
    "外文歌曲": "International",
    "纯音乐": "Instrumental",
    "影视原声": "Soundtrack",
    "重试": "Retry",
    "已暂停": "Paused",
    "正在播放": "Playing",
    "正在加载": "Loading",
    "播放已结束": "Finished"
  };

  const ATTR = {
    "切换外观主题": "Toggle theme",
    "切换外观主题 (D)": "Toggle theme (D)",
    "切换界面语言": "Toggle language",
    "切换界面语言 (L)": "Toggle language (L)",
    "GitHub 源代码": "GitHub Source",
    "打开导航与设置菜单": "Open navigation and settings",
    "关闭菜单": "Close menu",
    "全局导航": "Site navigation",
    "我的音乐收藏首页": "My Music Collection Home",
    "快捷设置与导航": "Quick Settings & Navigation",
    "搜索音乐": "Search music",
    "搜索歌名、歌手、专辑或原歌单": "Search track, artist, album, or playlist",
    "收藏统计": "Collection statistics",
    "音乐类别": "Music categories",
    "切换音乐类别": "Switch music category",
    "播放控制": "Playback controls",
    "播放全部": "Play all",
    "歌曲分页": "Song pagination",
    "音乐播放器": "Music player",
    "播放进度": "Playback progress",
    "上一首": "Previous track",
    "播放": "Play",
    "下一首": "Next track",
    "当前音源封面": "Current album cover",
    "播放设置": "Playback settings",
    "静音": "Mute",
    "取消静音": "Unmute",
    "音量": "Volume",
    "循环：关闭": "Repeat: Off",
    "单曲循环": "Repeat: One",
    "列表循环": "Repeat: All",
    "随机播放": "Shuffle",
    "随机播放：关闭": "Shuffle: Off",
    "随机播放：开启": "Shuffle: On",
    "关闭类别切换弹窗": "Close category modal"
  };

  const CATEGORIES = {
    "流行歌曲": "Pop",
    "外文歌曲": "International",
    "纯音乐": "Instrumental",
    "影视原声": "Soundtrack",
    "全部": "All",
    "all": "All"
  };

  const DOC = {
    title: { zh: "我的音乐收藏", en: "My Music Collection" },
    description: {
      zh: "按流行歌曲、外文歌曲、纯音乐和影视原声浏览个人音乐收藏",
      en: "Browse personal music archive across pop, international, instrumental, and soundtrack collections"
    }
  };

  const listeners = new Set();
  const originalText = new WeakMap();
  const originalAttrs = new WeakMap();

  function normalize(lang) {
    return SUPPORTED.includes(lang) ? lang : "zh";
  }

  function getLang() {
    try {
      return normalize(localStorage.getItem(STORAGE_KEY) || "zh");
    } catch {
      return "zh";
    }
  }

  function isEn() {
    return getLang() === "en";
  }

  function pad(original, replacement) {
    const lead = (original.match(/^\s*/) || [""])[0];
    const trail = (original.match(/\s*$/) || [""])[0];
    return lead + replacement + trail;
  }

  function applyTextNode(node, en) {
    if (originalText.has(node)) {
      const original = originalText.get(node);
      if (en) {
        const key = original.trim();
        node.nodeValue = Object.prototype.hasOwnProperty.call(EN, key)
          ? pad(original, EN[key])
          : original;
      } else {
        node.nodeValue = original;
        originalText.delete(node);
      }
      return;
    }
    if (!en) return;
    const current = node.nodeValue;
    const key = current.trim();
    if (!key || !Object.prototype.hasOwnProperty.call(EN, key)) return;
    originalText.set(node, current);
    node.nodeValue = pad(current, EN[key]);
  }

  function applyAttr(el, attr, en) {
    if (!el.hasAttribute(attr)) return;
    let map = originalAttrs.get(el);
    if (!map) {
      map = new Map();
      originalAttrs.set(el, map);
    }
    if (!map.has(attr)) map.set(attr, el.getAttribute(attr));
    const original = map.get(attr);
    const key = (original || "").trim();
    if (en && Object.prototype.hasOwnProperty.call(ATTR, key)) {
      el.setAttribute(attr, ATTR[key]);
    } else {
      el.setAttribute(attr, original);
    }
  }

  function updateToggles() {
    const en = isEn();
    const label = en ? "中" : "EN";
    const title = en ? "切换为简体中文 (L)" : "Switch to English (L)";
    document.querySelectorAll(".lang-toggle-btn").forEach((btn) => {
      btn.setAttribute("title", title);
      btn.setAttribute("aria-label", title);
      const textEl = btn.querySelector(".lang-toggle-text");
      if (textEl) textEl.textContent = label;
      else btn.textContent = label;
    });
  }

  function applyStatic() {
    const en = isEn();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const tag = node.parentNode && node.parentNode.nodeName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) applyTextNode(node, en);

    document.querySelectorAll("[placeholder],[title],[aria-label],[alt]").forEach((el) => {
      ["placeholder", "title", "aria-label", "alt"].forEach((attr) => applyAttr(el, attr, en));
    });

    document.documentElement.lang = en ? "en" : "zh-CN";
    document.title = DOC.title[en ? "en" : "zh"];
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", DOC.description[en ? "en" : "zh"]);

    updateToggles();
  }

  function t(key) {
    if (!isEn()) return key;
    return EN[key] || key;
  }

  function tCategory(cat) {
    if (!cat) return "";
    if (!isEn()) {
      if (cat === "all") return "全部";
      return cat;
    }
    return CATEGORIES[cat] || cat;
  }

  function setLang(lang) {
    const next = normalize(lang);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    applyStatic();
    listeners.forEach((cb) => {
      try { cb(next); } catch {}
    });
    return next;
  }

  function toggleLang() {
    return setLang(isEn() ? "zh" : "en");
  }

  function onChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  // Keyboard shortcut: L toggles language when not typing in input/textarea
  document.addEventListener("keydown", (e) => {
    if (e.key === "l" || e.key === "L") {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
        return;
      }
      toggleLang();
    }
  });

  
  // Cross-tab language synchronization
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && (e.newValue === "zh" || e.newValue === "en")) {
      applyStatic();
      listeners.forEach((cb) => {
        try { cb(e.newValue); } catch {}
      });
    }
  });

  window.I18n = {
    getLang,
    setLang,
    toggleLang,
    isEn,
    t,
    tCategory,
    applyStatic,
    onChange
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyStatic);
  } else {
    applyStatic();
  }
})();
