const state = {
  all: [],
  filtered: [],
  category: "all",
  platform: "all",
  page: 1,
  pageSize: 100,
};

const elements = {
  tabs: document.querySelector("#category-tabs"),
  title: document.querySelector("#collection-title"),
  search: document.querySelector("#search"),
  platform: document.querySelector("#platform-filter"),
  pageSize: document.querySelector("#page-size"),
  rows: document.querySelector("#music-rows"),
  playAll: document.querySelector("#play-all"),
  nowPlaying: document.querySelector("#now-playing"),
  playerToggle: document.querySelector("#player-toggle"),
  playerPrevious: document.querySelector("#player-previous"),
  playerNext: document.querySelector("#player-next"),
  playerShuffle: document.querySelector("#player-shuffle"),
  playerRepeat: document.querySelector("#player-repeat"),
  playerSeek: document.querySelector("#player-seek"),
  playerTime: document.querySelector("#player-time"),
  playerTitle: document.querySelector("#player-title"),
  playerSubtitle: document.querySelector("#player-subtitle"),
  playerCover: document.querySelector("#player-cover"),
  playerVolume: document.querySelector("#player-volume"),
  playerMute: document.querySelector("#player-mute"),
  status: document.querySelector("#status"),
  first: document.querySelector("#first-page"),
  previous: document.querySelector("#previous-page"),
  pageNumber: document.querySelector("#page-number"),
  pageTotal: document.querySelector("#page-total"),
  jump: document.querySelector("#jump-page"),
  next: document.querySelector("#next-page"),
  last: document.querySelector("#last-page"),
};

const integerFormat = new Intl.NumberFormat("zh-CN");

function cell(className, text) {
  const node = document.createElement("td");
  if (className) node.className = className;
  node.textContent = text || "—";
  return node;
}

const ICON_PLAY = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>';
const ICON_PAUSE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>';
const ICON_LOADING = '<svg class="play-spinner" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"></path></svg>';

// 在页面内用 YouTube 音源播放：先把「歌名 + 歌手」解析为视频 ID，再交给隐藏的 YouTube 播放器。
// 首选自有的 Cloudflare Pages Function（YouTube Music 搜索代理）；GitHub Pages 等无后端站点跨域调用它。
const SEARCH_API = location.hostname.endsWith("pages.dev") ? "/api/search" : "https://music-collection.pages.dev/api/search";
const PIPED_FALLBACK = "https://api.piped.private.coffee/search";

const player = { yt: null, ready: null, currentId: null, status: "idle", queue: [], queueSource: [], queueIndex: -1, queueKey: "", mode: "sequential", repeat: "off", volume: 100, muted: false, videoId: null, seeking: false, requestId: 0, progressTimer: null };
const searchIndex = new WeakMap();

function searchText(track) {
  if (!searchIndex.has(track)) {
    searchIndex.set(track, [track.title, track.artists, track.album, track.category, ...track.playlist_names]
      .join(" ").toLocaleLowerCase("zh-CN"));
  }
  return searchIndex.get(track);
}

function readCache(key) {
  try { return localStorage.getItem(`ytid:${key}`); } catch { return null; }
}
function writeCache(key, value) {
  try { localStorage.setItem(`ytid:${key}`, value); } catch { /* 忽略存储失败 */ }
}

async function resolveVideoId(track) {
  const key = `${track.title} ${track.artists}`.trim();
  const cached = readCache(key);
  if (cached) return cached;
  const q = encodeURIComponent(key);
  let id;
  try {
    const response = await fetch(`${SEARCH_API}?q=${q}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(String(response.status));
    id = (await response.json()).id;
  } catch {
    const response = await fetch(`${PIPED_FALLBACK}?q=${q}&filter=music_songs`, { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    id = (data.items || []).map((i) => (i.url || "").split("v=")[1]).find(Boolean);
  }
  if (!id) throw new Error("not found");
  writeCache(key, id);
  return id;
}

function loadYouTubeApi() {
  if (player.ready) return player.ready;
  player.ready = new Promise((resolve, reject) => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;width:1px;height:1px;left:-9999px;top:0;overflow:hidden;";
    const mount = document.createElement("div");
    host.append(mount);
    document.body.append(host);
    window.onYouTubeIframeAPIReady = () => {
      player.yt = new YT.Player(mount, {
        width: "200", height: "200",
        playerVars: { playsinline: 1, controls: 0 },
        events: {
          onReady: () => {
            applyVolume();
            syncProgressTimer();
            resolve(player.yt);
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) setStatus("playing");
            else if (e.data === YT.PlayerState.PAUSED) setStatus("paused");
            else if (e.data === YT.PlayerState.ENDED) handleTrackEnded();
            else if (e.data === YT.PlayerState.BUFFERING) setStatus("loading");
          },
          onError: () => { if (playNext()) return; const t = player.currentTrack; setStatus("idle", null); if (t) openInYouTubeMusic(t); },
        },
      });
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => { player.ready = null; reject(new Error("youtube api")); };
    document.head.append(script);
  });
  return player.ready;
}

function openInYouTubeMusic(track) {
  const q = encodeURIComponent(`${track.title} ${track.artists}`.trim());
  window.open(`https://music.youtube.com/search?q=${q}`, "_blank", "noopener,noreferrer");
}

function paintButton(anchor, trackId) {
  const active = trackId === player.currentId ? player.status : "idle";
  anchor.dataset.state = active;
  anchor.innerHTML = active === "playing" ? ICON_PAUSE : active === "loading" ? ICON_LOADING : ICON_PLAY;
  const name = anchor.dataset.name;
  const label = active === "playing" ? `暂停《${name}》` : active === "loading" ? `正在加载《${name}》` : `播放《${name}》`;
  anchor.title = active === "playing" ? `正在播放《${name}》（点击暂停）` : label;
  anchor.setAttribute("aria-label", label);
  anchor.disabled = active === "loading";
}

function setStatus(status, id = player.currentId) {
  player.status = status;
  player.currentId = id;
  syncProgressTimer();
  document.querySelectorAll(".play-btn").forEach((btn) => paintButton(btn, Number(btn.dataset.id)));
  updatePlayAll();
}

function currentListKey() {
  return `${state.category}|${state.platform}|${elements.search.value.trim()}`;
}

function updatePlayAll() {
  const btn = elements.playAll;
  if (!btn) return;
  const active = player.currentId !== null && player.status !== "idle";
  const playing = active && player.status === "playing";
  const loading = active && player.status === "loading";
  btn.querySelector(".play-all-icon").innerHTML = ICON_PLAY;
  btn.disabled = state.filtered.length === 0;
  btn.title = "从头播放当前筛选结果中的全部歌曲（包含所有分页），沿用底部选择的播放模式";
  const track = player.currentTrack;
  elements.playerTitle.textContent = track ? track.title : "尚未播放";
  elements.playerSubtitle.textContent = track ? [loading ? "正在加载" : playing ? "正在播放" : active ? "已暂停" : "播放已结束", track.artists, track.album].filter(Boolean).join(" · ") : "选择歌曲或播放全部";
  elements.nowPlaying.title = `${elements.playerTitle.textContent} · ${elements.playerSubtitle.textContent}`;
  elements.playerToggle.dataset.state = active ? player.status : "idle";
  elements.playerToggle.querySelector(".play-all-icon").innerHTML = loading ? ICON_LOADING : playing ? ICON_PAUSE : ICON_PLAY;
  elements.playerToggle.querySelector(".play-all-label").textContent = loading ? "加载中…" : playing ? "暂停" : active ? "继续" : "播放";
  elements.playerToggle.setAttribute("aria-label", elements.playerToggle.querySelector(".play-all-label").textContent);
  elements.playerToggle.title = elements.playerToggle.querySelector(".play-all-label").textContent;
  elements.playerToggle.disabled = loading || (!track && state.filtered.length === 0);
  elements.playerPrevious.disabled = !player.queue.length || (player.queueIndex <= 0 && player.repeat !== "all");
  elements.playerNext.disabled = !player.queue.length || (player.queueIndex >= player.queue.length - 1 && player.repeat !== "all");
  elements.playerShuffle.setAttribute("aria-pressed", String(player.mode === "shuffle"));
  elements.playerShuffle.title = `随机播放：${player.mode === "shuffle" ? "开启" : "关闭"}`;
  const repeatLabel = `循环：${player.repeat === "off" ? "关闭" : player.repeat === "all" ? "列表循环" : "单曲循环"}`;
  elements.playerRepeat.title = repeatLabel;
  elements.playerRepeat.setAttribute("aria-label", repeatLabel);
  elements.playerRepeat.setAttribute("aria-pressed", String(player.repeat !== "off"));
  elements.playerRepeat.querySelector(".repeat-one").hidden = player.repeat !== "one";
  updatePlaybackTime();
}

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function updatePlaybackTime() {
  if (player.seeking || document.hidden) return;
  const ready = player.videoId && player.yt?.getVideoData?.().video_id === player.videoId;
  const duration = ready ? player.yt.getDuration() || 0 : 0;
  const current = ready ? Math.min(player.yt.getCurrentTime() || 0, duration) : 0;
  elements.playerTime.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
  elements.playerSeek.max = String(duration || 1);
  elements.playerSeek.value = String(current);
  elements.playerSeek.disabled = !duration;
  elements.playerSeek.style.setProperty("--progress", `${duration ? current / duration * 100 : 0}%`);
  elements.playerSeek.setAttribute("aria-valuetext", `${formatTime(current)}，共 ${formatTime(duration)}`);
}

function syncProgressTimer() {
  const active = !document.hidden && player.status === "playing" && player.yt;
  if (active && player.progressTimer === null) {
    player.progressTimer = setInterval(updatePlaybackTime, 500);
  } else if (!active && player.progressTimer !== null) {
    clearInterval(player.progressTimer);
    player.progressTimer = null;
  }
}

document.addEventListener("visibilitychange", () => {
  syncProgressTimer();
  if (!document.hidden) updatePlaybackTime();
});

function previewSeek() {
  player.seeking = true;
  const current = Number(elements.playerSeek.value);
  const duration = Number(elements.playerSeek.max);
  elements.playerTime.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
  elements.playerSeek.style.setProperty("--progress", `${current / duration * 100}%`);
  elements.playerSeek.setAttribute("aria-valuetext", `${formatTime(current)}，共 ${formatTime(duration)}`);
}

function commitSeek() {
  if (player.videoId && !elements.playerSeek.disabled) player.yt.seekTo(Number(elements.playerSeek.value), true);
  player.seeking = false;
  updatePlaybackTime();
}

function applyVolume() {
  if (player.yt?.setVolume) {
    player.yt.setVolume(player.volume);
    if (player.muted) player.yt.mute(); else player.yt.unMute();
  }
  const silent = player.muted || player.volume === 0;
  elements.playerMute.setAttribute("aria-pressed", String(silent));
  elements.playerMute.setAttribute("aria-label", silent ? "取消静音" : "静音");
  elements.playerMute.title = silent ? "取消静音" : "静音";
  elements.playerVolume.value = String(player.muted ? 0 : player.volume);
  elements.playerVolume.style.setProperty("--progress", `${player.muted ? 0 : player.volume}%`);
}

function handleTrackEnded() {
  if (player.repeat === "one" && player.currentTrack) startTrack(player.currentTrack, true);
  else if (!playNext(player.repeat === "all")) setStatus("idle", null);
}

function shuffleTracks(tracks) {
  const result = tracks.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function changePlayMode(event) {
  player.mode = event.target.value;
  if (!player.queue.length) { updatePlayAll(); return; }
  const remainingIds = new Set(player.queue.slice(player.queueIndex + 1).map((track) => track.id));
  const remaining = player.queueSource.filter((track) => remainingIds.has(track.id));
  player.queue = player.queue.slice(0, player.queueIndex + 1).concat(player.mode === "shuffle" ? shuffleTracks(remaining) : remaining);
  updatePlayAll();
}

function playNext(wrap = false) {
  if (!player.queue.length || (player.queueIndex >= player.queue.length - 1 && !wrap)) return false;
  player.queueIndex = (player.queueIndex + 1) % player.queue.length;
  startTrack(player.queue[player.queueIndex], true);
  return true;
}

function playPrevious() {
  if (!player.queue.length || (player.queueIndex <= 0 && player.repeat !== "all")) return;
  player.queueIndex = (player.queueIndex - 1 + player.queue.length) % player.queue.length;
  startTrack(player.queue[player.queueIndex], true);
}

function togglePlayer() {
  if (player.status === "idle" && player.currentTrack && player.queue.length) {
    startTrack(player.queue[player.queueIndex], true);
    return;
  }
  togglePlayAll();
}

function togglePlayAll() {
  if (player.status === "loading") return;
  if (player.currentId !== null && player.yt) {
    if (player.status === "playing") player.yt.pauseVideo();
    else if (player.status === "paused") player.yt.playVideo();
    if (player.status === "playing" || player.status === "paused") return;
  }
  startList();
}

function startList() {
  if (!state.filtered.length) return;
  prepareQueue();
  startTrack(player.queue[player.queueIndex], true);
}

function prepareQueue(track = null) {
  player.queueSource = state.filtered.slice();
  if (track && !player.queueSource.some((item) => item.id === track.id)) player.queueSource = [track];
  player.queue = player.mode === "shuffle"
    ? track ? [track, ...shuffleTracks(player.queueSource.filter((item) => item.id !== track.id))] : shuffleTracks(player.queueSource)
    : player.queueSource.slice();
  player.queueKey = currentListKey();
  player.queueIndex = track ? player.queue.findIndex((item) => item.id === track.id) : 0;
}

async function togglePlay(track) {
  if (player.currentId === track.id && player.status === "loading") return;
  if (player.currentId === track.id && player.yt && (player.status === "playing" || player.status === "paused")) {
    if (player.status === "playing") player.yt.pauseVideo(); else player.yt.playVideo();
    return;
  }
  prepareQueue(track);
  startTrack(track, true);
}

async function startTrack(track, inQueue) {
  const requestId = ++player.requestId;
  player.videoId = null;
  player.seeking = false;
  elements.playerCover.src = "assets/favicon.svg";
  player.currentTrack = track;
  setStatus("loading", track.id);
  try {
    const [id, yt] = await Promise.all([resolveVideoId(track), loadYouTubeApi()]);
    if (player.requestId !== requestId) return; // 忽略已被新播放请求替代的解析结果
    player.videoId = id;
    elements.playerCover.src = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/default.jpg`;
    yt.loadVideoById(id);
  } catch {
    if (player.requestId !== requestId) return;
    if (inQueue) { if (player.currentId === track.id && !playNext()) setStatus("idle", null); return; } // 队列中跳过无法播放的歌曲
    if (player.currentId === track.id) setStatus("idle", null);
    openInYouTubeMusic(track); // 无法在页内解析音源时，退回到 YouTube Music
  }
}

function sourceCell(track) {
  const node = document.createElement("td");
  node.className = "play-cell";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "play-btn";
  button.dataset.id = String(track.id);
  button.dataset.name = track.title;
  paintButton(button, track.id);
  button.addEventListener("click", () => togglePlay(track));
  node.append(button);
  return node;
}

function renderRows() {
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const visible = state.filtered.slice(start, start + state.pageSize);
  const fragment = document.createDocumentFragment();

  if (!visible.length) {
    const row = document.createElement("tr");
    const message = cell("message", "没有找到匹配的歌曲");
    message.colSpan = 6;
    row.append(message);
    fragment.append(row);
  } else {
    visible.forEach((track, index) => {
        const row = document.createElement("tr");
        const category = document.createElement("td");
        category.className = "category-cell";
        const badge = document.createElement("span");
        badge.className = "category-badge";
        badge.textContent = typeof window !== "undefined" && window.I18n ? window.I18n.tCategory(track.category) : track.category;
        category.append(badge);

        // 1. 歌手单元格（挂载完整 title 提示）
        const artistNode = document.createElement("td");
        artistNode.className = "artist";
        artistNode.title = track.artists || "—";
        const artistName = document.createElement("span");
        artistName.className = "artist-name";
        artistName.textContent = track.artists || "—";
        artistNode.append(artistName);
        if (track.album) {
          const sep = document.createElement("span");
          sep.className = "album-separator";
          sep.textContent = " · ";
          const albumMobile = document.createElement("span");
          albumMobile.className = "album-mobile-name";
          albumMobile.textContent = track.album;
          artistNode.append(sep, albumMobile);
          artistNode.title = `${track.artists || "—"} · ${track.album}`;
        }

        // 2. 歌曲单元格（挂载完整 title 提示）
        const songNode = document.createElement("td");
        songNode.className = "song";
        songNode.title = track.title;
        const songLink = document.createElement("a");
        songLink.className = "song-title-link";
        songLink.href = `https://music.youtube.com/search?q=${encodeURIComponent(`${track.title} ${track.artists}`.trim())}`;
        songLink.target = "_blank";
        songLink.rel = "noopener noreferrer";
        songLink.title = track.title;
        songLink.textContent = track.title;
        songNode.append(songLink);

        // 3. 专辑单元格（包裹 span 并挂载完整 title 提示）
        const albumNode = document.createElement("td");
        albumNode.className = "album";
        albumNode.title = track.album || "—";
        const albumSpan = document.createElement("span");
        albumSpan.className = "album-text";
        albumSpan.textContent = track.album || "—";
        albumNode.append(albumSpan);

        row.append(
          cell("rank", integerFormat.format(start + index + 1)),
          songNode,
          artistNode,
          albumNode,
          category,
          sourceCell(track),
        );
        fragment.append(row);
      });
  }

  elements.rows.replaceChildren(fragment);
  const isEn = typeof window !== "undefined" && window.I18n && window.I18n.isEn();
  const categoryName = typeof window !== "undefined" && window.I18n ? window.I18n.tCategory(state.category) : (state.category === "all" ? "全部" : state.category);
  const query = elements.search.value.trim();
  const qualifier = query ? (isEn ? `, searching "${query}"` : `，搜索“${query}”`) : "";
  elements.status.textContent = isEn ? `${categoryName}${qualifier}: ${integerFormat.format(state.filtered.length)} ${state.filtered.length === 1 ? "track" : "tracks"}` : `${categoryName}${qualifier}：共 ${integerFormat.format(state.filtered.length)} 首`;
  if (typeof window !== "undefined" && window.__musicSyncMobileCategory) window.__musicSyncMobileCategory(state.category, integerFormat.format(state.filtered.length));
  elements.pageNumber.value = String(state.page);
  elements.pageNumber.max = String(totalPages);
  elements.pageTotal.textContent = (window.I18n && window.I18n.isEn()) ? `/ ${totalPages}` : `/ ${totalPages} 页`;
  const empty = state.filtered.length === 0;
  elements.first.disabled = empty || state.page <= 1;
  elements.previous.disabled = empty || state.page <= 1;
  elements.next.disabled = empty || state.page >= totalPages;
  elements.last.disabled = empty || state.page >= totalPages;
  elements.pageNumber.disabled = empty;
  elements.jump.disabled = empty;
  updatePlayAll();
}

function applyFilters(resetPage = true) {
  const query = elements.search.value.trim().toLocaleLowerCase("zh-CN");
  state.filtered = state.all.filter((track) => {
    if (state.category !== "all" && track.category !== state.category) return false;
    if (state.platform !== "all" && !track.platforms.includes(state.platform)) return false;
    if (!query) return true;
    return searchText(track).includes(query);
  });
  if (resetPage) state.page = 1;
  renderRows();
}

function activateCategory(category) {
  state.category = category;
  elements.tabs.querySelectorAll(".tab").forEach((button) => {
    const active = button.dataset.category === category;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  elements.title.textContent = typeof window !== "undefined" && window.I18n ? window.I18n.tCategory(category) : (category === "all" ? "全部" : category);
  if (typeof window !== "undefined" && window.__musicSyncMobileCategory) window.__musicSyncMobileCategory(category);
  applyFilters();
}

function renderTabs() {
  if (!elements.tabs || !elements.tabs.querySelectorAll) return;
  const isEn = typeof window !== "undefined" && window.I18n && window.I18n.isEn();
  const allBtn = elements.tabs.querySelector("[data-category='all']");
  if (allBtn && allBtn.firstChild) {
    allBtn.firstChild.nodeValue = `${isEn ? "All" : "全部"} `;
  }
  const categories = typeof window !== "undefined" ? window.__categoriesData : [];
  if (categories && categories.length) {
    elements.tabs.querySelectorAll(".tab:not([data-category='all'])").forEach((button) => {
      const catKey = button.dataset.category;
      const catData = categories.find((c) => c.key === catKey);
      if (!catData) return;
      const label = isEn ? (typeof window !== "undefined" && window.I18n ? window.I18n.tCategory(catKey) : catKey) : (catData ? catData.label : catKey);
      button.innerHTML = `${label} <span>${integerFormat.format(catData.count)}</span>`;
    });
  }
}
if (typeof window !== "undefined") window.__renderTabs = renderTabs;

function buildTabs(payload) {
  if (typeof window !== "undefined") window.__categoriesData = payload.categories;
  const isEn = typeof window !== "undefined" && window.I18n && window.I18n.isEn();
  const allBtn = elements.tabs.querySelector("[data-category='all']");
  if (allBtn) {
    if (allBtn.firstChild) allBtn.firstChild.nodeValue = `${isEn ? "All" : "全部"} `;
    const allCount = allBtn.querySelector("#all-count");
    if (allCount) allCount.textContent = integerFormat.format(payload.total);
    allBtn.addEventListener("click", () => activateCategory("all"));
  }
  payload.categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    button.dataset.category = category.key;
    const label = isEn ? (typeof window !== "undefined" && window.I18n ? window.I18n.tCategory(category.key) : category.label) : category.label;
    button.innerHTML = `${label} <span>${integerFormat.format(category.count)}</span>`;
    button.addEventListener("click", () => activateCategory(category.key));
    elements.tabs.append(button);
  });
  if (typeof window !== "undefined" && window.__musicSyncMobileCategory) window.__musicSyncMobileCategory("all", integerFormat.format(payload.total));
}

function jumpToPage() {
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  const requested = Number.parseInt(elements.pageNumber.value, 10);
  if (!Number.isFinite(requested)) return;
  state.page = Math.min(totalPages, Math.max(1, requested));
  renderRows();
  document.querySelector(".collection__head").scrollIntoView({ behavior: "smooth" });
}

if (elements.playAll) elements.playAll.addEventListener("click", startList);
elements.playerShuffle.addEventListener("click", () => changePlayMode({ target: { value: player.mode === "shuffle" ? "sequential" : "shuffle" } }));
elements.playerRepeat.addEventListener("click", () => { player.repeat = player.repeat === "off" ? "all" : player.repeat === "all" ? "one" : "off"; updatePlayAll(); });
elements.playerToggle.addEventListener("click", togglePlayer);
elements.playerPrevious.addEventListener("click", playPrevious);
elements.playerNext.addEventListener("click", () => playNext(player.repeat === "all"));
elements.playerSeek.addEventListener("input", previewSeek);
elements.playerSeek.addEventListener("change", commitSeek);
elements.playerSeek.addEventListener("blur", () => { player.seeking = false; updatePlaybackTime(); });
elements.playerVolume.addEventListener("input", () => { player.volume = Number(elements.playerVolume.value); player.muted = false; applyVolume(); });
elements.playerMute.addEventListener("click", () => { if (player.volume === 0) { player.volume = 100; player.muted = false; } else player.muted = !player.muted; applyVolume(); });
elements.playerCover.addEventListener("error", () => { if (elements.playerCover.getAttribute("src") !== "assets/favicon.svg") elements.playerCover.src = "assets/favicon.svg"; });
elements.search.addEventListener("input", () => applyFilters());
elements.platform.addEventListener("change", () => { state.platform = elements.platform.value; applyFilters(); });
elements.pageSize.addEventListener("change", () => { state.pageSize = Number(elements.pageSize.value) || 100; applyFilters(); });
elements.first.addEventListener("click", () => { state.page = 1; renderRows(); });
elements.previous.addEventListener("click", () => { state.page -= 1; renderRows(); });
elements.next.addEventListener("click", () => { state.page += 1; renderRows(); });
elements.last.addEventListener("click", () => { state.page = Math.max(1, Math.ceil(state.filtered.length / state.pageSize)); renderRows(); });
elements.jump.addEventListener("click", jumpToPage);
elements.pageNumber.addEventListener("keydown", (event) => { if (event.key === "Enter") jumpToPage(); });

fetch("data/music.json")
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then((payload) => {
    state.all = payload.tracks;
    buildTabs(payload);
    document.querySelector("#total-stat").textContent = integerFormat.format(payload.total);
    document.querySelector("#category-stat").textContent = integerFormat.format(payload.categories.length);
    document.querySelector("#platform-stat").textContent = integerFormat.format(Object.keys(payload.platform_counts).length);
    const updated = new Date(payload.generated_at);
    const updateText = `数据更新时间：${updated.toLocaleString("zh-CN", { hour12: false })}`;
    document.querySelector("#footer-updated").textContent = updateText;
    elements.playerShuffle.disabled = false;
    elements.search.disabled = false;
    elements.platform.disabled = false;
    elements.pageSize.disabled = false;
    activateCategory("all");
  })
  .catch((error) => {
    elements.status.textContent = `音乐数据载入失败：${error.message}`;
    const row = document.createElement("tr");
    const message = cell("message", "无法载入音乐收藏数据");
    message.colSpan = 7;
    row.append(message);
    elements.rows.replaceChildren(row);
  });


/* ========================================================
   Theme, Drawer & Modal Controllers for Music Collection
   ======================================================== */
(function initMusicEnhancements() {
  // 1. Theme Controller
  const themeToggleBtn = document.querySelector("#theme-toggle-btn");
  const drawerThemeToggleBtn = document.querySelector("#mobile-theme-toggle");
  const sunIcons = [document.querySelector("#theme-icon-sun"), document.querySelector("#drawer-theme-icon-sun")];
  const moonIcons = [document.querySelector("#theme-icon-moon"), document.querySelector("#drawer-theme-icon-moon")];

  function getPreferredTheme() {
    const saved = localStorage.getItem("music_theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
    localStorage.setItem("music_theme", theme);
    const isDark = theme === "dark";
    const navSun = document.querySelector("#theme-icon-sun");
    const navMoon = document.querySelector("#theme-icon-moon");
    if (navSun) navSun.style.display = isDark ? "block" : "none";
    if (navMoon) navMoon.style.display = isDark ? "none" : "block";

    const drawerSun = document.querySelector("#drawer-theme-icon-sun");
    const drawerMoon = document.querySelector("#drawer-theme-icon-moon");
    if (drawerSun) drawerSun.style.display = isDark ? "none" : "block";
    if (drawerMoon) drawerMoon.style.display = isDark ? "block" : "none";
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || getPreferredTheme();
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
  }

  if (themeToggleBtn) themeToggleBtn.addEventListener("click", toggleTheme);
  if (drawerThemeToggleBtn) drawerThemeToggleBtn.addEventListener("click", toggleTheme);

  document.addEventListener("keydown", (e) => {
    if (e.key === "d" || e.key === "D") {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) return;
      toggleTheme();
    }
  });

  applyTheme(getPreferredTheme());

  // 2. Drawer Controller
  const drawerLayer = document.querySelector("#mobile-drawer-layer");
  const drawerBackdrop = document.querySelector("#mobile-drawer-backdrop");
  const drawerOpenBtn = document.querySelector("#mobile-drawer-toggle");
  const drawerCloseBtn = document.querySelector("#mobile-drawer-close");
  const drawerCategoryBtn = document.querySelector("#mobileDrawerCategoryBtn");
  const drawerSearchBtn = document.querySelector("#mobileDrawerSearchBtn");

  function openDrawer() {
    if (drawerLayer) drawerLayer.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    if (drawerLayer) drawerLayer.hidden = true;
    document.body.style.overflow = "";
  }

  if (drawerOpenBtn) drawerOpenBtn.addEventListener("click", openDrawer);
  if (drawerCloseBtn) drawerCloseBtn.addEventListener("click", closeDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener("click", closeDrawer);

  if (drawerCategoryBtn) {
    drawerCategoryBtn.addEventListener("click", () => {
      closeDrawer();
      openSwitchCategoryModal();
    });
  }

  if (drawerSearchBtn) {
    drawerSearchBtn.addEventListener("click", () => {
      closeDrawer();
      const searchInput = document.querySelector("#search");
      if (searchInput) {
        searchInput.scrollIntoView({ behavior: "smooth" });
        setTimeout(() => searchInput.focus(), 300);
      }
    });
  }

  // 3. Category Modal Controller
  const modalLayer = document.querySelector("#switch-category-modal");
  const modalBackdrop = document.querySelector("#switch-category-backdrop");
  const modalCloseBtn = document.querySelector("#closeSwitchCategoryModal");
  const openModalBtn = document.querySelector("#mobileOpenCategoryModalBtn");
  const modalCategoryList = document.querySelector("#modalCategoryList");

  function openSwitchCategoryModal() {
    if (window.__renderModalCategories) window.__renderModalCategories();
    if (modalLayer) modalLayer.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeSwitchCategoryModal() {
    if (modalLayer) modalLayer.hidden = true;
    document.body.style.overflow = "";
  }

  if (openModalBtn) openModalBtn.addEventListener("click", openSwitchCategoryModal);
  if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeSwitchCategoryModal);
  if (modalBackdrop) modalBackdrop.addEventListener("click", closeSwitchCategoryModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (modalLayer && !modalLayer.hidden) closeSwitchCategoryModal();
      else if (drawerLayer && !drawerLayer.hidden) closeDrawer();
    }
  });

  // Expose helpers globally for app.js integration
  window.__musicSyncMobileCategory = function(categoryKey, count) {
    const isEn = window.I18n && window.I18n.isEn();
    const tag = document.querySelector("#mobileCurrentCategoryTag");
    const countEl = document.querySelector("#mobileFilterCount");
    if (tag) {
      tag.textContent = window.I18n ? window.I18n.tCategory(categoryKey) : (categoryKey === "all" ? "全部" : categoryKey);
    }
    if (countEl && count !== undefined) {
      countEl.textContent = isEn ? `(${count})` : `(${count} 首)`;
    }
  };

  window.__categoriesData = [];
  window.__renderModalCategories = function() {
    if (!modalCategoryList) return;
    modalCategoryList.innerHTML = "";
    const isEn = window.I18n && window.I18n.isEn();
    const countSuffix = isEn ? "" : " 首";
    
    // Add "All" option
    const totalCount = state.all.length;
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "modal-category-item" + (state.category === "all" ? " is-active" : "");
    allBtn.innerHTML = `<span>${isEn ? "All" : "全部"}</span><span class="modal-category-badge">${integerFormat.format(totalCount)}${countSuffix}</span>`;
    allBtn.addEventListener("click", () => {
      activateCategory("all");
      closeSwitchCategoryModal();
    });
    modalCategoryList.append(allBtn);

    // Add each category
    if (window.__categoriesData && window.__categoriesData.length) {
      window.__categoriesData.forEach(cat => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "modal-category-item" + (state.category === cat.key ? " is-active" : "");
        const label = isEn ? (window.I18n ? window.I18n.tCategory(cat.key) : cat.label) : cat.label;
        btn.innerHTML = `<span>${label}</span><span class="modal-category-badge">${integerFormat.format(cat.count)}${countSuffix}</span>`;
        btn.addEventListener("click", () => {
          activateCategory(cat.key);
          closeSwitchCategoryModal();
        });
        modalCategoryList.append(btn);
      });
    }
  };

  // Language toggle wire-up
  const desktopLangToggle = document.querySelector("#lang-toggle-btn");
  const mobileLangToggle = document.querySelector("#mobile-lang-toggle");
  if (desktopLangToggle) {
    desktopLangToggle.addEventListener("click", () => {
      if (window.I18n) window.I18n.toggleLang();
    });
  }
  if (mobileLangToggle) {
    mobileLangToggle.addEventListener("click", () => {
      if (window.I18n) window.I18n.toggleLang();
    });
  }
  if (window.I18n) {
    window.I18n.onChange(() => {
      elements.title.textContent = window.I18n ? window.I18n.tCategory(state.category) : (state.category === "all" ? "全部" : state.category);
      renderRows();
      if (window.__renderTabs) window.__renderTabs();
      if (window.__renderModalCategories) window.__renderModalCategories();
    });
  }

})();
