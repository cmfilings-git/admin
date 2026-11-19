import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { firebaseConfig } = await import(new URL("firebase/firebase-config.js", document.baseURI));

const ADMIN = "shanicm@gmail.com";
const TEMPLATE_DOC_ID = "letterhead";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DEFAULTS = {
  companyName: "COREBIQ Advisory LLP",
  companyTagline: "Tax, Compliance & ERP Advisory",
  headerAlign: "left",
  accentColor: "#0b57d0",
  companyPhone: "+91 98765 43210",
  companyEmail: "office@corebiq.com · corebiq.com",
  companyAddress: "2nd Floor, Business Park, Kozhikode, Kerala - 673001",
  companyReg: "GSTIN: 32ABCDE1234F1Z5 · Udyam: UDYAM-KL-00-0000000",
  refNo: "CBQ/2026/018",
  letterDate: todayIso(),
  recipientBlock: "The Managing Director,\nHexa Supermarket Pvt Ltd,\nMG Road, Ernakulam, Kerala - 682016",
  letterSubject: "Confirmation of Monthly GST Filing & Compliance Schedule",
  letterBody: "Dear Sir/Madam,\n\nThis is to confirm that your monthly GST returns and compliance filings for the current assessment period have been reviewed and scheduled for submission ahead of the statutory due date.\n\nPlease reach out to our advisory desk if any additional purchase invoices or credit notes need to be reconciled before final filing.\n\nThank you for your continued trust in our services.",
  signatoryName: "Shaniba B T",
  signatoryRole: "Authorized Signatory",
  showRefDate: true,
  showSignatory: true,
  showFooter: true
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

function formatDate(value) {
  if (!value) return "—";
  let d = null;
  if (typeof value?.toDate === "function") {
    d = value.toDate();
  } else if (typeof value === "string") {
    const ymd = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    d = ymd ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) : new Date(value);
  } else {
    d = new Date(value);
  }
  if (!d || Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${MONTHS[d.getMonth()]}-${String(d.getDate()).padStart(2, "0")}`;
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
    companyTagline: $("companyTagline").value.trim(),
    headerAlign: $("headerAlign").value || "left",
    accentColor: /^#[0-9a-f]{6}$/i.test($("accentColorHex").value.trim())
      ? $("accentColorHex").value.trim()
      : DEFAULTS.accentColor,
    companyPhone: $("companyPhone").value.trim(),
    companyEmail: $("companyEmail").value.trim(),
    companyAddress: $("companyAddress").value.trim(),
    companyReg: $("companyReg").value.trim(),
    refNo: $("refNo").value.trim(),
    letterDate: $("letterDate").value || todayIso(),
    recipientBlock: $("recipientBlock").value.trim(),
    letterSubject: $("letterSubject").value.trim(),
    letterBody: $("letterBody").value.trim(),
    signatoryName: $("signatoryName").value.trim(),
    signatoryRole: $("signatoryRole").value.trim(),
    showRefDate: $("showRefDate").checked,
    showSignatory: $("showSignatory").checked,
    showFooter: $("showFooter").checked
  };
}

function populateForm(data) {
  const cfg = { ...DEFAULTS, ...data };
  $("companyName").value = cfg.companyName;
  $("companyTagline").value = cfg.companyTagline;
  $("headerAlign").value = cfg.headerAlign;
  $("accentColor").value = cfg.accentColor;
  $("accentColorHex").value = cfg.accentColor;
  $("companyPhone").value = cfg.companyPhone;
  $("companyEmail").value = cfg.companyEmail;
  $("companyAddress").value = cfg.companyAddress;
  $("companyReg").value = cfg.companyReg;
  $("refNo").value = cfg.refNo;
  $("letterDate").value = cfg.letterDate || todayIso();
  $("recipientBlock").value = cfg.recipientBlock;
  $("letterSubject").value = cfg.letterSubject;
  $("letterBody").value = cfg.letterBody;
  $("signatoryName").value = cfg.signatoryName;
  $("signatoryRole").value = cfg.signatoryRole;
  $("showRefDate").checked = Boolean(cfg.showRefDate);
  $("showSignatory").checked = Boolean(cfg.showSignatory);
  $("showFooter").checked = Boolean(cfg.showFooter);
  renderPreview();
}

function renderPreview() {
  const cfg = readFormValues();
  $("letterheadPaper").style.setProperty("--lh-accent", cfg.accentColor);
  $("prevHeader").classList.toggle("is-center", cfg.headerAlign === "center");

  $("prevCompanyName").textContent = cfg.companyName;
  $("prevCompanyTagline").textContent = cfg.companyTagline;
  $("prevCompanyTagline").classList.toggle("hidden", !cfg.companyTagline);

  const contactParts = [cfg.companyPhone, cfg.companyEmail].filter(Boolean);
  $("prevHeaderContact").innerHTML = contactParts.map((line) => `<div>${escapeHtml(line)}</div>`).join("");

  $("prevMetaRow").classList.toggle("hidden", !cfg.showRefDate);
  $("prevRefNo").textContent = cfg.refNo || "—";
  $("prevDate").textContent = formatDate(cfg.letterDate);

  $("prevRecipient").textContent = cfg.recipientBlock;
  $("prevRecipient").classList.toggle("hidden", !cfg.recipientBlock);

  $("prevSubjectWrap").classList.toggle("hidden", !cfg.letterSubject);
  $("prevSubject").textContent = cfg.letterSubject;

  $("prevBody").textContent = cfg.letterBody;

  $("prevSignatoryBlock").classList.toggle("hidden", !cfg.showSignatory);
  $("prevSignCompany").textContent = cfg.companyName;
  $("prevSignName").textContent = cfg.signatoryName;
  $("prevSignRole").textContent = cfg.signatoryRole;

  $("prevFooter").classList.toggle("hidden", !cfg.showFooter);
  $("prevFooterAddress").textContent = cfg.companyAddress;
  $("prevFooterReg").textContent = cfg.companyReg;
  $("prevFooterReg").classList.toggle("hidden", !cfg.companyReg);
}

function exportWordDoc() {
  const cfg = readFormValues();
  const accent = cfg.accentColor;
  const align = cfg.headerAlign === "center" ? "center" : "left";
  const br = (txt) => escapeHtml(txt).replace(/\n/g, "<br>");

  const wordHtml = `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(cfg.companyName)} - Letterhead</title>
  <style>
    body { font-family: Calibri, Arial, sans-serif; color: #1f1f1f; font-size: 11pt; line-height: 1.55; margin: 24px; }
    .head { border-bottom: 2px solid ${accent}; padding-bottom: 10px; margin-bottom: 18px; text-align: ${align}; }
    .brand { font-size: 18pt; font-weight: 700; color: ${accent}; margin: 0; }
    .tag { font-size: 9.5pt; color: #64748b; margin: 2px 0 6px; }
    .contact { font-size: 9pt; color: #475569; }
    .meta { width: 100%; margin-bottom: 18px; font-size: 10pt; color: #334155; }
    .subject { margin: 14px 0; font-weight: 700; }
    .subject span { color: ${accent}; }
    .sign { margin-top: 36px; }
    .footer { margin-top: 48px; border-top: 1.5px solid ${accent}; padding-top: 8px; text-align: center; font-size: 8.5pt; color: #475569; }
  </style>
</head>
<body>
  <div class="head">
    <p class="brand">${escapeHtml(cfg.companyName)}</p>
    ${cfg.companyTagline ? `<p class="tag">${escapeHtml(cfg.companyTagline)}</p>` : ""}
    <div class="contact">${escapeHtml([cfg.companyPhone, cfg.companyEmail].filter(Boolean).join(" | "))}</div>
  </div>
  ${cfg.showRefDate ? `<table class="meta"><tr><td>Ref: <strong>${escapeHtml(cfg.refNo || "—")}</strong></td><td align="right">Date: <strong>${escapeHtml(formatDate(cfg.letterDate))}</strong></td></tr></table>` : ""}
  ${cfg.recipientBlock ? `<p>${br(cfg.recipientBlock)}</p>` : ""}
  ${cfg.letterSubject ? `<p class="subject"><span>Sub:</span> ${escapeHtml(cfg.letterSubject)}</p>` : ""}
  <p>${br(cfg.letterBody)}</p>
  ${cfg.showSignatory ? `<div class="sign"><p>For ${escapeHtml(cfg.companyName)},</p><br><br><p><strong>${escapeHtml(cfg.signatoryName)}</strong><br><span style="color:#64748b;font-size:9.5pt;">${escapeHtml(cfg.signatoryRole)}</span></p></div>` : ""}
  ${cfg.showFooter ? `<div class="footer">${escapeHtml(cfg.companyAddress)}${cfg.companyReg ? `<br>${escapeHtml(cfg.companyReg)}` : ""}</div>` : ""}
</body>
</html>`;

  const blob = new Blob(["\ufeff", wordHtml], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeRef = (cfg.refNo || "letterhead").replace(/[^a-z0-9-_]+/gi, "-");
  a.href = url;
  a.download = `${safeRef}-${formatDate(cfg.letterDate)}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Word document exported.");
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
    console.error("Load letterhead error:", err);
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
    showToast("Letterhead template saved.");
  } catch (err) {
    console.error("Save letterhead error:", err);
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

  $("accentColor")?.addEventListener("input", () => {
    $("accentColorHex").value = $("accentColor").value;
    renderPreview();
  });
  $("accentColorHex")?.addEventListener("input", () => {
    const hex = $("accentColorHex").value.trim();
    if (/^#[0-9a-f]{6}$/i.test(hex)) $("accentColor").value = hex;
    renderPreview();
  });

  $("letterheadForm")?.addEventListener("input", renderPreview);
  $("letterheadForm")?.addEventListener("change", renderPreview);
  $("saveTemplateBtn")?.addEventListener("click", saveTemplate);
  $("printLetterheadBtn")?.addEventListener("click", () => window.print());
  $("exportWordBtn")?.addEventListener("click", exportWordDoc);
  $("resetTemplateBtn")?.addEventListener("click", () => {
    if (!confirm("Reset letterhead fields back to default values?")) return;
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
    $("letterhead-tpl-app")?.classList.remove("hidden");
    loadTemplate();
    if (window.lucide) window.lucide.createIcons();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
