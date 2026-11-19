import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getFirestore, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { firebaseConfig } = await import(new URL("firebase/firebase-config.js", document.baseURI));

const ADMIN = "shanicm@gmail.com";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const employees = new Map();
const attendance = new Map();
const leaves = new Map();
const payrolls = new Map();
let unsubs = [];

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

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(num);
  } catch {
    return `₹${num.toLocaleString("en-IN")}`;
  }
}

function showError(msg) {
  const el = $("hr-error");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

function renderDashboard() {
  const today = todayIso();
  const monthKey = currentMonthKey();

  if ($("todayDateLabel")) $("todayDateLabel").textContent = `Attendance for ${formatDate(today)}`;

  // 1. Active Employees & Departments
  const activeEmps = [...employees.values()].filter((e) => normalize(e.status) !== "inactive");
  const deptCounts = new Map();
  activeEmps.forEach((e) => {
    const dept = String(e.department || "General").trim();
    deptCounts.set(dept, (deptCounts.get(dept) || 0) + 1);
  });

  $("kpi-employees").textContent = activeEmps.length.toLocaleString("en-IN");
  $("kpi-departments").textContent = `${deptCounts.size} department${deptCounts.size === 1 ? "" : "s"}`;

  // 2. Attendance Today
  const todayRecords = [...attendance.values()].filter((a) => a.date === today);
  const presentCount = todayRecords.filter((a) => ["present", "half-day", "late", "wfh"].includes(normalize(a.status))).length;
  const pct = activeEmps.length ? Math.round((presentCount / activeEmps.length) * 100) : 0;

  $("kpi-present").textContent = presentCount.toLocaleString("en-IN");
  $("kpi-present-sub").textContent = `${pct}% of active staff`;

  // 3. Pending Leave Requests
  const pendingLeaves = [...leaves.values()]
    .filter((l) => normalize(l.status) === "pending")
    .sort((a, b) => (toDate(a.fromDate)?.getTime() || 0) - (toDate(b.fromDate)?.getTime() || 0));

  $("kpi-leaves").textContent = pendingLeaves.length.toLocaleString("en-IN");

  // 4. Monthly Payroll (sum processed for current month, or fallback to active base salaries)
  const monthPayrolls = [...payrolls.values()].filter((p) => String(p.month || "").startsWith(monthKey));
  const processedTotal = monthPayrolls.reduce((sum, p) => sum + (Number(p.netPay) || 0), 0);
  const estimatedTotal = activeEmps.reduce((sum, e) => sum + (Number(e.monthlySalary) || 0), 0);

  $("kpi-payroll").textContent = formatMoney(monthPayrolls.length ? processedTotal : estimatedTotal);
  $("kpi-payroll-sub").textContent = monthPayrolls.length
    ? `${monthPayrolls.length} payslip${monthPayrolls.length === 1 ? "" : "s"} in ${monthKey}`
    : "Estimated from active salaries";

  // Render Pending Leaves Table
  $("pendingLeavesEmpty").classList.toggle("hidden", pendingLeaves.length > 0);
  $("pendingLeavesBody").innerHTML = pendingLeaves.slice(0, 6).map((l) => {
    const empName = l.employeeName || employees.get(l.employeeId)?.name || "—";
    const range = l.toDate && l.toDate !== l.fromDate
      ? `${formatDate(l.fromDate)} → ${formatDate(l.toDate)}`
      : formatDate(l.fromDate);
    return `<tr>
      <td>
        <div class="hr-name-main">${escapeHtml(empName)}</div>
        ${l.reason ? `<div class="hr-name-sub">${escapeHtml(l.reason)}</div>` : ""}
      </td>
      <td>${escapeHtml(l.leaveType || "Leave")}</td>
      <td style="white-space:nowrap">${range}</td>
      <td class="text-right"><span class="status-pill status-pending">Pending</span></td>
    </tr>`;
  }).join("");

  // Render Departments List
  const sortedDepts = [...deptCounts.entries()].sort((a, b) => b[1] - a[1]);
  $("departmentList").innerHTML = sortedDepts.length
    ? sortedDepts.map(([dept, count]) => `<div class="hr-dept-item">
        <span class="hr-dept-name">${escapeHtml(dept)}</span>
        <span class="hr-dept-count">${count} staff</span>
      </div>`).join("")
    : `<div class="hr-empty">No active employees yet.</div>`;

  // Render Today's Attendance Table
  $("todayAttendanceEmpty").classList.toggle("hidden", todayRecords.length > 0);
  $("todayAttendanceBody").innerHTML = todayRecords.slice(0, 8).map((a) => {
    const emp = employees.get(a.employeeId);
    const name = a.employeeName || emp?.name || "—";
    const dept = a.department || emp?.department || "—";
    const st = a.status || "Present";
    const norm = normalize(st);
    const pillCls = norm === "present" || norm === "wfh"
      ? "status-complete"
      : (norm === "absent" ? "status-danger" : "status-pending");

    return `<tr>
      <td><div class="hr-name-main">${escapeHtml(name)}</div></td>
      <td>${escapeHtml(dept)}</td>
      <td>${escapeHtml(a.checkIn || "—")}</td>
      <td class="text-right"><span class="status-pill ${pillCls}">${escapeHtml(st)}</span></td>
    </tr>`;
  }).join("");

  if (window.lucide) window.lucide.createIcons();
}

function startListeners() {
  unsubs.forEach((fn) => fn?.());
  unsubs = [];
  showError("");
  window.COREBIQ?.showLoading?.();

  const fallbackTimer = window.setTimeout(() => window.COREBIQ?.hideLoading?.(), 6000);
  let loadedCount = 0;
  const markLoaded = () => {
    loadedCount += 1;
    if (loadedCount >= 4) {
      clearTimeout(fallbackTimer);
      window.COREBIQ?.hideLoading?.();
    }
  };

  const watch = (colName, targetMap) => onSnapshot(collection(db, colName), (snap) => {
    targetMap.clear();
    snap.forEach((d) => targetMap.set(d.id, { id: d.id, ...d.data() }));
    try { renderDashboard(); } catch (err) { showError(err.message); }
    markLoaded();
  }, (err) => {
    console.error(`Failed loading ${colName}:`, err);
    showError(`Could not load ${colName} (${err.code || "error"}).`);
    markLoaded();
  });

  unsubs = [
    watch("hr_employees", employees),
    watch("hr_attendance", attendance),
    watch("hr_leave_requests", leaves),
    watch("hr_payroll", payrolls)
  ];
}

function setupDropdowns() {
  const pairs = [
    ["hrModuleMenuToggle", "hrModuleMenu"],
    ["hrAddMenuToggle", "hrAddMenu"]
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
      const open = menu.hidden;
      closeAll();
      menu.hidden = !open;
      $(tId)?.setAttribute("aria-expanded", String(open));
    });
  });

  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".hr-dropdown-wrap")) closeAll();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });
}

function init() {
  setupDropdowns();
  window.addEventListener("corebiq:signout-request", () => signOut(auth));

  $("refreshHr")?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    btn.classList.add("is-refreshing");
    startListeners();
    setTimeout(() => btn.classList.remove("is-refreshing"), 700);
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user || normalize(user.email) !== ADMIN) {
      unsubs.forEach((fn) => fn?.());
      if (user) await signOut(auth);
      const next = encodeURIComponent(location.pathname.replace(/^\//, "") + location.search + location.hash);
      location.replace(new URL(`auth/login.html?next=${next}`, document.baseURI).href);
      return;
    }
    $("hr-app")?.classList.remove("hidden");
    startListeners();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
