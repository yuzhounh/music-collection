const state = {
  all: [],
  filtered: [],
  category: "all",
  platform: "all",
  page: 1,
  pageSize: 50,
};

const elements = {
  tabs: document.querySelector("#category-tabs"),
  title: document.querySelector("#collection-title"),
  search: document.querySelector("#search"),
  platform: document.querySelector("#platform-filter"),
  pageSize: document.querySelector("#page-size"),
  rows: document.querySelector("#music-rows"),
  status: document.querySelector("#status"),
  updated: document.querySelector("#updated"),
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

function sourceCell(track) {
  const node = document.createElement("td");
  const wrapper = document.createElement("div");
  wrapper.className = "source-links";
  const sources = [
    { key: "netease", label: "网易云", domain: "music.163.com" },
    { key: "kuwo", label: "酷我", domain: "kuwo.cn" },
  ];
  sources.forEach((source) => {
    const link = track.links.find((item) => item.includes(source.domain));
    if (link) {
      const anchor = document.createElement("a");
      anchor.className = "source-link";
      anchor.href = link;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = source.label;
      wrapper.append(anchor);
    } else if (track.platforms.includes(source.key)) {
      const label = document.createElement("span");
      label.className = "source-link source-link--disabled";
      label.textContent = source.label;
      wrapper.append(label);
    }
  });
  node.append(wrapper);
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
      badge.textContent = track.category;
      category.append(badge);
      row.append(
        cell("rank", integerFormat.format(start + index + 1)),
        cell("song", track.title),
        cell("artist", track.artists),
        cell("album", track.album),
        category,
        sourceCell(track),
      );
      fragment.append(row);
    });
  }

  elements.rows.replaceChildren(fragment);
  const categoryName = state.category === "all" ? "全部" : state.category;
  const query = elements.search.value.trim();
  const qualifier = query ? `，搜索“${query}”` : "";
  elements.status.textContent = `${categoryName}${qualifier}：共 ${integerFormat.format(state.filtered.length)} 首`;
  elements.pageNumber.value = String(state.page);
  elements.pageNumber.max = String(totalPages);
  elements.pageTotal.textContent = `/ ${totalPages} 页`;
  const empty = state.filtered.length === 0;
  elements.first.disabled = empty || state.page <= 1;
  elements.previous.disabled = empty || state.page <= 1;
  elements.next.disabled = empty || state.page >= totalPages;
  elements.last.disabled = empty || state.page >= totalPages;
  elements.pageNumber.disabled = empty;
  elements.jump.disabled = empty;
}

function applyFilters(resetPage = true) {
  const query = elements.search.value.trim().toLocaleLowerCase("zh-CN");
  state.filtered = state.all.filter((track) => {
    if (state.category !== "all" && track.category !== state.category) return false;
    if (state.platform !== "all" && !track.platforms.includes(state.platform)) return false;
    if (!query) return true;
    const haystack = [track.title, track.artists, track.album, track.category, ...track.playlist_names]
      .join(" ")
      .toLocaleLowerCase("zh-CN");
    return haystack.includes(query);
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
  elements.title.textContent = category === "all" ? "全部" : category;
  applyFilters();
}

function buildTabs(payload) {
  document.querySelector("#all-count").textContent = integerFormat.format(payload.total);
  payload.categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    button.dataset.category = category.key;
    button.innerHTML = `${category.label} <span>${integerFormat.format(category.count)}</span>`;
    button.addEventListener("click", () => activateCategory(category.key));
    elements.tabs.append(button);
  });
  elements.tabs.querySelector("[data-category='all']").addEventListener("click", () => activateCategory("all"));
}

function jumpToPage() {
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  const requested = Number.parseInt(elements.pageNumber.value, 10);
  if (!Number.isFinite(requested)) return;
  state.page = Math.min(totalPages, Math.max(1, requested));
  renderRows();
  document.querySelector(".collection__head").scrollIntoView({ behavior: "smooth" });
}

elements.search.addEventListener("input", () => applyFilters());
elements.platform.addEventListener("change", () => { state.platform = elements.platform.value; applyFilters(); });
elements.pageSize.addEventListener("change", () => { state.pageSize = Number(elements.pageSize.value) || 50; applyFilters(); });
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
    elements.updated.textContent = updateText;
    document.querySelector("#footer-updated").textContent = updateText;
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
