import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getFirestore, onSnapshot, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "../../firebase/firebase-config.js";
import { enhanceSearchableSelect, prepareLucideIconMarkers } from "../../js/searchable-select.js";

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
const PAGE_SIZE = 10;
let contactPage = 1;
let taskPage = 1;
let taskSortKey = "due";
let taskSortDirection = 1;

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

function renderCredentials() {
  document.getElementById("total-credentials").textContent = credentials.size.toLocaleString("en-IN");
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
  document.getElementById("contact-total-count").textContent = list.length.toLocaleString("en-IN");
  document.getElementById("contact-phone-count").textContent = list.filter(client => String(client.clientMobile || "").trim()).length.toLocaleString("en-IN");
  document.getElementById("contact-email-count").textContent = list.filter(client => String(client.clientEmail || "").trim()).length.toLocaleString("en-IN");
  document.getElementById("contact-missing-count").textContent = list.filter(client => !String(client.clientMobile || "").trim() || !String(client.clientEmail || "").trim()).length.toLocaleString("en-IN");
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  contactPage = Math.min(contactPage, pageCount);
  const visible = filtered.slice((contactPage - 1) * PAGE_SIZE, contactPage * PAGE_SIZE);
  document.getElementById("contact-rows").innerHTML = visible.length
    ? visible.map(client => {
      const phone = String(client.clientMobile || "").trim();
      const phoneDigits = phone.replace(/\D/g, "");
      const whatsappNumber = phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits;
      const email = String(client.clientEmail || "").trim();
      const communicationActions = [
        phone ? `<a class="crm-contact-action call" href="tel:${escapeHtml(phone.replace(/[^\d+*#,;]/g, ""))}" aria-label="Call ${escapeHtml(client.clientName || "client")}" title="Call"><i data-lucide="phone"></i></a>` : "",
        whatsappNumber ? `<a class="crm-contact-action whatsapp" href="https://wa.me/${encodeURIComponent(whatsappNumber)}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp ${escapeHtml(client.clientName || "client")}" title="WhatsApp"><i data-lucide="message-circle"></i></a>` : "",
        email ? `<a class="crm-contact-action email" href="mailto:${encodeURIComponent(email)}" aria-label="Email ${escapeHtml(client.clientName || "client")}" title="Email"><i data-lucide="mail"></i></a>` : ""
      ].filter(Boolean).join("");
      const needsDetails = !phone || !email;
      return `<article class="crm-contact-card">
        <div class="crm-contact-card-head"><div><div class="crm-contact-name">${escapeHtml(client.clientName || "Unnamed client")}</div><div class="crm-contact-subtitle">${escapeHtml(client.personaName || client.clientId || client.id)}</div></div><span class="crm-contact-status">${escapeHtml(client.clientStatus || "Active")}</span></div>
        <div class="crm-contact-details">${phone ? `<span>${escapeHtml(phone)}</span>` : ""}${email ? `<span>${escapeHtml(email)}</span>` : ""}${!phone && !email ? "<span>No phone or email saved</span>" : ""}</div>
        <div class="crm-contact-actions">${communicationActions}${needsDetails ? `<button class="crm-contact-add-details" type="button" data-contact-client="${escapeHtml(client.id)}"><i data-lucide="user-round-pen"></i><span>Add details</span></button>` : ""}</div>
      </article>`;
    }).join("")
    : `<div class="crm-contact-empty">${query || status ? "No contacts match these filters." : "No client/contact records found."}</div>`;
  renderPagination("contactPagination", filtered.length, contactPage, "contacts");
  if (window.lucide) window.lucide.createIcons();
}

function renderPagination(elementId, total, page, type) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const end = Math.min(page * PAGE_SIZE, total);
  document.getElementById(elementId).innerHTML = `<span>${start}–${end} of ${total.toLocaleString("en-IN")}</span><button type="button" data-page-type="${type}" data-page-step="-1" aria-label="Previous page" ${page <= 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i></button><span>Page ${page} of ${pageCount}</span><button type="button" data-page-type="${type}" data-page-step="1" aria-label="Next page" ${page >= pageCount ? "disabled" : ""}><i data-lucide="chevron-right"></i></button>`;
  if (window.lucide) window.lucide.createIcons();
}

function closeContactForm() {
  document.getElementById("contactModal").hidden = true;
  document.getElementById("addContactForm").reset();
  document.getElementById("contactFormError").textContent = "";
  document.body.style.overflow = "";
}

function selectContactClient(clientId = "") {
  const select = document.getElementById("contactClientSelect");
  const allClients = [...clients.values()].sort((a, b) => String(a.clientName || "").localeCompare(String(b.clientName || "")));
  const incompleteClients = allClients.filter(client => !String(client.clientMobile || "").trim() || !String(client.clientEmail || "").trim());
  const choices = incompleteClients.length ? incompleteClients : allClients;
  select.innerHTML = `<option value="">Select a client</option>` + choices.map(client =>
    `<option value="${escapeHtml(client.id)}">${escapeHtml(client.clientName || "Unnamed client")} · ${escapeHtml(client.clientId || client.id)}</option>`
  ).join("");
  select.value = clientId;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillContactFields() {
  const client = clients.get(document.getElementById("contactClientSelect").value);
  document.getElementById("contactPersonInput").value = client?.personaName || "";
  document.getElementById("contactPhoneInput").value = client?.clientMobile || "";
  document.getElementById("contactEmailInput").value = client?.clientEmail || "";
}

function openContactForm(clientId = "") {
  document.getElementById("contactFormError").textContent = "";
  selectContactClient(clientId);
  document.getElementById("contactModal").hidden = false;
  document.body.style.overflow = "hidden";
  if (window.lucide) window.lucide.createIcons();
}

async function pickPhoneContact() {
  const errorOutput = document.getElementById("contactFormError");
  errorOutput.textContent = "";
  if (!navigator.contacts?.select) {
    errorOutput.textContent = "Phone contact picker is not available in this browser. Enter the details manually.";
    return;
  }
  try {
    const [picked] = await navigator.contacts.select(["name", "tel", "email"], { multiple: false });
    if (!picked) return;
    if (picked.name?.[0]) document.getElementById("contactPersonInput").value = picked.name[0];
    if (picked.tel?.[0]) document.getElementById("contactPhoneInput").value = picked.tel[0];
    if (picked.email?.[0]) document.getElementById("contactEmailInput").value = picked.email[0];
  } catch (pickerError) {
    if (pickerError.name !== "AbortError") errorOutput.textContent = "Could not read the selected phone contact.";
  }
}

async function saveContactDetails(event) {
  event.preventDefault();
  const error = document.getElementById("contactFormError");
  const clientId = document.getElementById("contactClientSelect").value;
  const phone = document.getElementById("contactPhoneInput").value.trim();
  const email = document.getElementById("contactEmailInput").value.trim();
  if (!clientId) {
    error.textContent = "Select an existing client.";
    return;
  }
  if (!phone && !email) {
    error.textContent = "Enter a phone number or email address.";
    return;
  }
  const saveButton = document.getElementById("saveContactDetails");
  saveButton.disabled = true;
  try {
    await updateDoc(doc(db, "clients", clientId), {
      personaName: document.getElementById("contactPersonInput").value.trim(),
      clientMobile: phone,
      clientEmail: email,
      updatedAt: serverTimestamp()
    });
    closeContactForm();
  } catch (saveError) {
    console.error("Could not update client contact details:", saveError);
    error.textContent = `Could not save contact details (${saveError.code || "error"}). Check Firestore permissions and try again.`;
  } finally {
    saveButton.disabled = false;
  }
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
  const clientFilter = normalize(document.getElementById("taskClientFilter")?.value);
  const allStatuses = records.map(complianceStatus);
  document.getElementById("task-total-count").textContent = records.length.toLocaleString("en-IN");
  document.getElementById("task-pending-count").textContent = allStatuses.filter(status => status === "pending").length.toLocaleString("en-IN");
  document.getElementById("task-overdue-count").textContent = allStatuses.filter(status => status === "overdue").length.toLocaleString("en-IN");
  document.getElementById("task-completed-count").textContent = allStatuses.filter(status => status === "completed").length.toLocaleString("en-IN");
  const filtered = records.filter(record => {
    const status = complianceStatus(record);
    const matchesQuery = !query || [
      record.clientName, record.clientId, record.complianceName,
      record.complianceId, record.CompliancePeriod, record.complianceAknNumber
    ].some(value => normalize(value).includes(query));
    const matchesStatus = filter === "all" || !filter && true
      ? true
      : filter === "open" ? !isFiled(record) : status === filter;
    const matchesClient = !clientFilter || normalize(record.clientId) === clientFilter || normalize(record.clientName) === clientFilter;
    return matchesQuery && matchesStatus && matchesClient;
  });
  filtered.sort((a, b) => {
    let comparison = 0;
    if (sort === "client" || taskSortKey === "client") comparison = String(a.clientName || "").localeCompare(String(b.clientName || ""));
    else if (taskSortKey === "compliance") comparison = String(a.complianceName || "").localeCompare(String(b.complianceName || ""));
    else comparison = (toDate(a.dueDate)?.getTime() || Infinity) - (toDate(b.dueDate)?.getTime() || Infinity);
    return comparison * taskSortDirection;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  taskPage = Math.min(taskPage, pageCount);
  const visible = filtered.slice((taskPage - 1) * PAGE_SIZE, taskPage * PAGE_SIZE);
  const rows = document.getElementById("task-rows");
  if (!rows) return;
  rows.innerHTML = visible.length ? visible.map(record => {
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
  renderPagination("taskPagination", filtered.length, taskPage, "tasks");
  if (window.lucide) window.lucide.createIcons();
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
    const clientFilter = document.getElementById("taskClientFilter");
    const selectedClient = clientFilter.value;
    const options = [...clients.values()].sort((a, b) => String(a.clientName || "").localeCompare(String(b.clientName || "")));
    clientFilter.innerHTML = `<option value="">All clients</option>` + options.map(client =>
      `<option value="${escapeHtml(client.clientId || client.id)}">${escapeHtml(client.clientName || "Unnamed client")} · ${escapeHtml(client.clientId || client.id)}</option>`
    ).join("");
    clientFilter.value = selectedClient;
    clientFilter.dispatchEvent(new Event("change", { bubbles: true }));
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
  credentialsUnsubscribe = onSnapshot(collection(db, "credentials"), snapshot => {
    credentials.clear();
    snapshot.forEach(documentSnapshot => credentials.set(documentSnapshot.id, documentSnapshot.data()));
    renderCredentials();
  }, error => reportLoadError("credentials", error));
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
  enhanceSearchableSelect(document.getElementById("contactClientSelect"));
  enhanceSearchableSelect(document.getElementById("taskClientFilter"));
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
    if (!document.getElementById("contactModal").hidden) closeContactForm();
  });
  document.getElementById("refreshCrm").addEventListener("click", event => {
    const button = event.currentTarget;
    button.classList.remove("is-refreshing");
    void button.offsetWidth;
    button.classList.add("is-refreshing");
    startListeners();
    setTimeout(() => button.classList.remove("is-refreshing"), 750);
  });
  document.getElementById("menuAddContact").addEventListener("click", () => {
    closeAddMenu();
    openContactForm();
  });
  document.getElementById("addContactButton").addEventListener("click", () => openContactForm());
  document.getElementById("contact-rows").addEventListener("click", event => {
    const button = event.target.closest("[data-contact-client]");
    if (button) openContactForm(button.dataset.contactClient);
  });
  document.getElementById("contactClientSelect").addEventListener("change", fillContactFields);
  document.getElementById("phoneContactPicker").addEventListener("click", pickPhoneContact);
  document.getElementById("addContactForm").addEventListener("submit", saveContactDetails);
  document.querySelectorAll("[data-close-contact]").forEach(button => button.addEventListener("click", closeContactForm));
  document.addEventListener("click", event => {
    const link = event.target.closest('.crm-tabs a[href*="crm.html#"]');
    if (!link) return;
    const panel = new URL(link.href).hash.slice(1);
    if (!["contacts", "tasks"].includes(panel)) return;
    event.preventDefault();
    activatePanel(panel);
  });
  document.getElementById("contact-search").addEventListener("input", () => { contactPage = 1; renderContacts(); });
  document.getElementById("contact-status-filter").addEventListener("change", () => { contactPage = 1; renderContacts(); });
  document.getElementById("contact-sort").addEventListener("change", () => { contactPage = 1; renderContacts(); });
  document.getElementById("task-search").addEventListener("input", () => { taskPage = 1; renderTasks(); });
  document.getElementById("task-status-filter").addEventListener("change", () => { taskPage = 1; renderTasks(); });
  document.getElementById("task-sort").addEventListener("change", () => { taskPage = 1; taskSortKey = document.getElementById("task-sort").value; renderTasks(); });
  document.getElementById("taskClientFilter").addEventListener("change", () => { taskPage = 1; renderTasks(); });
  document.querySelectorAll("[data-task-sort]").forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.taskSort;
    taskSortDirection = taskSortKey === key ? -taskSortDirection : 1;
    taskSortKey = key;
    document.getElementById("task-sort").value = key === "client" ? "client" : "due";
    taskPage = 1;
    prepareLucideIconMarkers("[data-task-sort]");
    document.querySelectorAll("[data-task-sort]").forEach(sortButton => {
      sortButton.querySelector("i").setAttribute("data-lucide", sortButton.dataset.taskSort === key ? (taskSortDirection < 0 ? "arrow-down" : "arrow-up") : "arrow-up-down");
    });
    renderTasks();
  }));
  ["contactPagination", "taskPagination"].forEach(id => document.getElementById(id).addEventListener("click", event => {
    const button = event.target.closest("button[data-page-type]");
    if (!button) return;
    if (button.dataset.pageType === "contacts") { contactPage += Number(button.dataset.pageStep); renderContacts(); }
    else { taskPage += Number(button.dataset.pageStep); renderTasks(); }
  }));
  document.getElementById("refreshTasks").addEventListener("click", startListeners);
  activatePanel(location.hash.slice(1) || "dashboard", false);

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
