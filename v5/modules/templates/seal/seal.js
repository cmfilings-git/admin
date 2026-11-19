import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const { firebaseConfig } = await import(new URL("firebase/firebase-config.js", document.baseURI));

const ADMIN = "shanicm@gmail.com";
const TEMPLATE_DOC_ID = "seal";
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
  activeType: "address",
  inkColor: "#1e3a8a",
  borderStyle: "double",
  tiltAngle: 0,
  companyName: "COREBIQ ADVISORY LLP",
  addrLine1: "2nd Floor, Business Park",
  addrLine2: "Kozhikode, Kerala - 673001",
  addrPhone: "Ph: +91 98765 43210",
  addrGstin: "GSTIN: 32ABCDE1234F1Z5",
  forPrefix: "For",
  forDesignation: "Authorised Signatory",
  forSubLabel: "",
  paidLabel: "PAID",
  paidDate: todayIso(),
  paidNote: "RECEIVED WITH THANKS",
  paidShowCompany: true
};

let activeType = DEFAULTS.activeType;
let toastTimer = 0;

function normalize(v) {
  return String(v ?? "").trim().toLowerCase();
}

function escapeXml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;"
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

function readValues() {
  return {
    activeType,
    inkColor: /^#[0-9a-f]{6}$/i.test($("inkColorHex").value.trim()) ? $("inkColorHex").value.trim() : DEFAULTS.inkColor,
    borderStyle: $("borderStyle").value || "double",
    tiltAngle: Number($("tiltAngle").value) || 0,
    companyName: $("companyName").value.trim() || DEFAULTS.companyName,
    addrLine1: $("addrLine1").value.trim(),
    addrLine2: $("addrLine2").value.trim(),
    addrPhone: $("addrPhone").value.trim(),
    addrGstin: $("addrGstin").value.trim(),
    forPrefix: $("forPrefix").value.trim() || "For",
    forDesignation: $("forDesignation").value.trim() || "Authorised Signatory",
    forSubLabel: $("forSubLabel").value.trim(),
    paidLabel: $("paidLabel").value.trim() || "PAID",
    paidDate: $("paidDate").value || todayIso(),
    paidNote: $("paidNote").value.trim(),
    paidShowCompany: $("paidShowCompany").checked
  };
}

function borderRects(w, h, color, style) {
  if (style === "none") return "";
  const outer = `<rect x="10" y="10" width="${w - 20}" height="${h - 20}" rx="8" fill="none" stroke="${color}" stroke-width="3.2"/>`;
  if (style === "single") return outer;
  const inner = `<rect x="16" y="16" width="${w - 32}" height="${h - 32}" rx="5" fill="none" stroke="${color}" stroke-width="1.3"/>`;
  return outer + inner;
}

function buildSealSvg(type, cfg, overrideAngle = null) {
  const w = 440;
  const h = type === "paid" ? 210 : 200;
  const color = type === "paid" && cfg.inkColor === "#1e3a8a" && overrideAngle !== null ? "#b91c1c" : cfg.inkColor;
  const angle = overrideAngle !== null ? overrideAngle : cfg.tiltAngle;
  const font = "Inter, 'Plus Jakarta Sans', Arial, sans-serif";
  const mono = "ui-monospace, Menlo, Consolas, monospace";

  let innerContent = "";

  if (type === "address") {
    const lines = [cfg.addrLine1, cfg.addrLine2, cfg.addrPhone, cfg.addrGstin].filter(Boolean);
    const startY = lines.length <= 2 ? 98 : 84;
    const gap = 22;

    innerContent = `
      ${borderRects(w, h, color, cfg.borderStyle)}
      <text x="${w / 2}" y="54" text-anchor="middle" fill="${color}" font-family="${font}" font-size="19" font-weight="800" letter-spacing="0.8">${escapeXml(cfg.companyName.toUpperCase())}</text>
      <line x1="34" y1="65" x2="${w - 34}" y2="65" stroke="${color}" stroke-width="1" stroke-opacity="0.55"/>
      ${lines.map((line, i) => {
        const isGstin = line === cfg.addrGstin && cfg.addrGstin;
        return `<text x="${w / 2}" y="${startY + i * gap}" text-anchor="middle" fill="${color}" font-family="${isGstin ? mono : font}" font-size="${isGstin ? "13.5" : "13.5"}" font-weight="${isGstin ? "700" : "500"}">${escapeXml(line)}</text>`;
      }).join("")}
    `;
  } else if (type === "for") {
    const title = `${cfg.forPrefix} ${cfg.companyName}`.trim();
    innerContent = `
      ${borderRects(w, h, color, cfg.borderStyle)}
      <text x="${w / 2}" y="52" text-anchor="middle" fill="${color}" font-family="${font}" font-size="17" font-weight="700" letter-spacing="0.4">${escapeXml(title)}</text>
      <line x1="88" y1="138" x2="${w - 88}" y2="138" stroke="${color}" stroke-width="1" stroke-dasharray="3 3" stroke-opacity="0.55"/>
      <text x="${w / 2}" y="160" text-anchor="middle" fill="${color}" font-family="${font}" font-size="14.5" font-weight="700">${escapeXml(cfg.forDesignation)}</text>
      ${cfg.forSubLabel ? `<text x="${w / 2}" y="177" text-anchor="middle" fill="${color}" font-family="${font}" font-size="11.5" font-weight="500" opacity="0.85">${escapeXml(cfg.forSubLabel)}</text>` : ""}
    `;
  } else {
    // Paid Seal
    const dateText = formatDate(cfg.paidDate);
    innerContent = `
      ${borderRects(w, h, color, cfg.borderStyle === "none" ? "double" : cfg.borderStyle)}
      <text x="${w / 2}" y="94" text-anchor="middle" fill="${color}" font-family="${font}" font-size="54" font-weight="900" letter-spacing="8">${escapeXml(cfg.paidLabel.toUpperCase())}</text>
      <line x1="36" y1="112" x2="${w - 36}" y2="112" stroke="${color}" stroke-width="1.6"/>
      <text x="${w / 2}" y="138" text-anchor="middle" fill="${color}" font-family="${mono}" font-size="16" font-weight="700" letter-spacing="1.2">DATE: ${escapeXml(dateText)}</text>
      ${cfg.paidShowCompany ? `<text x="${w / 2}" y="162" text-anchor="middle" fill="${color}" font-family="${font}" font-size="12.5" font-weight="700" letter-spacing="0.6">${escapeXml(cfg.companyName.toUpperCase())}</text>` : ""}
      ${cfg.paidNote ? `<text x="${w / 2}" y="182" text-anchor="middle" fill="${color}" font-family="${font}" font-size="11" font-weight="600" letter-spacing="0.8" opacity="0.85">${escapeXml(cfg.paidNote.toUpperCase())}</text>` : ""}
    `;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <g transform="rotate(${angle} ${w / 2} ${h / 2})">
      ${innerContent}
    </g>
  </svg>`;
}

function setActiveSealType(type, adjustDefaults = false) {
  activeType = ["address", "for", "paid"].includes(type) ? type : "address";

  document.querySelectorAll("[data-seal-type]").forEach((btn) => {
    const match = btn.dataset.sealType === activeType;
    btn.classList.toggle("is-active", match);
    btn.setAttribute("aria-selected", String(match));
  });

  document.querySelectorAll("[data-pick-seal]").forEach((card) => {
    card.classList.toggle("is-active", card.dataset.pickSeal === activeType);
  });

  ["address", "for", "paid"].forEach((t) => {
    $(`fields-${t}`)?.classList.toggle("hidden", t !== activeType);
  });

  const badgeLabels = {
    address: "Address Seal Preview",
    for: "For / Signatory Seal Preview",
    paid: "Paid Stamp Preview"
  };
  $("previewTypeBadge").textContent = badgeLabels[activeType];

  if (adjustDefaults) {
    if (activeType === "paid") {
      $("tiltAngle").value = "-10";
      $("inkColor").value = "#b91c1c";
      $("inkColorHex").value = "#b91c1c";
    } else {
      $("tiltAngle").value = "0";
      if ($("inkColorHex").value === "#b91c1c") {
        $("inkColor").value = "#1e3a8a";
        $("inkColorHex").value = "#1e3a8a";
      }
    }
  }

  renderAll();
}

function renderAll() {
  const cfg = readValues();
  $("tiltVal").textContent = `${cfg.tiltAngle}°`;
  $("sealPreviewHost").innerHTML = buildSealSvg(activeType, cfg);
  $("miniAddressHost").innerHTML = buildSealSvg("address", cfg, 0);
  $("miniForHost").innerHTML = buildSealSvg("for", cfg, 0);
  $("miniPaidHost").innerHTML = buildSealSvg("paid", cfg, -8);
}

function downloadSvg() {
  const cfg = readValues();
  const svg = buildSealSvg(activeType, cfg);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${activeType}-seal.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("SVG downloaded.");
}

function downloadPng() {
  const cfg = readValues();
  const svg = buildSealSvg(activeType, cfg);
  const scale = 3;
  const w = 440;
  const h = activeType === "paid" ? 210 : 200;

  const img = new Image();
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${activeType}-seal.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast("Transparent PNG downloaded.");
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    showToast("Could not export PNG.", false);
  };

  img.src = url;
}

function populateForm(data) {
  const cfg = { ...DEFAULTS, ...data };
  $("inkColor").value = cfg.inkColor;
  $("inkColorHex").value = cfg.inkColor;
  $("borderStyle").value = cfg.borderStyle;
  $("tiltAngle").value = String(cfg.tiltAngle ?? 0);
  $("companyName").value = cfg.companyName;
  $("addrLine1").value = cfg.addrLine1;
  $("addrLine2").value = cfg.addrLine2;
  $("addrPhone").value = cfg.addrPhone;
  $("addrGstin").value = cfg.addrGstin;
  $("forPrefix").value = cfg.forPrefix;
  $("forDesignation").value = cfg.forDesignation;
  $("forSubLabel").value = cfg.forSubLabel;
  $("paidLabel").value = cfg.paidLabel;
  $("paidDate").value = cfg.paidDate || todayIso();
  $("paidNote").value = cfg.paidNote;
  $("paidShowCompany").checked = Boolean(cfg.paidShowCompany);
  setActiveSealType(cfg.activeType || "address", false);
}

async function loadSeal() {
  showError("");
  window.COREBIQ?.showLoading?.();
  const fallback = window.setTimeout(() => window.COREBIQ?.hideLoading?.(), 6000);

  try {
    const snap = await getDoc(doc(db, "document_templates", TEMPLATE_DOC_ID));
    if (snap.exists()) {
      const data = snap.data();
      populateForm(data);
      $("savedStatusText").textContent = data.updatedAt ? `Saved on ${formatDate(data.updatedAt)}` : "Saved configuration";
    } else {
      populateForm(DEFAULTS);
      $("savedStatusText").textContent = "Default configuration (not saved yet)";
    }
  } catch (err) {
    console.error("Load seal error:", err);
    showError(`Could not load seal settings (${err.code || "error"}). Showing defaults.`);
    populateForm(DEFAULTS);
  } finally {
    clearTimeout(fallback);
    window.COREBIQ?.hideLoading?.();
  }
}

async function saveSeal() {
  const btn = $("saveSealBtn");
  btn.disabled = true;
  showError("");
  try {
    const payload = {
      ...readValues(),
      templateId: TEMPLATE_DOC_ID,
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, "document_templates", TEMPLATE_DOC_ID), payload, { merge: true });
    $("savedStatusText").textContent = `Saved on ${formatDate(new Date())}`;
    showToast("Seal configuration saved.");
  } catch (err) {
    console.error("Save seal error:", err);
    showToast(`Could not save seal (${err.code || "error"}).`, false);
  }
