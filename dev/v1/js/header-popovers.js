import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "../firebase/firebase-config.js";

const closeDelay = 190;

export function initHeaderPopovers() {
  const overlay = document.getElementById("mini-overlay");
  const search = document.getElementById("mini-search");
  const notifications = document.getElementById("mini-notifications");
  const profile = document.getElementById("mini-profile");
  const triggers = [...document.querySelectorAll("[data-popover-target]")];
  if (!overlay || !search || !notifications || !profile || !triggers.length) return;

  let activePopover = null;
  const popovers = [search, notifications, profile];

  function closePopover(popover) {
    if (!popover || popover.hidden) return;
    popover.classList.remove("is-open");
    popover.setAttribute("aria-hidden", "true");
    triggers.filter(trigger => trigger.dataset.popoverTarget === popover.id)
      .forEach(trigger => trigger.setAttribute("aria-expanded", "false"));
    if (activePopover === popover) activePopover = null;
    if (!activePopover) {
      overlay.classList.remove("is-open");
      window.setTimeout(() => {
        if (!activePopover) overlay.hidden = true;
      }, closeDelay);
    }
    window.setTimeout(() => {
      if (!popover.classList.contains("is-open")) popover.hidden = true;
    }, closeDelay);
  }

  function openPopover(popover, trigger) {
    if (activePopover && activePopover !== popover) closePopover(activePopover);
    popovers.filter(item => item !== popover).forEach(closePopover);
    popover.hidden = false;
    overlay.hidden = false;
    popover.setAttribute("aria-hidden", "false");
    triggers.forEach(item => item.setAttribute("aria-expanded", String(item === trigger)));
    activePopover = popover;
    if (popover === notifications) {
      document.querySelectorAll(".notification-button b").forEach(dot => { dot.hidden = true; });
    }
    requestAnimationFrame(() => {
      overlay.classList.add("is-open");
      popover.classList.add("is-open");
    });
  }

  triggers.forEach(trigger => {
    trigger.addEventListener("click", () => {
      const popover = document.getElementById(trigger.dataset.popoverTarget);
      if (!popover) return;
      if (activePopover === popover) {
        closePopover(popover);
      } else {
        openPopover(popover, trigger);
        if (popover === search) requestAnimationFrame(() => document.getElementById("master-search-input")?.focus());
      }
    });
  });
  overlay.addEventListener("click", () => closePopover(activePopover));
  popovers.forEach(popover => popover.addEventListener("click", event => event.stopPropagation()));
  document.querySelectorAll("[data-mini-close]").forEach(button => {
    button.addEventListener("click", () => closePopover(button.closest(".mini-popover")));
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closePopover(activePopover);
      return;
    }
    if (activePopover === search && event.key === "Enter") {
      const firstResult = document.querySelector("#master-search-results .master-search-result");
      if (firstResult) {
        event.preventDefault();
        firstResult.click();
      }
    }
    if (activePopover !== search || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const results = [...document.querySelectorAll("#master-search-results .master-search-result")];
    if (!results.length) return;
    event.preventDefault();
    const current = results.indexOf(document.activeElement);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    results[(current + offset + results.length) % results.length].focus();
  });

  renderRecentActivity();
  initMasterSearch(closePopover);
  initializeProfile();
  if (window.lucide) window.lucide.createIcons();

  async function initializeProfile() {
    try {
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      const auth = getAuth(app);
      onAuthStateChanged(auth, user => updateProfile(user), error => {
        console.error("Signed-in profile could not be loaded:", error);
        updateProfile(null, "Profile unavailable");
      });
      window.COREBIQ = window.COREBIQ || {};
      window.COREBIQ.signOut = async () => {
        try {
          await signOut(auth);
        } catch (error) {
          console.error("Could not sign out:", error);
          const errorMessage = document.getElementById("mini-profile-error");
          if (errorMessage) {
            errorMessage.textContent = "Could not sign out. Please try again.";
            errorMessage.hidden = false;
          }
        }
      };
    } catch (error) {
      console.error("Firebase profile could not initialize:", error);
      updateProfile(null, "Profile unavailable");
    }
  }
}

function initMasterSearch(closePopover) {
  const input = document.getElementById("master-search-input");
  const results = document.getElementById("master-search-results");
  const form = document.getElementById("master-search-form");
  if (!input || !results || !form) return;

  const records = collectSearchRecords();
  const iconByCategory = { Modules: "layers-3", Tasks: "list-checks", Activity: "activity", Records: "file-text" };

  input.addEventListener("input", render);
  results.addEventListener("click", event => {
    if (event.target.closest(".master-search-result")) closePopover(document.getElementById("mini-search"));
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    results.querySelector(".master-search-result")?.click();
  });
  render();

  function render() {
    const query = input.value.trim().toLowerCase();
    results.hidden = !query;
    const matches = records.filter(record =>
      `${record.title} ${record.description}`.toLowerCase().includes(query)
    ).slice(0, 8);
    results.replaceChildren();
    if (!query) return;
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "master-search-empty";
      empty.textContent = "No matching results. Try another search.";
      results.appendChild(empty);
      return;
    }

    matches.forEach(record => {
      const link = document.createElement("a");
      link.className = "master-search-result";
      link.href = record.href;
      link.setAttribute("role", "option");
      link.setAttribute("aria-selected", "false");
      const icon = document.createElement("span");
      icon.className = "master-search-result-icon";
      const glyph = document.createElement("i");
      glyph.setAttribute("data-lucide", iconByCategory[record.category] || "search");
      icon.appendChild(glyph);
      const copy = document.createElement("span");
      copy.className = "master-search-result-copy";
      const title = document.createElement("strong");
      title.textContent = record.title;
      const description = document.createElement("small");
      description.textContent = record.description;
      copy.append(title, description);
      const category = document.createElement("span");
      category.className = "master-search-result-category";
      category.textContent = record.category;
      link.append(icon, copy, category);
      results.appendChild(link);
    });
    if (window.lucide) window.lucide.createIcons();
  }
}

function collectSearchRecords() {
  const records = [];
  const seen = new Set();
  const add = (title, description, category, href) => {
    const label = title?.trim();
    if (!label || !href) return;
    const key = `${category}:${label.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    records.push({ title: label, description: description?.trim() || category, category, href });
  };
  const route = path => new URL(path, document.baseURI).href;

  document.querySelectorAll(".desktop-sidebar [data-nav-key], .drawer-links [data-nav-key]").forEach(link => {
    const key = link.dataset.navKey;
    if (key === "home") return;
    const title = link.querySelector("span")?.textContent || link.textContent;
    add(title, `Open ${title.trim()}`, "Modules", link.href);
  });
  document.querySelectorAll(".module-section-card").forEach(card => {
    const title = card.querySelector("h2")?.textContent;
    const description = card.querySelector("p")?.textContent;
    const href = card.href || location.href.split("#")[0] + "#module-container-content";
    add(title, description, "Modules", href);
  });
  document.querySelectorAll(".mobile-task-row, .form-table tbody tr[data-task]").forEach(task => {
    const title = task.querySelector(".task-name")?.textContent;
    const description = task.querySelector(".task-id")?.textContent || task.textContent;
    add(title, description, "Tasks", `${location.href.split("#")[0]}#form-view-mount`);
  });
  document.querySelectorAll(".activity-item").forEach(item => {
    const title = item.querySelector("strong")?.textContent;
    const description = item.querySelector("small")?.textContent;
    add(title, description, "Activity", `${location.href.split("#")[0]}#activity-list`);
  });
  document.querySelectorAll(".crm-table tbody tr").forEach(row => {
    const title = row.querySelector("td")?.textContent;
    add(title, row.textContent, "Records", route("modules/crm/crm.html#contacts"));
  });
  return records;
}

function updateProfile(user, fallback = "") {
  const displayName = user?.displayName || user?.email?.split("@")[0] || fallback || "Not signed in";
  const email = user?.email || "";
  const initials = displayName.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "--";

  document.querySelectorAll("[data-profile-name]").forEach(element => {
    element.textContent = displayName;
  });
  document.querySelectorAll("[data-profile-email]").forEach(element => {
    element.textContent = email;
  });
  document.querySelectorAll("[data-profile-initials]").forEach(element => {
    element.textContent = initials;
    element.hidden = Boolean(user?.photoURL);
  });
  document.querySelectorAll("[data-profile-photo]").forEach(image => {
    if (user?.photoURL) {
      image.src = user.photoURL;
      image.hidden = false;
      image.onerror = () => {
        image.hidden = true;
        image.parentElement?.querySelector("[data-profile-initials]")?.removeAttribute("hidden");
      };
    } else {
      image.removeAttribute("src");
      image.hidden = true;
    }
  });
  const signOutButton = document.getElementById("mini-signout");
  if (signOutButton) signOutButton.hidden = !user;
  const errorMessage = document.getElementById("mini-profile-error");
  if (errorMessage) errorMessage.hidden = true;
  const notificationDot = document.querySelectorAll(".notification-button b");
  notificationDot.forEach(dot => { dot.hidden = false; });
}

function renderRecentActivity() {
  const list = document.getElementById("mini-notifications-list");
  if (!list) return;

  const dashboardItems = [...document.querySelectorAll(".activity-item")].map(item => ({
    title: item.querySelector("strong")?.textContent.trim(),
    description: item.querySelector("small")?.textContent.trim(),
    category: item.querySelector(".activity-tag")?.textContent.trim()
  })).filter(item => item.title);
  const crmItems = [...document.querySelectorAll('.crm-panel[data-panel="activities"] .crm-tile')].map(item => ({
    title: item.querySelector("h3")?.textContent.trim(),
    description: item.querySelector("p")?.textContent.trim(),
    category: "CRM"
  })).filter(item => item.title);
  const fallbackItems = [
    { title: "New client added", description: "Acme Traders · 10 minutes ago", category: "CRM" },
    { title: "Invoice paid", description: "INV-00128 · 1 hour ago", category: "ERP" },
    { title: "Attendance submitted", description: "Operations team · 3 hours ago", category: "HR" },
    { title: "New task assigned", description: "GST return review · Yesterday", category: "Work" }
  ];
  const items = (dashboardItems.length ? dashboardItems : crmItems.length ? crmItems : fallbackItems).slice(0, 5);

  const icons = { CRM: "users", ERP: "receipt-text", HR: "users-round", Work: "clipboard-list" };
  items.forEach(item => {
    const row = document.createElement("article");
    row.className = "mini-activity-item";
    const icon = document.createElement("span");
    icon.className = "mini-activity-icon";
    const glyph = document.createElement("i");
    glyph.setAttribute("data-lucide", icons[item.category] || "activity");
    icon.appendChild(glyph);
    const copy = document.createElement("div");
    copy.className = "mini-activity-copy";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const description = document.createElement("p");
    description.textContent = item.description || item.category || "";
    copy.append(title, description);
    row.append(icon, copy);
    list.appendChild(row);
  });
  if (window.lucide) window.lucide.createIcons();
}

document.addEventListener("click", event => {
  if (event.target.closest("#mini-signout")) {
    window.COREBIQ?.signOut?.();
  }
});
