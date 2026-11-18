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
import { firebaseConfig } from "../../../firebase/firebase-config.js";

const ADMIN = "shanicm@gmail.com";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

const ACCOUNT_GROUPS = {
  Asset: ["Cash-in-Hand", "Bank Accounts", "Accounts Receivable", "Fixed Assets", "Current Assets"],
  Liability: ["Accounts Payable", "Duties & Taxes", "Loans & Borrowings", "Capital Account", "Current Liabilities"],
  Income: ["Sales Revenue", "Service Income", "Direct Income", "Indirect Income"],
  Expense: ["Operating Expenses", "Salaries & Wages", "Direct Expenses", "Office & Admin", "Rent & Utilities"]
};

const STARTER_LEDGERS = [
  { ledgerCode: "1001", name: "Cash-in-Hand", type: "Asset", group: "Cash-in-Hand", openingBalance: 0, balanceType: "Dr", status: "Active", notes: "Primary petty cash account" },
  { ledgerCode: "1002", name: "Primary Bank Account", type: "Asset", group: "Bank Accounts", openingBalance: 0, balanceType: "Dr", status: "Active", notes: "Main business bank account" },
  { ledgerCode: "1101", name: "Accounts Receivable", type: "Asset", group: "Accounts Receivable", openingBalance: 0, balanceType: "Dr", status: "Active", notes: "Client dues" },
  { ledgerCode: "2001", name: "Accounts Payable", type: "Liability", group: "Accounts Payable", openingBalance: 0, balanceType: "Cr", status: "Active", notes: "Supplier dues" },
  { ledgerCode: "4001", name: "Service & Consultation Income", type: "Income", group: "Service Income", openingBalance: 0, balanceType: "Cr", status: "Active", notes: "Primary revenue" },
  { ledgerCode: "5001", name: "Office & Operating Expenses", type: "Expense", group: "Operating Expenses", openingBalance: 0, balanceType: "Dr", status: "Active", notes: "General overheads" }
];

const ledgers = new Map();
const vouchers = new Map();
let ledgersUnsub = null;
let vouchersUnsub = null;
let editingId = "";
let toastTimer = 0;

function normalize(v) { return String(v ?? "").trim().toLowerCase(); }
function escapeHtml(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function formatMoney(amount) {
  const num = Math.abs(Number(amount) || 0);
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

function populateGroups(type, selectedGroup = "") {
  const select = $("ledgerGroup");
  const groups = ACCOUNT_GROUPS[type] || ACCOUNT_GROUPS.Asset;
  select.replaceChildren();
  groups.forEach((g) => select.add(new Option(g, g)));
  if (selectedGroup && !groups.includes(selectedGroup)) select.add(new Option(selectedGroup, selectedGroup));
  select.value = selectedGroup || groups[0];
}

function computeClosingDrCr(ledger) {
  const open = Number(ledger.openingBalance) || 0;
  let signed = normalize(ledger.balanceType) === "cr" ? -open : open;
  vouchers.forEach((v) => {
    if (normalize(v.status) === "draft") return;
    const amt = Number(v.amount) || 0;
    if (v.debitLedgerId === ledger.id) signed += amt;
    if (v.creditLedgerId === ledger.id) signed -= amt;
  });
  return signed;
}

function render() {
  const q = normalize($("ledgerSearch").value);
  const typeFilter = $("ledgerTypeFilter").value;
  const statusFilter = $("ledgerStatusFilter").value;

  const list = [...ledgers.values()].map((l) => ({ ...l, closingDrCr: computeClosingDrCr(l) }));

  // Update KPIs across all ledgers
  let assetSum = 0;
  let liabilitySum = 0;
  let ieCount = 0;
  list.forEach((l) => {
    if (l.type === "Asset") assetSum += l.closingDrCr;
    if (l.type === "Liability") liabilitySum += -l.closingDrCr;
    if (l.type === "Income" || l.type === "Expense") ieCount += 1;
  });

  $("kpi-total-ledgers").textContent = list.length.toLocaleString("en-IN");
  $("kpi-assets").textContent = formatMoney(assetSum);
  $("kpi-liabilities").textContent = formatMoney(liabilitySum);
  $("kpi-income-expense").textContent = ieCount.toLocaleString("en-IN");

  const filtered = list
    .filter((l) => {
      const hay = [l.ledgerCode, l.name, l.group, l.type, l.notes].map(normalize).join(" ");
      return (!q || hay.includes(q))
        && (!typeFilter || l.type === typeFilter)
        && (!statusFilter || (l.status || "Active") === statusFilter);
    })
    .sort((a, b) => String(a.ledgerCode || a.name).localeCompare(String(b.ledgerCode || b.name), undefined, { numeric: true }));

  $("ledgerCount").textContent = `${filtered.length} ledger${filtered.length === 1 ? "" : "s"}`;
  $("ledgerEmpty").classList.toggle("hidden", filtered.length > 0);
  $("seedLedgersBtn").classList.toggle("hidden", ledgers.size > 0);

  $("ledgerRows").innerHTML = filtered.map((l) => {
    const openDrCr = normalize(l.balanceType) === "cr" ? "Cr" : "Dr";
    const closeDrCr = l.closingDrCr < 0 ? "Cr" : "Dr";
    const status = l.status || "Active";
    const statusCls = status === "Active" ? "status-complete" : "status-other";
    const typeCls = normalize(l.type);

    return `<tr>
      <td><span class="erp-code">${escapeHtml(l.ledgerCode || "—")}</span></td>
      <td>
        <div class="erp-ledger-name">${escapeHtml(l.name)}</div>
        <div class="erp-ledger-group">${escapeHtml(l.group || "—")}</div>
      </td>
      <td><span class="type-badge ${typeCls}">${escapeHtml(l.type || "Asset")}</span></td>
      <td class="text-right erp-amount">${formatMoney(l.openingBalance)}<span class="erp-drcr">${openDrCr}</span></td>
      <td class="text-right erp-amount">${formatMoney(l.closingDrCr)}<span class="erp-drcr">${closeDrCr}</span></td>
      <td><span class="status-pill ${statusCls}">${escapeHtml(status)}</span></td>
      <td class="text-right">
        <div class="erp-row-menu-wrap">
          <button type="button" class="erp-row-action" data-row-menu-toggle aria-expanded="false" aria-label="Ledger actions">
            <i data-lucide="ellipsis" aria-hidden="true"></i>
          </button>
          <div class="erp-row-menu" hidden>
            <button type="button" data-edit-ledger="${escapeHtml(l.id)}"><i data-lucide="pencil" aria-hidden="true"></i><span>Edit ledger</span></button>
            <a href="modules/erp/vouchers/vouchers.html?ledger=${encodeURIComponent(l.id)}"><i data-lucide="receipt-text" aria-hidden="true"></i><span>View vouchers</span></a>
            <button type="button" class="is-danger" data-delete-ledger="${escapeHtml(l.id)}"><i data-lucide="trash-2" aria-hidden="true"></i><span>Delete</span></button>
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

function openModal(ledger = null) {
  editingId = ledger?.id || "";
  $("ledgerForm").reset();
  $("ledgerFormError").textContent = "";
  $("ledgerModalTitle").textContent = editingId ? "Edit Ledger" : "Add Ledger";

  const type = ledger?.type || "Asset";
  $("ledgerCode").value = ledger?.ledgerCode || String(1001 + ledgers.size);
  $("ledgerName").value = ledger?.name || "";
  $("ledgerType").value = type;
  populateGroups(type, ledger?.group || "");
  $("openingBalance").value = ledger?.openingBalance ?? 0;
  $("balanceType").value = ledger?.balanceType || (type === "Liability" || type === "Income" ? "Cr" : "Dr");
  $("ledgerStatus").value = ledger?.status || "Active";
  $("ledgerNotes").value = ledger?.notes || "";

  $("ledgerModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  $("ledgerName").focus();
}

function closeModal() {
  editingId = "";
  $("ledgerModal").classList.add("hidden");
  document.body.style.overflow = "";
}

async function saveLedger(event) {
  event.preventDefault();
  $("ledgerFormError").textContent = "";

  const payload = {
    ledgerCode: $("ledgerCode").value.trim(),
    name: $("ledgerName").value.trim(),
    type: $("ledgerType").value,
    group: $("ledgerGroup").value,
    openingBalance: Math.max(0, Number($("openingBalance").value) || 0),
    balanceType: $("balanceType").value,
    status: $("ledgerStatus").value,
    notes: $("ledgerNotes").value.trim(),
    updatedAt: serverTimestamp()
  };

  if (!payload.ledgerCode || !payload.name) {
    $("ledgerFormError").textContent = "Ledger code and name are required.";
    return;
  }

  const btn = $("saveLedgerBtn");
  btn.disabled = true;
  try {
    if (editingId) {
      await updateDoc(doc(db, "erp_ledgers", editingId), payload);
      showToast("Ledger updated.");
    } else {
      await addDoc(collection(db, "erp_ledgers"), { ...payload, createdAt: serverTimestamp() });
      showToast("Ledger created.");
    }
    closeModal();
  } catch (err) {
    console.error("Save ledger error:", err);
    $("ledgerFormError").textContent = `Could not save ledger (${err.code || "error"}).`;
  } finally {
    btn.disabled = false;
  }
}

async function deleteLedger(id) {
  const ledger = ledgers.get(id);
  if (!ledger) return;
  const used = [...vouchers.values()].some((v) => v.debitLedgerId === id || v.creditLedgerId === id);
  if (used) {
    showToast("Cannot delete a ledger linked to existing vouchers. Mark it Inactive instead.", false);
    return;
  }
  if (!confirm(`Delete ledger "${ledger.name}"? This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, "erp_ledgers", id));
    showToast("Ledger deleted.");
  } catch (err) {
    showToast(`Could not delete ledger (${err.code || "error"}).`, false);
  }
}

async function seedStarterLedgers() {
  const btn = $("seedLedgersBtn");
  btn.disabled = true;
  try {
    const batch = writeBatch(db);
    STARTER_LEDGERS.forEach((item) => {
      batch.set(doc(collection(db, "erp_ledgers")), { ...item, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    await batch.commit();
    showToast("Default Chart of Accounts added.");
  } catch (err) {
    showToast(`Could not load defaults (${err.code || "error"}).`, false);
  } finally {
    btn.disabled = false;
  }
}

function init() {
  populateGroups("Asset");

  // Module dropdown
  const menuToggle = $("erpModuleMenuToggle");
  const menu = $("erpModuleMenu");
  const closeMenu = () => { menu.hidden = true; menuToggle.setAttribute("aria-expanded", "false"); };
  menuToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    menuToggle.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".erp-dropdown-wrap")) closeMenu();
    if (!e.target.closest(".erp-row-menu-wrap")) closeRowMenus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeMenu();
    closeRowMenus();
    if (!$("ledgerModal").classList.contains("hidden")) closeModal();
  });

  $("addLedgerBtn").addEventListener("click", () => openModal());
  $("closeLedgerModal").addEventListener("click", closeModal);
  $("cancelLedgerBtn").addEventListener("click", closeModal);
  $("ledgerModal").addEventListener("click", (e) => { if (e.target === $("ledgerModal")) closeModal(); });
  $("ledgerForm").addEventListener("submit", saveLedger);
  $("seedLedgersBtn").addEventListener("click", seedStarterLedgers);

  $("ledgerType").addEventListener("change", () => {
    const t = $("ledgerType").value;
    populateGroups(t);
    if (!editingId) $("balanceType").value = (t === "Liability" || t === "Income") ? "Cr" : "Dr";
  });

  ["ledgerSearch", "ledgerTypeFilter", "ledgerStatusFilter"].forEach((id) => {
    $(id).addEventListener(id === "ledgerSearch" ? "input" : "change", render);
  });

  $("ledgerRows").addEventListener("click", (e) => {
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
    const editBtn = e.target.closest("[data-edit-ledger]");
    if (editBtn) {
      closeRowMenus();
      openModal(ledgers.get(editBtn.dataset.editLedger));
      return;
    }
    const delBtn = e.target.closest("[data-delete-ledger]");
    if (delBtn) {
      closeRowMenus();
      deleteLedger(delBtn.dataset.deleteLedger);
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
    ledgersUnsub = onSnapshot(collection(db, "erp_ledgers"), (snap) => {
      ledgers.clear();
      snap.forEach((d) => ledgers.set(d.id, { id: d.id, ...d.data() }));
      render();
      window.COREBIQ?.hideLoading?.();
    }, (err) => {
      window.COREBIQ?.hideLoading?.();
      $("erp-error").textContent = `Could not load erp_ledgers (${err.code || "error"}).`;
      $("erp-error").classList.remove("hidden");
    });
    vouchersUnsub = onSnapshot(collection(db, "erp_vouchers"), (snap) => {
      vouchers.clear();
      snap.forEach((d) => vouchers.set(d.id, { id: d.id, ...d.data() }));
      render();
    });
    if (location.hash === "#add") openModal();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
