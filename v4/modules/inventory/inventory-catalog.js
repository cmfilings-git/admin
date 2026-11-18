import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getFirestore, onSnapshot, runTransaction, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "../../firebase/firebase-config.js";

const ADMIN = "shanicm@gmail.com";
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(numberValue(value));
}

function quantityLabel(value) {
  return numberValue(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function roundQuantity(value) {
  return Math.round((numberValue(value) + Number.EPSILON) * 1000) / 1000;
}

function roundCurrency(value) {
  return Math.round((numberValue(value) + Number.EPSILON) * 100) / 100;
}

function timestampMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function dateTimeLabel(value) {
  const millis = timestampMillis(value);
  return millis ? new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(new Date(millis)) : "—";
}

function amounts(rate, quantity, gstApplicable, gstRate) {
  const amount = roundCurrency(numberValue(rate) * numberValue(quantity));
  const tax = gstApplicable === "applicable" ? roundCurrency(amount * numberValue(gstRate) / 100) : 0;
  return { amount, tax, total: roundCurrency(amount + tax) };
}

function itemDocumentId(inventoryId) {
  return encodeURIComponent(String(inventoryId).trim().toLowerCase());
}

function pageMarkup(type) {
  const isGoods = type === "goods";
  const label = isGoods ? "Goods" : "Services";
  const tableHeaders = isGoods
    ? "<th>Inventory ID</th><th>Name</th><th>Category</th><th>UQC</th><th>Rate</th><th>Qty</th><th>Amount</th><th>GST</th><th>HSN</th><th>Total</th><th>Opening Balance</th><th>Reorder At</th><th>Actions</th>"
    : "<th>Inventory ID</th><th>Name</th><th>Category</th><th>UQC</th><th>Rate</th><th>Amount</th><th>GST</th><th>HSN</th><th>Total</th><th>Actions</th>";
  return `
    <header class="inventory-head">
      <div>
        <h1>${label}</h1>
        <nav class="inventory-breadcrumb" aria-label="Breadcrumb">
          <a href="index.html">Modules</a><span aria-hidden="true">&gt;</span>
          <a href="modules/inventory/dashboard/dashboard.html">Inventory</a><span aria-hidden="true">&gt;</span>
          <span aria-current="page">${label}</span>
        </nav>
      </div>
      <div class="inventory-actions">
        <button id="refreshInventory" class="crm-icon-btn" type="button" aria-label="Refresh ${label}" title="Refresh ${label}"><i data-lucide="refresh-cw"></i></button>
        <button id="addInventoryItem" class="crm-btn primary" type="button"><i data-lucide="plus"></i><span>Add ${isGoods ? "Goods" : "Service"}</span></button>
      </div>
    </header>
    <div class="inventory-tabs-wrap">
      <nav class="inventory-tabs" aria-label="Inventory sections">
        <a href="modules/inventory/dashboard/dashboard.html"><i data-lucide="layout-dashboard"></i>Dashboard</a>
        <a class="${isGoods ? "active" : ""}" href="modules/inventory/goods/inventory-goods.html" ${isGoods ? 'aria-current="page"' : ""}><i data-lucide="boxes"></i>Goods</a>
        <a class="${!isGoods ? "active" : ""}" href="modules/inventory/services/inventory-services.html" ${!isGoods ? 'aria-current="page"' : ""}><i data-lucide="briefcase-business"></i>Services</a>
      </nav>
    </div>
    <section class="inventory-kpis" aria-label="${label} summary">
      <article class="inventory-kpi"><span class="inventory-kpi-label">Active ${label.toLowerCase()}</span><b id="catalogCount" class="inventory-kpi-value">—</b></article>
      <article class="inventory-kpi"><span class="inventory-kpi-label">${isGoods ? "Goods with stock" : "GST applicable"}</span><b id="catalogQuantity" class="inventory-kpi-value">—</b></article>
      <article class="inventory-kpi"><span class="inventory-kpi-label">${isGoods ? "Opening balance value" : "Catalog value"}</span><b id="catalogOpeningValue" class="inventory-kpi-value">—</b></article>
      <article class="inventory-kpi"><span class="inventory-kpi-label">${isGoods ? "Current stock total" : "Total service value"}</span><b id="catalogTotalValue" class="inventory-kpi-value">—</b></article>
    </section>
    <section class="inventory-card">
      <header class="inventory-card-head">
        <div><h2>${label} register</h2><p>${isGoods ? "Manage opening quantities, stock movements, GST, and reorder levels." : "Manage service rates, UQC, GST, and HSN details."}</p></div>
        <span id="recordCount" class="inventory-kpi-label">0 records</span>
      </header>
      <div class="inventory-toolbar">
        <input id="inventorySearch" class="inventory-search" type="search" placeholder="Search ID, name, category, or HSN" aria-label="Search ${label.toLowerCase()}">
        <label class="inventory-check"><input id="showArchived" type="checkbox">Show archived</label>
      </div>
      <div class="inventory-table-wrap">
        <table class="inventory-table ${isGoods ? "" : "inventory-table--services"}">
          <thead><tr>${tableHeaders}</tr></thead>
          <tbody id="inventoryRows"><tr><td colspan="${isGoods ? 13 : 10}" class="inventory-loading">Loading ${label.toLowerCase()}...</td></tr></tbody>
        </table>
      </div>
    </section>
    <p id="inventoryPageError" class="inventory-error" role="alert" hidden></p>

    <div id="itemModal" class="inventory-modal" hidden>
      <section class="inventory-dialog" role="dialog" aria-modal="true" aria-labelledby="itemModalTitle">
        <header class="inventory-dialog-head">
          <div><h2 id="itemModalTitle">Add ${isGoods ? "Goods" : "Service"}</h2><p>Enter the catalog and tax details.</p></div>
          <button class="inventory-icon-button" type="button" data-close-item aria-label="Close"><i data-lucide="x"></i></button>
        </header>
        <form id="itemForm" class="inventory-form" novalidate>
          <div class="inventory-form-grid">
            <label><span>Inventory ID *</span><input id="inventoryId" maxlength="80" required autocomplete="off"></label>
            <label><span>Name *</span><input id="itemName" maxlength="160" required></label>
            <label><span>Category</span><input id="itemCategory" maxlength="100"></label>
            <label><span>UQC *</span><input id="itemUqc" maxlength="40" placeholder="e.g. NOS, KGS, HRS" required></label>
            <label><span>Rate *</span><input id="itemRate" type="number" min="0" step="0.01" required></label>
            ${isGoods ? `
              <label id="openingQuantityField"><span>Opening balance quantity *</span><input id="openingQuantity" type="number" min="0" step="0.001" value="0" required><small class="inventory-form-hint">Only used when creating the item. Future changes are recorded as stock movements.</small></label>
              <label><span>Reorder level</span><input id="reorderLevel" type="number" min="0" step="0.001" value="0"></label>
            ` : ""}
            <label><span>GST</span><select id="gstApplicable"><option value="not_applicable">Not applicable</option><option value="applicable">Applicable</option></select></label>
            <div id="taxFields" class="inventory-tax-fields inventory-field-full" hidden>
              <label><span>GST rate (%) *</span><input id="gstRate" type="number" min="0" max="100" step="0.01" value="18"></label>
              <label><span>HSN / SAC code *</span><input id="hsnCode" maxlength="24"></label>
            </div>
            <div class="inventory-total-preview">
              <span>Amount <strong id="amountPreview">${money(0)}</strong></span>
              <span>GST <strong id="taxPreview">${money(0)}</strong></span>
              <span>Total <strong id="totalPreview">${money(0)}</strong></span>
            </div>
          </div>
          <p id="itemFormError" class="inventory-form-error" role="alert"></p>
          <div class="inventory-form-footer">
            <button class="crm-btn" type="button" data-close-item>Cancel</button>
            <button id="saveInventoryItem" class="crm-btn primary" type="submit">Save ${isGoods ? "Goods" : "Service"}</button>
          </div>
        </form>
      </section>
    </div>
    ${isGoods ? `
      <div id="movementModal" class="inventory-modal" hidden>
        <section class="inventory-dialog" role="dialog" aria-modal="true" aria-labelledby="movementModalTitle">
          <header class="inventory-dialog-head">
            <div><h2 id="movementModalTitle">Stock movement</h2><p id="movementItemLabel"></p></div>
            <button class="inventory-icon-button" type="button" data-close-movement aria-label="Close"><i data-lucide="x"></i></button>
          </header>
          <form id="movementForm" class="inventory-form" novalidate>
            <div class="inventory-form-grid">
              <label><span>Movement *</span><select id="movementKind"><option value="in">Stock in</option><option value="out">Stock out</option><option value="set">Set balance (adjustment)</option></select></label>
              <label><span id="movementQuantityLabel">Quantity *</span><input id="movementQuantity" type="number" min="0.001" step="0.001" required></label>
              <label class="inventory-field-full"><span>Note</span><input id="movementNote" maxlength="240" placeholder="Reason or reference"></label>
            </div>
            <p id="movementFormError" class="inventory-form-error" role="alert"></p>
            <div class="inventory-form-footer">
              <button class="crm-btn" type="button" data-close-movement>Cancel</button>
              <button class="crm-btn primary" type="submit">Save movement</button>
            </div>
          </form>
        </section>
      </div>
      <div id="historyModal" class="inventory-modal" hidden>
        <section class="inventory-dialog inventory-dialog--wide" role="dialog" aria-modal="true" aria-labelledby="historyModalTitle">
          <header class="inventory-dialog-head">
            <div><h2 id="historyModalTitle">Stock movement history</h2><p id="historyItemLabel"></p></div>
            <button class="inventory-icon-button" type="button" data-close-history aria-label="Close"><i data-lucide="x"></i></button>
          </header>
          <div class="inventory-table-wrap">
            <table class="inventory-table inventory-history-table">
              <thead><tr><th>Date</th><th>Movement</th><th>Previous</th><th>Change</th><th>New balance</th><th>Note</th></tr></thead>
              <tbody id="historyRows"><tr><td colspan="6" class="inventory-empty">No stock movements yet.</td></tr></tbody>
            </table>
          </div>
        </section>
      </div>
    ` : ""}
  `;
}

export function initInventoryCatalog() {
  const type = document.body.dataset.inventoryType;
  if (!["goods", "service"].includes(type)) {
    throw new Error("Inventory catalog requires a valid goods or service page type.");
  }
  const isGoods = type === "goods";
  const label = isGoods ? "Goods" : "Services";
  document.getElementById("inventoryContent").innerHTML = pageMarkup(type);
  if (window.lucide) window.lucide.createIcons();

  const $ = id => document.getElementById(id);
  const items = new Map();
  const movements = new Map();
  let movementsUnsubscribe;
  let itemsUnsubscribe;
  let editingItemId = "";
  let movingItemId = "";
  let historyItemId = "";
  let toastTimer;
  const listenerErrors = new Map();

  function updateListenerError(key, message) {
    if (message) listenerErrors.set(key, message);
    else listenerErrors.delete(key);
    const error = $("inventoryPageError");
    error.hidden = listenerErrors.size === 0;
    error.textContent = [...listenerErrors.values()].join(" ");
  }

  function showToast(message, isError = false) {
    const toast = $("inventoryToast");
    toast.textContent = message;
    toast.style.background = isError ? "#9f1d20" : "#17202b";
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
  }

  function visibleItems() {
    const query = $("inventorySearch").value.trim().toLowerCase();
    const includeArchived = $("showArchived").checked;
    return [...items.values()]
      .filter(item => item.type === type && (includeArchived || item.active !== false))
      .filter(item => !query || [item.inventoryId, item.name, item.category, item.hsnCode]
        .some(value => String(value || "").toLowerCase().includes(query)))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }

  function render() {
    const activeItems = [...items.values()].filter(item => item.type === type && item.active !== false);
    const rows = visibleItems();
    const quantity = isGoods ? activeItems.filter(item => numberValue(item.quantity) > 0).length : 0;
    const openingValue = isGoods ? activeItems.reduce((sum, item) => sum + numberValue(item.openingAmount), 0) : 0;
    const currentValue = activeItems.reduce((sum, item) => sum + amounts(item.rate, isGoods ? item.quantity : 1, item.gstApplicable, item.gstRate).total, 0);
    $("catalogCount").textContent = activeItems.length.toLocaleString("en-IN");
    $("catalogQuantity").textContent = isGoods
      ? quantity.toLocaleString("en-IN")
      : activeItems.filter(item => item.gstApplicable === "applicable").length.toLocaleString("en-IN");
    $("catalogOpeningValue").textContent = money(isGoods ? openingValue : activeItems.reduce((sum, item) => sum + numberValue(item.rate), 0));
    $("catalogTotalValue").textContent = money(currentValue);
    $("recordCount").textContent = `${rows.length.toLocaleString("en-IN")} records`;
    $("inventoryRows").innerHTML = rows.length ? rows.map(renderItemRow).join("") :
      `<tr><td colspan="${isGoods ? 13 : 10}" class="inventory-empty">${items.size ? "No items match these filters." : `No ${label.toLowerCase()} added yet.`}</td></tr>`;
    if (window.lucide) window.lucide.createIcons();
  }

  function renderItemRow(item) {
    const isActive = item.active !== false;
    const itemAmounts = amounts(item.rate, isGoods ? item.quantity : 1, item.gstApplicable, item.gstRate);
    const gstText = item.gstApplicable === "applicable" ? `Applicable (${numberValue(item.gstRate)}%)` : "Not applicable";
    const action = `<div class="inventory-row-actions">
      <button class="inventory-icon-button" type="button" data-edit-item="${escapeHtml(item.id)}" aria-label="Edit ${escapeHtml(item.name)}" title="Edit"><i data-lucide="pencil"></i></button>
      ${isGoods && isActive ? `<button class="inventory-icon-button" type="button" data-move-item="${escapeHtml(item.id)}" aria-label="Record stock movement for ${escapeHtml(item.name)}" title="Stock movement"><i data-lucide="arrow-left-right"></i></button>` : ""}
      ${isGoods ? `<button class="inventory-icon-button" type="button" data-history-item="${escapeHtml(item.id)}" aria-label="View stock history for ${escapeHtml(item.name)}" title="Stock history"><i data-lucide="history"></i></button>` : ""}
      <button class="inventory-icon-button" type="button" data-toggle-active="${escapeHtml(item.id)}" aria-label="${isActive ? "Archive" : "Restore"} ${escapeHtml(item.name)}" title="${isActive ? "Archive" : "Restore"}"><i data-lucide="${isActive ? "archive" : "archive-restore"}"></i></button>
    </div>`;
    const common = `<td><span class="inventory-id">${escapeHtml(item.inventoryId)}</span>${isActive ? "" : '<span class="inventory-status inventory-status--warning">Archived</span>'}</td>
      <td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.category || "—")}</td><td>${escapeHtml(item.uqc || "—")}</td><td>${money(item.rate)}</td>`;
    if (isGoods) {
      return `<tr>${common}
        <td>${quantityLabel(item.quantity)} ${escapeHtml(item.uqc)}</td>
        <td>${money(itemAmounts.amount)}</td>
        <td>${escapeHtml(gstText)}</td>
        <td>${escapeHtml(item.hsnCode || "—")}</td>
        <td>${money(itemAmounts.total)}</td>
        <td>${quantityLabel(item.openingQuantity)} ${escapeHtml(item.uqc)}<br><small>${money(item.openingAmount)}</small></td>
        <td>${numberValue(item.reorderLevel) ? quantityLabel(item.reorderLevel) : "—"}</td>
        <td>${action}</td></tr>`;
    }
    return `<tr>${common}
      <td>${money(itemAmounts.amount)}</td><td>${escapeHtml(gstText)}</td><td>${escapeHtml(item.hsnCode || "—")}</td>
      <td>${money(itemAmounts.total)}</td><td>${action}</td></tr>`;
  }

  function setItemError(message) {
    $("itemFormError").textContent = message;
  }

  function updatePreview() {
    const rate = numberValue($("itemRate").value);
    const quantity = isGoods
      ? (editingItemId ? numberValue(items.get(editingItemId)?.quantity) : numberValue($("openingQuantity").value))
      : 1;
    const tax = amounts(rate, quantity, $("gstApplicable").value, $("gstRate")?.value);
    $("amountPreview").textContent = money(tax.amount);
    $("taxPreview").textContent = money(tax.tax);
    $("totalPreview").textContent = money(tax.total);
    $("taxFields").hidden = $("gstApplicable").value !== "applicable";
  }

  function openItemForm(item) {
    editingItemId = item?.id || "";
    $("itemForm").reset();
    $("itemFormError").textContent = "";
    $("itemModalTitle").textContent = `${item ? "Edit" : "Add"} ${isGoods ? "Goods" : "Service"}`;
    $("saveInventoryItem").textContent = item ? "Save changes" : `Save ${isGoods ? "Goods" : "Service"}`;
    $("inventoryId").readOnly = Boolean(item);
    $("inventoryId").value = item?.inventoryId || "";
    $("itemName").value = item?.name || "";
    $("itemCategory").value = item?.category || "";
    $("itemUqc").value = item?.uqc || "";
    $("itemRate").value = item?.rate ?? "";
    $("gstApplicable").value = item?.gstApplicable || "not_applicable";
    $("gstRate").value = item?.gstRate ?? 18;
    $("hsnCode").value = item?.hsnCode || "";
    if (isGoods) {
      $("openingQuantity").value = item ? item.openingQuantity : 0;
      $("openingQuantity").disabled = Boolean(item);
      $("openingQuantityField").hidden = Boolean(item);
      $("reorderLevel").value = item?.reorderLevel ?? 0;
    }
    updatePreview();
    $("itemModal").hidden = false;
    document.body.style.overflow = "hidden";
    if (window.lucide) window.lucide.createIcons();
    $("itemName").focus();
  }

  function closeItemForm() {
    $("itemModal").hidden = true;
    document.body.style.overflow = "";
    editingItemId = "";
  }

  async function saveItem(event) {
    event.preventDefault();
    setItemError("");
    const inventoryId = $("inventoryId").value.trim();
    const name = $("itemName").value.trim();
    const uqc = $("itemUqc").value.trim();
    const rate = Number($("itemRate").value);
    const openingQuantity = isGoods ? Number($("openingQuantity").value) : 0;
    const reorderLevel = isGoods ? Number($("reorderLevel").value || 0) : 0;
    const gstApplicable = $("gstApplicable").value;
    const gstRate = gstApplicable === "applicable" ? Number($("gstRate").value) : 0;
    const hsnCode = gstApplicable === "applicable" ? $("hsnCode").value.trim() : "";
    if (!inventoryId || !name || !uqc || $("itemRate").value.trim() === "" || !Number.isFinite(rate) || rate < 0 ||
      $("itemRate").validity.stepMismatch ||
      (isGoods && ($("openingQuantity").value.trim() === "" || !Number.isFinite(openingQuantity) || openingQuantity < 0)) ||
      (isGoods && ($("openingQuantity").validity.stepMismatch || !Number.isFinite(reorderLevel) || reorderLevel < 0 || $("reorderLevel").validity.stepMismatch))) {
      setItemError("Enter a valid Inventory ID, name, UQC, rate, quantity, and reorder level.");
      return;
    }
    if (gstApplicable === "applicable" && ($("gstRate").value.trim() === "" || !Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100 || $("gstRate").validity.stepMismatch || !hsnCode)) {
      setItemError("Enter a valid GST rate and HSN/SAC code when GST is applicable.");
      return;
    }
    const id = itemDocumentId(inventoryId);
    if (id.length > 1500) {
      setItemError("Inventory ID is too long.");
      return;
    }
    if ([...items.values()].some(item => item.id !== editingItemId && item.id === id)) {
      setItemError("That Inventory ID is already in use.");
      return;
    }

    const saveButton = $("saveInventoryItem");
    saveButton.disabled = true;
    try {
      const itemData = {
        inventoryId,
        type,
        name,
        category: $("itemCategory").value.trim(),
        uqc,
        rate,
        reorderLevel,
        gstApplicable,
        gstRate,
        hsnCode,
        updatedAt: serverTimestamp()
      };
      const currentItem = editingItemId ? items.get(editingItemId) : null;
      if (currentItem) {
        const itemRef = doc(db, "inventoryItems", editingItemId);
        await runTransaction(db, async transaction => {
          const snapshot = await transaction.get(itemRef);
          if (!snapshot.exists()) throw new Error("Inventory item was not found.");
          const latest = snapshot.data();
          if (latest.type !== type) throw new Error("Inventory item type has changed.");
          const quantity = isGoods ? numberValue(latest.quantity) : null;
          const currentAmounts = amounts(rate, isGoods ? quantity : 1, gstApplicable, gstRate);
          transaction.update(itemRef, {
            ...itemData,
            quantity,
            openingQuantity: isGoods ? numberValue(latest.openingQuantity) : null,
            openingRate: isGoods ? numberValue(latest.openingRate) : null,
            openingAmount: isGoods ? numberValue(latest.openingAmount) : 0,
            amount: currentAmounts.amount,
            gstAmount: currentAmounts.tax,
            total: currentAmounts.total,
            active: latest.active !== false
          });
        });
        showToast(`${label} updated.`);
      } else {
        const openingQty = isGoods ? roundQuantity(openingQuantity) : null;
        const quantity = openingQty;
        const currentAmounts = amounts(rate, isGoods ? quantity : 1, gstApplicable, gstRate);
        const itemRef = doc(db, "inventoryItems", id);
        const itemMovement = isGoods && openingQuantity > 0;
        const movementRef = itemMovement ? doc(collection(db, "inventoryMovements")) : null;
        const newItemData = {
          ...itemData,
          quantity,
          openingQuantity: openingQty,
          openingRate: isGoods ? rate : null,
          openingAmount: isGoods ? amounts(rate, openingQty, gstApplicable, gstRate).amount : 0,
          amount: currentAmounts.amount,
          gstAmount: currentAmounts.tax,
          total: currentAmounts.total,
          active: true
        };
        await runTransaction(db, async transaction => {
          const existing = await transaction.get(itemRef);
          if (existing.exists()) throw new Error("That Inventory ID is already in use.");
          transaction.set(itemRef, { ...newItemData, createdAt: serverTimestamp() });
          if (movementRef) {
            transaction.set(movementRef, {
              inventoryItemId: id,
              inventoryId,
              itemName: name,
              kind: "opening",
              label: "Opening balance",
              changeQuantity: openingQty,
              previousQuantity: 0,
              newQuantity: openingQty,
              note: "Opening balance",
              createdAt: serverTimestamp()
            });
          }
        });
        showToast(`${label} added.`);
      }
      closeItemForm();
    } catch (error) {
      console.error(`Could not save inventory ${type}:`, error);
      setItemError(error.message === "That Inventory ID is already in use."
        ? error.message
        : `Could not save ${label.toLowerCase()} (${error.code || "error"}). Check Firebase permissions and try again.`);
    } finally {
      saveButton.disabled = false;
    }
  }

  function openMovementForm(item) {
    if (!isGoods) return;
    movingItemId = item.id;
    $("movementForm").reset();
    $("movementFormError").textContent = "";
    $("movementItemLabel").textContent = `${item.name} · ${quantityLabel(item.quantity)} ${item.uqc} on hand`;
    $("movementModal").hidden = false;
    document.body.style.overflow = "hidden";
    if (window.lucide) window.lucide.createIcons();
    $("movementQuantity").focus();
  }

  function closeMovementForm() {
    $("movementModal").hidden = true;
    document.body.style.overflow = "";
    movingItemId = "";
  }

  function renderHistory() {
    const records = [...movements.values()]
      .filter(movement => movement.inventoryItemId === historyItemId)
      .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
    $("historyRows").innerHTML = records.length ? records.map(movement => `
      <tr>
        <td>${dateTimeLabel(movement.createdAt)}</td>
        <td>${escapeHtml(movement.label || movement.kind || "—")}</td>
        <td>${quantityLabel(movement.previousQuantity)}</td>
        <td>${numberValue(movement.changeQuantity) > 0 ? "+" : ""}${quantityLabel(movement.changeQuantity)}</td>
        <td>${quantityLabel(movement.newQuantity)}</td>
        <td>${escapeHtml(movement.note || "—")}</td>
      </tr>`).join("") : '<tr><td colspan="6" class="inventory-empty">No stock movements recorded for this item.</td></tr>';
  }

  function openHistory(item) {
    historyItemId = item.id;
    $("historyItemLabel").textContent = `${item.name} · ${item.inventoryId}`;
    renderHistory();
    $("historyModal").hidden = false;
    document.body.style.overflow = "hidden";
    if (window.lucide) window.lucide.createIcons();
  }

  function closeHistory() {
    $("historyModal").hidden = true;
    document.body.style.overflow = "";
    historyItemId = "";
  }

  async function saveMovement(event) {
    event.preventDefault();
    const errorElement = $("movementFormError");
    errorElement.textContent = "";
    const kind = $("movementKind").value;
    const quantity = Number($("movementQuantity").value);
    if ($("movementQuantity").value.trim() === "" || !Number.isFinite(quantity) || quantity < 0 ||
      $("movementQuantity").validity.stepMismatch || (kind !== "set" && quantity <= 0)) {
      errorElement.textContent = "Enter a valid movement quantity.";
      return;
    }
    const item = items.get(movingItemId);
    if (!item) {
      errorElement.textContent = "This inventory item is no longer available. Refresh and try again.";
      return;
    }
    const movementButton = $("movementForm").querySelector('[type="submit"]');
    movementButton.disabled = true;
    try {
      const itemRef = doc(db, "inventoryItems", movingItemId);
      const movementRef = doc(collection(db, "inventoryMovements"));
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(itemRef);
        if (!snapshot.exists()) throw new Error("Inventory item was not found.");
        const latest = snapshot.data();
        if (latest.type !== "goods" || latest.active === false) throw new Error("Only active goods can receive stock movements.");
        const previousQuantity = numberValue(latest.quantity);
        const newQuantity = kind === "in"
          ? previousQuantity + quantity
          : kind === "out"
            ? previousQuantity - quantity
            : roundQuantity(quantity);
        const balancedQuantity = roundQuantity(newQuantity);
        if (balancedQuantity < 0) throw new Error("Stock out cannot exceed the available quantity.");
        const changeQuantity = balancedQuantity - previousQuantity;
        const currentAmounts = amounts(latest.rate, balancedQuantity, latest.gstApplicable, latest.gstRate);
        transaction.update(itemRef, {
          quantity: balancedQuantity,
          amount: currentAmounts.amount,
          gstAmount: currentAmounts.tax,
          total: currentAmounts.total,
          updatedAt: serverTimestamp()
        });
        transaction.set(movementRef, {
          inventoryItemId: movingItemId,
          inventoryId: latest.inventoryId,
          itemName: latest.name,
          kind,
          label: kind === "in" ? "Stock in" : kind === "out" ? "Stock out" : "Balance adjustment",
          changeQuantity,
          previousQuantity,
          newQuantity: balancedQuantity,
          note: $("movementNote").value.trim(),
          createdAt: serverTimestamp()
        });
      });
      closeMovementForm();
      showToast("Stock movement recorded.");
    } catch (error) {
      console.error("Could not save stock movement:", error);
      errorElement.textContent = error.message || `Could not save stock movement (${error.code || "error"}).`;
    } finally {
      movementButton.disabled = false;
    }
  }

  async function toggleActive(itemId) {
    const item = items.get(itemId);
    if (!item) return;
    const active = item.active === false;
    if (!active && !confirm(`Archive ${item.name}? The item and its stock history will be kept.`)) return;
    try {
      await updateDoc(doc(db, "inventoryItems", itemId), { active, updatedAt: serverTimestamp() });
      showToast(active ? `${label} restored.` : `${label} archived.`);
    } catch (error) {
      console.error(`Could not update ${label.toLowerCase()} status:`, error);
      showToast(`Could not update ${label.toLowerCase()} (${error.code || "error"}).`, true);
    }
  }

  function closeOnEscape(event) {
    if (event.key !== "Escape") return;
    if (!$("itemModal").hidden) closeItemForm();
    if (isGoods && !$("movementModal").hidden) closeMovementForm();
    if (isGoods && !$("historyModal").hidden) closeHistory();
  }

  $("addInventoryItem").addEventListener("click", () => openItemForm());
  $("inventorySearch").addEventListener("input", render);
  $("showArchived").addEventListener("change", render);
  $("itemRate").addEventListener("input", updatePreview);
  $("gstApplicable").addEventListener("change", updatePreview);
  $("gstRate").addEventListener("input", updatePreview);
  if (isGoods) $("openingQuantity").addEventListener("input", updatePreview);
  $("itemForm").addEventListener("submit", saveItem);
  $("inventoryRows").addEventListener("click", event => {
    const edit = event.target.closest("[data-edit-item]");
    const move = event.target.closest("[data-move-item]");
    const history = event.target.closest("[data-history-item]");
    const toggle = event.target.closest("[data-toggle-active]");
    if (edit) openItemForm(items.get(edit.dataset.editItem));
    else if (move) openMovementForm(items.get(move.dataset.moveItem));
    else if (history) openHistory(items.get(history.dataset.historyItem));
    else if (toggle) toggleActive(toggle.dataset.toggleActive);
  });
  document.querySelectorAll("[data-close-item]").forEach(button => button.addEventListener("click", closeItemForm));
  $("itemModal").addEventListener("click", event => { if (event.target === $("itemModal")) closeItemForm(); });
  document.addEventListener("keydown", closeOnEscape);
  if (isGoods) {
    $("movementKind").addEventListener("change", () => {
      $("movementQuantityLabel").textContent = $("movementKind").value === "set" ? "New balance *" : "Quantity *";
      $("movementQuantity").min = $("movementKind").value === "set" ? "0" : "0.001";
    });
    $("movementForm").addEventListener("submit", saveMovement);
    document.querySelectorAll("[data-close-movement]").forEach(button => button.addEventListener("click", closeMovementForm));
    $("movementModal").addEventListener("click", event => { if (event.target === $("movementModal")) closeMovementForm(); });
    document.querySelectorAll("[data-close-history]").forEach(button => button.addEventListener("click", closeHistory));
    $("historyModal").addEventListener("click", event => { if (event.target === $("historyModal")) closeHistory(); });
  }

  function startListeners() {
    itemsUnsubscribe?.();
    movementsUnsubscribe?.();
    itemsUnsubscribe = onSnapshot(collection(db, "inventoryItems"), snapshot => {
      updateListenerError("items", "");
      items.clear();
      snapshot.forEach(record => items.set(record.id, { id: record.id, ...record.data() }));
      render();
    }, error => {
      console.error(`Could not load inventory ${type}:`, error);
      updateListenerError("items", `Could not load ${label.toLowerCase()} (${error.code || "error"}). Check Firebase connectivity and Firestore rules.`);
    });
    if (isGoods) {
      movementsUnsubscribe = onSnapshot(collection(db, "inventoryMovements"), snapshot => {
        updateListenerError("movements", "");
        movements.clear();
        snapshot.forEach(record => movements.set(record.id, { id: record.id, ...record.data() }));
        if (historyItemId) renderHistory();
      }, error => {
        console.error("Could not load inventory movements:", error);
        updateListenerError("movements", `Could not load stock history (${error.code || "error"}). Check Firebase connectivity and Firestore rules.`);
      });
    }
  }

  $("refreshInventory").addEventListener("click", startListeners);
  window.addEventListener("corebiq:signout-request", async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Could not sign out of Inventory:", error);
      showToast(`Could not sign out (${error.code || "error"}).`, true);
    }
  });
  onAuthStateChanged(auth, async user => {
    if (!user || String(user.email || "").toLowerCase() !== ADMIN) {
      itemsUnsubscribe?.();
      movementsUnsubscribe?.();
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
    $("inventory-app").hidden = false;
    startListeners();
    if (location.hash === "#add") openItemForm();
  });
}
