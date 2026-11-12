export function enhanceSearchableSelect(select) {
  if (!select || select.dataset.searchableEnhanced) return null;

  select.dataset.searchableEnhanced = "true";
  const wrapper = document.createElement("div");
  wrapper.className = "crm-search-select";
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  const input = document.createElement("input");
  input.type = "search";
  input.className = `${select.className} crm-search-select-input`;
  input.placeholder = select.dataset.searchPlaceholder || "Search clients…";
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.required = select.required;

  const list = document.createElement("div");
  list.className = "crm-search-select-list";
  list.id = `crm-search-options-${Math.random().toString(36).slice(2)}`;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  input.setAttribute("aria-controls", list.id);

  select.required = false;
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.classList.add("crm-search-select-native");
  wrapper.insertBefore(input, select);
  wrapper.appendChild(list);

  function setExpanded(expanded) {
    list.hidden = !expanded;
    input.setAttribute("aria-expanded", String(expanded));
  }

  function syncFromSelect() {
    const option = select.selectedOptions[0];
    if (option?.value) input.value = option.textContent.trim();
    else if (document.activeElement !== input) input.value = "";
    input.setCustomValidity(input.required && !select.value ? "Choose a matching client." : "");
  }

  function renderOptions() {
    const search = input.value.trim().toLocaleLowerCase();
    const options = [...select.options].filter(option =>
      option.value && !option.disabled && option.textContent.toLocaleLowerCase().includes(search)
    );
    list.replaceChildren();
    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "crm-search-select-empty";
      empty.textContent = "No matching clients";
      list.appendChild(empty);
    } else {
      options.slice(0, 40).forEach(option => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "crm-search-select-option";
        button.setAttribute("role", "option");
        button.textContent = option.textContent.trim();
        button.addEventListener("click", () => {
          select.value = option.value;
          syncFromSelect();
          setExpanded(false);
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        list.appendChild(button);
      });
    }
    setExpanded(true);
  }

  input.addEventListener("focus", renderOptions);
  input.addEventListener("input", () => {
    select.value = "";
    input.setCustomValidity(input.required ? "Choose a matching client." : "");
    select.dispatchEvent(new Event("change", { bubbles: true }));
    renderOptions();
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") setExpanded(false);
    if (event.key === "ArrowDown" && list.hidden) renderOptions();
    if (event.key === "Enter" && !list.hidden) {
      const firstOption = list.querySelector("[role='option']");
      if (firstOption) {
        event.preventDefault();
        firstOption.click();
      }
    }
  });
  select.addEventListener("change", syncFromSelect);
  document.addEventListener("pointerdown", event => {
    if (!wrapper.contains(event.target)) setExpanded(false);
  });
  syncFromSelect();

  return { refresh: renderOptions, sync: syncFromSelect };
}

export function prepareLucideIconMarkers(selector) {
  document.querySelectorAll(selector).forEach(button => {
    button.querySelectorAll("svg").forEach(icon => icon.remove());
    if (!button.querySelector("i")) button.appendChild(document.createElement("i"));
  });
}