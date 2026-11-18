import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
    import {
      getAuth, onAuthStateChanged, signOut
    } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
    import {
      getFirestore, collection, doc, getDocs, serverTimestamp, updateDoc, writeBatch
    } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
    import { enhanceSearchableSelect, prepareLucideIconMarkers } from "../../../js/searchable-select.js";

    const {firebaseConfig}=await import(new URL("firebase/firebase-config.js",document.baseURI));

    const ALLOWED_ADMIN_EMAIL = "shanicm@gmail.com";
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    const $ = (id) => document.getElementById(id);
    let allRecords = [];
    let clients = [];
    let editingComplianceId = "";
    let currentPage = 1;
    let sortColumn = "";
    let sortDirection = 1;
    const selectedComplianceIds = new Set();
    const PAGE_SIZE = 10;
    const renderComplianceWithSortMarkers = render;
    render = () => {
      prepareLucideIconMarkers("[data-sort-key]");
      renderComplianceWithSortMarkers();
    };

    function normalize(value) {
      return String(value ?? "").trim().toLowerCase();
    }

    function revealActiveModuleTab() {
      const tabs = document.querySelector(".client-tabs");
      const activeTab = tabs?.querySelector('[aria-current="page"]');
      if (!tabs || !activeTab || tabs.scrollWidth <= tabs.clientWidth) return;
      const tabsLeft = tabs.getBoundingClientRect().left;
      const activeRect = activeTab.getBoundingClientRect();
      const target = tabs.scrollLeft + activeRect.left - tabsLeft - (tabs.clientWidth - activeRect.width) / 2;
      tabs.scrollLeft = Math.max(0, Math.min(target, tabs.scrollWidth - tabs.clientWidth));
    }

    function toDate(value) {
      if (!value) return null;
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
      if (typeof value?.toDate === "function") return value.toDate();
      if (typeof value === "object" && value.seconds) return new Date(value.seconds * 1000);
      if (typeof value === "string") {
        const raw = value.trim();
        if (!raw) return null;
        // Supports ISO dates and common dd-mm-yyyy / dd/mm/yyyy formats.
        const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
        if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
      return null;
    }

    function filed(record) {
      const status = normalize(record.complianceStatus);
      return Boolean(record.filedAt) || ["filed", "completed", "complete", "done", "submitted"].includes(status);
    }

    function recordStatus(record) {
      if (filed(record)) return "completed";
      const due = toDate(record.dueDate);
      if (due) {
        const today = new Date(); today.setHours(0,0,0,0);
        due.setHours(0,0,0,0);
        if (due < today) return "overdue";
      }
      return "pending";
    }

    function formatDate(value) {
      const date = toDate(value);
      return date ? new Intl.DateTimeFormat("en-IN", { day:"2-digit", month:"short", year:"numeric" }).format(date) : (value ? String(value) : "—");
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
    }

    async function loadClients() {
      const clientsSnap = await getDocs(collection(db, "clients"));
      clients = clientsSnap.docs.map(clientDoc => ({ id: clientDoc.id, ...clientDoc.data() }));
      clients.sort((a, b) => String(a.clientName || "").localeCompare(String(b.clientName || "")));
      const clientFilterValue = $("clientFilter").value;
      $("clientFilter").innerHTML = `<option value="">All clients</option>` + clients.map(client =>
        `<option value="${escapeHtml(client.clientId || client.id)}">${escapeHtml(client.clientName || "Unnamed client")} · ${escapeHtml(client.clientId || client.id)}</option>`
      ).join("");
      $("clientFilter").value = clientFilterValue;
      $("clientFilter").dispatchEvent(new Event("change", { bubbles: true }));
      $("complianceClient").innerHTML = `<option value="">Select a client</option>` + clients.map(client =>
        `<option value="${escapeHtml(client.id)}">${escapeHtml(client.clientName || "Unnamed client")} · ${escapeHtml(client.clientId || client.id)}</option>`
      ).join("");
      $("complianceClient").dispatchEvent(new Event("change", { bubbles: true }));
    }

    function pill(status) {
      const labels = { completed:"Completed", pending:"Pending", overdue:"Overdue" };
      const cls = { completed:"status-complete", pending:"status-pending", overdue:"status-overdue" };
      return `<span class="status-pill ${cls[status] || "status-other"}">${labels[status] || escapeHtml(status || "Unknown")}</span>`;
    }

    function paymentPill(value) {
      const v = normalize(value);
      const cls = v === "paid" ? "status-complete" : (v === "unpaid" || v === "pending" ? "status-pending" : "status-other");
      return `<span class="status-pill ${cls}">${escapeHtml(value || "—")}</span>`;
    }

    function render() {
      const query = normalize($("searchInput").value);
      const statusFilter = $("statusFilter").value;
      const periodFilter = $("periodFilter").value;
      const paymentFilter = $("paymentFilter").value;
      const sortFilter = $("sortFilter").value;
      const clientFilter = normalize($("clientFilter").value);
      const viewFilter = $("viewFilter").value;
      const dateFrom = toDate($("dateFromFilter").value);
      const dateTo = toDate($("dateToFilter").value);
      const complianceNameFilter = normalize($("complianceNameFilter").value);
      const priorityFilter = normalize($("priorityFilter").value);
      updateFilterCount();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const nextUpcomingDate = allRecords.reduce((nextDate, record) => {
        if (filed(record)) return nextDate;
        const dueDate = toDate(record.dueDate);
        if (!dueDate) return nextDate;
        dueDate.setHours(0, 0, 0, 0);
        if (dueDate < today || (nextDate && dueDate >= nextDate)) return nextDate;
        return dueDate;
      }, null);
      $("upcomingCount").textContent = nextUpcomingDate ? formatDate(nextUpcomingDate) : "—";
      if (nextUpcomingDate) {
        const daysUntil = Math.round((
          Date.UTC(nextUpcomingDate.getFullYear(), nextUpcomingDate.getMonth(), nextUpcomingDate.getDate())
          - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
        ) / 86400000);
        $("upcomingDaysCount").textContent = daysUntil === 0
          ? "Due today"
          : `Due in ${daysUntil} ${daysUntil === 1 ? "day" : "days"}`;
      } else {
        $("upcomingDaysCount").textContent = "No upcoming date";
      }
      $("pendingCount").textContent = allRecords.filter(record => recordStatus(record) === "pending").length.toLocaleString("en-IN");
      $("notPaidCount").textContent = allRecords.filter(record => normalize(record.paymentStatus) !== "paid").length.toLocaleString("en-IN");
      $("overdueCount").textContent = allRecords.filter(record => recordStatus(record) === "overdue").length.toLocaleString("en-IN");

      const filtered = allRecords.filter(r => {
        const status = recordStatus(r);
        const searchText = [r.clientName, r.clientId, r.complianceId, r.complianceName, r.CompliancePeriod, r.complianceAknNumber].map(normalize).join(" ");
        return (!query || searchText.includes(query))
          && (viewFilter === "all" || (!filed(r) && normalize(r.paymentStatus) !== "paid"))
          && (!clientFilter || normalize(r.clientId) === clientFilter || normalize(r.clientName) === clientFilter)
          && (!dateFrom || (toDate(r.dueDate) && toDate(r.dueDate) >= dateFrom))
          && (!dateTo || (toDate(r.dueDate) && toDate(r.dueDate) <= dateTo))
          && (!complianceNameFilter || normalize(r.complianceName) === complianceNameFilter)
          && (!priorityFilter || normalize(r.priority) === priorityFilter)
          && (!statusFilter || status === statusFilter)
          && (!periodFilter || String(r.CompliancePeriod ?? "") === periodFilter)
          && (!paymentFilter || normalize(r.paymentStatus) === paymentFilter);
      });
      filtered.sort((a, b) => {
        const key = sortColumn || (sortFilter === "client" ? "clientName" : sortFilter === "compliance" ? "complianceName" : "dueDate");
        const direction = sortColumn ? sortDirection : sortFilter === "due-desc" ? -1 : 1;
        if (key === "dueDate") {
          const dateA = toDate(a.dueDate)?.getTime();
          const dateB = toDate(b.dueDate)?.getTime();
          if (dateA == null) return dateB == null ? 0 : 1;
          if (dateB == null) return -1;
          return (dateA - dateB) * direction;
        }
        const valueA = key === "filingStatus" ? recordStatus(a) : a[key];
        const valueB = key === "filingStatus" ? recordStatus(b) : b[key];
        return String(valueA || "").localeCompare(String(valueB || ""), undefined, { sensitivity: "base", numeric: true }) * direction;
      });

      const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      currentPage = Math.min(currentPage, pageCount);
      const firstIndex = (currentPage - 1) * PAGE_SIZE;
      const visibleRecords = filtered.slice(firstIndex, firstIndex + PAGE_SIZE);
      $("recordCount").textContent = `${filtered.length ? firstIndex + 1 : 0}–${Math.min(firstIndex + PAGE_SIZE, filtered.length)} of ${filtered.length} matching · ${selectedComplianceIds.size} selected`;
      $("emptyState").classList.toggle("hidden", filtered.length !== 0);
      $("complianceRows").innerHTML = visibleRecords.map(r => {
        const status = recordStatus(r);
        const folderUrl = safeExternalUrl(r.taskFolderLink);
        const folder = folderUrl ? `<span class="text-gray-600">Linked</span>` : `<span class="text-gray-300">—</span>`;
        const client = clients.find(item => normalize(item.clientId || item.id) === normalize(r.clientId) || normalize(item.clientName) === normalize(r.clientName));
        const phoneDigits = String(client?.clientMobile || r.clientMobile || "").replace(/\D/g, "");
        const whatsappNumber = phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits;
        const reminder = `Hello ${r.clientName || ""}, this is a reminder that payment for ${r.complianceName || "your compliance"}${r.CompliancePeriod ? ` (${r.CompliancePeriod})` : ""} is pending. Please arrange payment at your earliest convenience.`;
        const whatsappUrl = whatsappNumber ? `https://wa.me/${encodeURIComponent(whatsappNumber)}?text=${encodeURIComponent(reminder)}` : "";
        const filingMessage = `Hello ${r.clientName || ""}, the filing status for ${r.complianceName || "your compliance"}${r.CompliancePeriod ? ` (${r.CompliancePeriod})` : ""} is ${status}. Due date: ${formatDate(r.dueDate)}.`;
        const filingWhatsappUrl = whatsappNumber ? `https://wa.me/${encodeURIComponent(whatsappNumber)}?text=${encodeURIComponent(filingMessage)}` : "";
        const action = `<div class="crm-row-menu-wrap"><button class="crm-row-action crm-row-menu-toggle" type="button" data-row-menu-toggle aria-label="Actions for ${escapeHtml(r.clientName || "compliance record")}" aria-expanded="false" title="Actions"><i data-lucide="ellipsis"></i></button><div class="crm-row-menu" hidden><button type="button" data-edit-compliance="${escapeHtml(r.firestoreDocId)}"><i data-lucide="pencil"></i><span>Edit</span></button>${whatsappUrl ? `<a href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer"><i data-lucide="message-circle"></i><span>Send Payment Reminder</span><i class="crm-row-menu-cta" data-lucide="arrow-up-right"></i></a><a href="${escapeHtml(filingWhatsappUrl)}" target="_blank" rel="noopener noreferrer"><i data-lucide="file-check-2"></i><span>Send Filing Status</span><i class="crm-row-menu-cta" data-lucide="arrow-up-right"></i></a>` : `<button type="button" disabled><i data-lucide="message-circle"></i><span>Mobile number missing</span></button>`}${folderUrl ? `<a href="${escapeHtml(folderUrl)}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i><span>Open folder</span></a>` : ""}</div></div>`;
        return `<tr>
          <td class="px-5 py-4"><input type="checkbox" data-select-compliance="${escapeHtml(r.firestoreDocId)}" aria-label="Select compliance for ${escapeHtml(r.clientName || "client")}" ${selectedComplianceIds.has(r.firestoreDocId) ? "checked" : ""}></td>
          <td class="px-5 py-4"><p class="crm-compliance-client-name font-semibold text-gray-900">${escapeHtml(r.clientName || "—")}</p><p class="crm-compliance-client-id text-xs text-gray-400 mt-1">${escapeHtml(r.clientId || "—")}</p></td>
          <td class="px-5 py-4"><p class="crm-compliance-name font-semibold text-gray-800">${escapeHtml(r.complianceName || "—")}</p><p class="crm-compliance-reference text-xs text-gray-400 mt-1">${escapeHtml(r.complianceId || r.complianceAknNumber || "—")}</p></td>
          <td class="px-5 py-4 text-gray-600">${escapeHtml(r.CompliancePeriod || "—")}</td>
          <td class="px-5 py-4 text-gray-600 whitespace-nowrap">${formatDate(r.dueDate)}</td>
          <td class="px-5 py-4">${pill(status)}</td>
          <td class="px-5 py-4">${paymentPill(r.paymentStatus)}</td>
          <td class="px-5 py-4 text-gray-600">${escapeHtml(r.priority || "—")}</td>
          <td class="px-5 py-4">${folder}</td>
          <td class="px-5 py-4 text-gray-600">${r.complianceFee === undefined || r.complianceFee === null || r.complianceFee === "" ? "—" : escapeHtml(r.complianceFee)}</td>
          <td class="px-5 py-4">${action}</td>
        </tr>`;
      }).join("");
      if (!filtered.length) $("complianceRows").innerHTML = "";
      const allVisibleSelected = visibleRecords.length > 0 && visibleRecords.every(record => selectedComplianceIds.has(record.firestoreDocId));
      $("selectVisibleCompliance").checked = allVisibleSelected;
      $("selectVisibleCompliance").indeterminate = visibleRecords.some(record => selectedComplianceIds.has(record.firestoreDocId)) && !allVisibleSelected;
      $("compliancePagination").innerHTML = `<span>Page ${currentPage} of ${pageCount}</span><button type="button" aria-label="Previous page" data-page="-1" ${currentPage <= 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i></button><button type="button" aria-label="Next page" data-page="1" ${currentPage >= pageCount ? "disabled" : ""}><i data-lucide="chevron-right"></i></button>`;
      updateBulkActionState();
      document.querySelectorAll("[data-sort-key]").forEach(button => button.querySelector("i").setAttribute("data-lucide", button.dataset.sortKey === sortColumn ? (sortDirection < 0 ? "arrow-down" : "arrow-up") : "arrow-up-down"));
      if (window.lucide) window.lucide.createIcons();
    }

    function updateBulkActionState() {
      const hasSelection = selectedComplianceIds.size > 0;
      $("deleteSelected").disabled = !hasSelection;
      $("copySelected").disabled = !hasSelection;
    }

    function closeBulkActions() {
      $("bulkActionsMenu").hidden = true;
      $("bulkActionsToggle").setAttribute("aria-expanded", "false");
    }

    function closeRowActionMenus() {
      document.querySelectorAll(".crm-row-menu:not([hidden])").forEach(menu => {
        menu.hidden = true;
        menu.parentElement.querySelector("[data-row-menu-toggle]")?.setAttribute("aria-expanded", "false");
      });
    }

    function updateFilterCount() {
      const activeFilters = [
        $("clientFilter").value,
        $("dateFromFilter").value,
        $("dateToFilter").value,
        $("periodFilter").value,
        $("complianceNameFilter").value,
        $("statusFilter").value,
        $("paymentFilter").value,
        $("priorityFilter").value,
        $("viewFilter").value === "all" ? "all" : ""
      ].filter(Boolean).length;
      $("activeFilterCount").textContent = String(activeFilters);
      $("activeFilterCount").hidden = activeFilters === 0;
    }

    function closeFilterPopover() {
      $("complianceFilterPopover").hidden = true;
      $("filterToggle").setAttribute("aria-expanded", "false");
    }

    function showFilterPanel(category) {
      document.querySelectorAll("[data-filter-category]").forEach(button => {
        const selected = button.dataset.filterCategory === category;
        button.classList.toggle("active", selected);
        if (selected) button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
      });
      document.querySelectorAll("[data-filter-panel]").forEach(panel => {
        const selected = panel.dataset.filterPanel === category;
        panel.classList.toggle("active", selected);
        panel.hidden = !selected;
      });
    }

    function showToast(message, success = true) {
      const toast = $("toast");
      toast.textContent = message;
      toast.style.background = success ? "#166534" : "#be123c";
      toast.classList.remove("hiddenx");
      setTimeout(() => toast.classList.add("hiddenx"), 3000);
    }

    async function deleteSelectedCompliance() {
      const ids = [...selectedComplianceIds];
      if (!ids.length || !confirm(`Delete ${ids.length} selected compliance record${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
      try {
        const batch = writeBatch(db);
        ids.forEach(id => batch.delete(doc(db, "compliance", id)));
        await batch.commit();
        selectedComplianceIds.clear();
        closeBulkActions();
        await loadComplianceRegister();
        showToast(`${ids.length} compliance record${ids.length === 1 ? "" : "s"} deleted.`);
      } catch (error) {
        console.error("Could not delete selected compliance records:", error);
        showToast(`Could not delete selected records (${error.code || "error"}).`, false);
      }
    }

    function openCopyDateModal() {
      if (!selectedComplianceIds.size) return;
      closeBulkActions();
      $("copyDateError").textContent = "";
      $("copyDateModal").hidden = false;
      document.body.style.overflow = "hidden";
    }

    function closeCopyDateModal() {
      $("copyDateModal").hidden = true;
      $("copyDateForm").reset();
      $("copyDateError").textContent = "";
      document.body.style.overflow = "";
    }

    async function copySelectedCompliance(event) {
      event.preventDefault();
      const dueDate = $("copyDueDate").value;
      const recordsToCopy = allRecords.filter(record => selectedComplianceIds.has(record.firestoreDocId));
      if (!dueDate || !recordsToCopy.length) {
        $("copyDateError").textContent = "Select a new date and at least one compliance record.";
        return;
      }
      try {
        const batch = writeBatch(db);
        recordsToCopy.forEach(({ firestoreDocId, ...record }) => {
          batch.set(doc(collection(db, "compliance")), {
            ...record,
            dueDate,
            complianceStatus: "pending",
            filedAt: null,
            paymentStatus: "pending",
            nextComplianceDate: "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        });
        await batch.commit();
        selectedComplianceIds.clear();
        closeCopyDateModal();
        await loadComplianceRegister();
        showToast(`${recordsToCopy.length} compliance cop${recordsToCopy.length === 1 ? "y" : "ies"} created.`);
      } catch (error) {
        console.error("Could not copy selected compliance records:", error);
        $("copyDateError").textContent = `Could not copy selected records (${error.code || "error"}).`;
      }
    }

    function safeExternalUrl(value) {
      if (!value) return "";
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
      } catch {
        return "";
      }
    }

    async function loadComplianceRegister() {
      $("loadError").classList.add("hidden");
      $("complianceRows").innerHTML = `<tr><td colspan="11" class="px-5 py-12 text-center"><div class="flex justify-center"><div class="spinner"></div></div><p class="text-gray-400 mt-3">Loading compliance records...</p></td></tr>`;
      try {
        await loadClients();
        const complianceSnap = await getDocs(collection(db, "compliance"));
        allRecords = complianceSnap.docs.map(doc => ({ firestoreDocId: doc.id, ...doc.data() }));

        // Populate distinct compliance periods using the existing field.
        const periods = [...new Set(allRecords.map(r => String(r.CompliancePeriod ?? "").trim()).filter(Boolean))].sort().reverse();
        $("periodFilter").innerHTML = `<option value="">All periods</option>` + periods.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
        const complianceNames = [...new Set(allRecords.map(r => String(r.complianceName ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
        $("complianceNameFilter").innerHTML = `<option value="">All compliances</option>` + complianceNames.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");

        render();
      } catch (error) {
        console.error("Firestore load failed:", error);
        $("complianceRows").innerHTML = "";
        $("loadError").textContent = `Could not load Firestore data (${error.code || "error"}). Check that Firestore rules allow this signed-in admin to read the compliance collection.`;
        $("loadError").classList.remove("hidden");
      }
    }

    function closeComplianceForm() {
      $("complianceModal").classList.add("hidden");
      $("complianceForm").reset();
      $("complianceFormError").textContent = "";
      $("complianceModalTitle").textContent = "Add Compliance";
      $("saveCompliance").innerHTML = '<i data-lucide="save" aria-hidden="true"></i>Save Compliance';
      editingComplianceId = "";
      $("nextComplianceDateField").classList.remove("hidden");
      $("nextComplianceDate").required = true;
      document.body.style.overflow = "";
    }

    async function openComplianceForm() {
      $("complianceFormError").textContent = "";
      try {
        if (!clients.length) await loadClients();
        $("complianceForm").reset();
        editingComplianceId = "";
        $("complianceModalTitle").textContent = "Add Compliance";
        $("saveCompliance").innerHTML = '<i data-lucide="save" aria-hidden="true"></i>Save Compliance';
        $("complianceClient").value = "";
        $("complianceClient").dispatchEvent(new Event("change", { bubbles: true }));
        updateComplianceType();
        $("complianceModal").classList.remove("hidden");
        document.body.style.overflow = "hidden";
        if (window.lucide) window.lucide.createIcons();
      } catch (error) {
        $("complianceFormError").textContent = `Could not load clients (${error.code || "error"}). Check Firestore access and try again.`;
        $("complianceModal").classList.remove("hidden");
      }
    }

    function dateInputValue(value) {
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      const date = toDate(value);
      if (!date) return "";
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    async function openEditComplianceForm(recordId) {
      const record = allRecords.find(item => item.firestoreDocId === recordId);
      if (!record) return;
      try {
        if (!clients.length) await loadClients();
        $("complianceForm").reset();
        editingComplianceId = recordId;
        $("complianceModalTitle").textContent = "Edit Compliance";
        $("saveCompliance").innerHTML = '<i data-lucide="save" aria-hidden="true"></i>Update Compliance';
        const client = clients.find(item => normalize(item.clientId || item.id) === normalize(record.clientId) || normalize(item.clientName) === normalize(record.clientName));
        $("complianceClient").value = client?.id || "";
        $("complianceClient").dispatchEvent(new Event("change", { bubbles: true }));
        $("complianceNameInput").value = record.complianceName || "";
        $("complianceIdInput").value = record.complianceId || "";
        $("complianceAknInput").value = record.complianceAknNumber || "";
        $("compliancePeriodInput").value = record.CompliancePeriod || "";
        $("complianceDueDate").value = dateInputValue(record.dueDate);
        $("nextComplianceDate").value = dateInputValue(record.nextComplianceDate);
        $("compliancePriority").value = record.priority || "";
        $("complianceFolder").value = record.taskFolderLink || "";
        document.querySelector(`input[name="complianceType"][value="${record.complianceType === "Running Compliance" ? "Running Compliance" : "Onetime"}"]`).checked = true;
        updateComplianceType();
        $("complianceFormError").textContent = "";
        $("complianceModal").classList.remove("hidden");
        document.body.style.overflow = "hidden";
        if (window.lucide) window.lucide.createIcons();
      } catch (error) {
        console.error("Could not open compliance record:", error);
        showToast(`Could not open record (${error.code || "error"}).`, false);
      }
    }

    function updateComplianceType() {
      const isRunning = document.querySelector('input[name="complianceType"]:checked').value === "Running Compliance";
      $("nextComplianceDateField").classList.toggle("hidden", !isRunning);
      $("nextComplianceDate").required = isRunning;
    }

    async function saveCompliance(event) {
      event.preventDefault();
      $("complianceFormError").textContent = "";
      const selectedClient = clients.find(client => client.id === $("complianceClient").value);
      const complianceType = document.querySelector('input[name="complianceType"]:checked').value;
      const dueDate = $("complianceDueDate").value;
      const nextComplianceDate = $("nextComplianceDate").value;
      if (!selectedClient) {
        $("complianceFormError").textContent = "Select a client.";
        return;
      }
      if (complianceType === "Running Compliance" && (!nextComplianceDate || nextComplianceDate <= dueDate)) {
        $("complianceFormError").textContent = "Next Compliance date must be later than the due date.";
        return;
      }

      const saveButton = $("saveCompliance");
      saveButton.disabled = true;
      saveButton.textContent = "Saving…";
      const timestamp = serverTimestamp();
      const record = {
        clientName: selectedClient.clientName || "",
        clientId: selectedClient.clientId || selectedClient.id,
        complianceId: $("complianceIdInput").value.trim(),
        complianceName: $("complianceNameInput").value.trim(),
        complianceAknNumber: $("complianceAknInput").value.trim(),
        CompliancePeriod: $("compliancePeriodInput").value.trim(),
        dueDate,
        complianceType,
        nextComplianceDate: complianceType === "Running Compliance" ? nextComplianceDate : "",
        priority: $("compliancePriority").value,
        taskFolderLink: $("complianceFolder").value.trim()
      };

      try {
        if (editingComplianceId) {
          const existing = allRecords.find(item => item.firestoreDocId === editingComplianceId);
          await updateDoc(doc(db, "compliance", editingComplianceId), {
            ...record,
            complianceStatus: existing?.complianceStatus || "pending",
            filedAt: existing?.filedAt ?? null,
            paymentStatus: existing?.paymentStatus || "pending",
            updatedAt: timestamp
          });
          closeComplianceForm();
          await loadComplianceRegister();
          showToast("Compliance updated.");
        } else {
          const batch = writeBatch(db);
          batch.set(doc(collection(db, "compliance")), {
            ...record,
            complianceStatus: "pending",
            filedAt: null,
            paymentStatus: "pending",
            createdAt: timestamp,
            updatedAt: timestamp
          });
          if (complianceType === "Running Compliance") {
            batch.set(doc(collection(db, "compliance")), {
              ...record,
              dueDate: nextComplianceDate,
              nextComplianceDate: "",
              complianceStatus: "pending",
              filedAt: null,
              paymentStatus: "pending",
              createdAt: timestamp,
              updatedAt: timestamp
            });
          }
          await batch.commit();
          closeComplianceForm();
          await loadComplianceRegister();
          showToast(complianceType === "Running Compliance" ? "Compliance and next pending copy created." : "Compliance created.");
        }
      } catch (error) {
        console.error("Could not save compliance:", error);
        $("complianceFormError").textContent = `Could not save compliance (${error.code || "error"}). Check Firestore permissions and try again.`;
      } finally {
        saveButton.disabled = false;
        saveButton.innerHTML = editingComplianceId ? '<i data-lucide="save" aria-hidden="true"></i>Update Compliance' : '<i data-lucide="save" aria-hidden="true"></i>Save Compliance';
        if (window.lucide) window.lucide.createIcons();
      }
    }

    enhanceSearchableSelect($("clientFilter"));
    enhanceSearchableSelect($("complianceClient"));
    document.querySelectorAll("[data-filter-panel]").forEach(panel => { panel.hidden = !panel.classList.contains("active"); });
    document.addEventListener("click",e=>{if(e.target.closest("[data-signout]"))signOut(auth)});window.addEventListener("corebiq:signout-request",()=>signOut(auth));
    $("filterToggle").addEventListener("click", () => {
      const isOpening = $("complianceFilterPopover").hidden;
      $("complianceFilterPopover").hidden = !isOpening;
      $("filterToggle").setAttribute("aria-expanded", String(isOpening));
      if (isOpening) showFilterPanel(document.querySelector("[data-filter-category].active")?.dataset.filterCategory || "view");
    });
    $("clearComplianceFilters").addEventListener("click", () => {
      ["clientFilter", "dateFromFilter", "dateToFilter", "periodFilter", "complianceNameFilter", "statusFilter", "paymentFilter", "priorityFilter"].forEach(id => { $(id).value = ""; });
      $("viewFilter").value = "outstanding";
      $("clientFilter").dispatchEvent(new Event("change", { bubbles: true }));
      currentPage = 1;
      showFilterPanel("view");
      render();
      closeFilterPopover();
    });
    document.querySelectorAll("[data-filter-category]").forEach(button => button.addEventListener("click", () => showFilterPanel(button.dataset.filterCategory)));
    document.addEventListener("pointerdown", event => {
      if (!event.target.closest(".crm-filter-wrap")) closeFilterPopover();
    });
    $("refreshButton").addEventListener("click", loadComplianceRegister);
    $("addComplianceButton").addEventListener("click", openComplianceForm);
    $("closeComplianceModal").addEventListener("click", closeComplianceForm);
    $("cancelComplianceForm").addEventListener("click", closeComplianceForm);
    $("complianceModal").addEventListener("click", event => { if (event.target === $("complianceModal")) closeComplianceForm(); });
    $("complianceForm").addEventListener("submit", saveCompliance);
    $("selectVisibleCompliance").addEventListener("change", () => {
      const shouldSelect = $("selectVisibleCompliance").checked;
      $("complianceRows").querySelectorAll("[data-select-compliance]").forEach(checkbox => {
        checkbox.checked = shouldSelect;
        if (shouldSelect) selectedComplianceIds.add(checkbox.dataset.selectCompliance);
        else selectedComplianceIds.delete(checkbox.dataset.selectCompliance);
      });
      render();
    });
    $("complianceRows").addEventListener("change", event => {
      const checkbox = event.target.closest("[data-select-compliance]");
      if (!checkbox) return;
      if (checkbox.checked) selectedComplianceIds.add(checkbox.dataset.selectCompliance);
      else selectedComplianceIds.delete(checkbox.dataset.selectCompliance);
      render();
    });
    $("complianceRows").addEventListener("click", event => {
      const toggle = event.target.closest("[data-row-menu-toggle]");
      if (toggle) {
        const menu = toggle.parentElement.querySelector(".crm-row-menu");
        const shouldOpen = menu.hidden;
        closeRowActionMenus();
        if (shouldOpen) {
          menu.hidden = false;
          const buttonRect = toggle.getBoundingClientRect();
          const menuRect = menu.getBoundingClientRect();
          const left = Math.max(14, Math.min(buttonRect.right - menuRect.width, window.innerWidth - menuRect.width - 14));
          const top = buttonRect.bottom + menuRect.height + 8 <= window.innerHeight
            ? buttonRect.bottom + 4
            : Math.max(8, buttonRect.top - menuRect.height - 4);
          menu.style.left = `${left}px`;
          menu.style.top = `${top}px`;
          toggle.setAttribute("aria-expanded", "true");
        }
        return;
      }
      const editButton = event.target.closest("[data-edit-compliance]");
      if (editButton) {
        closeRowActionMenus();
        openEditComplianceForm(editButton.dataset.editCompliance);
      }
    });
    document.addEventListener("pointerdown", event => {
      if (!event.target.closest(".crm-row-menu-wrap")) closeRowActionMenus();
    });
    $("bulkActionsToggle").addEventListener("click", () => {
      $("bulkActionsMenu").hidden = !$("bulkActionsMenu").hidden;
      $("bulkActionsToggle").setAttribute("aria-expanded", String(!$("bulkActionsMenu").hidden));
    });
    $("deleteSelected").addEventListener("click", deleteSelectedCompliance);
    $("copySelected").addEventListener("click", openCopyDateModal);
    $("copyDateForm").addEventListener("submit", copySelectedCompliance);
    $("copyDateModal").addEventListener("click", event => { if (event.target === $("copyDateModal")) closeCopyDateModal(); });
    document.querySelectorAll("[data-close-copy]").forEach(button => button.addEventListener("click", closeCopyDateModal));
    document.addEventListener("pointerdown", event => { if (!event.target.closest("#bulkActionsMenu, #bulkActionsToggle, .crm-add-wrap")) closeBulkActions(); });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      closeBulkActions();
      closeRowActionMenus();
      closeFilterPopover();
      if (!$ ("copyDateModal").hidden) closeCopyDateModal();
    });
    document.querySelectorAll('input[name="complianceType"]').forEach(input => input.addEventListener("change", updateComplianceType));
    $("complianceDueDate").addEventListener("change", () => { $("nextComplianceDate").min = $("complianceDueDate").value; });
    ["searchInput","statusFilter","clientFilter","periodFilter","paymentFilter","viewFilter","dateFromFilter","dateToFilter","complianceNameFilter","priorityFilter"].forEach(id => $(id).addEventListener(id === "searchInput" ? "input" : "change", () => { currentPage = 1; render(); }));
    $("compliancePagination").addEventListener("click", event => {
      const button = event.target.closest("button[data-page]");
      if (!button) return;
      currentPage += Number(button.dataset.page);
      render();
    });
    $("complianceRows").closest("table").addEventListener("click", event => {
      const button = event.target.closest("[data-sort-key]");
      if (!button) return;
      const key = button.dataset.sortKey;
      sortDirection = sortColumn === key ? -sortDirection : 1;
      sortColumn = key;
      currentPage = 1;
      render();
    });

    onAuthStateChanged(auth, async (user) => {
      if (!user || normalize(user.email) !== ALLOWED_ADMIN_EMAIL) {
        if (user) await signOut(auth);
        const next = encodeURIComponent(location.pathname.replace(/^\//, "") + location.search + location.hash);
        location.replace(new URL(`auth/login.html?next=${next}`, document.baseURI).href);
        return;
      }
      $("app").classList.remove("hiddenx");
      requestAnimationFrame(revealActiveModuleTab);
      await loadComplianceRegister();
      if (location.hash === "#add") openComplianceForm();
    });
