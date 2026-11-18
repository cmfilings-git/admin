import { initializeDatePickers, refreshDatePicker } from "../../js/date-picker.js";

    const initializeSamplePage = () => {
      document.body.classList.add("sample-component-page");
      initializeDatePickers(document);

      const form = document.getElementById("complianceForm");
      const modal = document.getElementById("complianceModal");
      const periodField = document.getElementById("compliancePeriodField");
      const periodSelect = document.getElementById("compliancePeriodInput");
      const frequencySelect = document.getElementById("complianceFrequencyInput");
      const scheduleInputs = document.querySelectorAll('input[name="complianceType"]');
      const clientSelect = document.getElementById("complianceClient");
      const pageName = decodeURIComponent(window.location.pathname.split("/").pop() || "").replace(/\.html$/i, "");
      const sampleFormPrefix = pageName.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase() || "COM";
      const sampleFormYear = String(new Date().getFullYear()).slice(-2);
      const sampleRows = [...document.querySelectorAll(".crm-record-card tbody tr")];
      const sampleFormId = index => `${sampleFormPrefix}-${sampleFormYear}${String(index + 1).padStart(5, "0")}`;
      sampleRows.forEach((row, index) => {
        row.querySelector(".sample-form-id").textContent = sampleFormId(index);
      });

      const enhanceSampleClientSearch = () => {
        const clients = [
          { id: "C40218", name: "Aarav Mehta" },
          { id: "C40231", name: "Nisha Rao" },
          { id: "C40247", name: "Rohan Shah" }
        ];
        const wrapper = document.createElement("div");
        wrapper.className = "crm-search-select";
        clientSelect.parentNode.insertBefore(wrapper, clientSelect);
        wrapper.appendChild(clientSelect);
        const input = document.createElement("input");
        input.type = "search";
        input.className = "field crm-search-select-input";
        input.placeholder = "Type 3+ characters to search";
        input.autocomplete = "off";
        input.required = true;
        input.setAttribute("role", "combobox");
        input.setAttribute("aria-autocomplete", "list");
        input.setAttribute("aria-expanded", "false");
        input.setAttribute("aria-label", "Search clients");
        const list = document.createElement("div");
        list.className = "crm-search-select-list";
        list.hidden = true;
        list.setAttribute("role", "listbox");
        clientSelect.required = false;
        clientSelect.tabIndex = -1;
        clientSelect.setAttribute("aria-hidden", "true");
        clientSelect.classList.add("crm-search-select-native");
        wrapper.insertBefore(input, clientSelect);
        wrapper.appendChild(list);
        input.addEventListener("input", () => {
          clientSelect.value = "";
          input.setCustomValidity("Choose a matching client.");
          list.replaceChildren();
          const search = input.value.trim().toLocaleLowerCase();
          if (search.length < 3) {
            list.hidden = true;
            input.setAttribute("aria-expanded", "false");
            return;
          }
          const matches = clients.filter(client => `${client.name} ${client.id}`.toLocaleLowerCase().includes(search));
          if (!matches.length) {
            const empty = document.createElement("div");
            empty.className = "crm-search-select-empty";
            empty.textContent = "No matching clients";
            list.appendChild(empty);
          }
          matches.forEach(client => {
            const option = document.createElement("button");
            option.type = "button";
            option.className = "crm-search-select-option";
            option.setAttribute("role", "option");
            option.textContent = `${client.name} · ${client.id}`;
            option.addEventListener("click", () => {
              clientSelect.replaceChildren(new Option("Select a client", ""), new Option(option.textContent, client.id));
              clientSelect.value = client.id;
              input.value = option.textContent;
              input.setCustomValidity("");
              list.hidden = true;
              input.setAttribute("aria-expanded", "false");
            });
            list.appendChild(option);
          });
          list.hidden = false;
          input.setAttribute("aria-expanded", "true");
        });
        document.addEventListener("pointerdown", event => {
          if (!wrapper.contains(event.target)) {
            list.hidden = true;
            input.setAttribute("aria-expanded", "false");
          }
        });
      };

      const fiscalYearStart = date => date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
      const periodsFor = frequency => {
        const startYear = fiscalYearStart(new Date());
        const periods = [];
        for (let year = startYear - 1; year <= startYear + 1; year += 1) {
          const financialYear = `${year}-${String(year + 1).slice(-2)}`;
          if (frequency === "Monthly") {
            for (let month = 0; month < 12; month += 1) {
              const value = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date(year, month + 3, 1));
              periods.push([value, value]);
            }
          } else if (frequency === "Quarterly") {
            for (let quarter = 1; quarter <= 4; quarter += 1) {
              const value = `Q${quarter} FY ${financialYear}`;
              periods.push([value, value]);
            }
          } else if (frequency === "Yearly") {
            const value = `FY ${financialYear}`;
            periods.push([value, value]);
          }
        }
        return periods;
      };
      const updatePeriods = () => {
        const frequency = frequencySelect.value;
        const current = periodSelect.value;
        periodSelect.replaceChildren(new Option("Select period", ""));
        periodsFor(frequency).forEach(([value, label]) => periodSelect.add(new Option(label, value)));
        periodSelect.value = current;
        periodField.classList.toggle("hidden", !frequency);
        periodSelect.required = Boolean(frequency);
      };
      const updateSchedule = () => {
        const running = document.querySelector('input[name="complianceType"]:checked')?.value === "Running Compliance";
        const nextDateField = document.getElementById("nextComplianceDateField");
        const nextDateInput = document.getElementById("nextComplianceDate");
        nextDateField.classList.toggle("hidden", !running);
        document.getElementById("nextComplianceDateDisplay").required = running;
        refreshDatePicker(nextDateInput);
      };
      const clearClientSearch = () => {
        const searchInput = document.querySelector(".crm-search-select-input");
        const list = document.querySelector(".crm-search-select-list");
        searchInput.value = "";
        searchInput.setCustomValidity("");
        searchInput.setAttribute("aria-expanded", "false");
        list.replaceChildren();
        list.hidden = true;
        clientSelect.replaceChildren(new Option("Select a client", ""));
      };
      const setFormHeading = (title, description) => {
        document.getElementById("complianceModalTitle").textContent = title;
        document.querySelector(".compliance-modal-sticky-header p").textContent = description;
      };
      const openSampleComplianceForm = row => {
        form.reset();
        clearClientSearch();
        document.getElementById("complianceFormError").textContent = "";
        document.getElementById("saveCompliance").disabled = false;

        if (row) {
          const clientName = row.cells[3].querySelector(".crm-compliance-client-name").textContent.trim();
          const clientId = row.cells[3].querySelector(".crm-compliance-client-id").textContent.trim();
          const clientOption = new Option(`${clientName} · ${clientId}`, clientId);
          clientSelect.add(clientOption);
          clientSelect.value = clientId;
          const clientSearchInput = document.querySelector(".crm-search-select-input");
          clientSearchInput.value = clientOption.text;
          document.getElementById("complianceIdInput").value = row.cells[1].textContent.trim();
          document.getElementById("complianceNameInput").value = row.cells[2].querySelector(".crm-compliance-name").textContent.trim();
          frequencySelect.value = row.cells[4].textContent.trim();
          updatePeriods();
          periodSelect.value = row.cells[5].textContent.trim();
          document.getElementById("complianceDueDate").value = row.dataset.dueDate;
          const schedule = row.cells[7].textContent.trim() === "Running" ? "Running Compliance" : "Onetime";
          scheduleInputs.forEach(input => { input.checked = input.value === schedule; });
          document.getElementById("nextComplianceDate").value = row.dataset.nextDate;
          document.getElementById("compliancePriority").value = row.cells[10].textContent.trim();
          setFormHeading("Edit Sample Compliance", "Sample changes are for preview only and will not be saved.");
        } else {
          frequencySelect.required = true;
          document.getElementById("complianceIdInput").value = sampleFormId(sampleRows.length);
          document.getElementById("complianceDueDate").value = "";
          document.getElementById("nextComplianceDate").value = "";
          updatePeriods();
          setFormHeading("Add Compliance", "New records start with filing and payment status pending.");
        }

        updateSchedule();
        const dueDateInput = document.getElementById("complianceDueDate");
        const nextDateInput = document.getElementById("nextComplianceDate");
        nextDateInput.min = dueDateInput.value;
        refreshDatePicker(dueDateInput);
        refreshDatePicker(nextDateInput);
        modal.classList.remove("hidden");
        document.body.style.overflow = "hidden";
        if (window.lucide) window.lucide.createIcons();
      };
      const closeForm = () => {
        modal.classList.add("hidden");
        form.reset();
        clearClientSearch();
        periodField.classList.add("hidden");
        periodSelect.required = false;
        document.getElementById("nextComplianceDate").min = "";
        setFormHeading("Add Compliance", "New records start with filing and payment status pending.");
        updateSchedule();
        document.body.style.overflow = "";
      };
      let sampleToastTimer;
      const showSampleToast = message => {
        const toast = document.getElementById("sample-toast");
        toast.textContent = message;
        toast.classList.remove("hiddenx");
        window.clearTimeout(sampleToastTimer);
        sampleToastTimer = window.setTimeout(() => toast.classList.add("hiddenx"), 2500);
      };

      document.getElementById("app").classList.remove("hiddenx");
      document.querySelectorAll("[data-filter-panel]").forEach(panel => {
        panel.hidden = !panel.classList.contains("active");
      });
      document.getElementById("sampleComplianceRecordCount").textContent = "2 sample records";
      enhanceSampleClientSearch();
      document.addEventListener("click", event => {
        const addButton = event.target instanceof Element
          ? event.target.closest(".kpi-hero-submodule-page [data-modulepage-add]")
          : null;
        if (addButton) openSampleComplianceForm();
      });
      document.getElementById("closeComplianceModal").addEventListener("click", closeForm);
      document.getElementById("cancelComplianceForm").addEventListener("click", closeForm);
      modal.addEventListener("click", event => { if (event.target === modal) closeForm(); });
      frequencySelect.addEventListener("change", updatePeriods);
      scheduleInputs.forEach(input => input.addEventListener("change", updateSchedule));
      document.getElementById("complianceDueDate").addEventListener("change", event => {
        const nextDateInput = document.getElementById("nextComplianceDate");
        nextDateInput.min = event.target.value;
        refreshDatePicker(nextDateInput);
        document.getElementById("complianceFormError").textContent = "";
      });
      document.getElementById("nextComplianceDate").addEventListener("change", () => {
        document.getElementById("complianceFormError").textContent = "";
      });
      form.addEventListener("submit", event => {
        event.preventDefault();
        const dueDateInput = document.getElementById("complianceDueDate");
        const nextDateInput = document.getElementById("nextComplianceDate");
        const running = document.querySelector('input[name="complianceType"]:checked')?.value === "Running Compliance";
        const missingDate = !dueDateInput.value
          ? { display: document.getElementById("complianceDueDateDisplay"), label: "due" }
          : running && !nextDateInput.value
            ? { display: document.getElementById("nextComplianceDateDisplay"), label: "next compliance" }
            : null;
        if (missingDate) {
          document.getElementById("complianceFormError").textContent = `Choose a ${missingDate.label} date.`;
          missingDate.display.focus();
          return;
        }
        document.getElementById("complianceFormError").textContent = "Sample only — this page does not save data.";
      });
      document.getElementById("sampleComplianceSearch").addEventListener("input", event => {
        const search = event.target.value.trim().toLocaleLowerCase();
        let visible = 0;
        document.querySelectorAll(".crm-record-card tbody tr").forEach(row => {
          const searchableRow = row.cloneNode(true);
          searchableRow.querySelectorAll(".crm-row-menu-wrap").forEach(menu => menu.remove());
          const matches = searchableRow.textContent.toLocaleLowerCase().includes(search);
          row.hidden = !matches;
          if (matches) visible += 1;
        });
        document.getElementById("sampleComplianceRecordCount").textContent = `${visible} sample records`;
      });
      const sampleTable = document.querySelector(".sample-saved-forms-table");
      const selectAllRecords = sampleTable.querySelector('thead input[type="checkbox"]');
      const updateSampleSelection = () => {
        const selected = sampleRows.filter(row => row.querySelector('input[type="checkbox"]')?.checked);
        const visibleChecks = sampleRows
          .filter(row => !row.hidden)
          .map(row => row.querySelector('input[type="checkbox"]'));
        const visibleSelected = visibleChecks.filter(checkbox => checkbox.checked).length;
        selectAllRecords.checked = visibleChecks.length > 0 && visibleSelected === visibleChecks.length;
        selectAllRecords.indeterminate = visibleSelected > 0 && visibleSelected < visibleChecks.length;
        document.getElementById("sampleComplianceSelectedCount").textContent = `${selected.length} selected`;
      };
      sampleTable.addEventListener("change", event => {
        const checkbox = event.target;
        if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== "checkbox") return;
        if (checkbox === selectAllRecords) {
          sampleRows.filter(row => !row.hidden).forEach(row => {
            row.querySelector('input[type="checkbox"]').checked = checkbox.checked;
          });
        }
        updateSampleSelection();
      });
      document.getElementById("sampleComplianceSearch").addEventListener("input", updateSampleSelection);
      updateSampleSelection();
      const closeSampleRowMenus = restoreFocus => {
        sampleTable.querySelectorAll(".crm-row-menu:not([hidden])").forEach(menu => {
          menu.hidden = true;
          const toggle = menu.parentElement.querySelector("[data-sample-row-menu-toggle]");
          toggle.setAttribute("aria-expanded", "false");
          if (restoreFocus) toggle.focus();
        });
      };
      sampleTable.addEventListener("click", async event => {
        const toggle = event.target.closest("[data-sample-row-menu-toggle]");
        if (toggle) {
          const menu = toggle.parentElement.querySelector(".crm-row-menu");
          const shouldOpen = menu.hidden;
          closeSampleRowMenus(false);
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

        const action = event.target.closest("[data-sample-row-action]");
        if (!action) return;
        const row = action.closest("tr");
        closeSampleRowMenus(false);
        if (action.dataset.sampleRowAction === "edit") {
          openSampleComplianceForm(row);
        } else if (action.dataset.sampleRowAction === "copy-id") {
          const id = row.cells[1].textContent.trim();
          try {
            if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
            await navigator.clipboard.writeText(id);
            showSampleToast(`${id} copied.`);
          } catch (error) {
            console.error("Could not copy sample compliance ID:", error);
            showSampleToast("Could not copy the ID. Please copy it manually.");
          }
        }
      });
      document.addEventListener("pointerdown", event => {
        if (!(event.target instanceof Element) || !event.target.closest(".sample-saved-forms .crm-row-menu-wrap")) closeSampleRowMenus(false);
      });
      document.querySelectorAll("[data-filter-category]").forEach(button => button.addEventListener("click", () => {
        const category = button.dataset.filterCategory;
        document.querySelectorAll("[data-filter-category]").forEach(item => item.classList.toggle("active", item === button));
        document.querySelectorAll("[data-filter-panel]").forEach(panel => {
          panel.hidden = panel.dataset.filterPanel !== category;
          panel.classList.toggle("active", panel.dataset.filterPanel === category);
        });
      }));
      document.querySelectorAll("[data-shared-date-picker]").forEach(input => input.addEventListener("change", () => refreshDatePicker(input)));
      document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        closeSampleRowMenus(true);
        if (!modal.classList.contains("hidden")) closeForm();
      });
      updatePeriods();
      updateSchedule();
      if (window.lucide) window.lucide.createIcons();
    };

    if (window.COREBIQ_COMPONENTS_LOADED) initializeSamplePage();
    else document.addEventListener("corebiq:components-loaded", initializeSamplePage, { once: true });
