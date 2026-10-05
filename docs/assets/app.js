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
  if (window.__musicSyncMobileCategory) window.__musicSyncMobileCategory(state.category, integerFormat.format(state.filtered.length));
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
  if (window.__musicSyncMobileCategory) window.__musicSyncMobileCategory(category);
  applyFilters();
}

function buildTabs(payload) {
  window.__categoriesData = payload.categories;
  if (window.__musicSyncMobileCategory) window.__musicSyncMobileCategory("all", integerFormat.format(payload.total));
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
    sunIcons.forEach(icon => { if (icon) icon.style.display = isDark ? "none" : "block"; });
    moonIcons.forEach(icon => { if (icon) icon.style.display = isDark ? "block" : "none"; });
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
    const tag = document.querySelector("#mobileCurrentCategoryTag");
    const countEl = document.querySelector("#mobileFilterCount");
    if (tag) {
      if (categoryKey === "all") {
        tag.textContent = "全部";
      } else {
        tag.textContent = categoryKey;
      }
    }
    if (countEl && count !== undefined) {
      countEl.textContent = `(${count} 首)`;
    }
  };

  window.__categoriesData = [];
  window.__renderModalCategories = function() {
    if (!modalCategoryList) return;
    modalCategoryList.innerHTML = "";
    
    // Add "All" option
    const totalCount = state.all.length;
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "modal-category-item" + (state.category === "all" ? " is-active" : "");
    allBtn.innerHTML = `<span>全部</span><span class="modal-category-badge">${integerFormat.format(totalCount)} 首</span>`;
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
        btn.innerHTML = `<span>${cat.label}</span><span class="modal-category-badge">${integerFormat.format(cat.count)} 首</span>`;
        btn.addEventListener("click", () => {
          activateCategory(cat.key);
          closeSwitchCategoryModal();
        });
        modalCategoryList.append(btn);
      });
    }
  };
})();
