"use strict";

(async function () {
  I18n.applyI18n(document);

  const tbody = document.querySelector("#rules-table tbody");
  const empty = document.getElementById("empty");
  const status = document.getElementById("status");
  const defaultSelect = document.getElementById("default-container");
  const enabledToggle = document.getElementById("global-enabled");
  const exportBtn = document.getElementById("export-rules");
  const importBtn = document.getElementById("import-rules");
  const importFile = document.getElementById("import-file");
  const undoToast = document.getElementById("undo-toast");
  const undoText = document.getElementById("undo-text");
  const undoBtn = document.getElementById("undo-btn");

  // Hex equivalents of Firefox container palette names. Used to tint each
  // option in the dropdown so the closed select also shows the chosen color.
  const COLOR_HEX = {
    blue:      "#37adff",
    turquoise: "#00c79a",
    green:     "#51cd00",
    yellow:    "#ffcb00",
    orange:    "#ff9f00",
    red:       "#ff613d",
    pink:      "#ff4bda",
    purple:    "#af51f5",
    toolbar:   "#7f7f7f",
  };
  const COLORS = ["blue", "turquoise", "green", "yellow", "orange", "red", "pink", "purple"];
  const NEW_OPT = "__new__";

  let { rules, defaultContainer, enabled } = await Storage.loadAll();
  let containers = await Containers_safeList();
  let lastSavedJSON = JSON.stringify(rules);
  let lastSavedDefault = defaultContainer;
  let lastSavedEnabled = enabled;

  // --- Listeners that ignore self-writes -----------------------------
  Storage.onRulesChanged((next) => {
    const nextJSON = JSON.stringify(next);
    if (nextJSON === lastSavedJSON) return;
    lastSavedJSON = nextJSON;
    rules = next;
    render();
  });

  Storage.onDefaultContainerChanged((next) => {
    if (next === lastSavedDefault) return;
    lastSavedDefault = next;
    defaultContainer = next;
    renderDefault();
  });

  Storage.onEnabledChanged((next) => {
    if (next === lastSavedEnabled) return;
    lastSavedEnabled = next;
    enabled = next;
    enabledToggle.checked = enabled;
  });

  // --- Top-level controls --------------------------------------------
  enabledToggle.checked = enabled;
  enabledToggle.addEventListener("change", async () => {
    enabled = enabledToggle.checked;
    lastSavedEnabled = enabled;
    await Storage.saveEnabled(enabled);
    flashStatus(I18n.t("saved"));
  });

  defaultSelect.addEventListener("change", onDefaultChange);

  exportBtn.addEventListener("click", onExport);
  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", onImport);

  undoBtn.addEventListener("click", () => {
    if (pendingUndo) restoreUndo();
  });

  document.getElementById("add-rule").addEventListener("click", () => {
    // Build via normalizeRule so the in-memory rule has the same property
    // order as what Storage.onRulesChanged delivers; otherwise our
    // lastSavedJSON guard misfires and re-renders the textarea on every
    // self-save, eating trailing newlines and breaking multi-line input.
    rules.push(Storage.normalizeRule({
      id: Storage.newId(),
      type: "domain",
      patterns: [],
      container: "",
      enabled: true,
    }));
    render();
    persist();
    focusLastPattern();
  });

  tbody.addEventListener("click", onTableClick);
  tbody.addEventListener("change", onTableChange);
  tbody.addEventListener("input", onTableInput);
  tbody.addEventListener("mousedown", onHandleMouseDown);
  tbody.addEventListener("dragstart", onDragStart);
  tbody.addEventListener("dragover", onDragOver);
  tbody.addEventListener("dragleave", onDragLeave);
  tbody.addEventListener("drop", onDrop);
  tbody.addEventListener("dragend", onDragEnd);
  window.addEventListener("mouseup", clearDraggable);

  for (const evt of ["onCreated", "onRemoved", "onUpdated"]) {
    if (browser.contextualIdentities[evt]) {
      browser.contextualIdentities[evt].addListener(refreshContainers);
    }
  }

  render();
  renderDefault();

  // --- Render --------------------------------------------------------

  function render() {
    tbody.innerHTML = "";
    rules.forEach((rule, i) => tbody.appendChild(renderRow(rule, i)));
    empty.hidden = rules.length > 0;
    tbody.querySelectorAll("textarea.pattern").forEach(autoResize);
  }

  function autoResize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
  }

  function renderDefault() {
    populateContainerSelect(defaultSelect, defaultContainer, { allowEmpty: true });
  }

  function renderRow(rule, i) {
    const tr = document.createElement("tr");
    tr.dataset.idx = String(i);
    tr.draggable = false;

    const handleCell = el("td", { className: "col-handle" });
    const handle = el("span", { className: "handle" });
    handle.title = I18n.t("dragHandle");
    handle.textContent = "⋮⋮";
    handleCell.appendChild(handle);

    const enabledBox = el("input", { type: "checkbox", className: "enabled" });
    enabledBox.checked = rule.enabled !== false;

    const type = el("select", { className: "type" });
    for (const t of ["domain", "path", "regex"]) {
      const opt = el("option", { value: t, textContent: t });
      if (rule.type === t) opt.selected = true;
      type.appendChild(opt);
    }

    const pattern = document.createElement("textarea");
    pattern.className = "pattern";
    pattern.value = (rule.patterns || []).join("\n");
    pattern.placeholder = placeholderFor(rule.type);
    pattern.spellcheck = false;
    pattern.rows = Math.max(1, (rule.patterns || []).length);
    if (hasBadPattern(rule)) pattern.classList.add("invalid");

    const container = document.createElement("select");
    container.className = "container";
    populateContainerSelect(container, rule.container);

    const actions = el("td", { className: "col-actions" });
    const del = iconBtn("delete", "✕");
    del.title = I18n.t("delete");
    del.classList.add("danger");
    actions.appendChild(del);

    tr.appendChild(handleCell);
    tr.appendChild(td(enabledBox, "col-enabled"));
    tr.appendChild(td(type, "col-type"));
    tr.appendChild(td(pattern, "col-pattern"));
    tr.appendChild(td(container, "col-container"));
    tr.appendChild(actions);
    return tr;
  }

  function placeholderFor(type) {
    if (type === "domain") return I18n.t("patternPhDomain");
    if (type === "path") return I18n.t("patternPhPath");
    if (type === "regex") return I18n.t("patternPhRegex");
    return "";
  }

  function populateContainerSelect(select, currentValue, opts) {
    const allowEmpty = !!(opts && opts.allowEmpty);
    select.innerHTML = "";

    const first = document.createElement("option");
    first.value = "";
    if (allowEmpty) {
      first.textContent = I18n.t("noContainer");
    } else {
      first.textContent = I18n.t("selectContainer");
      first.disabled = true;
    }
    if (!currentValue) first.selected = true;
    select.appendChild(first);

    let matched = false;
    for (const c of containers) {
      const opt = document.createElement("option");
      opt.value = c.name;
      opt.textContent = `● ${c.name}`;
      opt.style.color = COLOR_HEX[c.color] || "inherit";
      if (c.name === currentValue) {
        opt.selected = true;
        matched = true;
      }
      select.appendChild(opt);
    }

    if (currentValue && !matched) {
      const opt = document.createElement("option");
      opt.value = currentValue;
      opt.textContent = I18n.t("containerDeleted", currentValue);
      opt.selected = true;
      select.appendChild(opt);
    }

    const sep = document.createElement("option");
    sep.disabled = true;
    sep.textContent = "──────────";
    select.appendChild(sep);

    const create = document.createElement("option");
    create.value = NEW_OPT;
    create.textContent = I18n.t("newContainer");
    select.appendChild(create);
  }

  async function refreshContainers() {
    containers = await Containers_safeList();
    render();
    renderDefault();
  }

  async function handleNewContainer(select, fallbackValue) {
    select.value = fallbackValue || "";
    const name = (window.prompt(I18n.t("newContainerPrompt")) || "").trim();
    if (!name) return null;
    try {
      const existing = containers.find((c) => c.name === name);
      const created = existing || await browser.contextualIdentities.create({
        name,
        color: COLORS[Math.abs(hashString(name)) % COLORS.length],
        icon: "fingerprint",
      });
      containers = await Containers_safeList();
      return created.name;
    } catch (err) {
      window.alert(I18n.t("createContainerFail", (err && err.message) || String(err)));
      return null;
    }
  }

  // --- Export / Import -----------------------------------------------
  async function onExport() {
    const config = await Storage.loadAll();
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = `container-switcher-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(u);
  }

  async function onImport() {
    const file = importFile.files[0];
    importFile.value = "";
    if (!file) return;
    let parsed;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch (_) {
      window.alert(I18n.t("importInvalid"));
      return;
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rules)) {
      window.alert(I18n.t("importInvalid"));
      return;
    }
    if (!window.confirm(I18n.t("importConfirm"))) return;

    rules = parsed.rules.map(Storage.normalizeRule).filter(Boolean);
    defaultContainer = typeof parsed.defaultContainer === "string" ? parsed.defaultContainer : "";
    enabled = parsed.enabled !== false;

    lastSavedJSON = JSON.stringify(rules);
    lastSavedDefault = defaultContainer;
    lastSavedEnabled = enabled;

    await Storage.saveAll({ rules, defaultContainer, enabled });
    enabledToggle.checked = enabled;
    render();
    renderDefault();
    flashStatus(I18n.t("saved"));
  }

  // --- Click / Change / Input handlers -------------------------------
  function onTableClick(e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    const idx = rowIndex(btn);
    if (idx < 0) return;
    if (btn.classList.contains("delete")) {
      deleteRule(idx);
      return;
    }
  }

  // --- Drag & drop ---------------------------------------------------
  let dragSrcIdx = null;

  function onHandleMouseDown(e) {
    if (e.button !== 0) return;
    const handle = e.target.closest(".handle");
    if (!handle) return;
    const tr = handle.closest("tr");
    if (tr) tr.draggable = true;
  }

  function clearDraggable() {
    tbody.querySelectorAll('tr[draggable="true"]').forEach((tr) => {
      tr.draggable = false;
    });
  }

  function onDragStart(e) {
    const tr = e.target.closest("tr");
    if (!tr || tr.parentElement !== tbody) return;
    dragSrcIdx = Number(tr.dataset.idx);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(dragSrcIdx)); } catch (_) {}
    setTimeout(() => tr.classList.add("drag-source"), 0);
  }

  function onDragOver(e) {
    if (dragSrcIdx === null) return;
    const tr = e.target.closest("tr");
    if (!tr || tr.parentElement !== tbody) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    clearDropIndicators();
    if (Number(tr.dataset.idx) === dragSrcIdx) return;

    const rect = tr.getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    tr.classList.add(above ? "drop-above" : "drop-below");
  }

  function onDragLeave(e) {
    if (!e.relatedTarget || !tbody.contains(e.relatedTarget)) {
      clearDropIndicators();
    }
  }

  function onDrop(e) {
    if (dragSrcIdx === null) return;
    const tr = e.target.closest("tr");
    if (!tr || tr.parentElement !== tbody) return;
    e.preventDefault();

    const tgtIdx = Number(tr.dataset.idx);
    const above = tr.classList.contains("drop-above");
    let insertAt = above ? tgtIdx : tgtIdx + 1;

    if (insertAt === dragSrcIdx || insertAt === dragSrcIdx + 1) {
      onDragEnd();
      return;
    }

    const [moved] = rules.splice(dragSrcIdx, 1);
    if (dragSrcIdx < insertAt) insertAt--;
    rules.splice(insertAt, 0, moved);

    dragSrcIdx = null;
    render();
    persist();
  }

  function onDragEnd() {
    clearDropIndicators();
    tbody.querySelectorAll(".drag-source").forEach((r) => r.classList.remove("drag-source"));
    clearDraggable();
    dragSrcIdx = null;
  }

  function clearDropIndicators() {
    tbody.querySelectorAll(".drop-above, .drop-below").forEach((r) => {
      r.classList.remove("drop-above", "drop-below");
    });
  }

  async function onTableChange(e) {
    const idx = rowIndex(e.target);
    if (idx < 0) return;
    const rule = rules[idx];
    if (e.target.classList.contains("enabled")) {
      rule.enabled = e.target.checked;
      persist();
    } else if (e.target.classList.contains("type")) {
      rule.type = e.target.value;
      render();
      persist();
    } else if (e.target.classList.contains("container")) {
      await onContainerSelect(rule, e.target);
    }
  }

  function onTableInput(e) {
    const idx = rowIndex(e.target);
    if (idx < 0) return;
    const rule = rules[idx];
    if (e.target.classList.contains("pattern")) {
      rule.patterns = parsePatterns(e.target.value);
      autoResize(e.target);
      e.target.classList.toggle("invalid", hasBadPattern(rule));
    } else {
      return;
    }
    persistDebounced();
  }

  function parsePatterns(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }

  function hasBadPattern(rule) {
    return (rule.patterns || []).some((p) => !Matcher.isValidPattern(rule.type, p));
  }

  async function onContainerSelect(rule, select) {
    const value = select.value;
    if (value !== NEW_OPT) {
      rule.container = value;
      persist();
      return;
    }
    const newName = await handleNewContainer(select, rule.container);
    if (!newName) return;
    rule.container = newName;
    render();
    renderDefault();
    persist();
  }

  async function onDefaultChange(e) {
    const value = e.target.value;
    if (value !== NEW_OPT) {
      defaultContainer = value;
      lastSavedDefault = value;
      await Storage.saveDefaultContainer(value);
      flashStatus(I18n.t("saved"));
      return;
    }
    const newName = await handleNewContainer(e.target, defaultContainer);
    if (!newName) return;
    defaultContainer = newName;
    lastSavedDefault = newName;
    render();
    renderDefault();
    await Storage.saveDefaultContainer(newName);
    flashStatus(I18n.t("saved"));
  }

  // --- Delete + undo -------------------------------------------------
  let pendingUndo = null;
  let undoTimer = null;

  function deleteRule(idx) {
    const removed = rules[idx];
    rules.splice(idx, 1);
    pendingUndo = { rule: removed, idx };
    undoText.textContent = I18n.t("ruleDeleted");
    undoToast.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(dismissUndo, 5000);
    render();
    persist();
  }

  function restoreUndo() {
    if (!pendingUndo) return;
    const { rule, idx } = pendingUndo;
    rules.splice(Math.min(idx, rules.length), 0, rule);
    pendingUndo = null;
    clearTimeout(undoTimer);
    undoToast.hidden = true;
    render();
    persist();
  }

  function dismissUndo() {
    pendingUndo = null;
    undoToast.hidden = true;
  }

  // --- Helpers -------------------------------------------------------
  function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  function rowIndex(node) {
    const tr = node.closest("tr");
    return tr ? Number(tr.dataset.idx) : -1;
  }

  function focusLastPattern() {
    const inputs = tbody.querySelectorAll("textarea.pattern");
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
  }

  let saveTimer = null;
  function persistDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 250);
  }

  async function persist() {
    clearTimeout(saveTimer);
    lastSavedJSON = JSON.stringify(rules);
    await Storage.saveRules(rules);
    flashStatus(I18n.t("saved"));
  }

  let statusTimer = null;
  function flashStatus(text) {
    status.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ""; }, 1200);
  }

  function el(tag, props) {
    const e = document.createElement(tag);
    if (!props) return e;
    for (const k in props) {
      if (k === "className") e.className = props[k];
      else if (k === "textContent") e.textContent = props[k];
      else e.setAttribute(k, props[k]);
    }
    return e;
  }

  function td(child, cls) {
    const t = document.createElement("td");
    if (cls) t.className = cls;
    t.appendChild(child);
    return t;
  }

  function iconBtn(cls, label) {
    const b = el("button", { className: `icon ${cls}`, type: "button" });
    b.textContent = label;
    return b;
  }

  async function Containers_safeList() {
    try { return await browser.contextualIdentities.query({}); }
    catch (_) { return []; }
  }
})();
