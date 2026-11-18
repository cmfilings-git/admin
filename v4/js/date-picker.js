const datePickers = new WeakMap();
const openPickers = new Set();

function parseIsoDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
    ? date
    : null;
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(date, options = { day: "2-digit", month: "short", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-IN", options).format(date);
}

function dateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function datePickerTemplate() {
  const template = document.getElementById("sharedDatePickerTemplate");
  if (!(template instanceof HTMLTemplateElement)) {
    throw new Error("The shared date-picker template has not been loaded.");
  }
  return template;
}

function makeDatePicker(source) {
  const template = datePickerTemplate();
  const wrapper = document.createElement("div");
  wrapper.className = "shared-date-picker-input-wrap";
  wrapper.dataset.datePickerFor = source.id;
  source.parentNode.insertBefore(wrapper, source);

  const display = document.createElement("input");
  display.type = "text";
  display.id = `${source.id}Display`;
  display.className = `${[...source.classList].join(" ")} shared-date-picker-input`;
  display.placeholder = source.dataset.datePlaceholder || "Select date";
  display.readOnly = true;
  display.required = source.required;
  display.setAttribute("aria-haspopup", "dialog");
  display.setAttribute("aria-expanded", "false");
  display.setAttribute("aria-controls", `${source.id}Calendar`);
  display.setAttribute("aria-label", source.getAttribute("aria-label")
    || source.closest("label")?.querySelector(".label")?.textContent
    || source.closest("label")?.childNodes[0]?.textContent?.trim()
    || "Choose a date");
  display.autocomplete = "off";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "shared-date-picker-trigger";
  trigger.setAttribute("aria-label", "Open calendar");
  trigger.setAttribute("tabindex", "-1");
  trigger.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path></svg>';

  const popup = template.content.firstElementChild.cloneNode(true);
  popup.id = `${source.id}Calendar`;
  popup.dataset.open = "false";
  wrapper.append(display, trigger, popup);

  source.type = "hidden";
  source.required = false;
  source.tabIndex = -1;
  source.setAttribute("aria-hidden", "true");
  source.classList.add("shared-date-picker-native");

  const monthLabel = popup.querySelector("[data-date-month]");
  const daysGrid = popup.querySelector("[data-date-days]");
  const previousButton = popup.querySelector("[data-date-previous]");
  const nextButton = popup.querySelector("[data-date-next]");
  const minDate = () => parseIsoDate(source.min);
  const maxDate = () => parseIsoDate(source.max);
  let month = parseIsoDate(source.value) || dateOnly(new Date());

  const close = ({ restoreFocus = false } = {}) => {
    popup.dataset.open = "false";
    popup.setAttribute("aria-hidden", "true");
    display.setAttribute("aria-expanded", "false");
    openPickers.delete(api);
    if (restoreFocus) display.focus();
  };

  const position = () => {
    const anchor = display.getBoundingClientRect();
    const popupWidth = popup.offsetWidth || 304;
    const popupHeight = popup.offsetHeight || 330;
    const left = Math.max(12, Math.min(anchor.left, window.innerWidth - popupWidth - 12));
    const below = anchor.bottom + 8;
    const top = below + popupHeight <= window.innerHeight - 12
      ? below
      : Math.max(12, anchor.top - popupHeight - 8);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.transformOrigin = top < anchor.top ? "bottom left" : "top left";
  };

  const chooseDate = date => {
    source.value = toIsoDate(date);
    display.value = formatDate(date);
    display.setCustomValidity("");
    close();
    source.dispatchEvent(new Event("input", { bubbles: true }));
    source.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const render = () => {
    monthLabel.textContent = formatDate(month, { month: "long", year: "numeric" });
    daysGrid.replaceChildren();
    const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
    const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - firstOfMonth.getDay());
    const selected = source.value;
    const today = toIsoDate(dateOnly(new Date()));
    const minimum = minDate();
    const maximum = maxDate();

    for (let index = 0; index < 42; index += 1) {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const iso = toIsoDate(date);
      const dayButton = document.createElement("button");
      dayButton.type = "button";
      dayButton.textContent = String(date.getDate());
      dayButton.setAttribute("role", "gridcell");
      dayButton.setAttribute("aria-label", formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
      dayButton.setAttribute("aria-selected", String(iso === selected));
      if (date.getMonth() !== month.getMonth()) dayButton.classList.add("is-outside-month");
      if (iso === today) dayButton.classList.add("is-today");
      if (iso === selected) dayButton.classList.add("is-selected");
      dayButton.disabled = Boolean((minimum && dateOnly(date) < minimum) || (maximum && dateOnly(date) > maximum));
      dayButton.addEventListener("click", () => chooseDate(date));
      daysGrid.appendChild(dayButton);
    }

    const previousMonthEnd = new Date(month.getFullYear(), month.getMonth(), 0);
    const nextMonthStart = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    previousButton.disabled = Boolean(minimum && dateOnly(previousMonthEnd) < minimum);
    nextButton.disabled = Boolean(maximum && dateOnly(nextMonthStart) > maximum);
    const now = dateOnly(new Date());
    popup.querySelector("[data-date-today]").disabled = Boolean((minimum && now < minimum) || (maximum && now > maximum));
  };

  const open = () => {
    openPickers.forEach(picker => picker.close());
    month = parseIsoDate(source.value) || dateOnly(new Date());
    render();
    popup.dataset.open = "true";
    popup.setAttribute("aria-hidden", "false");
    display.setAttribute("aria-expanded", "true");
    openPickers.add(api);
    position();
  };

  const sync = () => {
    const date = parseIsoDate(source.value);
    display.value = date ? formatDate(date) : "";
    display.setCustomValidity(display.required && !date ? "Choose a date." : "");
    if (popup.dataset.open === "true") render();
  };

  const api = { close, sync };
  datePickers.set(source, api);
  sync();

  display.addEventListener("click", open);
  display.addEventListener("keydown", event => {
    if (event.key === "Escape" && popup.dataset.open === "true") {
      event.preventDefault();
      close({ restoreFocus: true });
    } else if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  trigger.addEventListener("click", () => {
    if (popup.dataset.open === "true") close();
    else open();
  });
  previousButton.addEventListener("click", () => {
    month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    render();
  });
  nextButton.addEventListener("click", () => {
    month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    render();
  });
  popup.querySelector("[data-date-clear]").addEventListener("click", () => {
    source.value = "";
    sync();
    close();
    source.dispatchEvent(new Event("input", { bubbles: true }));
    source.dispatchEvent(new Event("change", { bubbles: true }));
  });
  popup.querySelector("[data-date-today]").addEventListener("click", () => chooseDate(dateOnly(new Date())));
  popup.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
    }
  });
  source.addEventListener("change", sync);
  document.addEventListener("pointerdown", event => {
    if (!wrapper.contains(event.target) && popup.dataset.open === "true") close();
  });
  window.addEventListener("resize", () => {
    if (popup.dataset.open === "true") position();
  });
  window.addEventListener("scroll", () => {
    if (popup.dataset.open === "true") position();
  }, true);

  const form = source.closest("form");
  if (form && form.dataset.datePickerResetBound !== "true") {
    form.dataset.datePickerResetBound = "true";
    form.addEventListener("reset", () => window.setTimeout(() => {
      form.querySelectorAll("[data-date-picker-source]").forEach(input => {
        datePickers.get(input)?.close();
        refreshDatePicker(input);
      });
    }, 0));
  }
  source.dataset.datePickerSource = "true";
  return api;
}

export function initializeDatePickers(root = document) {
  const sources = [...root.querySelectorAll("[data-shared-date-picker]")];
  if (root instanceof HTMLInputElement && root.matches("[data-shared-date-picker]")) sources.unshift(root);
  sources.forEach(source => {
    if (!datePickers.has(source)) makeDatePicker(source);
  });
}

export function refreshDatePicker(inputOrId) {
  const input = typeof inputOrId === "string" ? document.getElementById(inputOrId) : inputOrId;
  if (input) datePickers.get(input)?.sync();
}
