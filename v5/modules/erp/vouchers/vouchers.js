import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { firebaseConfig } = await import(new URL("firebase/firebase-config.js", document.baseURI));

const ADMIN = "shanicm@gmail.com";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const VOUCHER_CONFIG = {
  Contra:        { prefix: "CNT", badge: "contra",      label: "Contra Voucher",   nonPosting: false },
  Payment:       { prefix: "PMT", badge: "payment",     label: "Payment Voucher",  nonPosting: false },
  Receipt:       { prefix: "RCT", badge: "receipt",     label: "Receipt Voucher",  nonPosting: false },
  Journal:       { prefix: "JRN", badge: "journal",     label: "Journal Voucher",  nonPosting: false },
  Sales:         { prefix: "SLS", badge: "sales",       label: "Sales Voucher",    nonPosting: false },
  Purchase:      { prefix: "PUR", badge: "purchase",    label: "Purchase Voucher", nonPosting: false },
  "Credit Note": { prefix: "CRN", badge: "credit-note", label: "Credit Note",      nonPosting: false },
  "Debit Note":  { prefix: "DBN", badge: "debit-note",  label: "Debit Note",       nonPosting: false },
  Estimate:      { prefix: "EST", badge: "estimate",    label: "Estimate",         nonPosting: true }
};

// Optional page lock for dedicated sub-pages (e.g., <body data-voucher-type="Contra">)
const PAGE_VOUCHER_TYPE = (document.body.dataset.voucherType || "").trim();

const ledgers = new Map();
const vouchers = new Map();
const selectedVoucherIds = new Set();
let ledgersUnsub = null;
let vouchersUnsub = null;
let editingId = "";
let toastTimer = 0;
let initialLedgerParam = new URLSearchParams(location.search).get("ledger") || "";

function normalize(v) {
  return String(v ?? "").trim().toLowerCase();
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value === "string") {
    const ymd = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

// Formats dates as yyyy-MMM-dd (e.g., 2026-Nov-19)
function formatDate(value) {
  const d = toDate(value);
  if (!d) return "—";
  return `${d.getFullYear()}-${MONTHS[d.getMonth()]}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatMoney(amount) {
  const num = Number(amount) || 0;
  let currency = "INR";
  try { currency = localStorage.getItem("corebiq-currency") || "INR"; } catch {}
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(num);
  } catch {
    return `₹${num.toLocaleString("en-IN")}`;
  }
}

function showToast(msg, success = true) {
  const el = $("toast");
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = msg;
  el.style.background = success ? "#166534" : "#be123c";
  el.style.color = "#ffffff";
  el.classList.remove("hidden");
  toastTimer = window.setTimeout(() => el.classList.add("hidden"), 3000);
}

function showError(err) {
  console.error("Vouchers error:", err);
  $("erp-app")?.classList.remove("hidden");
  window.COREBIQ?.hideLoading?.();
  const banner = $("erp-error");
  if (banner) {
    banner.textContent = typeof err === "string" ? err : `Could not load vouchers (${err?.code || err?.message || "error"}).`;
    banner.classList.remove("hidden");
  }
}

function nextVoucherNumber(type) {
  const cfg = VOUCHER_CONFIG[type] || { prefix: "VCH" };
  const yy = String(new Date().getFullYear()).slice(-2);
  const pattern = new RegExp(`^${cfg.prefix}-(\\d{2})(\\d{4,})$`);
  let maxSeq = 0;
  vouchers.forEach((v) => {
    const m = String(v.voucherNo || "").match(pattern);
    if (m && m[1] === yy) maxSeq = Math.max(maxSeq, Number(m[2]));
  });
  return `${cfg.prefix}-${yy}${String(maxSeq + 1).padStart(4, "0")}`;
}

function syncSubmenuActiveState() {
  document.querySelectorAll("[data-submenu-type]").forEach((link) => {
    const isMatch = (link.dataset.submenuType || "") === PAGE_VOUCHER_TYPE;
    if (isMatch) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if (PAGE_VOUCHER_TYPE && VOUCHER_CONFIG[PAGE_VOUCHER_TYPE]) {
    const label = VOUCHER_CONFIG[PAGE_VOUCHER_TYPE].label;
    if ($("voucherPageHeading")) $("voucherPageHeading").textContent = label;
    if ($("voucherBreadcrumbCurrent")) $("voucherBreadcrumbCurrent").textContent = PAGE_VOUCHER_TYPE;
    const titleSpan = document.querySelector("[data-modulepage-row3-title-text]");
    if (titleSpan) titleSpan.textContent = `${PAGE_VOUCHER_TYPE} Register`;
    if ($("voucherTypeFilter")) {
      $("voucherTypeFilter").value = PAGE_VOUCHER_TYPE;
      $("voucherTypeFilter").disabled = true;
    }
  }
}

/* Compliance-Style Filter Popover & Bulk Actions Helpers */
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

function updateFilterCount() {
  const active = [
    PAGE_VOUCHER_TYPE ? "" : ($("voucherTypeFilter")?.value || ""),
    $("voucherLedgerFilter")?.value || "",
    $("voucherStatusFilter")?.value || "",
    $("voucherFromDate")?.value || "",
    $("voucherToDate")?.value || ""
  ].filter(Boolean).length;
  const badge = $("activeVoucherFilterCount");
  if (badge) {
    badge.textContent = String(active);
    badge.hidden = active === 0;
  }
}

function closeFilterPopover() {
  if ($("voucherFilterPopover")) $("voucherFilterPopover").hidden = true;
  $("voucherFilterToggle")?.setAttribute("aria-expanded", "false");
}

function closeBulkActions() {
  if ($("voucherBulkActionsMenu")) $("voucherBulkActionsMenu").hidden = true;
  $("voucherBulkActionsToggle")?.setAttribute("aria-expanded", "false");
}

function updateBulkActionState() {
  const hasSelection = selectedVoucherIds.size > 0;
  if ($("bulkMarkPosted")) $("bulkMarkPosted").disabled = !hasSelection;
  if ($("bulkMarkDraft")) $("bulkMarkDraft").disabled = !hasSelection;
  if ($("bulkDeleteVouchers")) $("bulkDeleteVouchers").disabled = !hasSelection;
  if ($("selectedVoucherCount")) $("selectedVoucherCount").textContent = `${selectedVoucherIds.size} selected`;
}

function syncModalForVoucherType(type) {
  const isEstimate = Boolean(VOUCHER_CONFIG[type]?.nonPosting);
  if ($("debitLedger")) $("debitLedger").required = !isEstimate;
  if ($("creditLedger")) $("creditLedger").required = !isEstimate;
  $("ledgerPairFields")?.classList.toggle("hidden", isEstimate);
  if ($("voucherModalSub")) {
    $("voucherModalSub").textContent = isEstimate
      ? "Estimates are non-posting quotations and do not affect ledger balances."
      : "Posted vouchers update ledger balances immediately.";
  }

  if (!editingId) {
    if ($("voucherNo")) $("voucherNo").value = nextVoucherNumber(type);
    if (isEstimate && $("voucherStatus")) $("voucherStatus").value = "Draft";
  }
}

function populateLedgerSelects() {
  const sorted = [...ledgers.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const active = sorted.filter((l) => normalize(l.status) !== "inactive");

  const filterSel = $("voucherLedgerFilter");
  if (filterSel) {
    const prevFilter = filterSel.value || initialLedgerParam;
    filterSel.replaceChildren(new Option("All ledgers", ""));
    sorted.forEach((l) => filterSel.add(new Option(`${l.name} (${l.type})`, l.id)));
    if (prevFilter && ledgers.has(prevFilter)) {
      filterSel.value = prevFilter;
      initialLedgerParam = "";
    }
  }

  ["debitLedger", "creditLedger"].forEach((id) => {
    const sel = $(id);
    if (!sel) return;
    const prev = sel.value;
    sel.replaceChildren(new Option(id === "debitLedger" ? "Select debit ledger" : "Select credit ledger", ""));
    active.forEach((l) => sel.add(new Option(`${l.name} · ${l.group || l.type}`, l.id)));
    if (prev) sel.value = prev;
  });
}

function render() {
  updateFilterCount();

  const q = normalize($("voucherSearch")?.value);
  const typeFilter = PAGE_VOUCHER_TYPE || ($("voucherTypeFilter")?.value || "");
  const ledgerFilter = $("voucherLedgerFilter")?.value || "";
  const statusFilter = $("voucherStatusFilter")?.value || "";
  const fromDate = $("voucherFromDate")?.value || "";
  const toDateVal = $("voucherToDate")?.value || "";
  const sortOrder = $("voucherSortFilter")?.value || "date-desc";

  const scoped = PAGE_VOUCHER_TYPE
    ? [...vouchers.values()].filter((v) => v.voucherType === PAGE_VOUCHER_TYPE)
    : [...vouchers.values()];

  let inflow = 0;
  let outflow = 0;
  let postedCount = 0;
  let draftCount = 0;

  scoped.forEach((v) => {
    const amt = Number(v.amount) || 0;
    const isDraft = normalize(v.status) === "draft" || v.voucherType === "Estimate";
    if (isDraft) {
      draftCount += 1;
      return;
    }
    postedCount += 1;
    if (v.voucherType === "Receipt" || v.voucherType === "Sales" || v.voucherType === "Debit Note") inflow += amt;
    if (v.voucherType === "Payment" || v.voucherType === "Purchase" || v.voucherType === "Credit Note") outflow += amt;
  });

  if ($("kpi-total-vouchers")) $("kpi-total-vouchers").textContent = scoped.length.toLocaleString("en-IN");
  if ($("kpi-inflow")) $("kpi-inflow").textContent = formatMoney(inflow);
  if ($("kpi-outflow")) $("kpi-outflow").textContent = formatMoney(outflow);
  if ($("kpi-posted-count")) $("kpi-posted-count").textContent = `${postedCount} / ${draftCount}`;

  const filtered = scoped
    .filter((v) => {
      const drName = v.debitLedgerName || ledgers.get(v.debitLedgerId)?.name || "";
      const crName = v.creditLedgerName || ledgers.get(v.creditLedgerId)?.name || "";
      const hay = [v.voucherNo, v.voucherType, v.partyName, drName, crName, v.paymentMode, v.referenceNo, v.narration]
        .map(normalize)
        .join(" ");
      return (!q || hay.includes(q))
        && (!typeFilter || v.voucherType === typeFilter)
        && (!ledgerFilter || v.debitLedgerId === ledgerFilter || v.creditLedgerId === ledgerFilter)
        && (!statusFilter || (v.status || "Posted") === statusFilter)
        && (!fromDate || (v.date && v.date >= fromDate))
        && (!toDateVal || (v.date && v.date <= toDateVal));
    })
    .sort((a, b) => {
      if (sortOrder === "date-asc") return (toDate(a.date)?.getTime() || 0) - (toDate(b.date)?.getTime() || 0);
      if (sortOrder === "amount-desc") return (Number(b.amount) || 0) - (Number(a.amount) || 0);
      if (sortOrder === "amount-asc") return (Number(a.amount) || 0) - (Number(b.amount) || 0);
      if (sortOrder === "no-desc") return String(b.voucherNo || "").localeCompare(String(a.voucherNo || ""), undefined, { numeric: true });
      return (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0)
        || String(b.voucherNo || "").localeCompare(String(a.voucherNo || ""), undefined, { numeric: true });
    });

  if ($("voucherCount")) $("voucherCount").textContent = `${filtered.length} matching`;
  $("voucherEmpty")?.classList.toggle("hidden", filtered.length > 0);

  const tbody = $("voucherRows");
  if (!tbody) return;

  tbody.innerHTML = filtered.map((v) => {
    const vType = v.voucherType || "Journal";
    const cfg = VOUCHER_CONFIG[vType] || { badge: "journal", nonPosting: false };
    const drName = v.debitLedgerName || ledgers.get(v.debitLedgerId)?.name || "";
    const crName = v.creditLedgerName || ledgers.get(v.creditLedgerId)?.name || "";
    const entryMain = drName && crName
      ? `${drName} → ${crName}`
      : (v.partyName || drName || crName || "—");
    const entrySub = [drName && crName ? v.partyName : "", v.narration].filter(Boolean).join(" · ");

    const status = cfg.nonPosting
      ? (normalize(v.status) === "posted" ? "Approved" : "Draft")
      : (normalize(v.status) === "draft" ? "Draft" : "Posted");
    const pillCls = status === "Posted" || status === "Approved" ? "status-complete" : "status-pending";

    return `<tr>
      <td><input type="checkbox" data-select-voucher="${escapeHtml(v.id)}" aria-label="Select voucher ${escapeHtml(v.voucherNo || "")}" ${selectedVoucherIds.has(v.id) ? "checked" : ""}></td>
      <td class="erp-date-cell">${formatDate(v.date)}</td>
      <td>
        <div class="erp-voucher-no">${escapeHtml(v.voucherNo || "—")}</div>
        <span class="vtype-badge ${cfg.badge}">${escapeHtml(vType)}</span>
      </td>
      <td>
        <div class="erp-entry-main">${escapeHtml(entryMain)}</div>
        ${entrySub ? `<div class="erp-entry-sub">${escapeHtml(entrySub)}</div>` : ""}
      </td>
      <td>
        <div>${escapeHtml(v.paymentMode || "—")}</div>
        ${v.referenceNo ? `<div class="erp-entry-sub">${escapeHtml(v.referenceNo)}</div>` : ""}
      </td>
      <td><span class="status-pill ${pillCls}">${status}</span></td>
      <td class="text-right erp-amount">${formatMoney(v.amount)}</td>
      <td class="text-right">
        <div class="erp-row-menu-wrap">
          <button type="button" class="erp-row-action" data-row-menu-toggle aria-expanded="false" aria-label="Voucher actions">
            <i data-lucide="ellipsis" aria-hidden="true"></i>
          </button>
          <div class="erp-row-menu" hidden>
            <button type="button" data-edit-voucher="${escapeHtml(v.id)}"><i data-lucide="pencil" aria-hidden="true"></i><span>Edit</span></button>
            <button type="button" data-toggle-status="${escapeHtml(v.id)}"><i data-lucide="check-circle-2" aria-hidden="true"></i><span>Mark as ${normalize(v.status) === "draft" ? "Posted" : "Draft"}</span></button>
            <button type="button" class="is-danger" data-delete-voucher="${escapeHtml(v.id)}"><i data-lucide="trash-2" aria-hidden="true"></i><span>Delete</span></button>
          </div>
        </div>
      </td>
    </tr>`;
  }).join("");

  const selectAll = $("selectVisibleVouchers");
  if (selectAll) {
    const allSelected = filtered.length > 0 && filtered.every((v) => selectedVoucherIds.has(v.id));
    selectAll.checked = allSelected;
    selectAll.indeterminate = filtered.some((v) => selectedVoucherIds.has(v.id)) && !allSelected;
  }

  updateBulkActionState();
  if (window.lucide) window.lucide.createIcons();
}

function closeRowMenus() {
  document.querySelectorAll(".erp-row-menu:not([hidden])").forEach((m) => {
    m.hidden = true;
    m.parentElement.querySelector("[data-row-menu-toggle]")?.setAttribute("aria-expanded", "false");
  });
}

function openModal(voucher = null) {
  editingId = voucher?.id || "";
  $("voucherForm")?.reset();
  if ($("voucherFormError")) $("voucherFormError").textContent = "";
  populateLedgerSelects();

  const type = voucher?.voucherType || PAGE_VOUCHER_TYPE || "Receipt";
  if ($("voucherModalTitle")) $("voucherModalTitle").textContent = editingId ? `Edit ${type}` : `New ${type}`;
  if ($("voucherType")) {
    $("voucherType").value = type;
    $("voucherType").disabled = Boolean(PAGE_VOUCHER_TYPE && !editingId);
  }
  if ($("voucherDate")) $("voucherDate").value = voucher?.date || todayIso();
  if ($("partyName")) $("partyName").value = voucher?.partyName || "";
  if ($("debitLedger")) $("debitLedger").value = voucher?.debitLedgerId || "";
  if ($("creditLedger")) $("creditLedger").value = voucher?.creditLedgerId || "";
  if ($("voucherAmount")) $("voucherAmount").value = voucher?.amount ?? "";
  if ($("paymentMode")) $("paymentMode").value = voucher?.paymentMode || "Bank Transfer";
  if ($("voucherStatus")) $("voucherStatus").value = voucher?.status || (type === "Estimate" ? "Draft" : "Posted");
  if ($("referenceNo")) $("referenceNo").value = voucher?.referenceNo || "";
  if ($("voucherNarration")) $("voucherNarration").value = voucher?.narration || "";

  syncModalForVoucherType(type);
  if (voucher?.voucherNo && $("voucherNo")) $("voucherNo").value = voucher.voucherNo;

  if (!VOUCHER_CONFIG[type]?.nonPosting && !ledgers.size && $("voucherFormError")) {
    $("voucherFormError").textContent = "Create at least two ledgers in ERP > Ledgers before posting vouchers.";
  }

  $("voucherModal")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  editingId = "";
  if ($("voucherType")) $("voucherType").disabled = false;
  $("voucherModal")?.classList.add("hidden");
  document.body.style.overflow = "";
}

async function saveVoucher(event) {
  event.preventDefault();
  if ($("voucherFormError")) $("voucherFormError").textContent = "";

  const voucherType = $("voucherType").value;
  const isEstimate = Boolean(VOUCHER_CONFIG[voucherType]?.nonPosting);
  const debitId = isEstimate ? "" : $("debitLedger").value;
  const creditId = isEstimate ? "" : $("creditLedger").value;
  const amount = Number($("voucherAmount").value);
  const date = $("voucherDate").value;
  const voucherNo = $("voucherNo").value.trim();
  const partyName = $("partyName").value.trim();

  if (!voucherNo || !date) {
    $("voucherFormError").textContent = "Voucher number and date are required.";
    return;
  }
  if (!isEstimate) {
    if (!debitId || !creditId) {
      $("voucherFormError").textContent = "Select both Debit and Credit ledgers.";
      return;
    }
    if (debitId === creditId) {
      $("voucherFormError").textContent = "Debit and Credit ledgers must be different.";
      return;
    }
  } else if (!partyName) {
    $("voucherFormError").textContent = "Enter a party / customer name for the estimate.";
    $("partyName").focus();
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    $("voucherFormError").textContent = "Enter a valid amount greater than 0.";
    return;
  }

  const payload = {
    voucherNo,
    voucherType,
    date,
    partyName,
    debitLedgerId: debitId,
    debitLedgerName: debitId ? (ledgers.get(debitId)?.name || "") : "",
    creditLedgerId: creditId,
    creditLedgerName: creditId ? (ledgers.get(creditId)?.name || "") : "",
    amount,
    paymentMode: $("paymentMode").value,
    referenceNo: $("referenceNo").value.trim(),
    narration: $("voucherNarration").value.trim(),
    status: isEstimate ? "Draft" : $("voucherStatus").value,
    nonPosting: isEstimate,
    updatedAt: serverTimestamp()
  };

  const btn = $("saveVoucherBtn");
  btn.disabled = true;
  try {
    if (editingId) {
      await updateDoc(doc(db, "erp_vouchers", editingId), payload);
      showToast(`${voucherType} updated.`);
    } else {
      await addDoc(collection(db, "erp_vouchers"), { ...payload, createdAt: serverTimestamp() });
      showToast(`${voucherType} saved.`);
    }
    closeModal();
  } catch (err) {
    console.error("Save voucher error:", err);
    $("voucherFormError").textContent = `Could not save voucher (${err.code || "error"}).`;
  } finally {
    btn.disabled = false;
  }
}

async function toggleVoucherStatus(id) {
  const v = vouchers.get(id);
  if (!v) return;
  const nextStatus = normalize(v.status) === "draft" ? "Posted" : "Draft";
  try {
    await updateDoc(doc(db, "erp_vouchers", id), { status: nextStatus, updatedAt: serverTimestamp() });
    showToast(`Voucher marked as ${nextStatus}.`);
  } catch (err) {
    showToast(`Could not update status (${err.code || "error"}).`, false);
  }
}

async function deleteVoucher(id) {
  const v = vouchers.get(id);
  if (!v || !confirm(`Delete ${v.voucherType || "voucher"} ${v.voucherNo || ""}? Ledger balances will recalculate.`)) return;
  try {
    await deleteDoc(doc(db, "erp_vouchers", id));
    selectedVoucherIds.delete(id);
    showToast("Voucher deleted.");
  } catch (err) {
    showToast(`Could not delete voucher (${err.code || "error"}).`, false);
  }
}

async function bulkUpdateStatus(nextStatus) {
  const ids = [...selectedVoucherIds];
  if (!ids.length) return;
  try {
    const batch = writeBatch(db);
    ids.forEach((id) => batch.update(doc(db, "erp_vouchers", id), { status: nextStatus, updatedAt: serverTimestamp() }));
    await batch.commit();
    selectedVoucherIds.clear();
    closeBulkActions();
    showToast(`${ids.length} voucher${ids.length === 1 ? "" : "s"} marked as ${nextStatus}.`);
  } catch (err) {
    showToast(`Bulk update failed (${err.code || "error"}).`, false);
  }
}

async function bulkDeleteSelected() {
  const ids = [...selectedVoucherIds];
  if (!ids.length || !confirm(`Delete ${ids.length} selected voucher${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
  try {
    const batch = writeBatch(db);
    ids.forEach((id) => batch.delete(doc(db, "erp_vouchers", id)));
    await batch.commit();
    selectedVoucherIds.clear();
    closeBulkActions();
    showToast(`${ids.length} voucher${ids.length === 1 ? "" : "s"} deleted.`);
  } catch (err) {
    showToast(`Bulk delete failed (${err.code || "error"}).`, false);
  }
}

function setupDropdowns() {
  const pairs = [
    ["erpModuleMenuToggle", "erpModuleMenu"],
    ["voucherSubmenuToggle", "voucherSubmenuDropdown"]
  ];

  const closeAll = () => {
    pairs.forEach(([tId, mId]) => {
      if ($(mId)) $(mId).hidden = true;
      $(tId)?.setAttribute("aria-expanded", "false");
    });
  };

  pairs.forEach(([tId, mId]) => {
    $(tId)?.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = $(mId);
      if (!menu) return;
      const willOpen = menu.hidden;
      closeAll();
      menu.hidden = !willOpen;
      $(tId)?.setAttribute("aria-expanded", String(willOpen));
    });
  });

  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".erp-dropdown-wrap")) closeAll();
    if (!e.target.closest(".erp-row-menu-wrap")) closeRowMenus();
    if (!e.target.closest(".crm-filter-wrap")) closeFilterPopover();
    if (!e.target.closest("#voucherBulkActionsMenu, #voucherBulkActionsToggle, .crm-add-wrap")) closeBulkActions();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeAll();
    closeRowMenus();
    closeFilterPopover();
    closeBulkActions();
    if ($("voucherModal") && !$("voucherModal").classList.contains("hidden")) closeModal();
  });
}

function init() {
  try {
    syncSubmenuActiveState();
    setupDropdowns();

    // Initialize Compliance-style filter panels
    document.querySelectorAll("[data-filter-panel]").forEach((panel) => {
      panel.hidden = !panel.classList.contains("active");
    });

    document.addEventListener("corebiq:modulepage-filter-toggle", (event) => {
      if (event.detail?.id !== "voucherFilterToggle" || !event.detail.open) return;
      showFilterPanel(document.querySelector("[data-filter-category].active")?.dataset.filterCategory || "type");
    });

    document.querySelectorAll("[data-filter-category]").forEach((button) => {
      button.addEventListener("click", () => showFilterPanel(button.dataset.filterCategory));
    });

    window.addEventListener("corebiq:signout-request", () => signOut(auth));

    $("addVoucherBtn")?.addEventListener("click", () => openModal());
    $("closeVoucherModal")?.addEventListener("click", closeModal);
    $("cancelVoucherBtn")?.addEventListener("click", closeModal);
    $("voucherModal")?.addEventListener("click", (e) => { if (e.target === $("voucherModal")) closeModal(); });
    $("voucherForm")?.addEventListener("submit", saveVoucher);

    $("voucherType")?.addEventListener("change", () => {
      const type = $("voucherType").value;
      if (!editingId && $("voucherModalTitle")) $("voucherModalTitle").textContent = `New ${type}`;
      syncModalForVoucherType(type);
    });

    $("clearVoucherFilters")?.addEventListener("click", () => {
      ["voucherLedgerFilter", "voucherStatusFilter", "voucherFromDate", "voucherToDate"].forEach((id) => {
        if ($(id)) $(id).value = "";
      });
      if (!PAGE_VOUCHER_TYPE && $("voucherTypeFilter")) $("voucherTypeFilter").value = "";
      if ($("voucherSortFilter")) $("voucherSortFilter").value = "date-desc";
      showFilterPanel("type");
      render();
      closeFilterPopover();
    });

    ["voucherSearch", "voucherTypeFilter", "voucherLedgerFilter", "voucherStatusFilter", "voucherFromDate", "voucherToDate", "voucherSortFilter"].forEach((id) => {
      $(id)?.addEventListener(id === "voucherSearch" ? "input" : "change", render);
    });

    // Bulk selection & actions
    $("selectVisibleVouchers")?.addEventListener("change", () => {
      const checked = $("selectVisibleVouchers").checked;
      $("voucherRows")?.querySelectorAll("[data-select-voucher]").forEach((cb) => {
        cb.checked = checked;
        if (checked) selectedVoucherIds.add(cb.dataset.selectVoucher);
        else selectedVoucherIds.delete(cb.dataset.selectVoucher);
      });
      render();
    });

    $("voucherRows")?.addEventListener("change", (e) => {
      const cb = e.target.closest("[data-select-voucher]");
      if (!cb) return;
      if (cb.checked) selectedVoucherIds.add(cb.dataset.selectVoucher);
      else selectedVoucherIds.delete(cb.dataset.selectVoucher);
      render();
    });

    $("bulkMarkPosted")?.addEventListener("click", () => bulkUpdateStatus("Posted"));
    $("bulkMarkDraft")?.addEventListener("click", () => bulkUpdateStatus("Draft"));
    $("bulkDeleteVouchers")?.addEventListener("click", bulkDeleteSelected);

    $("voucherRows")?.addEventListener("click", (e) => {
      const toggle = e.target.closest("[data-row-menu-toggle]");
      if (toggle) {
        const m = toggle.parentElement.querySelector(".erp-row-menu");
        const open = m.hidden;
        closeRowMenus();
        if (open) {
          m.hidden = false;
          const r = toggle.getBoundingClientRect();
          const mr = m.getBoundingClientRect();
          m.style.left = `${Math.max(12, Math.min(r.right - mr.width, window.innerWidth - mr.width - 12))}px`;
          m.style.top = `${r.bottom + mr.height + 8 <= window.innerHeight ? r.bottom + 4 : Math.max(8, r.top - mr.height - 4)}px`;
          toggle.setAttribute("aria-expanded", "true");
        }
        return;
      }

      const editBtn = e.target.closest("[data-edit-voucher]");
      if (editBtn) {
        closeRowMenus();
        openModal(vouchers.get(editBtn.dataset.editVoucher));
        return;
      }

      const statusBtn = e.target.closest("[data-toggle-status]");
      if (statusBtn) {
        closeRowMenus();
        toggleVoucherStatus(statusBtn.dataset.toggleStatus);
        return;
      }

      const delBtn = e.target.closest("[data-delete-voucher]");
      if (delBtn) {
        closeRowMenus();
        deleteVoucher(delBtn.dataset.deleteVoucher);
      }
    });

    onAuthStateChanged(auth, async (user) => {
      if (!user || normalize(user.email) !== ADMIN) {
        ledgersUnsub?.();
        vouchersUnsub?.();
        if (user) await signOut(auth);
        const next = encodeURIComponent(location.pathname.replace(/^\//, "") + location.search + location.hash);
        location.replace(new URL(`auth/login.html?next=${next}`, document.baseURI).href);
        return;
      }

      $("erp-app")?.classList.remove("hidden");
      window.COREBIQ?.showLoading?.();

      const loaderFallback = window.setTimeout(() => window.COREBIQ?.hideLoading?.(), 6000);

      let ledgersReady = false;
      ledgersUnsub = onSnapshot(collection(db, "erp_ledgers"), (snap) => {
        ledgers.clear();
        snap.forEach((d) => ledgers.set(d.id, { id: d.id, ...d.data() }));
        populateLedgerSelects();
        try {
          render();
        } catch (err) {
          showError(err);
        }
        if (!ledgersReady) {
          ledgersReady = true;
          if (location.hash === "#add") openModal();
        }
      }, (err) => {
        clearTimeout(loaderFallback);
        showError(err);
      });

      vouchersUnsub = onSnapshot(collection(db, "erp_vouchers"), (snap) => {
        clearTimeout(loaderFallback);
        try {
          vouchers.clear();
          snap.forEach((d) => vouchers.set(d.id, { id: d.id, ...d.data() }));
          render();
        } catch (err) {
          showError(err);
        } finally {
          window.COREBIQ?.hideLoading?.();
        }
      }, (err) => {
        clearTimeout(loaderFallback);
        showError(err);
      });
    });
  } catch (err) {
    showError(err);
  }
}

if (window.COREBIQ_COMPONENTS_LOADED) init();
else document.addEventListener("corebiq:components-loaded", init, { once: true });
