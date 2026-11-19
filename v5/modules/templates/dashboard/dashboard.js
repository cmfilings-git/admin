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

const TEMPLATE_CATALOG = [
  {
    id: "invoice-template",
    name: "Invoice Template",
    category: "ERP",
    icon: "file-spreadsheet",
    href: "modules/templates/invoice-template/invoice-template.html",
    description: "GST-ready tax invoice layout with item table, bank details, QR/UPI, and PDF export."
  },
  {
    id: "letterhead",
    name: "Letterhead",
    category: "Brand",
    icon: "file-signature",
    href: "modules/templates/letterhead/letterhead.html",
    description: "Official company letterhead editor with logo header, footer, and PDF / Word export."
  },
  {
    id: "receipt-voucher",
    name: "Receipt Voucher",
    category: "ERP",
    icon: "arrow-down-left",
    href: "modules/templates/receipt-voucher/receipt-voucher.html",
    description: "Customer payment acknowledgement slip with mode, reference number, and amount in words."
  },
  {
    id: "payment-voucher",
    name: "Payment Voucher",
    category: "ERP",
    icon: "arrow-up-right",
    href: "modules/templates/payment-voucher/payment-voucher.html",
    description: "Vendor and expense payout voucher with approval blocks and ledger reference."
  },
  {
    id: "payslip",
    name: "Payslip",
    category: "HR",
    icon: "wallet",
    href: "modules/templates/payslip/payslip.html",
    description: "Monthly employee salary slip with earnings, deductions, net pay, and attendance summary."
  },
  {
    id: "estimate",
    name: "Estimate",
    category: "Sales",
    icon: "calculator",
    href: "modules/templates/estimate/estimate.html",
    description: "Client quotation and proforma estimate layout with validity date and terms."
  },
  {
    id: "seal",
    name: "Digital Seal",
    category: "Brand",
    icon: "stamp",
    href: "modules/templates/seal/seal.html",
    description: "Circular or rectangular company rubber stamp generator with authorized signatory block."
  }
];

const savedTemplates = new Map();
let templatesUnsub = null;

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

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Formats dates as yyyy-MMM-dd (e.g., 2026-Nov-19)
function formatDate(value) {
  const d = toDate(value);
  if (!d) return "—";
  return `${d.getFullYear()}-${MONTHS[d.getMonth()]}-${String(d.getDate()).padStart(2, "0")}`;
}

function showError(msg) {
  const el = $("tpl-error");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

function render() {
  const q = normalize($("templateSearch")?.value);

  // KPIs
  const customizedCount = TEMPLATE_CATALOG.filter((t) => savedTemplates.has(t.id)).length;
  $("kpi-total").textContent = String(TEMPLATE_CATALOG.length);
  $("kpi-customized").textContent = String(customizedCount);
  $("kpi-seal-status").textContent = savedTemplates.has("seal") ? "Configured" : "Default";

  const latestTs = [...savedTemplates.values()]
    .map((docData) => toDate(docData.updatedAt)?.getTime() || 0)
    .filter(Boolean)
    .sort((a, b) => b - a)[0];
  $("kpi-last-updated").textContent = latestTs ? formatDate(latestTs) : "—";

  // Filtered Cards
  const filtered = TEMPLATE_CATALOG.filter((tpl) => {
    if (!q) return true;
    return [tpl.name, tpl.category, tpl.description, tpl.id].map(normalize).join(" ").includes(q);
  });

  $("templateEmpty")?.classList.toggle("hidden", filtered.length > 0);
  $("templateGrid").innerHTML = filtered.map((tpl) => {
    const saved = savedTemplates.get(tpl.id);
    const isCustom = Boolean(saved);
    const pillCls = isCustom ? "status-complete" : "status-other";
    const statusLabel = isCustom ? "Customized" : "Default";
    const metaText = saved?.updatedAt ? `Updated ${formatDate(saved.updatedAt)}` : `${tpl.category} template`;

    return `<article class="tpl-card">
      <div>
        <div class="tpl-card-top">
          <span class="tpl-card-icon" aria-hidden="true"><i data-lucide="${tpl.icon}"></i></span>
          <span class="status-pill ${pillCls}">${statusLabel}</span>
        </div>
        <div class="tpl-card-body" style="margin-top:12px;">
          <h3>${escapeHtml(tpl.name)}</h3>
          <p>${escapeHtml(tpl.description)}</p>
        </div>
      </div>

      <div class="tpl-card-footer">
        <span class="tpl-card-meta">${escapeHtml(metaText)}</span>
        <a href="${tpl.href}" class="btn btn-tonal btn-sm">
          <span>Open</span>
          <i data-lucide="arrow-up-right" aria-hidden="true"></i>
        </a>
      </div>
    </article>`;
  }).join("");

  if (window.lucide) window.lucide.createIcons();
}

function startListener() {
  templatesUnsub?.();
  showError("");
  window.COREBIQ?.showLoading?.();

  const fallbackTimer = window.setTimeout(() => window.COREBIQ?.hideLoading?.(), 6000);

  templatesUnsub = onSnapshot(collection(db, "document_templates"), (snap) => {
    clearTimeout(fallbackTimer);
    savedTemplates.clear();
    snap.forEach((d) => savedTemplates.set(d.id, { id: d.id, ...d.data() }));
    try {
      render();
    } catch (err) {
      showError(`Render error: ${err.message}`);
    } finally {
      window.COREBIQ?.hideLoading?.();
    }
  }, (err) => {
    clearTimeout(fallbackTimer);
    window.COREBIQ?.hideLoading?.();
    showError(`Could not load document_templates (${err.code || "error"}).`);
    render();
  });
}

function setupDropdown() {
  const toggle = $("tplModuleMenuToggle");
  const menu = $("tplModuleMenu");
  const close = () => {
    if (menu) menu.hidden = true;
    toggle?.setAttribute("aria-expanded", "false");
  };

  toggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!menu) return;
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });

  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".tpl-dropdown-wrap")) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

function init() {
  setupDropdown();
  window.addEventListener("corebiq:signout-request", () => signOut(auth));

  $("templateSearch")?.addEventListener("input", render);
  $("refreshTemplates")?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    btn.classList.add("is-refreshing");
    startListener();
    setTimeout(() => btn.classList.remove("is-refreshing"), 700);
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user || normalize(user.email) !== ADMIN) {
      templatesUnsub?.();
      if (user) await signOut(auth);
      const next = encodeURIComponent(location.pathname.replace(/^\//, "") + location.search + location.hash);
      location.replace(new URL(`auth/login.html?next=${next}`, document.baseURI).href);
      return;
    }
    $("templates-app")?.classList.remove("hidden");
    startListener();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
