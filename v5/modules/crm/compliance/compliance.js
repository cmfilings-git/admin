import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  documentId,
  endAt,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAt,
  updateDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { prepareLucideIconMarkers } from "../../../js/searchable-select.js";
import { initializeDatePickers, refreshDatePicker } from "../../../js/date-picker.js";

const { firebaseConfig } = await import(new URL("firebase/firebase-config.js", document.baseURI));

const ALLOWED_ADMIN_EMAIL = "shanicm@gmail.com";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

let allRecords = [];
const clientsByDocId = new Map();
const clientsByClientId = new Map();
let clientFilterPicker = null;
let complianceClientPicker = null;
let editingComplianceId = "";
let complianceFormRequest = 0;
let currentPage = 1;
let sortColumn = "";
let sortDirection = 1;
let toastTimer = 0;

const selectedComplianceIds = new Set();
const PAGE_SIZE = 10;
const complianceFrequencies = new Set(["Monthly", "Quarterly", "Yearly"]);

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value === "object" && typeof value.seconds === "number") return new Date(value.seconds * 1000);
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;
    // Parse ISO YYYY-MM-DD as local midnight to avoid UTC/IST off-by-one boundary shifts
    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    // Supports common dd-mm-yyyy / dd/mm/yyyy formats
    const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function startOfDay(date) {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function filed(record) {
  const status = normalize(record.complianceStatus);
  return Boolean(record.filedAt) || ["filed", "completed", "complete", "done", "submitted"].includes(status);
}

function recordStatus(record) {
  if (filed(record)) return "completed";
  const due = toDate(record.dueDate);
  if (due) {
    if (startOfDay(due) < startOfDay(new Date())) return "overdue";
  }
  return "pending";
}

function formatDate(value) {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date)
    : (value ? String(value) : "—");
}

function financialYearStartYear(date = new Date()) {
  return date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
}

function compliancePeriodsFor(frequency, date = new Date()) {
  const currentStartYear = financialYearStartYear(date);
  const periods = [];
  for (let startYear = currentStartYear - 1; startYear <= currentStartYear + 1; startYear += 1) {
    const fiscalYear = `${startYear}-${String(startYear + 1).slice(-2)}`;
    if (frequency === "Monthly") {
      for (let month = 0; month < 12; month += 1) {
        const monthDate = new Date(startYear, 3 + month, 1);
        const value = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(monthDate);
        periods.push({ value, label: value });
      }
    } else if (frequency === "Quarterly") {
      for (let quarter = 1; quarter <= 4; quarter += 1) {
        const value = `Q${quarter} FY ${fiscalYear}`;
        periods.push({ value, label: value });
      }
    } else if (frequency === "Yearly") {
      const value = `FY ${fiscalYear}`;
      periods.push({ value, label: value });
    }
  }
  return periods;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function safeExternalUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function rememberClient(client) {
  const cached = { ...client, id: String(client.id || "") };
  if (cached.id) clientsByDocId.set(cached.id, cached);
  if (cached.clientId) clientsByClientId.set(normalize(cached.clientId), cached);
  return cached;
}

function findClient(clientId) {
  const id = String(clientId || "");
  return clientsByClientId.get(normalize(id)) || clientsByDocId.get(id) || null;
}

function clientOptionLabel(client) {
  const id = client.clientId || client.id;
  return `${client.clientName || "Unnamed client"} · ${id || ""}`.trim();
}

async function searchClientsByName(prefix) {
  const input = prefix.trim();
  const variants = [...new Set([
    input,
    `${input[0].toLocaleUpperCase()}${input.slice(1).toLocaleLowerCase()}`,
    input.toLocaleUpperCase()
  ])];
  const snapshots = await Promise.all(variants.map((value) => getDocs(query(
    collection(db, "clients"),
    orderBy("clientName"),
    startAt(value),
    endAt(`${value}\uf8ff`),
    limit(10)
  ))));
  const matches = new Map();
  snapshots.forEach((snapshot) => snapshot.docs.forEach((clientDoc) => {
    const client = rememberClient({ id: clientDoc.id, ...clientDoc.data() });
    matches.set(client.id, client);
  }));
  return [...matches.values()]
    .sort((a, b) => String(a.clientName || "").localeCompare(String(b.clientName || "")))
    .slice(0, 10);
}

function enhanceClientAutocomplete(select, { required = false, searchPlaceholder = "Type at least 3 characters to search" } = {}) {
  if (!select || select.dataset.clientAutocomplete) return null;
  select.dataset.clientAutocomplete = "true";

  const placeholder = select.options[0]?.value === ""
    ? select.options[0].cloneNode(true)
    : new Option("Select a client", "");

  const wrapper = document.createElement("div");
  wrapper.className = "crm-search-select compliance-client-search";
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  const input = document.createElement("input");
  input.type = "search";
  input.className = `${select.className} crm-search-select-input`;
  input.placeholder = searchPlaceholder;
  input.autocomplete = "off";
  input.required = required;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-label", select.getAttribute("aria-label") || select.closest("label")?.querySelector(".label")?.textContent || "Search clients");

  const list = document.createElement("div");
  list.className = "crm-search-select-list";
  list.id = `${select.id}-suggestions`;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  input.setAttribute("aria-controls", list.id);

  select.required = false;
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.classList.add("crm-search-select-native");
  wrapper.insertBefore(input, select);
  wrapper.appendChild(list);

  let requestVersion = 0;
  let debounceTimer = 0;

  const setExpanded = (expanded) => {
    list.hidden = !expanded;
    input.setAttribute("aria-expanded", String(expanded));
  };

  const setMessage = (message) => {
    const item = document.createElement("div");
    item.className = "crm-search-select-empty";
    item.textContent = message;
    list.replaceChildren(item);
    setExpanded(true);
  };

  const syncFromSelect = () => {
    const option = select.selectedOptions[0];
    if (option?.value) input.value = option.textContent.trim();
    else if (document.activeElement !== input) input.value = "";
    input.setCustomValidity(required && !select.value ? "Choose a matching client." : "");
  };

  const renderResults = (clients) => {
    select.replaceChildren(placeholder.cloneNode(true));
    list.replaceChildren();
    clients.forEach((client) => {
      const value = select.id === "complianceClient" ? client.id : (client.clientId || client.id);
      const label = clientOptionLabel(client);
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "crm-search-select-option";
      button.setAttribute("role", "option");
      button.textContent = label;
      button.addEventListener("click", () => {
        select.value = value;
        input.value = label;
        input.setCustomValidity("");
        setExpanded(false);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      list.appendChild(button);
    });
    if (!clients.length) {
      setMessage("No matching clients");
      return;
    }
    setExpanded(true);
  };

  const requestSuggestions = (search, version) => {
    setMessage("Searching clients...");
    searchClientsByName(search).then((results) => {
      if (version !== requestVersion || input.value.trim() !== search) return;
      renderResults(results);
    }).catch((error) => {
      if (version !== requestVersion) return;
      console.error("Client suggestions could not be loaded:", error);
      setMessage("Client search failed. Please try again.");
    });
  };

  input.addEventListener("input", () => {
    requestVersion += 1;
    clearTimeout(debounceTimer);
    select.value = "";
    input.setCustomValidity(required ? "Choose a matching client." : "");
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const search = input.value.trim();
    if (search.length < 3) {
      list.replaceChildren();
      setExpanded(false);
      return;
    }
    const version = requestVersion;
    debounceTimer = window.setTimeout(() => requestSuggestions(search, version), 250);
  });

  input.addEventListener("focus", () => {
    const search = input.value.trim();
    if (search.length >= 3 && !select.value) {
      requestVersion += 1;
      clearTimeout(debounceTimer);
      requestSuggestions(search, requestVersion);
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setExpanded(false);
    if (event.key === "ArrowDown" && !list.hidden) list.querySelector("[role='option']")?.focus();
    if (event.key === "Enter" && !list.hidden) {
      const firstOption = list.querySelector("[role='option']");
      if (firstOption) {
        event.preventDefault();
        firstOption.click();
      }
    }
  });

  select.addEventListener("change", syncFromSelect);
  document.addEventListener("pointerdown", (event) => {
    if (!wrapper.contains(event.target)) setExpanded(false);
  });

  return {
    clear() {
      requestVersion += 1;
      clearTimeout(debounceTimer);
      select.replaceChildren(placeholder.cloneNode(true));
      input.value = "";
      input.setCustomValidity(required ? "Choose a matching client." : "");
      list.replaceChildren();
      setExpanded(false);
    },
    setSelected(client) {
      const cached = rememberClient(client);
      const value = select.id === "complianceClient" ? cached.id : (cached.clientId || cached.id);
      if (!value) throw new Error("Cannot select a client without an ID.");
      const option = document.createElement("option");
      option.value = value;
      option.textContent = clientOptionLabel(cached);
      select.replaceChildren(placeholder.cloneNode(true), option);
      select.value = value;
      input.value = option.textContent;
      input.setCustomValidity("");
      setExpanded(false);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
}

async function loadClientsForRecords(records) {
  const ids = [...new Set(records.map((record) => String(record.clientId || "").trim()).filter(Boolean))]
    .filter((id) => !clientsByClientId.has(normalize(id)) && !clientsByDocId.has(id));
  const chunks = [];
  for (let index = 0; index < ids.length; index += 30) chunks.push(ids.slice(index, index + 30));
  await Promise.all(chunks.map(async (chunk) => {
    const [byClientId, byDocumentId] = await Promise.all([
      getDocs(query(collection(db, "clients"), where("clientId", "in", chunk))),
      getDocs(query(collection(db, "clients"), where(documentId(), "in", chunk)))
    ]);
    byClientId.docs.concat(byDocumentId.docs).forEach((clientDoc) => {
      rememberClient({ id: clientDoc.id, ...clientDoc.data() });
    });
  }));
}

async function nextComplianceIds(count = 1) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("Compliance ID count must be positive.");
  const year = String(new Date().getFullYear()).slice(-2);
  const sequenceField = `complianceSequence${year}`;
  const existingMax = allRecords.reduce((max, record) => {
    const match = String(record.complianceId || "").match(/^COM-(\d{2})(\d{5})$/);
    return match && match[1] === year ? Math.max(max, Number(match[2])) : max;
  }, 0);
  const counterRef = doc(db, "settings", "counters");
  return runTransaction(db, async (transaction) => {
    const counterSnapshot = await transaction.get(counterRef);
    const stored = Number(counterSnapshot.exists() ? counterSnapshot.data()[sequenceField] : 0);
    const first = Math.max(Number.isSafeInteger(stored) && stored > 0 ? stored + 1 : 1, existingMax + 1);
    const last = first + count - 1;
    if (last > 99999) throw new Error("The compliance ID sequence has reached its five-digit limit.");
    transaction.set(counterRef, { [sequenceField]: last, updatedAt: serverTimestamp() }, { merge: true });
    return Array.from({ length: count }, (_, index) => `COM-${year}${String(first + index).padStart(5, "0")}`);
  });
}

async function nextComplianceId() {
  return (await nextComplianceIds(1))[0];
}

function pill(status) {
  const labels = { completed: "Completed", pending: "Pending", overdue: "Overdue" };
  const cls = { completed: "status-complete", pending: "status-pending", overdue: "status-overdue" };
  return `<span class="status-pill ${cls[status] || "status-other"}">${labels[status] || escapeHtml(status || "Unknown")}</span>`;
}

function paymentPill(value) {
  const v = normalize(value);
  const cls = v === "paid" ? "status-complete" : (v === "unpaid" || v === "pending" ? "status-pending" : "status-other");
  return `<span class="status-pill ${cls}">${escapeHtml(value || "—")}</span>`;
}

function render() {
  prepareLucideIconMarkers("[data-sort-key]");

  const searchQuery = normalize($("searchInput").value);
  const statusFilter = $("statusFilter").value;
  const periodFilter = $("periodFilter").value;
  const paymentFilter = $("paymentFilter").value;
  const sortFilter = $("sortFilter").value;
  const clientFilter = normalize($("clientFilter").value);
  const viewFilter = $("viewFilter").value;
  const dateFrom = toDate($("dateFromFilter").value);
  const dateTo = toDate($("dateToFilter").value);
  const dateFromMs = dateFrom ? startOfDay(dateFrom).getTime() : null;
  const dateToMs = dateTo ? startOfDay(dateTo).getTime() : null;
  const complianceNameFilter = normalize($("complianceNameFilter").value);
  const priorityFilter = normalize($("priorityFilter").value);

  updateFilterCount();

  const today = startOfDay(new Date());
  const nextUpcomingDate = allRecords.reduce((nextDate, record) => {
    if (filed(record)) return nextDate;
    const dueDate = toDate(record.dueDate);
    if (!dueDate) return nextDate;
    const dueStart = startOfDay(dueDate);
    if (dueStart < today || (nextDate && dueStart >= nextDate)) return nextDate;
    return dueStart;
  }, null);

  $("upcomingCount").textContent = nextUpcomingDate ? formatDate(nextUpcomingDate) : "—";
  const upcomingDaysCount = $("upcomingDaysCount");
  if (nextUpcomingDate) {
    const daysUntil = Math.round((
      Date.UTC(nextUpcomingDate.getFullYear(), nextUpcomingDate.getMonth(), nextUpcomingDate.getDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
    ) / 86400000);
    upcomingDaysCount.textContent = daysUntil === 0
      ? "Due today"
      : `Due in ${daysUntil} ${daysUntil === 1 ? "day" : "days"}`;
    upcomingDaysCount.classList.toggle("is-warning", daysUntil <= 2);
  } else {
    upcomingDaysCount.textContent = "No upcoming date";
    upcomingDaysCount.classList.remove("is-warning");
  }

  $("pendingCount").textContent = allRecords.filter((record) => recordStatus(record) === "pending").length.toLocaleString("en-IN");
  $("notPaidCount").textContent = allRecords.filter((record) => normalize(record.paymentStatus) !== "paid").length.toLocaleString("en-IN");
  $("overdueCount").textContent = allRecords.filter((record) => recordStatus(record) === "overdue").length.toLocaleString("en-IN");

  const filtered = allRecords.filter((r) => {
    const status = recordStatus(r);
    const dueDate = toDate(r.dueDate);
    const dueMs = dueDate ? startOfDay(dueDate).getTime() : null;
    const searchText = [
      r.clientName,
      r.clientId,
      r.complianceId,
      r.complianceName,
      r.ComplianceFrequency,
      r.CompliancePeriod,
      r.complianceAknNumber
    ].map(normalize).join(" ");

    return (!searchQuery || searchText.includes(searchQuery))
      && (viewFilter === "all" || (!filed(r) && normalize(r.paymentStatus) !== "paid"))
      && (!clientFilter || normalize(r.clientId) === clientFilter || normalize(r.clientName) === clientFilter)
      && (dateFromMs === null || (dueMs !== null && dueMs >= dateFromMs))
      && (dateToMs === null || (dueMs !== null && dueMs <= dateToMs))
      && (!complianceNameFilter || normalize(r.complianceName) === complianceNameFilter)
      && (!priorityFilter || normalize(r.priority) === priorityFilter)
      && (!statusFilter || status === statusFilter)
      && (!periodFilter || String(r.CompliancePeriod ?? "") === periodFilter)
      && (!paymentFilter || normalize(r.paymentStatus) === paymentFilter);
  });

  filtered.sort((a, b) => {
    const key = sortColumn || (sortFilter === "client" ? "clientName" : sortFilter === "compliance" ? "complianceName" : "dueDate");
    const direction = sortColumn ? sortDirection : (sortFilter === "due-desc" ? -1 : 1);
    if (key === "dueDate") {
      const dateA = toDate(a.dueDate)?.getTime();
      const dateB = toDate(b.dueDate)?.getTime();
      if (dateA == null) return dateB == null ? 0 : 1;
      if (dateB == null) return -1;
      return (dateA - dateB) * direction;
    }
    const valueA = key === "filingStatus" ? recordStatus(a) : a[key];
    const valueB = key === "filingStatus" ? recordStatus(b) : b[key];
    return String(valueA || "").localeCompare(String(valueB || ""), undefined, { sensitivity: "base", numeric: true }) * direction;
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, pageCount);
  const firstIndex = (currentPage - 1) * PAGE_SIZE;
  const visibleRecords = filtered.slice(firstIndex, firstIndex + PAGE_SIZE);

  $("recordCount").textContent = `${filtered.length ? firstIndex + 1 : 0}–${Math.min(firstIndex + PAGE_SIZE, filtered.length)} of ${filtered.length} matching`;
  $("selectedComplianceCount").textContent = `${selectedComplianceIds.size} selected`;
  $("emptyState").classList.toggle("hidden", filtered.length !== 0);

  $("complianceRows").innerHTML = visibleRecords.map((r) => {
    const status = recordStatus(r);
    const folderUrl = safeExternalUrl(r.taskFolderLink);
    const folder = folderUrl
      ? `<span>Linked</span>`
      : `<span class="crm-compliance-reference">—</span>`;
    const client = findClient(r.clientId);
    const phoneDigits = String(client?.clientMobile || r.clientMobile || "").replace(/\D/g, "");
    const whatsappNumber = phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits;

    const reminder = `Hello ${r.clientName || ""}, this is a reminder that payment for ${r.complianceName || "your compliance"}${r.CompliancePeriod ? ` (${r.CompliancePeriod})` : ""} is pending. Please arrange payment at your earliest convenience.`;
    const whatsappUrl = whatsappNumber ? `https://wa.me/${encodeURIComponent(whatsappNumber)}?text=${encodeURIComponent(reminder)}` : "";

    const filingMessage = `Hello ${r.clientName || ""}, the filing status for ${r.complianceName || "your compliance"}${r.CompliancePeriod ? ` (${r.CompliancePeriod})` : ""} is ${status}. Due date: ${formatDate(r.dueDate)}.`;
    const filingWhatsappUrl = whatsappNumber ? `https://wa.me/${encodeURIComponent(whatsappNumber)}?text=${encodeURIComponent(filingMessage)}` : "";

    const action = `<div class="crm-row-menu-wrap"><button class="crm-row-action crm-row-menu-toggle" type="button" data-row-menu-toggle aria-label="Actions for ${escapeHtml(r.clientName || "compliance record")}" aria-expanded="false" title="Actions"><i data-lucide="ellipsis" aria-hidden="true"></i></button><div class="crm-row-menu" hidden><button type="button" data-edit-compliance="${escapeHtml(r.firestoreDocId)}"><i data-lucide="pencil" aria-hidden="true"></i><span>Edit</span></button>${whatsappUrl ? `<a href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer"><i data-lucide="message-circle" aria-hidden="true"></i><span>Send Payment Reminder</span><i class="crm-row-menu-cta" data-lucide="arrow-up-right" aria-hidden="true"></i></a><a href="${escapeHtml(filingWhatsappUrl)}" target="_blank" rel="noopener noreferrer"><i data-lucide="file-check-2" aria-hidden="true"></i><span>Send Filing Status</span><i class="crm-row-menu-cta" data-lucide="arrow-up-right" aria-hidden="true"></i></a>` : `<button type="button" disabled><i data-lucide="message-circle" aria-hidden="true"></i><span>Mobile number missing</span></button>`}${folderUrl ? `<a href="${escapeHtml(folderUrl)}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link" aria-hidden="true"></i><span>Open folder</span></a>` : ""}</div></div>`;

    return `<tr>
      <td><input type="checkbox" data-select-compliance="${escapeHtml(r.firestoreDocId)}" aria-label="Select compliance for ${escapeHtml(r.clientName || "client")}" ${selectedComplianceIds.has(r.firestoreDocId) ? "checked" : ""}></td>
      <td><p class="crm-compliance-client-name">${escapeHtml(r.clientName || "—")}</p><p class="crm-compliance-client-id">${escapeHtml(r.clientId || "—")}</p></td>
      <td><p class="crm-compliance-name">${escapeHtml(r.complianceName || "—")}</p><p class="crm-compliance-reference">${escapeHtml(r.complianceId || r.complianceAknNumber || "—")}</p></td>
      <td><p>${escapeHtml(r.CompliancePeriod || "—")}</p>${r.ComplianceFrequency ? `<p class="crm-compliance-reference">${escapeHtml(r.ComplianceFrequency)}</p>` : ""}</td>
      <td class="whitespace-nowrap">${formatDate(r.dueDate)}</td>
      <td>${pill(status)}</td>
      <td>${paymentPill(r.paymentStatus)}</td>
      <td>${escapeHtml(r.priority || "—")}</td>
      <td>${folder}</td>
      <td>${r.complianceFee === undefined || r.complianceFee === null || r.complianceFee === "" ? "—" : escapeHtml(r.complianceFee)}</td>
      <td class="text-right">${action}</td>
    </tr>`;
  }).join("");

  if (!filtered.length) $("complianceRows").innerHTML = "";

  const allVisibleSelected = visibleRecords.length > 0 && visibleRecords.every((record) => selectedComplianceIds.has(record.firestoreDocId));
  $("selectVisibleCompliance").checked = allVisibleSelected;
  $("selectVisibleCompliance").indeterminate = visibleRecords.some((record) => selectedComplianceIds.has(record.firestoreDocId)) && !allVisibleSelected;

  $("compliancePagination").innerHTML = `<span>Page ${currentPage} of ${pageCount}</span><button type="button" aria-label="Previous page" data-page="-1" ${currentPage <= 1 ? "disabled" : ""}><i data-lucide="chevron-left" aria-hidden="true"></i></button><button type="button" aria-label="Next page" data-page="1" ${currentPage >= pageCount ? "disabled" : ""}><i data-lucide="chevron-right" aria-hidden="true"></i></button>`;

  updateBulkActionState();
  document.querySelectorAll("[data-sort-key]").forEach((button) => {
    const icon = button.querySelector("i");
    if (icon) {
      icon.setAttribute("data-lucide", button.dataset.sortKey === sortColumn ? (sortDirection < 0 ? "arrow-down" : "arrow-up") : "arrow-up-down");
    }
  });
  if (window.lucide) window.lucide.createIcons();
}

function updateBulkActionState() {
  const hasSelection = selectedComplianceIds.size > 0;
  $("deleteSelected").disabled = !hasSelection;
  $("copySelected").disabled = !hasSelection;
}

function closeBulkActions() {
  $("bulkActionsMenu").hidden = true;
  $("bulkActionsToggle").setAttribute("aria-expanded", "false");
}

function closeRowActionMenus() {
  document.querySelectorAll(".crm-row-menu:not([hidden])").forEach((menu) => {
    menu.hidden = true;
    menu.parentElement.querySelector("[data-row-menu-toggle]")?.setAttribute("aria-expanded", "false");
  });
}

function updateFilterCount() {
  const activeFilters = [
    $("clientFilter").value,
    $("dateFromFilter").value,
    $("dateToFilter").value,
    $("periodFilter").value,
    $("complianceNameFilter").value,
    $("statusFilter").value,
    $("paymentFilter").value,
    $("priorityFilter").value,
    $("viewFilter").value === "all" ? "all" : ""
  ].filter(Boolean).length;
  $("activeFilterCount").textContent = String(activeFilters);
  $("activeFilterCount").hidden = activeFilters === 0;
}

function closeFilterPopover() {
  $("complianceFilterPopover").hidden = true;
  $("filterToggle").setAttribute("aria-expanded", "false");
}

function showFilterPanel(category) {
  document.querySelectorAll("[data-filter-category]").forEach((button) => {
    const selected = button.dataset.filterCategory === category;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-filter-panel]").forEach((panel) => {
    const selected = panel.dataset.filterPanel === category;
    panel.classList.toggle("active", selected);
    panel.hidden = !selected;
  });
}

function showToast(message, success = true) {
  const toast = $("toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.style.background = success ? "#166534" : "#be123c";
  toast.style.color = "#ffffff";
  toast.classList.remove("hidden", "hiddenx");
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 3000);
}

async function deleteSelectedCompliance() {
  const ids = [...selectedComplianceIds];
  if (!ids.length || !confirm(`Delete ${ids.length} selected compliance record${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
  try {
    const batch = writeBatch(db);
    ids.forEach((id) => batch.delete(doc(db, "compliance", id)));
    await batch.commit();
    selectedComplianceIds.clear();
    closeBulkActions();
    await loadComplianceRegister();
    showToast(`${ids.length} compliance record${ids.length === 1 ? "" : "s"} deleted.`);
  } catch (error) {
    console.error("Could not delete selected compliance records:", error);
    showToast(`Could not delete selected records (${error.code || "error"}).`, false);
  }
}

function openCopyDateModal() {
  if (!selectedComplianceIds.size) return;
  closeBulkActions();
  $("copyDateError").textContent = "";
  $("copyDateModal").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeCopyDateModal() {
  $("copyDateModal").hidden = true;
  $("copyDateForm").reset();
  $("copyDateError").textContent = "";
  document.body.style.overflow = "";
}

async function copySelectedCompliance(event) {
  event.preventDefault();
  const dueDate = $("copyDueDate").value;
  const recordsToCopy = allRecords.filter((record) => selectedComplianceIds.has(record.firestoreDocId));
  if (!dueDate || !recordsToCopy.length) {
    $("copyDateError").textContent = "Select a new date and at least one compliance record.";
    return;
  }
  try {
    const complianceIds = await nextComplianceIds(recordsToCopy.length);
    const batch = writeBatch(db);
    recordsToCopy.forEach(({ firestoreDocId, ...record }, index) => {
      batch.set(doc(collection(db, "compliance")), {
        ...record,
        complianceId: complianceIds[index],
        dueDate,
        complianceStatus: "pending",
        filedAt: null,
        paymentStatus: "pending",
        nextComplianceDate: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
    selectedComplianceIds.clear();
    closeCopyDateModal();
    await loadComplianceRegister();
    showToast(`${recordsToCopy.length} compliance cop${recordsToCopy.length === 1 ? "y" : "ies"} created.`);
  } catch (error) {
    console.error("Could not copy selected compliance records:", error);
    $("copyDateError").textContent = `Could not copy selected records (${error.code || "error"}).`;
  }
}

async function loadComplianceRegister() {
  $("loadError").classList.add("hidden");
  $("complianceRows").innerHTML = `<tr><td colspan="11" class="text-center" style="padding:36px 16px"><div class="flex justify-center"><div class="spinner"></div></div><p class="crm-compliance-reference" style="margin-top:10px">Loading compliance records…</p></td></tr>`;
  window.COREBIQ?.showLoading?.();
  try {
    const complianceSnap = await getDocs(collection(db, "compliance"));
    allRecords = complianceSnap.docs.map((recordDoc) => ({ firestoreDocId: recordDoc.id, ...recordDoc.data() }));
    await loadClientsForRecords(allRecords);

    const periods = [...new Set(allRecords.map((r) => String(r.CompliancePeriod ?? "").trim()).filter(Boolean))].sort().reverse();
    $("periodFilter").innerHTML = `<option value="">All periods</option>` + periods.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");

    const complianceNames = [...new Set(allRecords.map((r) => String(r.complianceName ?? "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    $("complianceNameFilter").innerHTML = `<option value="">All compliances</option>` + complianceNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");

    render();
  } catch (error) {
    console.error("Firestore load failed:", error);
    $("complianceRows").innerHTML = "";
    $("loadError").textContent = `Could not load Firestore data (${error.code || "error"}). Check that Firestore rules allow this signed-in admin to read the compliance collection.`;
    $("loadError").classList.remove("hidden");
  } finally {
    window.COREBIQ?.hideLoading?.();
  }
}

function resetCompliancePeriodOptions() {
  $("complianceFrequencyInput").value = "";
  $("complianceFrequencyInput").required = true;
  $("compliancePeriodField").classList.add("hidden");
  $("compliancePeriodInput").replaceChildren(new Option("Select period", ""));
  $("compliancePeriodInput").required = false;
}

function updateCompliancePeriodOptions(preservedValue) {
  const frequency = $("complianceFrequencyInput").value;
  const periodSelect = $("compliancePeriodInput");
  const currentValue = preservedValue === undefined ? periodSelect.value : preservedValue;
  const periods = compliancePeriodsFor(frequency);
  periodSelect.replaceChildren(new Option("Select period", ""));

  if (!complianceFrequencies.has(frequency)) {
    $("compliancePeriodField").classList.add("hidden");
    periodSelect.required = false;
    if (currentValue) {
      periodSelect.add(new Option(currentValue, currentValue));
      periodSelect.value = currentValue;
    }
    return;
  }

  $("compliancePeriodField").classList.remove("hidden");
  periods.forEach((period) => periodSelect.add(new Option(period.label, period.value)));
  if (currentValue && !periods.some((period) => period.value === currentValue) && preservedValue !== undefined) {
    periodSelect.add(new Option(currentValue, currentValue));
  }
  periodSelect.value = currentValue && Array.from(periodSelect.options).some((option) => option.value === currentValue)
    ? currentValue
    : "";
  periodSelect.required = true;
}

function closeComplianceForm() {
  complianceFormRequest += 1;
  $("complianceModal").classList.add("hidden");
  resetCompliancePeriodOptions();
  $("complianceForm").reset();
  complianceClientPicker?.clear();
  $("complianceFormError").textContent = "";
  $("complianceModalTitle").textContent = "Add Compliance";
  $("saveCompliance").innerHTML = '<i data-lucide="save" aria-hidden="true"></i><span>Save Compliance</span>';
  $("saveCompliance").disabled = false;
  editingComplianceId = "";
  $("nextComplianceDateField").classList.add("hidden");
  $("nextComplianceDate").required = false;
  document.body.style.overflow = "";
}

async function openComplianceForm() {
  $("complianceFormError").textContent = "";
  const request = ++complianceFormRequest;
  resetCompliancePeriodOptions();
  $("complianceForm").reset();
  complianceClientPicker?.clear();
  editingComplianceId = "";
  $("complianceModalTitle").textContent = "Add Compliance";
  $("saveCompliance").innerHTML = '<i data-lucide="save" aria-hidden="true"></i><span>Save Compliance</span>';
  $("saveCompliance").disabled = true;
  $("complianceIdInput").value = "Generating...";
  updateComplianceType();
  $("complianceModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  if (window.lucide) window.lucide.createIcons();

  try {
    const complianceId = await nextComplianceId();
    if (request !== complianceFormRequest || $("complianceModal").classList.contains("hidden")) return;
    $("complianceIdInput").value = complianceId;
    $("saveCompliance").disabled = false;
  } catch (error) {
    if (request !== complianceFormRequest) return;
    console.error("Could not generate compliance ID:", error);
    $("complianceIdInput").value = "";
    $("complianceFormError").textContent = `Could not generate a compliance ID (${error.code || "error"}). Try again.`;
  }
}

function dateInputValue(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function openEditComplianceForm(recordId) {
  const record = allRecords.find((item) => item.firestoreDocId === recordId);
  if (!record) return;
  try {
    complianceFormRequest += 1;
    resetCompliancePeriodOptions();
    $("complianceForm").reset();
    complianceClientPicker?.clear();
    editingComplianceId = recordId;
    $("complianceModalTitle").textContent = "Edit Compliance";
    $("saveCompliance").innerHTML = '<i data-lucide="save" aria-hidden="true"></i><span>Update Compliance</span>';

    const client = findClient(record.clientId);
    if (client) complianceClientPicker?.setSelected(client);

    $("complianceNameInput").value = record.complianceName || "";
    $("complianceIdInput").value = record.complianceId || await nextComplianceId();
    $("complianceAknInput").value = record.complianceAknNumber || "";

    const storedFrequency = String(record.ComplianceFrequency || "").trim();
    const legacyFrequency = complianceFrequencies.has(record.CompliancePeriod) ? record.CompliancePeriod : "";
    const frequency = complianceFrequencies.has(storedFrequency) ? storedFrequency : legacyFrequency;
    const periodValue = storedFrequency ? (record.CompliancePeriod || "") : (legacyFrequency ? "" : (record.CompliancePeriod || ""));

    $("complianceFrequencyInput").value = frequency;
    $("complianceFrequencyInput").required = Boolean(frequency);
    updateCompliancePeriodOptions(periodValue);

    $("complianceDueDate").value = dateInputValue(record.dueDate);
    $("nextComplianceDate").value = dateInputValue(record.nextComplianceDate);
    refreshDatePicker("complianceDueDate");
    refreshDatePicker("nextComplianceDate");

    $("compliancePriority").value = record.priority || "";
    $("complianceFolder").value = record.taskFolderLink || "";
    document.querySelector(`input[name="complianceType"][value="${record.complianceType === "Running Compliance" ? "Running Compliance" : "Onetime"}"]`).checked = true;
    updateComplianceType();

    $("complianceFormError").textContent = client ? "" : "The linked client was not found. Search and select a client to continue.";
    $("complianceModal").classList.remove("hidden");
    $("saveCompliance").disabled = false;
    document.body.style.overflow = "hidden";
    if (window.lucide) window.lucide.createIcons();
  } catch (error) {
    console.error("Could not open compliance record:", error);
    showToast(`Could not open record (${error.code || "error"}).`, false);
  }
}

function updateComplianceType() {
  const isRunning = document.querySelector('input[name="complianceType"]:checked').value === "Running Compliance";
  $("nextComplianceDateField").classList.toggle("hidden", !isRunning);
  $("nextComplianceDate").required = false;
  const nextDateDisplay = $("nextComplianceDateDisplay");
  if (nextDateDisplay) nextDateDisplay.required = isRunning;
}

async function saveCompliance(event) {
  event.preventDefault();
  $("complianceFormError").textContent = "";

  const selectedClient = clientsByDocId.get($("complianceClient").value);
  const complianceName = $("complianceNameInput").value.trim();
  const complianceType = document.querySelector('input[name="complianceType"]:checked').value;
  const dueDate = $("complianceDueDate").value;
  const nextComplianceDate = $("nextComplianceDate").value;
  const complianceId = $("complianceIdInput").value.trim();
  const isEditing = Boolean(editingComplianceId);
  const existingRecord = isEditing ? allRecords.find((item) => item.firestoreDocId === editingComplianceId) : null;
  const complianceFrequency = $("complianceFrequencyInput").value;
  const compliancePeriod = $("compliancePeriodInput").value.trim()
    || (!complianceFrequency ? (existingRecord?.CompliancePeriod || "") : "");

  if (!selectedClient) {
    $("complianceFormError").textContent = "Select a client.";
    return;
  }
  if (!complianceName) {
    $("complianceFormError").textContent = "Enter a compliance name.";
    $("complianceNameInput").focus();
    return;
  }
  if ((!isEditing || complianceFrequency) && (!complianceFrequency || !compliancePeriod)) {
    $("complianceFormError").textContent = "Choose a frequency and compliance period.";
    return;
  }
  if (!dueDate) {
    $("complianceFormError").textContent = "Select a due date.";
    return;
  }
  if (!editingComplianceId && !/^COM-\d{7}$/.test(complianceId)) {
    $("complianceFormError").textContent = "A valid compliance ID has not been generated. Close the form and try again.";
    return;
  }
  if (complianceType === "Running Compliance" && (!nextComplianceDate || nextComplianceDate <= dueDate)) {
    $("complianceFormError").textContent = "Next Compliance date must be later than the due date.";
    return;
  }

  const saveButton = $("saveCompliance");
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";

  const timestamp = serverTimestamp();
  const record = {
    clientName: selectedClient.clientName || "",
    clientId: selectedClient.clientId || selectedClient.id,
    clientMobile: selectedClient.clientMobile || "",
    complianceId,
    complianceName,
    complianceAknNumber: $("complianceAknInput").value.trim(),
    ComplianceFrequency: complianceFrequency || existingRecord?.ComplianceFrequency || "",
    CompliancePeriod: compliancePeriod,
    dueDate,
    complianceType,
    nextComplianceDate: complianceType === "Running Compliance" ? nextComplianceDate : "",
    priority: $("compliancePriority").value,
    taskFolderLink: $("complianceFolder").value.trim()
  };

  try {
    if (isEditing) {
      const existing = allRecords.find((item) => item.firestoreDocId === editingComplianceId);
      await updateDoc(doc(db, "compliance", editingComplianceId), {
        ...record,
        complianceStatus: existing?.complianceStatus || "pending",
        filedAt: existing?.filedAt ?? null,
        paymentStatus: existing?.paymentStatus || "pending",
        updatedAt: timestamp
      });
      closeComplianceForm();
      await loadComplianceRegister();
      showToast("Compliance updated.");
    } else {
      const nextRecordComplianceId = complianceType === "Running Compliance" ? await nextComplianceId() : "";
      const batch = writeBatch(db);
      batch.set(doc(collection(db, "compliance")), {
        ...record,
        complianceStatus: "pending",
        filedAt: null,
        paymentStatus: "pending",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      if (complianceType === "Running Compliance") {
        batch.set(doc(collection(db, "compliance")), {
          ...record,
          complianceId: nextRecordComplianceId,
          dueDate: nextComplianceDate,
          nextComplianceDate: "",
          complianceStatus: "pending",
          filedAt: null,
          paymentStatus: "pending",
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }
      await batch.commit();
      closeComplianceForm();
      await loadComplianceRegister();
      showToast(complianceType === "Running Compliance" ? "Compliance and next pending copy created." : "Compliance created.");
    }
  } catch (error) {
    console.error("Could not save compliance:", error);
    $("complianceFormError").textContent = `Could not save compliance (${error.code || "error"}). Check Firestore permissions and try again.`;
  } finally {
    saveButton.disabled = false;
    saveButton.innerHTML = isEditing
      ? '<i data-lucide="save" aria-hidden="true"></i><span>Update Compliance</span>'
      : '<i data-lucide="save" aria-hidden="true"></i><span>Save Compliance</span>';
    if (window.lucide) window.lucide.createIcons();
  }
}

function initCompliancePageControls() {
  const requiredIds = [
    "upcomingCount",
    "pendingCount",
    "notPaidCount",
    "overdueCount",
    "searchInput",
    "recordCount",
    "selectedComplianceCount",
    "filterToggle",
    "complianceFilterPopover",
    "bulkActionsToggle",
    "bulkActionsMenu",
    "complianceFrequencyInput",
    "compliancePeriodField",
    "compliancePeriodInput"
  ];
  const missingIds = requiredIds.filter((id) => !$(id));
  if (missingIds.length) {
    throw new Error(`Compliance page components are missing required elements: ${missingIds.join(", ")}`);
  }

  initializeDatePickers(document);
  clientFilterPicker = enhanceClientAutocomplete($("clientFilter"), {
    searchPlaceholder: $("clientFilter").dataset.searchPlaceholder || "Type at least 3 characters to search"
  });
  complianceClientPicker = enhanceClientAutocomplete($("complianceClient"), {
    required: true,
    searchPlaceholder: $("complianceClient").dataset.searchPlaceholder || "Type at least 3 characters to search"
  });

  document.querySelectorAll("[data-filter-panel]").forEach((panel) => {
    panel.hidden = !panel.classList.contains("active");
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-signout]")) signOut(auth);
  });
  window.addEventListener("corebiq:signout-request", () => signOut(auth));

  document.addEventListener("corebiq:modulepage-filter-toggle", (event) => {
    if (event.detail?.id !== "filterToggle" || !event.detail.open) return;
    showFilterPanel(document.querySelector("[data-filter-category].active")?.dataset.filterCategory || "view");
  });

  $("clearComplianceFilters").addEventListener("click", () => {
    clientFilterPicker?.clear();
    ["clientFilter", "dateFromFilter", "dateToFilter", "periodFilter", "complianceNameFilter", "statusFilter", "paymentFilter", "priorityFilter"].forEach((id) => {
      $(id).value = "";
    });
    refreshDatePicker("dateFromFilter");
    refreshDatePicker("dateToFilter");
    $("viewFilter").value = "outstanding";
    $("sortFilter").value = "due-asc";
    sortColumn = "";
    sortDirection = 1;
    $("clientFilter").dispatchEvent(new Event("change", { bubbles: true }));
    currentPage = 1;
    showFilterPanel("view");
    render();
    closeFilterPopover();
  });

  document.querySelectorAll("[data-filter-category]").forEach((button) => {
    button.addEventListener("click", () => showFilterPanel(button.dataset.filterCategory));
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".crm-filter-wrap")) closeFilterPopover();
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-compliance-refresh]");
    if (!button) return;
    button.classList.add("is-refreshing");
    loadComplianceRegister().finally(() => button.classList.remove("is-refreshing"));
  });

  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-modulepage-add]")) openComplianceForm();
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("#closeComplianceModal")) closeComplianceForm();
  });

  $("cancelComplianceForm").addEventListener("click", closeComplianceForm);
  $("complianceModal").addEventListener("click", (event) => {
    if (event.target === $("complianceModal")) closeComplianceForm();
  });
  $("complianceForm").addEventListener("submit", saveCompliance);

  $("selectVisibleCompliance").addEventListener("change", () => {
    const shouldSelect = $("selectVisibleCompliance").checked;
    $("complianceRows").querySelectorAll("[data-select-compliance]").forEach((checkbox) => {
      checkbox.checked = shouldSelect;
      if (shouldSelect) selectedComplianceIds.add(checkbox.dataset.selectCompliance);
      else selectedComplianceIds.delete(checkbox.dataset.selectCompliance);
    });
    render();
  });

  $("complianceRows").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-select-compliance]");
    if (!checkbox) return;
    if (checkbox.checked) selectedComplianceIds.add(checkbox.dataset.selectCompliance);
    else selectedComplianceIds.delete(checkbox.dataset.selectCompliance);
    render();
  });

  $("complianceRows").addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-row-menu-toggle]");
    if (toggle) {
      const menu = toggle.parentElement.querySelector(".crm-row-menu");
      const shouldOpen = menu.hidden;
      closeRowActionMenus();
      if (shouldOpen) {
        menu.hidden = false;
        const buttonRect = toggle.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const left = Math.max(14, Math.min(buttonRect.right - menuRect.width, window.innerWidth - menuRect.width - 14));
        const top = buttonRect.bottom + menuRect.height + 8 <= window.innerHeight
          ? buttonRect.bottom + 4
          : Math.max(8, buttonRect.top - menuRect.height - 4);
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        toggle.setAttribute("aria-expanded", "true");
      }
      return;
    }

    const editButton = event.target.closest("[data-edit-compliance]");
    if (editButton) {
      closeRowActionMenus();
      openEditComplianceForm(editButton.dataset.editCompliance);
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".crm-row-menu-wrap")) closeRowActionMenus();
  });

  $("deleteSelected").addEventListener("click", deleteSelectedCompliance);
  $("copySelected").addEventListener("click", openCopyDateModal);
  $("copyDateForm").addEventListener("submit", copySelectedCompliance);
  $("copyDateModal").addEventListener("click", (event) => {
    if (event.target === $("copyDateModal")) closeCopyDateModal();
  });
  document.querySelectorAll("[data-close-copy]").forEach((button) => {
    button.addEventListener("click", closeCopyDateModal);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("#bulkActionsMenu, #bulkActionsToggle, .crm-add-wrap")) closeBulkActions();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeBulkActions();
    closeRowActionMenus();
    closeFilterPopover();
    if (!$("copyDateModal").hidden) closeCopyDateModal();
    if (!$("complianceModal").classList.contains("hidden")) closeComplianceForm();
  });

  document.querySelectorAll('input[name="complianceType"]').forEach((input) => {
    input.addEventListener("change", updateComplianceType);
  });
  $("complianceFrequencyInput").addEventListener("change", () => updateCompliancePeriodOptions());
  $("complianceDueDate").addEventListener("change", () => {
    $("nextComplianceDate").min = $("complianceDueDate").value;
  });

  $("sortFilter").addEventListener("change", () => {
    sortColumn = "";
    currentPage = 1;
    render();
  });

  [
    "searchInput",
    "statusFilter",
    "clientFilter",
    "periodFilter",
    "paymentFilter",
    "viewFilter",
    "dateFromFilter",
    "dateToFilter",
    "complianceNameFilter",
    "priorityFilter"
  ].forEach((id) => {
    $(id).addEventListener(id === "searchInput" ? "input" : "change", () => {
      currentPage = 1;
      render();
    });
  });

  $("compliancePagination").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-page]");
    if (!button) return;
    currentPage += Number(button.dataset.page);
    render();
  });

  $("complianceRows").closest("table").addEventListener("click", (event) => {
    const button = event.target.closest("[data-sort-key]");
    if (!button) return;
    const key = button.dataset.sortKey;
    sortDirection = sortColumn === key ? -sortDirection : 1;
    sortColumn = key;
    currentPage = 1;
    render();
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user || normalize(user.email) !== ALLOWED_ADMIN_EMAIL) {
      if (user) await signOut(auth);
      const next = encodeURIComponent(location.pathname.replace(/^\//, "") + location.search + location.hash);
      location.replace(new URL(`auth/login.html?next=${next}`, document.baseURI).href);
      return;
    }
    $("app").classList.remove("hidden", "hiddenx");
    await loadComplianceRegister();
    if (location.hash === "#add") openComplianceForm();
  });
}

if (window.COREBIQ_COMPONENTS_LOADED) initCompliancePageControls();
else document.addEventListener("corebiq:components-loaded", initCompliancePageControls, { once: true });
