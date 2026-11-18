import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getFirestore, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "../../../firebase/firebase-config.js";

const ADMIN = "shanicm@gmail.com";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const items = new Map();
const movements = new Map();
let stopItems;
let stopMovements;
const listenerErrors = new Map();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(numeric(value));
}

function dateLabel(value) {
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value || 0);
  return Number.isNaN(date.getTime()) || !value
    ? "—"
    : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(date);
}

function stockAmounts(item) {
  const amount = Math.round((numeric(item.rate) * numeric(item.quantity) + Number.EPSILON) * 100) / 100;
  const tax = item.gstApplicable === "applicable"
    ? Math.round((amount * numeric(item.gstRate) / 100 + Number.EPSILON) * 100) / 100
    : 0;
  return { amount, tax, total: Math.round((amount + tax + Number.EPSILON) * 100) / 100 };
}

function setError(collectionName, error) {
  console.error(`Inventory could not read ${collectionName}:`, error);
  listenerErrors.set(collectionName, `Could not load ${collectionName} (${error.code || "error"}). Check Firebase connectivity and Firestore rules.`);
  renderErrors();
}

function showError(message) {
  const target = document.getElementById("inventoryError");
  target.hidden = false;
  target.textContent = message;
}

function renderErrors() {
  const target = document.getElementById("inventoryError");
  target.hidden = listenerErrors.size === 0;
  target.textContent = [...listenerErrors.values()].join(" ");
}

function render() {
  const active = [...items.values()].filter(item => item.active !== false);
  const goods = active.filter(item => item.type === "goods");
  const services = active.filter(item => item.type === "service");
  const goodsInStock = goods.filter(item => numeric(item.quantity) > 0).length;
  const openingValue = goods.reduce((sum, item) => sum + numeric(item.openingAmount), 0);
  const totals = goods.reduce((sum, item) => {
    const values = stockAmounts(item);
    sum.amount += values.amount;
    sum.tax += values.tax;
    sum.total += values.total;
    return sum;
  }, { amount: 0, tax: 0, total: 0 });
  const lowStock = goods.filter(item => numeric(item.reorderLevel) > 0 && numeric(item.quantity) <= numeric(item.reorderLevel))
    .sort((a, b) => numeric(a.quantity) - numeric(b.quantity));

  document.getElementById("goodsCount").textContent = goods.length.toLocaleString("en-IN");
  document.getElementById("servicesCount").textContent = services.length.toLocaleString("en-IN");
  document.getElementById("goodsInStock").textContent = goodsInStock.toLocaleString("en-IN");
  document.getElementById("openingValue").textContent = money(openingValue);
  document.getElementById("currentValue").textContent = money(totals.amount);
  document.getElementById("currentTax").textContent = money(totals.tax);
  document.getElementById("currentTotal").textContent = money(totals.total);
  document.getElementById("lowStockCount").textContent = lowStock.length.toLocaleString("en-IN");
  document.getElementById("lowStockRows").innerHTML = lowStock.length
    ? lowStock.slice(0, 8).map(item => `<tr><td><span class="inventory-id">${escapeHtml(item.inventoryId)}</span></td><td>${escapeHtml(item.name)}</td><td><span class="inventory-status inventory-status--warning">${numeric(item.quantity).toLocaleString("en-IN")} ${escapeHtml(item.uqc)}</span></td><td>${numeric(item.reorderLevel).toLocaleString("en-IN")}</td></tr>`).join("")
    : '<tr><td colspan="4" class="inventory-empty">No low-stock goods.</td></tr>';

  const recent = [...movements.values()]
    .sort((a, b) => numeric(b.createdAt?.seconds ?? new Date(b.createdAt || 0).getTime() / 1000) - numeric(a.createdAt?.seconds ?? new Date(a.createdAt || 0).getTime() / 1000))
    .slice(0, 8);
  document.getElementById("recentMovementRows").innerHTML = recent.length
    ? recent.map(movement => `<tr><td>${dateLabel(movement.createdAt)}</td><td><span class="inventory-id">${escapeHtml(movement.inventoryId || "—")}</span></td><td>${escapeHtml(movement.label || movement.kind || "—")}</td><td>${numeric(movement.changeQuantity) > 0 ? "+" : ""}${numeric(movement.changeQuantity).toLocaleString("en-IN")}</td></tr>`).join("")
    : '<tr><td colspan="4" class="inventory-empty">No stock activity yet.</td></tr>';
  if (window.lucide) window.lucide.createIcons();
}

function startListeners() {
  stopItems?.();
  stopMovements?.();
  stopItems = onSnapshot(collection(db, "inventoryItems"), snapshot => {
    listenerErrors.delete("inventory items");
    renderErrors();
    items.clear();
    snapshot.forEach(record => items.set(record.id, { id: record.id, ...record.data() }));
    render();
  }, error => setError("inventory items", error));
  stopMovements = onSnapshot(collection(db, "inventoryMovements"), snapshot => {
    listenerErrors.delete("stock activity");
    renderErrors();
    movements.clear();
    snapshot.forEach(record => movements.set(record.id, { id: record.id, ...record.data() }));
    render();
  }, error => setError("stock activity", error));
}

document.getElementById("refreshInventoryDashboard").addEventListener("click", startListeners);
window.addEventListener("corebiq:signout-request", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Could not sign out of Inventory:", error);
    showError(`Could not sign out (${error.code || "error"}). Try again.`);
  }
});

onAuthStateChanged(auth, async user => {
  if (!user || String(user.email || "").toLowerCase() !== ADMIN) {
    stopItems?.();
    stopMovements?.();
    if (user) {
      try {
        await signOut(auth);
      } catch (error) {
        console.error("Could not sign out an unauthorized Inventory account:", error);
      }
    }
    const next = encodeURIComponent(location.pathname.replace(/^\//, "") + location.search + location.hash);
    location.replace(new URL(`auth/login.html?next=${next}`, document.baseURI).href);
    return;
  }
  document.getElementById("inventory-app").hidden = false;
  startListeners();
});
