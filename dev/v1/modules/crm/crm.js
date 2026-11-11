import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getFirestore, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "../../firebase/firebase-config.js";

const ADMIN = "shanicm@gmail.com";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const clients = new Map();
const compliances = new Map();
let clientsUnsubscribe;
let complianceUnsubscribe;

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "object" && typeof value.seconds === "number") return new Date(value.seconds * 1000);
  if (typeof value !== "string") return null;
  const raw = value.trim();
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  const parsed = dmy
    ? new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isFiled(record) {
  return Boolean(record.filedAt) ||
    ["filed", "completed", "complete", "done", "submitted"].includes(normalize(record.complianceStatus));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function formatDate(value) {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date)
    : "—";
}

function reportLoadError(collectionName, error) {
  console.error(`CRM could not read the ${collectionName} collection:`, error);
  const output = document.getElementById("crm-data-error");
  if (!output) return;
  output.hidden = false;
  output.textContent = `Could not load ${collectionName} from Firestore (${error.code || "error"}). Check Firebase connectivity and Firestore rules.`;
}

function renderClients() {
  const list = [...clients.values()];
  list.sort((a, b) => {
    const dateDifference = (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0);
    return dateDifference || String(a.clientName || "").localeCompare(String(b.clientName || ""));
  });
  document.getElementById("total-clients").textContent = list.length.toLocaleString("en-IN");
  document.getElementById("recent-client-rows").innerHTML = list.length
    ? list.slice(0, 5).map(client => `
      <tr>
        <td><span class="crm-recent-client-name">${escapeHtml(client.clientName || "Unnamed client")}</span><span class="crm-client-mobile-id">${escapeHtml(client.clientId || client.id)}</span></td>
        <td>${escapeHtml(client.clientId || client.id)}</td>
        <td>${escapeHtml(client.clientEmail || "—")}</td>
        <td><span class="crm-client-status">${escapeHtml(client.clientStatus || "Active")}</span></td>
      </tr>`).join("")
    : '<tr><td colspan="4">No client records found.</td></tr>';
  renderContacts(list);
}

function renderContacts(list = [...clients.values()]) {
  const query = normalize(document.getElementById("contact-search")?.value);
  const status = document.getElementById("contact-status-filter")?.value || "";
  const sort = document.getElementById("contact-sort")?.value || "name";
  const filtered = list.filter(client => {
    const matchesQuery = !query || [
      client.clientName, client.personaName, client.clientMobile,
      client.clientEmail, client.clientId, client.legalName
    ].some(value => normalize(value).includes(query));
    return matchesQuery && (!status || (client.clientStatus || "Active") === status);
  });
  filtered.sort((a, b) => {
    if (sort === "name-desc") return String(b.clientName || "").localeCompare(String(a.clientName || ""));
    if (sort === "contact") return String(a.personaName || "").localeCompare(String(b.personaName || ""));
    return String(a.clientName || "").localeCompare(String(b.clientName || ""));
  });
  document.getElementById("contact-rows").innerHTML = filtered.length
    ? filtered.map(client => `
      <tr>
        <td>${escapeHtml(client.clientName || "Unnamed client")}</td>
        <td>${escapeHtml(client.personaName || "—")}</td>
        <td>${escapeHtml(client.clientMobile || "—")}</td>
        <td>${escapeHtml(client.clientEmail || "—")}</td>
        <td>${escapeHtml(client.clientStatus || "Active")}</td>
        <td><a class="crm-row-action" href="modules/crm/clients.html" aria-label="Manage ${escapeHtml(client.clientName || "client")}" title="Manage client"><i data-lucide="arrow-up-right"></i></a></td>
      </tr>`).join("")
    : `<tr><td colspan="6">${query || status ? "No contacts match these filters." : "No client/contact records found."}</td></tr>`;
  if (window.lucide) window.lucide.createIcons();
}

function renderCompliances() {
  const records = [...compliances.values()];
  const open = records.filter(record => !isFiled(record));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = open.filter(record => {
    const due = toDate(record.dueDate);
    if (!due) return false;
    due.setHours(0, 0, 0, 0);
    return due >= today;
  }).sort((a, b) => (toDate(a.dueDate)?.getTime() || Infinity) - (toDate(b.dueDate)?.getTime() || Infinity));

  document.getElementById("pending-compliances").textContent = open.length.toLocaleString("en-IN");
  document.getElementById("upcoming-compliances").textContent = upcoming.length.toLocaleString("en-IN");
  document.getElementById("upcoming-compliance-rows").innerHTML = upcoming.length
    ? upcoming.slice(0, 6).map(record => `
      <tr>
        <td>${escapeHtml(record.clientName || record.clientId || "—")}</td>
        <td>${escapeHtml(record.complianceName || "—")}</td>
        <td>${formatDate(record.dueDate)}</td>
      </tr>`).join("")
    : '<tr><td colspan="3">No upcoming compliance records found.</td></tr>';
  renderTasks(records);
}

function complianceStatus(record) {
  if (isFiled(record)) return "completed";
  const due = toDate(record.dueDate);
  if (!due) return "pending";
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today ? "overdue" : "pending";
}

function renderTasks(records = [...compliances.values()]) {
  const query = normalize(document.getElementById("task-search")?.value);
  const filter = document.getElementById("task-status-filter")?.value || "open";
  const sort = document.getElementById("task-sort")?.value || "due";
  const filtered = records.filter(record => {
    const status = complianceStatus(record);
    const matchesQuery = !query || [
      record.clientName, record.clientId, record.complianceName,
      record.complianceId, record.CompliancePeriod, record.complianceAknNumber
    ].some(value => normalize(value).includes(query));
    const matchesStatus = filter === "all" || !filter && true
      ? true
      : filter === "open" ? !isFiled(record) : status === filter;
    return matchesQuery && matchesStatus;
  });
  filtered.sort((a, b) => {
    if (sort === "client") return String(a.clientName || "").localeCompare(String(b.clientName || ""));
    return (toDate(a.dueDate)?.getTime() || Infinity) - (toDate(b.dueDate)?.getTime() || Infinity);
  });
  const rows = document.getElementById("task-rows");
  if (!rows) return;
  rows.innerHTML = filtered.length ? filtered.map(record => {
    const status = complianceStatus(record);
    const label = status === "completed" ? "Completed" : status === "overdue" ? "Overdue" : "Pending";
    return `<tr>
      <td>${escapeHtml(record.clientName || record.clientId || "—")}</td>
      <td>${escapeHtml(record.complianceName || "—")}</td>
      <td>${formatDate(record.dueDate)}</td>
      <td><span class="crm-row-status ${status}">${label}</span></td>
      <td><a class="crm-row-action" href="modules/crm/compliance.html" aria-label="View compliance register" title="View compliance register"><i data-lucide="arrow-up-right"></i></a></td>
    </tr>`;
  }).join("") : `<tr><td colspan="5">${query ? "No pending work matches your search." : "No pending work matches this filter."}</td></tr>`;
  if (window.lucide) window.lucide.createIcons();
}

function startListeners() {
  clientsUnsubscribe?.();
  complianceUnsubscribe?.();
  clientsUnsubscribe = onSnapshot(collection(db, "clients"), snapshot => {
    clients.clear();
    snapshot.forEach(documentSnapshot => clients.set(documentSnapshot.id, {
      ...documentSnapshot.data(),
      id: documentSnapshot.id
    }));
    renderClients();
  }, error => reportLoadError("clients", error));
  complianceUnsubscribe = onSnapshot(collection(db, "compliance"), snapshot => {
    compliances.clear();
    snapshot.forEach(documentSnapshot => compliances.set(documentSnapshot.id, {
      ...documentSnapshot.data(),
      id: documentSnapshot.id
    }));
    renderCompliances();
  }, error => reportLoadError("compliance", error));
}

function activatePanel(name, updateUrl = true) {
  const validPanels = new Set(["dashboard", "contacts", "tasks"]);
  const panelName = validPanels.has(name) ? name : "dashboard";
  document.querySelectorAll("[data-panel]").forEach(panel => {
    panel.classList.toggle("active", panel.dataset.panel === panelName);
  });
  document.querySelectorAll(".crm-tabs a").forEach(link => {
    const selected = link.getAttribute("href") === `modules/crm/crm.html${panelName === "dashboard" ? "" : `#${panelName}`}`;
    link.classList.toggle("active", selected);
    if (selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (updateUrl) history.replaceState(null, "", `${location.pathname}${location.search}${panelName === "dashboard" ? "" : `#${panelName}`}`);
}

function initPage() {
  document.addEventListener("click", event => {
    const link = event.target.closest('.crm-tabs a[href*="crm.html#"]');
    if (!link) return;
    const panel = new URL(link.href).hash.slice(1);
    if (!["contacts", "tasks"].includes(panel)) return;
    event.preventDefault();
    activatePanel(panel);
  });
  document.getElementById("contact-search").addEventListener("input", () => renderContacts());
  document.getElementById("contact-status-filter").addEventListener("change", () => renderContacts());
  document.getElementById("contact-sort").addEventListener("change", () => renderContacts());
  document.getElementById("task-search").addEventListener("input", () => renderTasks());
  document.getElementById("task-status-filter").addEventListener("change", () => renderTasks());
  document.getElementById("task-sort").addEventListener("change", () => renderTasks());
  activatePanel(location.hash.slice(1) || "dashboard", false);

  onAuthStateChanged(auth, async user => {
    if (!user || normalize(user.email) !== ADMIN) {
      clientsUnsubscribe?.();
      complianceUnsubscribe?.();
      if (user) {
        try {
          await signOut(auth);
        } catch (error) {
          console.error("Could not sign out an unauthorized CRM account:", error);
        }
      }
      const next = encodeURIComponent(location.pathname.replace(/^\//, "") + location.search + location.hash);
      location.replace(new URL(`auth/login.html?next=${next}`, document.baseURI).href);
      return;
    }
    document.getElementById("crm-app").hidden = false;
    startListeners();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage, { once: true });
} else {
  initPage();
}
