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
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const { firebaseConfig } = await import(new URL("firebase/firebase-config.js", document.baseURI));

const ADMIN = "shanicm@gmail.com";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const VOUCHER_CONFIG = {
  Contra:        { prefix: "CNT", badge: "contra",      label: "Contra Voucher",  nonPosting: false },
  Payment:       { prefix: "PMT", badge: "payment",     label: "Payment Voucher", nonPosting: false },
  Receipt:       { prefix: "RCT", badge: "receipt",     label: "Receipt Voucher", nonPosting: false },
  Journal:       { prefix: "JRN", badge: "journal",     label: "Journal Voucher", nonPosting: false },
  Sales:         { prefix: "SLS", badge: "sales",       label: "Sales Voucher",   nonPosting: false },
  Purchase:      { prefix: "PUR", badge: "purchase",    label: "Purchase Voucher",nonPosting: false },
  "Credit Note": { prefix: "CRN", badge: "credit-note", label: "Credit Note",     nonPosting: false },
  "Debit Note":  { prefix: "DBN", badge: "debit-note",  label: "Debit Note",      nonPosting: false },
  Estimate:      { prefix: "EST", badge: "estimate",    label: "Estimate",        nonPosting: true }
};

// Optional page lock for dedicated pages (e.g., <body data-voucher-type="Contra">)
const PAGE_VOUCHER_TYPE = (document.body.dataset.voucherType || "").trim();

const ledgers = new Map();
const vouchers = new Map();
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
  clearTimeout(toastTimer);
  el.textContent = msg;
  el.style.background = success ? "#166534" : "#be123c";
  el.style.color = "#ffffff";
  el.classList.remove("hidden");
  toastTimer = window.setTimeout(() => el.classList.add("hidden"), 3000);
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
    $("voucherPageHeading").textContent = label;
    $("voucherBreadcrumbCurrent").textContent = PAGE_VOUCHER_TYPE;
    $("registerHeading").textContent = `${PAGE_VOUCHER_TYPE} Register`;
    $("voucherTypeFilter").value = PAGE_VOUCHER_TYPE;
    $("voucherTypeFilter").hidden = true;
  }
}

function syncModalForVoucherType(type) {
  const isEstimate = Boolean(VOUCHER_CONFIG[type]?.nonPosting);
  $("debitLedger").required = !isEstimate;
  $("creditLedger").required = !isEstimate;
  $("ledgerPairFields").classList.toggle("hidden", isEstimate);
  $("voucherModalSub").textContent = isEstimate
    ? "Estimates are non-posting quotations and do not affect ledger balances."
    : "Posted vouchers update ledger balances immediately.";

  if (!editingId) {
    $("voucherNo").value = nextVoucherNumber(type);
    if (isEstimate) $("voucherStatus").value = "Draft";
  }
}

function populateLedgerSelects() {
  const sorted = [...ledgers.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const active = sorted.filter((l) => normalize(l.status) !== "inactive");

  const filterSel = $("voucherLedgerFilter");
  const prevFilter = filterSel.value || initialLedgerParam;
  filterSel.replaceChildren(new Option("All ledgers", ""));
  sorted.forEach((l) => filterSel.add(new Option(`${l.name} (${l.type})`, l.id)));
  if (prevFilter && ledgers.has(prevFilter)) {
    filterSel.value = prevFilter;
    initialLedgerParam = "";
  }

  ["debitLedger", "creditLedger"].forEach((id) => {
    const sel = $(id);
    const prev = sel.value;
    sel.replaceChildren(new Option(id === "debitLedger" ? "Select debit ledger" : "Select credit ledger", ""));
    active.forEach((l) => sel.add(new Option(`${l.name} · ${l.group || l.type}`, l.id)));
    if (prev) sel.value = prev;
  });
}

function render() {
  const q = normalize($("voucherSearch").value);
  const typeFilter = PAGE_VOUCHER_TYPE || $("voucherTypeFilter").value;
  const ledgerFilter = $("voucherLedgerFilter").value;
  const statusFilter = $("voucherStatusFilter").value;
  const fromDate = $("voucherFromDate").value;
  const toDateVal = $("voucherToDate").value;

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

  $("kpi-total-vouchers").textContent = scoped.length.toLocaleString("en-IN");
  $("kpi-inflow").textContent = formatMoney(inflow);
  $("kpi-outflow").textContent = formatMoney(outflow);
  $("kpi-posted-count").textContent = `${postedCount} / ${draftCount}`;

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
    .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0)
      || String(b.voucherNo || "").localeCompare(String(a.voucherNo || "")));

  $("voucherCount").textContent = `${filtered.length} voucher${filtered.length === 1 ? "" : "s"}`;
  $("voucherEmpty").classList.toggle("hidden", filtered.length > 0);

  $("voucherRows").innerHTML = filtered.map((v) => {
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
  $("voucherForm").reset();
  $("voucherFormError").textContent = "";
  populateLedgerSelects();

  const type = voucher?.voucherType || PAGE_VOUCHER_TYPE || "Receipt";
  $("voucherModalTitle").textContent = editingId ? `Edit ${type}` : `New ${type}`;
  $("voucherType").value = type;
  $("voucherType").disabled = Boolean(PAGE_VOUCHER_TYPE && !editingId);
  $("voucherDate").value = voucher?.date || todayIso();
  $("partyName").value = voucher?.partyName || "";
  $("debitLedger").value = voucher?.debitLedgerId || "";
  $("creditLedger").value = voucher?.creditLedgerId || "";
  $("voucherAmount").value = voucher?.amount ?? "";
  $("paymentMode").value = voucher?.paymentMode || "Bank Transfer";
  $("voucherStatus").value = voucher?.status || (type === "Estimate" ? "Draft" : "Posted");
  $("referenceNo").value = voucher?.referenceNo || "";
  $("voucherNarration").value = voucher?.narration || "";

  syncModalForVoucherType(type);
  if (voucher?.voucherNo) $("voucherNo").value = voucher.voucherNo;

  if (!VOUCHER_CONFIG[type]?.nonPosting && !ledgers.size) {
    $("voucherFormError").textContent = "Create at least two ledgers in ERP > Ledgers before posting vouchers.";
  }

  $("voucherModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  editingId = "";
  $("voucherType").disabled = false;
  $("voucherModal").classList.add("hidden");
  document.body.style.overflow = "";
}

async function saveVoucher(event) {
  event.preventDefault();
  $("voucherFormError").textContent = "";

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
    showToast("Voucher deleted.");
  } catch (err) {
    showToast(`Could not delete voucher (${err.code || "error"}).`, false);
  }
}

function setupDropdowns() {
  const pairs = [
    ["erpModuleMenuToggle", "erpModuleMenu"],
    ["voucherSubmenuToggle", "voucherSubmenuDropdown"]
  ];

  const closeAll = () => {
    pairs.forEach(([tId, mId]) => {
      $(mId).hidden = true;
      $(tId).setAttribute("aria-expanded", "false");
    });
  };

  pairs.forEach(([tId, mId]) => {
    $(tId).addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = $(mId).hidden;
      closeAll();
      $(mId).hidden = !willOpen;
      $(tId).setAttribute("aria-expanded", String(willOpen));
    });
  });

  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".erp-dropdown-wrap")) closeAll();
    if (!e.target.closest(".erp-row-menu-wrap")) closeRowMenus();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeAll();
    closeRowMenus();
    if (!$("voucherModal").classList.contains("hidden")) closeModal();
  });
}

function init() {
  syncSubmenuActiveState();
  setupDropdowns();

  window.addEventListener("corebiq:signout-request", () => signOut(auth));

  $("addVoucherBtn").addEventListener("click", () => openModal());
  $("closeVoucherModal").addEventListener("click", closeModal);
  $("cancelVoucherBtn").addEventListener("click", closeModal);
  $("voucherModal").addEventListener("click", (e) => { if (e.target === $("voucherModal")) closeModal(); });
  $("voucherForm").addEventListener("submit", saveVoucher);

  $("voucherType").addEventListener("change", () => {
    const type = $("voucherType").value;
    if (!editingId) $("voucherModalTitle").textContent = `New ${type}`;
    syncModalForVoucherType(type);
  });

  $("clearVoucherFilters").addEventListener("click", () => {
    ["voucherSearch", "voucherLedgerFilter", "voucherStatusFilter", "voucherFromDate", "voucherToDate"].forEach((id) => {
      $(id).value = "";
    });
    if (!PAGE_VOUCHER_TYPE) $("voucherTypeFilter").value = "";
    render();
  });

  ["voucherSearch", "voucherTypeFilter", "voucherLedgerFilter", "voucherStatusFilter", "voucherFromDate", "voucherToDate"].forEach((id) => {
    $(id).addEventListener(id === "voucherSearch" ? "input" : "change", render);
  });

  $("voucherRows").addEventListener("click", (e) => {
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

    $("erp-app").classList.remove("hidden");
    window.COREBIQ?.showLoading?.();

    let ledgersReady = false;
    ledgersUnsub = onSnapshot(collection(db, "erp_ledgers"), (snap) => {
      ledgers.clear();
      snap.forEach((d) => ledgers.set(d.id, { id: d.id, ...d.data() }));
      populateLedgerSelects();
      render();
      if (!ledgersReady) {
        ledgersReady = true;
        if (location.hash === "#add") openModal();
      }
    });

    vouchersUnsub = onSnapshot(collection(db, "erp_vouchers"), (snap) => {
      vouchers.clear();
      snap.forEach((d) => vouchers.set(d.id, { id: d.id, ...d.data() }));
      render();
      window.COREBIQ?.hideLoading?.();
