import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getFirestore, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "../../../firebase/firebase-config.js";

const ADMIN = "shanicm@gmail.com";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

const ledgers = new Map();
const vouchers = new Map();
let ledgersUnsub = null;
let vouchersUnsub = null;
let cashflowChart = null;

function normalize(v) {
  return String(v ?? "").trim().toLowerCase();
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function getCurrencyCode() {
  try {
    return localStorage.getItem("corebiq-currency") || "INR";
  } catch {
    return "INR";
  }
}

function formatMoney(amount) {
  const num = Number(amount) || 0;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: getCurrencyCode(),
      maximumFractionDigits: 0
    }).format(num);
  } catch {
    return `₹${num.toLocaleString("en-IN")}`;
  }
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

function formatDate(value) {
  const date = toDate(value);
  return date
    ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date)
    : "—";
}

function showError(msg) {
  const el = $("erp-error");
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

// Compute signed closing balance per ledger (positive = normal balance for its type)
function computeLedgerBalances() {
  const map = new Map();
  ledgers.forEach((ledger, id) => {
    const open = Number(ledger.openingBalance) || 0;
    // Signed in Dr - Cr convention: Dr is positive, Cr is negative
    const signedOpen = normalize(ledger.balanceType) === "cr" ? -open : open;
    map.set(id, { ledger, signedDrCr: signedOpen });
  });

  vouchers.forEach((v) => {
    if (normalize(v.status) === "draft") return;
    const amt = Number(v.amount) || 0;
    if (map.has(v.debitLedgerId)) map.get(v.debitLedgerId).signedDrCr += amt;
    if (map.has(v.creditLedgerId)) map.get(v.creditLedgerId).signedDrCr -= amt;
  });

  return map;
}

function renderDashboard() {
  const balances = computeLedgerBalances();
  const postedVouchers = [...vouchers.values()].filter((v) => normalize(v.status) !== "draft");

  let totalIncome = 0;
  let totalExpense = 0;
  let cashBankBalance = 0;

  const groupTotals = {
    Asset: { count: 0, total: 0 },
    Liability: { count: 0, total: 0 },
    Income: { count: 0, total: 0 },
    Expense: { count: 0, total: 0 }
  };

  balances.forEach(({ ledger, signedDrCr }) => {
    const type = ledger.type || "Asset";
    const isCreditNormal = type === "Liability" || type === "Income";
    const displayBal = isCreditNormal ? -signedDrCr : signedDrCr;

    if (groupTotals[type]) {
      groupTotals[type].count += 1;
      groupTotals[type].total += displayBal;
    }
    if (type === "Income") totalIncome += displayBal;
    if (type === "Expense") totalExpense += displayBal;

    const grp = normalize(ledger.group);
    if (type === "Asset" && (grp.includes("cash") || grp.includes("bank"))) {
      cashBankBalance += displayBal;
    }
  });

  const netProfit = totalIncome - totalExpense;
  $("kpi-income").textContent = formatMoney(totalIncome);
  $("kpi-expense").textContent = formatMoney(totalExpense);

  const netEl = $("kpi-net");
  netEl.textContent = formatMoney(netProfit);
  netEl.classList.toggle("is-success", netProfit > 0);
  netEl.classList.toggle("is-danger", netProfit < 0);
  $("kpi-net-sub").textContent = netProfit >= 0 ? "Net surplus" : "Net deficit";

  $("kpi-cash").textContent = formatMoney(cashBankBalance);
  const activeCount = [...ledgers.values()].filter((l) => normalize(l.status) !== "inactive").length;
  $("kpi-ledger-count").textContent = `${activeCount} active ledger${activeCount === 1 ? "" : "s"}`;

  // Render Account Type Summary
  const typeOrder = ["Asset", "Liability", "Income", "Expense"];
  $("groupSummaryList").innerHTML = typeOrder.map((type) => {
    const info = groupTotals[type];
    return `<div class="erp-group-item">
      <div class="erp-group-meta">
        <span class="erp-group-name">${type}</span>
        <span class="erp-group-count">${info.count} ledger${info.count === 1 ? "" : "s"}</span>
      </div>
      <span class="erp-group-amount">${formatMoney(info.total)}</span>
    </div>`;
  }).join("");

  // Render Recent 8 Vouchers
  const recent = [...vouchers.values()]
    .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0))
    .slice(0, 8);

  $("recentVouchersEmpty").classList.toggle("hidden", recent.length > 0);
  $("recentVouchersBody").innerHTML = recent.map((v) => {
    const status = normalize(v.status) === "draft" ? "Draft" : "Posted";
    const pillCls = status === "Posted" ? "status-complete" : "status-pending";
    const drName = v.debitLedgerName || ledgers.get(v.debitLedgerId)?.name || "—";
    const crName = v.creditLedgerName || ledgers.get(v.creditLedgerId)?.name || "—";
    return `<tr>
      <td>${formatDate(v.date)}</td>
      <td>
        <div class="erp-voucher-no">${escapeHtml(v.voucherNo || "—")}</div>
        <div class="erp-entry-sub">${escapeHtml(v.voucherType || "Journal")}</div>
      </td>
      <td>
        <div class="erp-entry-main">${escapeHtml(drName)} &rarr; ${escapeHtml(crName)}</div>
        ${v.narration ? `<div class="erp-entry-sub">${escapeHtml(v.narration)}</div>` : ""}
      </td>
      <td><span class="status-pill ${pillCls}">${status}</span></td>
      <td class="text-right erp-amount">${formatMoney(v.amount)}</td>
    </tr>`;
  }).join("");

  renderChart(postedVouchers);
  if (window.lucide) window.lucide.createIcons();
}

function renderChart(postedVouchers) {
  const canvas = $("erpCashflowChart");
  if (!canvas || typeof window.Chart === "undefined") return;

  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" }).format(d);
    months.push({ key, label, income: 0, expense: 0 });
  }
  const monthMap = new Map(months.map((m) => [m.key, m]));

  postedVouchers.forEach((v) => {
    const d = toDate(v.date);
    if (!d) return;
    const bucket = monthMap.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    if (!bucket) return;
    const amt = Number(v.amount) || 0;
    const drType = ledgers.get(v.debitLedgerId)?.type;
    const crType = ledgers.get(v.creditLedgerId)?.type;
    if (crType === "Income") bucket.income += amt;
    if (drType === "Income") bucket.income -= amt;
    if (drType === "Expense") bucket.expense += amt;
    if (crType === "Expense") bucket.expense -= amt;
  });

  const cs = getComputedStyle(document.documentElement);
  const primary = cs.getPropertyValue("--primary-600").trim() || "#0b57d0";
  const danger = cs.getPropertyValue("--status-danger-fg").trim() || "#b3261e";
  const muted = cs.getPropertyValue("--ink-muted").trim() || "#64748b";
  const gridColor = cs.getPropertyValue("--border-light").trim() || "#e2e8f0";

  if (cashflowChart) cashflowChart.destroy();
  cashflowChart = new window.Chart(canvas, {
    type: "bar",
    data: {
      labels: months.map((m) => m.label),
      datasets: [
        { label: "Income", data: months.map((m) => Math.max(0, m.income)), backgroundColor: primary, borderRadius: 4, maxBarThickness: 28 },
        { label: "Expense", data: months.map((m) => Math.max(0, m.expense)), backgroundColor: danger, borderRadius: 4, maxBarThickness: 28 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: muted, boxWidth: 10, usePointStyle: true } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: muted } },
        y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: muted } }
      }
    }
  });
}

function startListeners() {
  ledgersUnsub?.();
  vouchersUnsub?.();
  showError("");
  window.COREBIQ?.showLoading?.();

  let loadedLedgers = false;
  let loadedVouchers = false;
  const checkDone = () => {
    if (loadedLedgers && loadedVouchers) window.COREBIQ?.hideLoading?.();
  };

  ledgersUnsub = onSnapshot(collection(db, "erp_ledgers"), (snap) => {
    ledgers.clear();
    snap.forEach((d) => ledgers.set(d.id, { id: d.id, ...d.data() }));
    loadedLedgers = true;
    renderDashboard();
    checkDone();
  }, (err) => {
    loadedLedgers = true;
    checkDone();
    showError(`Could not load erp_ledgers (${err.code || "error"}).`);
  });

  vouchersUnsub = onSnapshot(collection(db, "erp_vouchers"), (snap) => {
    vouchers.clear();
    snap.forEach((d) => vouchers.set(d.id, { id: d.id, ...d.data() }));
    loadedVouchers = true;
    renderDashboard();
    checkDone();
  }, (err) => {
    loadedVouchers = true;
    checkDone();
    showError(`Could not load erp_vouchers (${err.code || "error"}).`);
  });
}

function setupDropdowns() {
  const pairs = [
    ["erpModuleMenuToggle", "erpModuleMenu"],
    ["addMenuToggle", "addActionMenu"]
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
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });
}

function init() {
  setupDropdowns();
  $("refreshErp").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    btn.classList.add("is-refreshing");
    startListeners();
    setTimeout(() => btn.classList.remove("is-refreshing"), 700);
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
    startListeners();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
