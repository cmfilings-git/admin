/* COREBIQ dashboard bootstrap: loads shared components and wires interactions. */
const componentMap = {
  "desktop-sidebar-mount": "components/sidebar.html",
  "desktop-header-mount": "components/header.html",
  "mobile-header-mount": "components/app/header.html",
  "app-sidebar-mount": "components/app/sidebar.html",
  "bottom-nav-mount": "components/app/bottom-nav.html",
  "welcome-mount": "components/kpi-welcomecard.html",
  "compliance-sticky-header-mount": "components/compliance-sticky-header.html",
  "sample-form-mount": "components/sample-form.html",
  "sample-form-view-mount": "components/sample-form-view.html",
  "date-picker-component-mount": "components/date-picker.html",
  "kpi-hero-submodule-page-mount": "components/kpi-hero-submodule-page.html",
  "modulepage-row1-mount": "components/modulepage-row1.html",
  "modulepage-row2-mount": "components/modulepage-row2.html",
  "modulepage-row3-mount": "components/modulepage-row3.html",
  "modulepage-row4-mount": "components/modulepage-row4.html",
  "kpi-mini-mount": "components/kpi-mini.html",
  "chart-mount": "components/chart.html",
  "form-view-mount": "components/form-view.html",
  "mini-container-mount": "components/mini-container.html",
  "app-loader-mount": "components/loader.html"
};

async function loadComponent(mountId, url) {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    mount.innerHTML = await response.text();
  } catch (error) {
    console.error("Component could not load:", error);
    mount.innerHTML = `<div class="component-error">Unable to load ${url}</div>`;
  }
}

async function initDashboard() {
  initAppearanceTheme();

  const loaderMount = document.getElementById("app-loader-mount") || document.createElement("div");
  loaderMount.id = "app-loader-mount";
  const miniMount = document.getElementById("mini-container-mount") || document.createElement("div");
  miniMount.id = "mini-container-mount";

  if (!loaderMount.isConnected) document.body.append(loaderMount);
  if (!miniMount.isConnected) document.body.append(miniMount);

  await loadComponent("app-loader-mount", componentMap["app-loader-mount"]);
  initBookLoader();

  const loaderStartedAt = performance.now();
  window.COREBIQ?.showLoading("Loading...");

  await Promise.all(
    Object.entries(componentMap)
      .filter(([id]) => id !== "app-loader-mount" && id !== "modulepage-row1-mount")
      .map(([id, url]) => loadComponent(id, url))
  );
  await loadComponent("modulepage-row1-mount", componentMap["modulepage-row1-mount"]);
  await loadComponent("compliance-sticky-header-mount", componentMap["compliance-sticky-header-mount"]);

  initModulePageRow1();
  initModulePageRow2();
  initModulePageRow3();
  initModulePageRow4();
  window.COREBIQ_COMPONENTS_LOADED = true;
  document.dispatchEvent(new Event("corebiq:components-loaded"));
  initCrmSubnav();
  if (window.lucide) window.lucide.createIcons();
  initAppearanceTheme();
  try {
    const { initHeaderPopovers } = await import(new URL("js/header-popovers.js", document.baseURI));
    initHeaderPopovers();
  } catch (error) {
    console.error("Header notifications and profile could not initialize:", error);
  }
  try {
    const { initWelcomeCompanyName } = await import(new URL("js/welcome-card.js", document.baseURI));
    initWelcomeCompanyName();
  } catch (error) {
    console.error("Company name could not initialize:", error);
    const companyName = document.getElementById("welcome-company-name");
    if (companyName) companyName.textContent = "Company name unavailable";
  }
  initDrawer();
  initNavigation();
  initChart();
  initDashboardControls();
  initModuleContainer();
  updateDate();

  await new Promise(resolve => setTimeout(resolve, Math.max(0, 450 - (performance.now() - loaderStartedAt))));
  window.COREBIQ?.hideLoading();
}

function initCrmSubnav() {
  const nav = document.querySelector(".crm-tabs,.client-tabs");
  if (!nav) return;
  const container = document.querySelector(".crm-page,.client-page");
  const navContainer = nav.closest(".crm-tabs-wrap,.client-tabs-wrap");
  const pageHeader = container?.querySelector(".crm-head");
  if (pageHeader && navContainer && pageHeader.nextElementSibling !== navContainer) pageHeader.after(navContainer);
  container?.classList.add("crm-module-container");
  navContainer?.classList.add("crm-submodule-nav");
  const page = location.pathname.split("/").pop().toLowerCase();
  const activeKey = ["clients.html", "credentials.html", "compliance.html"].includes(page)
    ? page.replace(".html", "")
    : "dashboard";
  const items = [
    ["dashboard", "Dashboard", "layout-dashboard", "modules/crm/dashboard/dashboard.html"],
    ["clients", "Clients", "contact-round", "modules/crm/clients/clients.html"],
    ["credentials", "Credentials", "shield-check", "modules/crm/credentials/credentials.html"],
    ["compliance", "Compliance", "clipboard-check", "modules/crm/compliance/compliance.html"]
  ];
  nav.setAttribute("aria-label", "CRM sections");
  nav.removeAttribute("role");
  nav.replaceChildren(...items.map(([key, label, icon, href]) => {
    const link = document.createElement("a");
    link.className = `crm-tab${key === activeKey ? " active" : ""}`;
    link.href = href;
    if (key === activeKey) link.setAttribute("aria-current", "page");
    const glyph = document.createElement("i");
    glyph.setAttribute("data-lucide", icon);
    link.append(glyph, document.createTextNode(label));
    return link;
  }));
}

function initAppearanceTheme() {
  const storageKey = "corebiq-theme";
  const root = document.documentElement;
  const storedTheme = localStorage.getItem(storageKey);
  const applyTheme = theme => {
    const isDark = theme === "dark";
    root.dataset.theme = isDark ? "dark" : "light";
    document.body.dataset.theme = isDark ? "dark" : "light";
    document.querySelectorAll("[data-theme-toggle]").forEach(toggle => {
      toggle.setAttribute("aria-checked", String(isDark));
      toggle.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} theme`);
    });
  };
  applyTheme(storedTheme === "dark" ? "dark" : "light");
  document.querySelectorAll("[data-theme-toggle]").forEach(toggle => {
    if (toggle.dataset.themeBound === "true") return;
    toggle.dataset.themeBound = "true";
    toggle.addEventListener("click", () => {
      const theme = root.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem(storageKey, theme);
      applyTheme(theme);
    });
  });
}

function initBookLoader() {
  const overlay = document.getElementById("app-loader") || document.getElementById("appLoader");
  const textEl = document.getElementById("app-loader-text") || document.getElementById("appLoaderText");
  if (!overlay) return;

  window.COREBIQ = window.COREBIQ || {};

  window.COREBIQ.showLoading = (message = "Loading...") => {
    if (textEl) textEl.textContent = message;
    overlay.hidden = false;
    overlay.classList.add("is-active");
    overlay.setAttribute("aria-hidden", "false");
    overlay.setAttribute("aria-busy", "true");
  };

  window.COREBIQ.hideLoading = () => {
    overlay.classList.remove("is-active");
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("aria-busy", "false");
  };

  window.COREBIQ.withLoading = async (asyncTask, message = "Loading...") => {
    window.COREBIQ.showLoading(message);
    try {
      return await asyncTask();
    } finally {
      window.COREBIQ.hideLoading();
    }
  };
}

function initDrawer() {
  const drawer = document.getElementById("app-drawer");
  const backdrop = document.getElementById("app-drawer-backdrop");
  if (!drawer || !backdrop) return;
  const open = () => { drawer.classList.add("open"); backdrop.classList.add("show"); drawer.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; };
  const close = () => { drawer.classList.remove("open"); backdrop.classList.remove("show"); drawer.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; };
  document.querySelectorAll("[data-open-app-sidebar],[data-bottom-menu]").forEach(el => el.addEventListener("click", open));
  document.getElementById("close-app-sidebar")?.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  let sx = 0, sy = 0, edge = false;
  document.addEventListener("touchstart", e => { if (e.touches.length !== 1) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; edge = sx < 24 && !drawer.classList.contains("open"); }, { passive: true });
  document.addEventListener("touchend", e => { if (!edge || !e.changedTouches.length) return; const dx = e.changedTouches[0].clientX - sx; const dy = Math.abs(e.changedTouches[0].clientY - sy); if (dx > 65 && dy < 90) open(); edge = false; }, { passive: true });
  let dx0 = 0, dy0 = 0;
  drawer.addEventListener("touchstart", e => { dx0 = e.touches[0].clientX; dy0 = e.touches[0].clientY; }, { passive: true });
  drawer.addEventListener("touchend", e => { const dx = e.changedTouches[0].clientX - dx0; const dy = Math.abs(e.changedTouches[0].clientY - dy0); if (dx < -65 && dy < 90) close(); }, { passive: true });
}

function initNavigation() {
  const segments = location.pathname.split("/").filter(Boolean).map(part => part.toLowerCase());
  const moduleNames = ["crm", "erp", "inventory", "hr", "clients", "transactions", "reports", "settings"];
  let activeKey = "home";
  if (segments.length > 1 && segments[segments.length - 2] === "modules" && moduleNames.includes(segments[segments.length - 1].replace(/\.html?$/i, ""))) {
    activeKey = segments[segments.length - 1].replace(/\.html?$/i, "");
  } else if (segments.includes("modules")) {
    const moduleIndex = segments.lastIndexOf("modules");
    const moduleName = segments[moduleIndex + 1];
    if (moduleNames.includes(moduleName)) activeKey = moduleName;
  } else {
    const page = (segments[segments.length - 1] || "index.html").replace(/\.html?$/i, "");
    const aliases = { index: "home", home: "home", dashboard: "home" };
    activeKey = aliases[page] || activeKey;
  }
  document.querySelectorAll("[data-nav-key]").forEach(link => {
    const active = link.dataset.navKey === activeKey;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function initModuleContainer() {
  const mount = document.getElementById("module-container-content");
  if (!mount) return;
  const config = window.COREBIQ_MODULE;
  if (!config) {
    console.error("Module container configuration is missing.");
    mount.textContent = "This module could not be loaded.";
    mount.setAttribute("role", "alert");
    return;
  }
  document.title = `${config.title} | COREBIQ`;
  document.getElementById("module-title").textContent = config.title;
  document.getElementById("module-description").textContent = config.description;
  config.sections.forEach(section => {
    const card = document.createElement(section.href ? "a" : "article");
    card.className = "module-section-card";
    if (section.href) card.href = section.href;
    const icon = document.createElement("span");
    icon.className = "module-section-icon";
    const iconElement = document.createElement("i");
    iconElement.setAttribute("data-lucide", section.icon);
    icon.appendChild(iconElement);
    const title = document.createElement("h2");
    title.textContent = section.title;
    const description = document.createElement("p");
    description.textContent = section.description;
    card.append(icon, title, description);
    mount.appendChild(card);
  });
  if (window.lucide) window.lucide.createIcons();
}

function titleFromPathSegment(segment) {
  const acronyms = { crm: "CRM", erp: "ERP", hr: "HR", api: "API", gst: "GST" };
  return String(segment || "").replace(/\.html?$/i, "").split(/[-_\s]+/).filter(Boolean)
    .map(word => acronyms[word.toLowerCase()] || `${word[0].toUpperCase()}${word.slice(1)}`).join(" ");
}

function modulePageIdentityFromPath() {
  const segments = decodeURIComponent(location.pathname).split("/").filter(Boolean);
  const file = segments.pop() || "index.html";
  const parent = segments[segments.length - 1] || "";
  const fileSlug = file.replace(/\.html?$/i, "");
  const pageName = titleFromPathSegment(fileSlug && fileSlug.toLowerCase() !== "index" ? fileSlug : parent) || document.body.dataset.pageTitle || "Page";
  const modulesIndex = segments.lastIndexOf("modules");
  if (modulesIndex >= 0 && segments[modulesIndex + 1]) {
    const rootSlug = segments[modulesIndex + 1];
    return { pageName, rootName: titleFromPathSegment(rootSlug), rootHref: "index.html" };
  }
  return { pageName, rootName: titleFromPathSegment(parent) || "Modules", rootHref: "index.html" };
}

function initModulePageRow1() {
  const mount = document.getElementById("modulepage-row1-mount");
  if (!mount) return;
  const config = mount.dataset;
  const identity = modulePageIdentityFromPath();
  const pageName = config.pageName || identity.pageName;
  const title = mount.querySelector("[data-modulepage-title]");
  const icon = mount.querySelector("[data-modulepage-icon]");
  const root = mount.querySelector("[data-modulepage-root]");
  const current = mount.querySelector("[data-modulepage-current]");
  const add = mount.querySelector("[data-modulepage-add]");
  const menu = mount.querySelector("#modulepageRow1Menu");
  const menuItems = mount.querySelector("[data-modulepage-row1-menu-items]");
  const toggle = mount.querySelector("#modulepageRow1MenuToggle");
  cloneModulePageTemplate(mount, config.menuTemplateId, "[data-modulepage-row1-menu-items]", "modulepage row 1 menu");
  if (title) title.textContent = pageName;
  if (icon) icon.setAttribute("data-lucide", config.pageIcon || "layers");
  if (root) { root.textContent = config.rootName || identity.rootName; root.href = config.rootHref || identity.rootHref; }
  if (current) current.textContent = pageName;
  if (menu && config.menuLabel) menu.setAttribute("aria-label", config.menuLabel);
  if (toggle && config.menuLabel) {
    toggle.title = config.menuLabel;
    toggle.setAttribute("aria-label", `Open ${config.menuLabel}`);
  }
  if (add) {
    add.setAttribute("aria-label", config.addAriaLabel || `Add ${pageName.toLowerCase()}`);
    add.title = config.addAriaLabel || `Add ${pageName.toLowerCase()}`;
    const label = add.querySelector("[data-modulepage-add-label]");
    if (label) label.textContent = config.addLabel || "Add";
  }
  if (menuItems) {
    menuItems.querySelectorAll("a[href]").forEach(link => {
      if (new URL(link.href, document.baseURI).pathname === new URL(location.href).pathname) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }
  if (toggle && menu && toggle.dataset.modulepageBound !== "true") {
    toggle.dataset.modulepageBound = "true";
    toggle.addEventListener("click", () => {
      menu.hidden = !menu.hidden;
      toggle.setAttribute("aria-expanded", String(!menu.hidden));
    });
    document.addEventListener("pointerdown", event => {
      const target = event.target;
      if (target instanceof Element && target.closest(".modulepage-row1-menu-wrap")) return;
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    });
  }
}

function cloneModulePageTemplate(mount, templateId, slotSelector, label) {
  if (!templateId) return;
  const template = document.getElementById(templateId);
  if (!(template instanceof HTMLTemplateElement)) {
    console.error(`The ${label} template "${templateId}" is missing or invalid.`);
    return;
  }
  const slot = mount.querySelector(slotSelector);
  if (!slot) {
    console.error(`The ${label} slot did not load.`);
    return;
  }
  slot.replaceChildren(template.content.cloneNode(true));
}

function initModulePageRow2() {
  const mount = document.getElementById("modulepage-row2-mount");
  if (!mount) return;
  mount.querySelectorAll("[data-modulepage-kpi]").forEach(card => {
    const index = card.dataset.modulepageKpi;
    const label = card.querySelector("[data-kpi-label]");
    const value = card.querySelector("[data-kpi-value]");
    const support = card.querySelector("[data-kpi-support]");
    const icon = card.querySelector("[data-kpi-icon]");
    const valueId = mount.dataset[`kpi${index}ValueId`];
    const supportId = mount.dataset[`kpi${index}SupportId`];
    if (label) label.textContent = mount.dataset[`kpi${index}Label`] || "";
    if (value) {
      if (valueId) value.id = valueId;
      value.textContent = mount.dataset[`kpi${index}Value`] || "—";
    }
    if (support) {
      if (supportId) support.id = supportId;
      support.textContent = mount.dataset[`kpi${index}SupportText`] || "";
      support.hidden = !support.textContent;
    }
    if (icon) icon.setAttribute("data-lucide", mount.dataset[`kpi${index}Icon`] || "chart-no-axes-column");
    if (mount.dataset[`kpi${index}Tone`]) card.dataset.kpiTone = mount.dataset[`kpi${index}Tone`];
  });
}

function initModulePageRow3() {
  const mount = document.getElementById("modulepage-row3-mount");
  if (!mount) return;
  const config = mount.dataset;
  const title = mount.querySelector("[data-modulepage-row3-title-text]");
  const icon = mount.querySelector("[data-modulepage-row3-icon]");
  const search = mount.querySelector("[data-modulepage-row3-search]");
  const recordCount = mount.querySelector(".modulepage-row3-record-count");
  const selectedCount = mount.querySelector(".modulepage-row3-selected-count");
  const filterToggle = mount.querySelector("#modulepageRow3FilterToggle");
  const filterCount = mount.querySelector("#modulepageRow3FilterCount");
  const filterPopover = mount.querySelector("#modulepageRow3FilterPopover");
  const actionToggle = mount.querySelector("#modulepageRow3ActionToggle");
  const actionMenu = mount.querySelector("#modulepageRow3ActionMenu");
  cloneModulePageTemplate(mount, config.filterTemplateId, "[data-modulepage-row3-filter-content]", "modulepage row 3 filter");
  cloneModulePageTemplate(mount, config.actionTemplateId, "[data-modulepage-row3-action-content]", "modulepage row 3 action");
  if (title) title.textContent = config.title || "Records";
  if (icon) icon.setAttribute("data-lucide", config.icon || "list");
  if (search) {
    search.id = config.searchId || "modulepageRow3Search";
    search.placeholder = config.searchPlaceholder || `Search ${config.title || "records"}...`;
    search.setAttribute("aria-label", config.searchLabel || search.placeholder);
  }
  if (recordCount && config.recordCountId) recordCount.id = config.recordCountId;
  if (selectedCount && config.selectedCountId) selectedCount.id = config.selectedCountId;
  if (filterToggle && filterCount && filterPopover) {
    filterToggle.id = config.filterToggleId || "modulepageRow3FilterToggle";
    filterCount.id = config.filterCountId || "modulepageRow3FilterCount";
    filterPopover.id = config.filterPopoverId || "modulepageRow3FilterPopover";
    filterToggle.setAttribute("aria-controls", filterPopover.id);
  }
  if (actionToggle && actionMenu) {
    actionToggle.id = config.actionToggleId || "modulepageRow3ActionToggle";
    actionMenu.id = config.actionMenuId || "modulepageRow3ActionMenu";
    actionToggle.setAttribute("aria-controls", actionMenu.id);
    if (config.actionLabel) {
      actionToggle.title = config.actionLabel;
      actionToggle.setAttribute("aria-label", config.actionLabel);
    }
  }
  if (filterToggle && filterPopover) {
    filterToggle.addEventListener("click", () => {
      filterPopover.hidden = !filterPopover.hidden;
      filterToggle.setAttribute("aria-expanded", String(!filterPopover.hidden));
      document.dispatchEvent(new CustomEvent("corebiq:modulepage-filter-toggle", { detail: { id: filterToggle.id, open: !filterPopover.hidden } }));
    });
    document.addEventListener("pointerdown", event => {
      const target = event.target;
      if (target instanceof Element && target.closest(".modulepage-row3 .crm-filter-wrap")) return;
      filterPopover.hidden = true;
      filterToggle.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      filterPopover.hidden = true;
      filterToggle.setAttribute("aria-expanded", "false");
    });
  }
  if (actionToggle && actionMenu) {
    actionToggle.addEventListener("click", () => {
      actionMenu.hidden = !actionMenu.hidden;
      actionToggle.setAttribute("aria-expanded", String(!actionMenu.hidden));
    });
    document.addEventListener("pointerdown", event => {
      const target = event.target;
      if (target instanceof Element && target.closest(".modulepage-row3 .crm-add-wrap")) return;
      actionMenu.hidden = true;
      actionToggle.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      actionMenu.hidden = true;
      actionToggle.setAttribute("aria-expanded", "false");
    });
  }
}

function initModulePageRow4() {
  const mount = document.getElementById("modulepage-row4-mount");
  if (!mount) return;
  const config = mount.dataset;
  const title = mount.querySelector("[data-modulepage-row4-title]");
  const description = mount.querySelector("[data-modulepage-row4-description]");
  const count = mount.querySelector("[data-modulepage-row4-count]");
  const items = mount.querySelector("[data-modulepage-row4-items]");
  if (title) title.textContent = config.title || "Recent records";
  if (description) description.textContent = config.description || "Most recent items";
  if (count) {
    if (config.countId) count.id = config.countId;
    count.textContent = config.loadingCount || "Loading...";
  }
  if (items) {
    if (config.listId) items.id = config.listId;
    items.setAttribute("aria-label", config.listLabel || config.title || "Recent records");
    const loading = document.createElement("p");
    loading.className = "modulepage-row4-empty";
    loading.textContent = config.loadingText || "Loading records...";
    items.replaceChildren(loading);
  }
}

function initChart() {
  const canvas = document.getElementById("revenue-chart");
  if (!canvas || !window.Chart) return;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 240);
  gradient.addColorStop(0, "rgba(26,115,232,.13)");
  gradient.addColorStop(1, "rgba(26,115,232,0)");
  const datasets = {
    week: { labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], data: [18, 24, 21, 32, 29, 38, 43] },
    month: { labels: ["1", "4", "7", "10", "13", "16", "19", "22", "25", "28", "30"], data: [12, 19, 16, 25, 22, 31, 28, 37, 34, 43, 48] },
    year: { labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], data: [18, 22, 20, 28, 25, 31, 29, 35, 32, 39, 44, 48] }
  };
  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: datasets.month.labels,
      datasets: [{ data: datasets.month.data, borderColor: "#1a73e8", backgroundColor: gradient, fill: true, tension: .38, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: "#1765cc" }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false, backgroundColor: "#1f2937", padding: 10, titleFont: { family: "Outfit", size: 10 }, bodyFont: { family: "Outfit", size: 11 }, callbacks: { label: c => ` ₹${c.raw}K` } }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: "#687386", font: { family: "Outfit", size: 10 }, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: "#e1e7f0", drawTicks: false }, border: { display: false }, ticks: { color: "#687386", font: { family: "Outfit", size: 9 }, padding: 9, callback: v => `₹${v}K` } }
      }
    }
  });
  document.getElementById("chart-period")?.addEventListener("change", e => {
    const d = datasets[e.target.value] || datasets.month;
    chart.data.labels = d.labels;
    chart.data.datasets[0].data = d.data;
    chart.update();
  });
}

function initDashboardControls() {
  const year = document.getElementById("current-year");
  if (year) year.textContent = new Date().getFullYear();
  document.getElementById("add-work")?.addEventListener("click", () => alert("Connect this action to your task creation form."));
  document.querySelectorAll(".icon-action").forEach(btn => btn.addEventListener("click", () => alert("Connect this action to your task edit/action menu.")));
}

function updateDate() {
  const date = document.getElementById("welcome-date");
  const dateText = document.getElementById("welcome-date-text");
  if (!date || !dateText) return;
  const now = new Date();
  const day = now.getDate();
  const daySuffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
  const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "long" }).format(now);
  const month = new Intl.DateTimeFormat("en-IN", { month: "long" }).format(now);
  dateText.textContent = `${weekday}, ${day}${daySuffix} ${month} ${now.getFullYear()}`;
  const isoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  date.setAttribute("datetime", isoDate);
}

document.addEventListener("DOMContentLoaded", initDashboard);

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-module-refresh]");
  if (!btn || btn.classList.contains("is-refreshing")) return;

  btn.classList.add("is-refreshing");
  btn.disabled = true;

  const done = () => {
    btn.classList.remove("is-refreshing");
    btn.disabled = false;
  };

  const refreshEvent = new CustomEvent("corebiq:module-refresh", {
    cancelable: true,
    detail: {
      page: document.body.dataset.pageTitle || "",
      done
    }
  });

  window.dispatchEvent(refreshEvent);

  // If no module called e.preventDefault(), do a standard page refresh
  if (!refreshEvent.defaultPrevented) {
    window.location.reload();
  } else {
    // Safety fallback so spinner never gets stuck
    window.setTimeout(done, 8000);
  }
});
