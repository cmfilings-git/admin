import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { firebaseConfig } = await import(new URL("firebase/firebase-config.js", document.baseURI));

const ADMIN = "shanicm@gmail.com";
const TEMPLATE_DOC_ID = "invoice-template";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DEFAULTS = {
  companyName: "COREBIQ Advisory LLP",
  companyGstin: "32ABCDE1234F1Z5",
  companyPhone: "+91 98765 43210",
  companyEmail: "billing@corebiq.com · corebiq.com",
  companyAddress: "2nd Floor, Business Park, Kozhikode, Kerala - 673001",
  docTitle: "TAX INVOICE",
  invoicePrefix: "INV-26-",
  accentColor: "#0b57d0",
  signatoryLabel: "Authorized Signatory",
  showGst: true,
  showBank: true,
  showSignatory: true,
  bankName: "HDFC Bank",
  bankAccount: "50200012345678",
  bankIfsc: "HDFC0001234",
  upiId: "corebiq@hdfcbank",
  termsText: "1. Payment is due within 15 days from the invoice date.\n2. Please quote the invoice number as payment reference.",
  footerNote: "This is a computer-generated invoice."
};

let toastTimer = 0;

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

function formatDate(d) {
  const date = typeof d?.toDate === "function" ? d.toDate() : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}-${MONTHS[date.getMonth()]}-${String(date.getDate()).padStart(2, "0")}`;
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

function showError(msg) {
  const el = $("tpl-error");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

function readFormValues() {
  return {
    companyName: $("companyName").value.trim() || DEFAULTS.companyName,
    companyGstin: $("companyGstin").value.trim(),
    companyPhone: $("companyPhone").value.trim(),
    companyEmail: $("companyEmail").value.trim(),
    companyAddress: $("companyAddress").value.trim(),
    docTitle: $("docTitle").value.trim() || DEFAULTS.docTitle,
    invoicePrefix: $("invoicePrefix").value.trim() || DEFAULTS.invoicePrefix,
    accentColor: /^#[0-9a-f]{6}$/i.test($("accentColorHex").value.trim())
      ? $("accentColorHex").value.trim()
      : DEFAULTS.accentColor,
    signatoryLabel: $("signatoryLabel").value.trim() || DEFAULTS.signatoryLabel,
    showGst: $("showGst").checked,
    showBank: $("showBank").checked,
    showSignatory: $("showSignatory").checked,
    bankName: $("bankName").value.trim(),
    bankAccount: $("bankAccount").value.trim(),
    bankIfsc: $("bankIfsc").value.trim(),
    upiId: $("upiId").value.trim(),
    termsText: $("termsText").value.trim(),
    footerNote: $("footerNote").value.trim()
  };
}

function populateForm(data) {
  const cfg = { ...DEFAULTS, ...data };
  $("companyName").value = cfg.companyName;
  $("companyGstin").value = cfg.companyGstin;
  $("companyPhone").value = cfg.companyPhone;
  $("companyEmail").value = cfg.companyEmail;
  $("companyAddress").value = cfg.companyAddress;
  $("docTitle").value = cfg.docTitle;
  $("invoicePrefix").value = cfg.invoicePrefix;
  $("accentColor").value = cfg.accentColor;
  $("accentColorHex").value = cfg.accentColor;
  $("signatoryLabel").value = cfg.signatoryLabel;
  $("showGst").checked = Boolean(cfg.showGst);
  $("showBank").checked = Boolean(cfg.showBank);
  $("showSignatory").checked = Boolean(cfg.showSignatory);
  $("bankName").value = cfg.bankName;
  $("bankAccount").value = cfg.bankAccount;
  $("bankIfsc").value = cfg.bankIfsc;
  $("upiId").value = cfg.upiId;
  $("termsText").value = cfg.termsText;
  $("footerNote").value = cfg.footerNote;
  renderPreview();
}

function renderPreview() {
  const cfg = readFormValues();
  const paper = $("invoicePaper");
  paper.style.setProperty("--inv-accent", cfg.accentColor);

  $("prevCompanyName").textContent = cfg.companyName;
  $("prevCompanyAddress").textContent = cfg.companyAddress;
  $("prevCompanyContact").textContent = [cfg.companyPhone, cfg.companyEmail].filter(Boolean).join(" · ");

  const gstinEl = $("prevCompanyGstin");
  gstinEl.textContent = cfg.companyGstin ? `GSTIN: ${cfg.companyGstin}` : "";
  gstinEl.classList.toggle("hidden", !cfg.companyGstin);

  $("prevDocTitle").textContent = cfg.docTitle;
  $("prevInvoiceNo").textContent = `${cfg.invoicePrefix}0042`;

  const today = new Date();
  const due = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 15);
  $("prevInvoiceDate").textContent = formatDate(today);
  $("prevDueDate").textContent = formatDate(due);

  $("prevGstRows").classList.toggle("hidden", !cfg.showGst);
  $("prevGrandTotal").textContent = cfg.showGst ? "₹14,160.00" : "₹12,000.00";

  $("prevBankBox").classList.toggle("hidden", !cfg.showBank);
  const bankLines = [
    cfg.bankName ? `<div><strong>Bank:</strong> ${escapeHtml(cfg.bankName)}</div>` : "",
    cfg.bankAccount ? `<div><strong>A/c No:</strong> ${escapeHtml(cfg.bankAccount)}</div>` : "",
    cfg.bankIfsc ? `<div><strong>IFSC:</strong> ${escapeHtml(cfg.bankIfsc)}</div>` : "",
    cfg.upiId ? `<div><strong>UPI:</strong> ${escapeHtml(cfg.upiId)}</div>` : ""
  ].filter(Boolean);
  $("prevBankDetails").innerHTML = bankLines.join("") || "<div>Add bank details on the left.</div>";

  $("prevTerms").textContent = cfg.termsText || "—";
  $("prevSignatoryBlock").classList.toggle("hidden", !cfg.showSignatory);
  $("prevSignatoryLabel").textContent = cfg.signatoryLabel;
  $("prevFooterNote").textContent = cfg.footerNote;
}

async function loadTemplate() {
  showError("");
  window.COREBIQ?.showLoading?.();
  const fallback = window.setTimeout(() => window.COREBIQ?.hideLoading?.(), 6000);

  try {
    const snap = await getDoc(doc(db, "document_templates", TEMPLATE_DOC_ID));
    if (snap.exists()) {
      const data = snap.data();
      populateForm(data);
      $("savedStatusText").textContent = data.updatedAt
        ? `Saved on ${formatDate(data.updatedAt)}`
        : "Saved template";
    } else {
      populateForm(DEFAULTS);
      $("savedStatusText").textContent = "Default layout (not saved yet)";
    }
  } catch (err) {
    console.error("Load invoice template error:", err);
    showError(`Could not load template (${err.code || "error"}). Showing defaults.`);
    populateForm(DEFAULTS);
  } finally {
    clearTimeout(fallback);
    window.COREBIQ?.hideLoading?.();
  }
}

async function saveTemplate() {
  const btn = $("saveTemplateBtn");
  btn.disabled = true;
  showError("");
  try {
    const payload = {
      ...readFormValues(),
      templateId: TEMPLATE_DOC_ID,
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, "document_templates", TEMPLATE_DOC_ID), payload, { merge: true });
    $("savedStatusText").textContent = `Saved on ${formatDate(new Date())}`;
    showToast("Invoice template saved.");
  } catch (err) {
    console.error("Save invoice template error:", err);
    showToast(`Could not save template (${err.code || "error"}).`, false);
  } finally {
    btn.disabled = false;
  }
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

  // Sync color picker & hex input
  $("accentColor")?.addEventListener("input", () => {
    $("accentColorHex").value = $("accentColor").value;
    renderPreview();
  });
  $("accentColorHex")?.addEventListener("input", () => {
    const hex = $("accentColorHex").value.trim();
    if (/^#[0-9a-f]{6}$/i.test(hex)) $("accentColor").value = hex;
    renderPreview();
  });

  $("invoiceTplForm")?.addEventListener("input", renderPreview);
  $("invoiceTplForm")?.addEventListener("change", renderPreview);
  $("saveTemplateBtn")?.addEventListener("click", saveTemplate);
  $("printInvoiceBtn")?.addEventListener("click", () => window.print());
  $("resetTemplateBtn")?.addEventListener("click", () => {
    if (!confirm("Reset invoice template fields back to default values?")) return;
    populateForm(DEFAULTS);
    showToast("Reset to defaults. Click Save to apply.");
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user || normalize(user.email) !== ADMIN) {
      if (user) await signOut(auth);
      const next = encodeURIComponent(location.pathname.replace(/^\//, "") + location.search + location.hash);
      location.replace(new URL(`auth/login.html?next=${next}`, document.baseURI).href);
      return;
    }
    $("invoice-tpl-app")?.classList.remove("hidden");
    loadTemplate();
    if (window.lucide) window.lucide.createIcons();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
