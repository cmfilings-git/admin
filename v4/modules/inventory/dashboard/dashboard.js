import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getFirestore, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "../../../firebase/firebase-config.js";

const ADMIN = "shanicm@gmail.com";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const clients = new Map();
const compliances = new Map();
const credentials = new Map();
let clientsUnsubscribe;
let complianceUnsubscribe;
let credentialsUnsubscribe;
let selectedClientDocId = "";

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
  document.getElementById("total-clients").textContent = list.length.toLocaleString("en-IN");
  renderClientSearch();
}

function renderCredentials() {
  document.getElementById("total-credentials").textContent = credentials.size.toLocaleString("en-IN");
  renderSelectedClientRecords();
}

function renderClientSearch() {
  const query = normalize(document.getElementById("client-record-search").value);
  const results = document.getElementById("client-search-results");
  if (!query || selectedClientDocId) {
    results.hidden = true;
    results.innerHTML = "";
    return;
  }
  const matching = [...clients.values()]
    .filter(client => [client.clientName, client.clientId, client.id].some(value => normalize(value).includes(query)))
    .sort((a, b) => String(a.clientName || "").localeCompare(String(b.clientName || "")));
  results.hidden = false;
  results.innerHTML = matching.length
    ? matching.map(client => `<button type="button" class="crm-client-search-result" role="option" data-client-doc-id="${escapeHtml(client.id)}"><span><strong>${escapeHtml(client.clientName || "Unnamed client")}</strong><small>${escapeHtml(client.clientId || client.id)}</small></span><i data-lucide="arrow-up-right"></i></button>`).join("")
    : `<div class="crm-client-search-empty">No clients match this name or Client ID.</div>`;
  if (window.lucide) window.lucide.createIcons();
}

function renderSelectedClientRecords() {
  const selected = clients.get(selectedClientDocId);
  const panel = document.getElementById("selected-client-records");
  const prompt = document.getElementById("client-record-prompt");
  if (!selected) {
    selectedClientDocId = "";
    panel.hidden = true;
    prompt.hidden = false;
    return;
  }
  const clientId = normalize(selected.clientId || selected.id);
  const clientCompliances = [...compliances.values()]
    .filter(record => normalize(record.clientId) === clientId)
    .sort((a, b) => (toDate(a.dueDate)?.getTime() || Infinity) - (toDate(b.dueDate)?.getTime() || Infinity));
  const clientCredentials = [...credentials.values()]
    .filter(record => normalize(record.clientId) === clientId)
    .sort((a, b) => String(a.PortalName || "").localeCompare(String(b.PortalName || "")));
  document.getElementById("selected-client-name").textContent = selected.clientName || "Unnamed client";
  document.getElementById("selected-client-id").textContent = selected.clientId || selected.id;
  document.getElementById("selected-client-contact").textContent = [selected.clientMobile, selected.clientEmail].filter(Boolean).join(" · ") || "No contact details";
  document.getElementById("selected-compliance-count").textContent = clientCompliances.length.toLocaleString("en-IN");
  document.getElementById("selected-credential-count").textContent = clientCredentials.length.toLocaleString("en-IN");
  document.getElementById("selected-compliance-rows").innerHTML = clientCompliances.length
    ? clientCompliances.map(record => {
      const filingStatus = clientComplianceStatus(record);
      return `<tr><td>${escapeHtml(record.complianceName || "—")}</td><td>${escapeHtml(record.complianceId || record.complianceAknNumber || "—")}</td><td>${escapeHtml(record.CompliancePeriod || "—")}</td><td>${formatDate(record.dueDate)}</td><td><span class="crm-row-status ${filingStatus.toLowerCase()}">${filingStatus}</span></td><td>${escapeHtml(record.paymentStatus || "—")}</td></tr>`;
    }).join("")
    : '<tr><td colspan="6">No compliance records for this Client ID.</td></tr>';
  document.getElementById("selected-credential-rows").innerHTML = clientCredentials.length
    ? clientCredentials.map(record => `<tr><td>${escapeHtml(record.PortalName || "—")}</td><td>${escapeHtml(record.credentialId || "—")}</td><td>${escapeHtml(record.UserName || "—")}</td><td>${escapeHtml(record.credentialStatus || "Active")}</td></tr>`).join("")
    : '<tr><td colspan="4">No credential records for this Client ID.</td></tr>';
  panel.hidden = false;
  prompt.hidden = true;
  if (window.lucide) window.lucide.createIcons();
}

function clientComplianceStatus(record) {
  if (isFiled(record)) return "Completed";
  const due = toDate(record.dueDate);
  if (due) {
    due.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (due < today) return "Overdue";
  }
  return "Pending";
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
  renderSelectedClientRecords();
}

function startListeners() {
  clientsUnsubscribe?.();
  complianceUnsubscribe?.();
  credentialsUnsubscribe?.();
  clientsUnsubscribe = onSnapshot(collection(db, "clients"), snapshot => {
    clients.clear();
    snapshot.forEach(documentSnapshot => clients.set(documentSnapshot.id, {
      ...documentSnapshot.data(),
      id: documentSnapshot.id
    }));
    renderClients();
    renderSelectedClientRecords();
  }, error => reportLoadError("clients", error));
  complianceUnsubscribe = onSnapshot(collection(db, "compliance"), snapshot => {
    compliances.clear();
    snapshot.forEach(documentSnapshot => compliances.set(documentSnapshot.id, {
      ...documentSnapshot.data(),
      id: documentSnapshot.id
    }));
    renderCompliances();
  }, error => reportLoadError("compliance", error));
  credentialsUnsubscribe = onSnapshot(collection(db, "credentials"), snapshot => {
    credentials.clear();
    snapshot.forEach(documentSnapshot => credentials.set(documentSnapshot.id, {
      ...documentSnapshot.data(),
      id: documentSnapshot.id
    }));
    renderCredentials();
  }, error => reportLoadError("credentials", error));
}

function initPage() {
  const addMenu = document.getElementById("addActionMenu");
  const addMenuToggle = document.getElementById("addMenuToggle");
  function closeAddMenu() {
    addMenu.hidden = true;
    addMenuToggle.setAttribute("aria-expanded", "false");
  }
  addMenuToggle.addEventListener("click", () => {
    addMenu.hidden = !addMenu.hidden;
    addMenuToggle.setAttribute("aria-expanded", String(!addMenu.hidden));
  });
  document.addEventListener("pointerdown", event => {
    if (!event.target.closest(".crm-add-wrap")) closeAddMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    closeAddMenu();
  });
  document.getElementById("refreshCrm").addEventListener("click", event => {
    const button = event.currentTarget;
    button.classList.remove("is-refreshing");
    void button.offsetWidth;
    button.classList.add("is-refreshing");
    startListeners();
    setTimeout(() => button.classList.remove("is-refreshing"), 750);
  });
  const search = document.getElementById("client-record-search");
  search.addEventListener("input", () => {
    selectedClientDocId = "";
    renderSelectedClientRecords();
    renderClientSearch();
  });
  document.getElementById("client-search-results").addEventListener("click", event => {
    const result = event.target.closest("[data-client-doc-id]");
    if (!result) return;
    selectedClientDocId = result.dataset.clientDocId;
    const client = clients.get(selectedClientDocId);
    search.value = client ? `${client.clientName || "Unnamed client"} · ${client.clientId || client.id}` : "";
    document.getElementById("client-search-results").hidden = true;
    renderSelectedClientRecords();
  });
  document.getElementById("clear-selected-client").addEventListener("click", () => {
    selectedClientDocId = "";
    search.value = "";
    renderSelectedClientRecords();
    renderClientSearch();
    search.focus();
  });

  onAuthStateChanged(auth, async user => {
    if (!user || normalize(user.email) !== ADMIN) {
      clientsUnsubscribe?.();
      complianceUnsubscribe?.();
      credentialsUnsubscribe?.();
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
