/* Konsum Tracker PWA (Netlify Sync + Auth Gate) */
(() => {
  // ---- Storage keys (keep same keys to avoid deleting existing data)
  const STORAGE_KEY = "konsumTracker.v1";              // entries array
  const AUTH_KEY    = "konsumTracker.auth.v1";         // { ok:1, vault:"<hex>" }
  const META_KEY    = "konsumTracker.meta.v1";         // { lastSyncAt, lastRemoteUpdatedAt }
  const DELETED_KEY = "konsumTracker.deleted.v1";      // { [id]: deleted_at }

  const GATE_PASSWORD = "PeachR"; // lightweight gate (not strong security)

  const SUBSTANCES = ["sativa","CBD","Keta","Xans","MDMA","2CB","Pilze","Alkohol"];
  const COLORS = {
    "sativa": "#5dd6ff",
    "CBD":    "#a07bff",
    "Keta":   "#ffb86b",
    "Xans":   "#6bff95",
    "MDMA":   "#ff6bd6",
    "2CB":    "#ffd86b",
    "Pilze":  "#6bd6ff",
    "Alkohol":"#ff8bd6"
  };

  // ---- DOM
  const form = document.getElementById("entryForm");
  const dtInput = document.getElementById("dtInput");
  const substanceInput = document.getElementById("substanceInput");
  const doseInput = document.getElementById("doseInput");

  const xansMedicalWrap = document.getElementById("xansMedicalWrap");
  const medicalToggle = document.getElementById("medicalToggle");

  const alcoholWrap = document.getElementById("alcoholWrap");
  const drinkList = document.getElementById("drinkList");
  const addDrinkBtn = document.getElementById("addDrinkBtn");
  const alcoholSummary = document.getElementById("alcoholSummary");

  // Verlauf
  const tbody = document.getElementById("tbody");
  const countInfo = document.getElementById("countInfo");
  const filterSubstance = document.getElementById("filterSubstance");
  const searchInput = document.getElementById("searchInput");
  const clearBtn = document.getElementById("clearBtn");

  // Global actions
  const resetBtn = document.getElementById("resetBtn");
  const exportCsvBtn = document.getElementById("exportCsvBtn");
  const backupBtn = document.getElementById("backupBtn");
  const restoreInput = document.getElementById("restoreInput");
  const delimiterSelect = document.getElementById("delimiterSelect");

  // Sync UI
  const syncStatusEl = document.getElementById("syncStatus");
  const syncNowBtn = document.getElementById("syncNowBtn");

  // Auth overlay
  const authOverlay = document.getElementById("authOverlay");
  const authForm = document.getElementById("authForm");
  const authPassword = document.getElementById("authPassword");
  const authError = document.getElementById("authError");

  // Tabs
  const tabButtons = Array.from(document.querySelectorAll(".tabbtn"));
  const tabPanels  = Array.from(document.querySelectorAll(".tabpanel"));

  // Graph tab
  const graphRange = document.getElementById("graphRange");
  const graphSubstance = document.getElementById("graphSubstance");
  const graphMetric = document.getElementById("graphMetric");
  const chartLegend = document.getElementById("chartLegend");
  const graphSummary = document.getElementById("graphSummary");
  const monthlyChartCanvas = document.getElementById("monthlyChart");

  // Monthly tab
  const monthlyFilterSubstance = document.getElementById("monthlyFilterSubstance");
  const kpiTotalDays = document.getElementById("kpiTotalDays");
  const kpiAvgGapDays = document.getElementById("kpiAvgGapDays");
  const monthlyTbody = document.getElementById("monthlyTbody");
  const monthlyNote = document.getElementById("monthlyNote");
  const lastOverallEl = document.getElementById("lastOverall");
  const lastSubstanceSelect = document.getElementById("lastSubstanceSelect");
  const lastSubstanceEl = document.getElementById("lastSubstance");

  // Intervals tab
  const intervalsRefreshBtn = document.getElementById("intervalsRefreshBtn");
  const kpi6mEvents = document.getElementById("kpi6mEvents");
  const kpi6mAvg = document.getElementById("kpi6mAvg");
  const kpi6mMedian = document.getElementById("kpi6mMedian");
  const kpi6mMinMax = document.getElementById("kpi6mMinMax");
  const gapHistogramCanvas = document.getElementById("gapHistogram");
  const gapsTbody = document.getElementById("gapsTbody");
  const intervalsNote = document.getElementById("intervalsNote");

  // ---- Status line (form feedback)
  const statusEl = (() => {
    const p = document.createElement("p");
    p.id = "statusLine";
    p.className = "hint";
    p.style.marginTop = "10px";
    p.style.display = "none";
    form.appendChild(p);
    return p;
  })();

  function status(msg, kind="info"){
    statusEl.style.display = "block";
    statusEl.textContent = msg;
    statusEl.style.opacity = "1";
    statusEl.style.borderLeft = kind === "error"
      ? "4px solid rgba(255,107,107,.6)"
      : "4px solid rgba(93,214,255,.55)";
    statusEl.style.paddingLeft = "10px";
    window.clearTimeout(statusEl._t);
    statusEl._t = window.setTimeout(() => {
      statusEl.style.opacity = "0.0";
      window.setTimeout(() => { statusEl.style.display = "none"; }, 250);
    }, 2400);
  }

  // ---- Sync status pill
  function setSyncStatus(text, kind=""){
    if(!syncStatusEl) return;
    syncStatusEl.textContent = text;
    syncStatusEl.classList.remove("ok","err","busy");
    if(kind) syncStatusEl.classList.add(kind);
  }

  // ---- Helpers
  let editId = null;
  let medicalXans = false;
  let vaultId = null;
  let syncing = false;

  const HOUR = 1000*60*60;
  const DAY = 24*HOUR;

  function pad(n){ return String(n).padStart(2,"0"); }

  function toLocalDatetimeValue(d){
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth()+1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  function nowDefault(){ dtInput.value = toLocalDatetimeValue(new Date()); }

  function parseDose(text){
    const t = String(text ?? "").trim().replace(",", ".");
    return Number(t);
  }

  function uuid(){
    try{
      if(globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    }catch{}
    try{
      if(globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function"){
        const b = new Uint8Array(16);
        globalThis.crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const hex = [...b].map(x => x.toString(16).padStart(2,"0")).join("");
        return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      }
    }catch{}
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function parseDt(dtStr){
    const s = String(dtStr || "");
    return new Date(s.length === 16 ? (s + ":00") : s);
  }

  function fmtDate(dtStr){
    const s = String(dtStr || "").replace("T"," ");
    return s.length >= 16 ? s.slice(0,16) : s;
  }

  function dayKeyFromDate(d){
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  function monthKeyFromDate(d){
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  }

  function escapeHtml(s){
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---- Storage
  function loadRaw(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    }catch{
      return [];
    }
  }
  function saveRaw(entries){ localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); }

  function loadDeleted(){
    try{
      const raw = localStorage.getItem(DELETED_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
    }catch{
      return {};
    }
  }
  function saveDeleted(map){ localStorage.setItem(DELETED_KEY, JSON.stringify(map || {})); }

  function loadMeta(){
    try{
      const raw = localStorage.getItem(META_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
    }catch{
      return {};
    }
  }
  function saveMeta(obj){ localStorage.setItem(META_KEY, JSON.stringify(obj || {})); }

  function readAuth(){
    try{
      const raw = localStorage.getItem(AUTH_KEY);
      const obj = raw ? JSON.parse(raw) : null;
      if(obj && obj.ok === 1 && typeof obj.vault === "string" && obj.vault.length > 20) return obj.vault;
      return null;
    }catch{ return null; }
  }
  function writeAuth(vault){ localStorage.setItem(AUTH_KEY, JSON.stringify({ok:1, vault})); }

  // ---- Entry normalization (keeps compatibility with old records)
  function normalizeEntry(e){
    const dt = String(e?.dt || "");
    const updated_at = String(e?.updated_at || dt || new Date().toISOString());
    const substance = String(e?.substance || "");
    const medical = Boolean(e?.medical);
    const dose_mg = (substance === "Alkohol") ? Number.NaN : Number(e?.dose_mg);

    const drinks = Array.isArray(e?.alcohol_drinks) ? e.alcohol_drinks : (Array.isArray(e?.drinks) ? e.drinks : []);
    const alcohol_drinks = drinks.map(d => ({
      ml: Number(d?.ml),
      abv: Number(d?.abv),
    })).filter(d => Number.isFinite(d.ml) && d.ml > 0 && Number.isFinite(d.abv) && d.abv > 0 && d.abv <= 100);

    const alcohol_total_ml = Number(e?.alcohol_total_ml);
    const alcohol_pure_ml = Number(e?.alcohol_pure_ml);

    return {
      id: String(e?.id ?? uuid()),
      dt,
      substance,
      dose_mg,
      medical,
      alcohol_drinks,
      alcohol_total_ml: Number.isFinite(alcohol_total_ml) ? alcohol_total_ml : sumAlcoholTotal(alcohol_drinks),
      alcohol_pure_ml: Number.isFinite(alcohol_pure_ml) ? alcohol_pure_ml : sumAlcoholPure(alcohol_drinks),
      updated_at,
    };
  }

  function isValidEntry(e){
    if(!(e && e.dt && e.substance)) return false;
    if(e.substance === "Alkohol"){
      return Array.isArray(e.alcohol_drinks) && e.alcohol_drinks.length > 0;
    }
    return Number.isFinite(Number(e.dose_mg));
  }

  function isExcludedEntry(e){
    // medical Xans should be visible but excluded from stats/intervals
    return (e.substance === "Xans" && e.medical === true);
  }

  function visibleEntries(){
    const deleted = loadDeleted();
    const entries = loadRaw().map(normalizeEntry).filter(isValidEntry);
    return entries.filter(e => {
      const tomb = deleted[e.id];
      if(!tomb) return true;
      // allow resurrection if updated later than delete timestamp
      return String(e.updated_at || "") > String(tomb || "");
    });
  }

  // ---- Alcohol helpers
  function sumAlcoholTotal(drinks){
    let s = 0;
    for(const d of drinks || []) s += Number(d.ml) || 0;
    return s;
  }
  function sumAlcoholPure(drinks){
    let s = 0;
    for(const d of drinks || []) s += (Number(d.ml)||0) * (Number(d.abv)||0) / 100;
    return s;
  }

  function updateAlcoholSummary(){
    if(!alcoholSummary) return;
    const drinks = getDrinkRows();
    const total = sumAlcoholTotal(drinks);
    const pure = sumAlcoholPure(drinks);
    if(!drinks.length) alcoholSummary.textContent = "Noch keine Drinks.";
    else alcoholSummary.textContent = `Drinks: ${drinks.length} • Summe: ${total.toFixed(0)} ml • ≈ ${pure.toFixed(1)} ml reiner Alkohol`;
  }

  function clearDrinkRows(){
    if(!drinkList) return;
    drinkList.innerHTML = "";
  }

  function addDrinkRow(ml="", abv=""){
    const row = document.createElement("div");
    row.className = "drink-row";
    row.innerHTML = `
      <label>ml
        <input class="drink-ml" type="number" inputmode="decimal" min="0" step="1" placeholder="z. B. 330" value="${escapeHtml(ml)}">
      </label>
      <label>%
        <input class="drink-abv" type="number" inputmode="decimal" min="0" max="100" step="0.1" placeholder="z. B. 5" value="${escapeHtml(abv)}">
      </label>
      <div class="remove-col">
        <button class="btn btn-danger drink-remove" type="button">Entfernen</button>
      </div>
    `;
    row.querySelector(".drink-remove").addEventListener("click", () => {
      row.remove();
      updateAlcoholSummary();
    });
    row.querySelector(".drink-ml").addEventListener("input", updateAlcoholSummary);
    row.querySelector(".drink-abv").addEventListener("input", updateAlcoholSummary);
    drinkList.appendChild(row);
    updateAlcoholSummary();
  }

  function getDrinkRows(){
    if(!drinkList) return [];
    const rows = Array.from(drinkList.querySelectorAll(".drink-row"));
    return rows.map(r => ({
      ml: Number(String(r.querySelector(".drink-ml")?.value || "").replace(",", ".")),
      abv: Number(String(r.querySelector(".drink-abv")?.value || "").replace(",", ".")),
    })).filter(d => Number.isFinite(d.ml) && d.ml > 0 && Number.isFinite(d.abv) && d.abv > 0 && d.abv <= 100);
  }

  // ---- Form mode toggles
  function setMedicalToggle(on){
    medicalXans = Boolean(on);
    if(medicalToggle){
      medicalToggle.setAttribute("aria-pressed", medicalXans ? "true" : "false");
      medicalToggle.classList.toggle("btn-primary", medicalXans);
      medicalToggle.classList.toggle("btn-secondary", !medicalXans);
    }
  }

  function applySubstanceUI(){
    const s = substanceInput.value || "";
    const isXans = (s === "Xans");
    const isAlcohol = (s === "Alkohol");

    if(xansMedicalWrap) xansMedicalWrap.style.display = isXans ? "" : "none";
    if(!isXans) setMedicalToggle(false);

    if(alcoholWrap) alcoholWrap.style.display = isAlcohol ? "" : "none";

    // Dose field required only for non-alcohol
    if(doseInput){
      doseInput.disabled = isAlcohol;
      doseInput.required = !isAlcohol;
      doseInput.style.opacity = isAlcohol ? "0.5" : "1";
      if(isAlcohol) doseInput.value = "";
    }

    if(isAlcohol && drinkList && drinkList.children.length === 0){
      // start with one row for convenience
      addDrinkRow("", "");
    }
  }

  function formReset(){
    editId = null;
    substanceInput.value = "";
    doseInput.value = "";
    setMedicalToggle(false);
    clearDrinkRows();
    nowDefault();
    document.getElementById("saveBtn").textContent = "Speichern";
    applySubstanceUI();
  }

  // ---- Sessions (24h grouping)
  function buildSessions(entries){
    const sorted = [...entries].sort((a,b) => String(a.dt||"").localeCompare(String(b.dt||"")));
    const sessions = [];
    let cur = null;
    let lastT = null;

    for(const e of sorted){
      const t = parseDt(e.dt);
      if(!cur){
        cur = { id: "S-" + e.id, start: t, end: t, entries: [e] };
        lastT = t;
        continue;
      }
      if((t - lastT) <= DAY){
        cur.entries.push(e);
        if(t > cur.end) cur.end = t;
        lastT = t;
      }else{
        sessions.push(cur);
        cur = { id: "S-" + e.id, start: t, end: t, entries: [e] };
        lastT = t;
      }
    }
    if(cur) sessions.push(cur);

    // enrich sessions
    return sessions.map(s => {
      const entriesSorted = [...s.entries].sort((a,b)=>String(a.dt||"").localeCompare(String(b.dt||"")));
      const included = entriesSorted.filter(e => !isExcludedEntry(e));
      const excluded = entriesSorted.filter(e => isExcludedEntry(e));

      const sums = new Map(); // substance -> {mg, daysFlag, alcohol_pure_ml, alcohol_total_ml, drinks}
      for(const e of included){
        if(e.substance === "Alkohol"){
          const o = sums.get("Alkohol") || {mg:0, alcohol_pure_ml:0, alcohol_total_ml:0, drinks:0};
          o.alcohol_pure_ml += Number(e.alcohol_pure_ml)||0;
          o.alcohol_total_ml += Number(e.alcohol_total_ml)||0;
          o.drinks += (e.alcohol_drinks?.length||0);
          sums.set("Alkohol", o);
        }else{
          const o = sums.get(e.substance) || {mg:0, alcohol_pure_ml:0, alcohol_total_ml:0, drinks:0};
          o.mg += Number(e.dose_mg)||0;
          sums.set(e.substance, o);
        }
      }

      const distinct = [...new Set(included.map(e=>e.substance))];
      const anyMedical = excluded.length > 0;

      return {
        ...s,
        startStr: toLocalDatetimeValue(s.start),
        endStr: toLocalDatetimeValue(s.end),
        entries: entriesSorted,
        includedEntries: included,
        excludedEntries: excluded,
        excludedOnly: included.length === 0,
        anyMedical,
        distinctSubstances: distinct,
        sums,
      };
    }).sort((a,b)=>b.start - a.start);
  }

  function sessionSummary(session){
    const parts = [];
    // included first
    for(const sub of session.distinctSubstances){
      const o = session.sums.get(sub);
      if(!o) continue;
      if(sub === "Alkohol"){
        parts.push(`Alkohol: ${o.alcohol_total_ml.toFixed(0)}ml (≈${o.alcohol_pure_ml.toFixed(1)}ml rein)`);
      }else{
        parts.push(`${sub}: ${o.mg.toFixed(1)}mg`);
      }
    }
    // excluded medical xans
    if(session.anyMedical){
      const medCount = session.excludedEntries.length;
      parts.push(`Xans (medizinisch) ×${medCount}`);
    }
    if(!parts.length) return "–";
    return parts.join(" • ");
  }

  // ---- Modal for session details
  const modal = (() => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div>
            <h2 style="margin:0;">Konsumtag</h2>
            <div id="modalTime" class="small-muted"></div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button id="modalClose" class="btn btn-secondary" type="button">Schließen</button>
          </div>
        </div>
        <div id="modalBadges" class="badges" style="margin-top:10px;"></div>
        <div id="modalSummary" class="muted" style="margin-top:8px;"></div>
        <div id="modalList" class="entry-list"></div>
      </div>
    `;
    document.body.appendChild(m);
    m.addEventListener("click", (ev) => { if(ev.target === m) hideModal(); });
    m.querySelector("#modalClose").addEventListener("click", hideModal);
    return m;
  })();

  function showModal(session){
    modal._session = session;
    modal.querySelector("#modalTime").textContent =
      `${fmtDate(session.startStr)} — ${fmtDate(session.endStr)} (${Math.max(0, (session.end - session.start)/HOUR).toFixed(1)}h)`;

    const badges = modal.querySelector("#modalBadges");
    badges.innerHTML = "";
    if(session.distinctSubstances.length > 1) badges.appendChild(makePill("Mischkonsum"));
    if(session.anyMedical) badges.appendChild(makePill("medizinisch"));
    if(session.excludedOnly) badges.appendChild(makePill("nur medizinisch"));

    modal.querySelector("#modalSummary").textContent = sessionSummary(session);

    const list = modal.querySelector("#modalList");
    list.innerHTML = "";
    for(const e of session.entries){
      const item = document.createElement("div");
      item.className = "entry-item";
      const title = `${fmtDate(e.dt)} • ${e.substance}`;
      const flags = [];
      if(isExcludedEntry(e)) flags.push("medizinisch");
      let detail = "";
      if(e.substance === "Alkohol"){
        const total = Number(e.alcohol_total_ml)||0;
        const pure = Number(e.alcohol_pure_ml)||0;
        detail = `Alkohol: ${total.toFixed(0)}ml (≈${pure.toFixed(1)}ml rein) • Drinks: ${e.alcohol_drinks?.length||0}`;
      }else{
        detail = `${Number(e.dose_mg).toFixed(1)} mg`;
      }
      item.innerHTML = `
        <div class="entry-item-head">
          <div><strong>${escapeHtml(title)}</strong> ${flags.length ? `<span class="pill">${escapeHtml(flags.join(","))}</span>` : ""}</div>
          <div class="mono">${escapeHtml(detail)}</div>
        </div>
        <div class="small-muted" style="margin-top:6px;">${escapeHtml(e.substance==="Alkohol" ? drinkDetailsText(e) : "")}</div>
        <div class="entry-actions">
          <button class="btn btn-secondary" type="button" data-act="edit">Bearbeiten</button>
          <button class="btn btn-danger" type="button" data-act="del">Löschen</button>
        </div>
      `;
      item.querySelector('[data-act="edit"]').addEventListener("click", () => editEntry(e));
      item.querySelector('[data-act="del"]').addEventListener("click", () => deleteEntry(e.id));
      list.appendChild(item);
    }

    modal.classList.add("show");
  }
  function hideModal(){ modal.classList.remove("show"); modal._session = null; }

  function drinkDetailsText(e){
    const arr = e.alcohol_drinks || [];
    if(!arr.length) return "";
    return arr.map((d,i)=>`#${i+1}: ${Number(d.ml).toFixed(0)}ml @ ${Number(d.abv).toFixed(1)}% (≈ ${(Number(d.ml)*Number(d.abv)/100).toFixed(1)}ml rein)`).join(" • ");
  }

  function makePill(text){
    const s = document.createElement("span");
    s.className = "pill";
    s.textContent = text;
    return s;
  }

  // ---- Verlauf render (sessions)
  function renderTable(){
    const sessions = buildSessions(visibleEntries());
    const fSub = filterSubstance.value || "";
    const q = (searchInput.value || "").trim().toLowerCase();

    const filtered = sessions.filter(s => {
      if(fSub){
        // filter matches if substance is present in session entries (including alcohol)
        const has = s.entries.some(e => e.substance === fSub);
        if(!has) return false;
      }
      if(!q) return true;
      const hay = (sessionSummary(s) + " " + s.startStr + " " + s.endStr).toLowerCase();
      return hay.includes(q);
    });

    tbody.innerHTML = "";
    for(const s of filtered){
      const tr = document.createElement("tr");

      const tdDate = document.createElement("td");
      tdDate.className = "mono";
      tdDate.textContent = fmtDate(s.startStr);

      const tdSum = document.createElement("td");
      tdSum.textContent = sessionSummary(s);

      const tdAct = document.createElement("td");
      const detailsBtn = document.createElement("button");
      detailsBtn.className = "btn btn-secondary";
      detailsBtn.type = "button";
      detailsBtn.textContent = "Details";
      detailsBtn.addEventListener("click", () => showModal(s));

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-danger";
      delBtn.type = "button";
      delBtn.style.marginLeft = "8px";
      delBtn.textContent = "Tag löschen";
      delBtn.addEventListener("click", () => deleteSession(s));

      tdAct.appendChild(detailsBtn);
      tdAct.appendChild(delBtn);

      tr.appendChild(tdDate);
      tr.appendChild(tdSum);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    }

    countInfo.textContent = `${filtered.length} Konsumtage (gesamt: ${sessions.length})`;
  }

  // ---- Editing / deleting
  function editEntry(e){
    hideModal();
    const ne = normalizeEntry(e);
    editId = ne.id;
    dtInput.value = ne.dt;
    substanceInput.value = ne.substance;
    setMedicalToggle(ne.medical);
    clearDrinkRows();

    if(ne.substance === "Alkohol"){
      for(const d of ne.alcohol_drinks) addDrinkRow(String(d.ml), String(d.abv));
      if(ne.alcohol_drinks.length === 0) addDrinkRow("", "");
    }else{
      doseInput.value = String(ne.dose_mg);
    }
    document.getElementById("saveBtn").textContent = "Update speichern";
    applySubstanceUI();
    status("Bearbeiten: Eintrag geladen.");
  }

  function deleteEntry(id){
    const ok = confirm("Diesen Eintrag wirklich löschen?");
    if(!ok) return;

    const now = new Date().toISOString();
    const deleted = loadDeleted();
    deleted[id] = now;
    saveDeleted(deleted);

    // keep raw entries but they'll be hidden; optionally we could remove them
    rerenderAll();
    status("Eintrag gelöscht.");
    syncPush(null, "delete-entry");
  }

  function deleteSession(session){
    const ok = confirm("Diesen ganzen Konsumtag wirklich löschen? (alle Einträge in 24h-Gruppe)");
    if(!ok) return;
    const now = new Date().toISOString();
    const deleted = loadDeleted();
    for(const e of session.entries) deleted[e.id] = now;
    saveDeleted(deleted);
    hideModal();
    rerenderAll();
    status("Konsumtag gelöscht.");
    syncPush(null, "delete-session");
  }

  // ---- CSV / Backup
  function download(filename, content, mime="text/plain"){
    const blob = new Blob([content], {type: mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function escapeCsv(value, delimiter){
    const s = String(value ?? "");
    const needsQuotes = s.includes(delimiter) || s.includes("\n") || s.includes("\r") || s.includes('"');
    const t = s.replace(/"/g,'""');
    return needsQuotes ? `"${t}"` : t;
  }

  function exportCsv(){
    const delimiter = delimiterSelect.value || ";";
    const data = visibleEntries().sort((a,b) => String(a.dt||"").localeCompare(String(b.dt||"")));
    const header = ["dt","substance","dose_mg","medical","alcohol_total_ml","alcohol_pure_ml","alcohol_drinks_json","updated_at"];
    const rows = [header.join(delimiter)];
    for(const e of data){
      rows.push([
        escapeCsv(e.dt, delimiter),
        escapeCsv(e.substance, delimiter),
        escapeCsv(Number.isFinite(e.dose_mg) ? e.dose_mg : "", delimiter),
        escapeCsv(e.medical ? "1" : "0", delimiter),
        escapeCsv(e.substance==="Alkohol" ? (Number(e.alcohol_total_ml)||0) : "", delimiter),
        escapeCsv(e.substance==="Alkohol" ? (Number(e.alcohol_pure_ml)||0) : "", delimiter),
        escapeCsv(e.substance==="Alkohol" ? JSON.stringify(e.alcohol_drinks||[]) : "", delimiter),
        escapeCsv(e.updated_at, delimiter),
      ].join(delimiter));
    }
    const stamp = new Date();
    const fn = `konsum_export_${stamp.getFullYear()}-${pad(stamp.getMonth()+1)}-${pad(stamp.getDate())}.csv`;
    download(fn, rows.join("\n"), "text/csv;charset=utf-8");
    status("CSV exportiert.");
  }

  function backupJson(){
    const entries = loadRaw(); // raw to preserve old fields too
    const deleted = loadDeleted();
    const meta = loadMeta();
    const stamp = new Date();
    const fn = `konsum_backup_${stamp.getFullYear()}-${pad(stamp.getMonth()+1)}-${pad(stamp.getDate())}.json`;
    download(fn, JSON.stringify({version: 8, exported_at: stamp.toISOString(), entries, deleted, meta}, null, 2), "application/json");
    status("Backup heruntergeladen.");
  }

  async function restoreJson(file){
    const text = await file.text();
    let obj;
    try{ obj = JSON.parse(text); }catch{ alert("Backup ist kein gültiges JSON."); return; }
    const entries = Array.isArray(obj?.entries) ? obj.entries : (Array.isArray(obj) ? obj : null);
    if(!entries){ alert("Backup hat keine gültigen entries."); return; }
    const ok = confirm("Restore überschreibt deinen lokalen Verlauf. Fortfahren?");
    if(!ok) return;
    saveRaw(entries);
    if(obj?.deleted) saveDeleted(obj.deleted);
    if(obj?.meta) saveMeta(obj.meta);
    formReset();
    rerenderAll();
    status("Restore abgeschlossen.");
    syncPush(null, "restore");
  }

  function clearAll(){
    const ok = confirm("Wirklich ALLES löschen? (Nicht rückgängig)");
    if(!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DELETED_KEY);
    formReset();
    rerenderAll();
    status("Alles gelöscht.");
    syncPush(null, "clear");
  }

  // ---- Stats based on sessions (exclude medical Xans from stats)
  function statSessionsAll(){
    const sessions = buildSessions(visibleEntries());
    return sessions.filter(s => !s.excludedOnly); // remove sessions that are only medical Xans
  }

  function sessionsForFilter(sub){
    const sessions = statSessionsAll();
    if(!sub) return sessions;
    return sessions.filter(s => s.includedEntries.some(e => e.substance === sub));
  }

  function sessionAmount(session, sub){
    // returns {value, unit}
    if(sub === "Alkohol"){
      let pure = 0;
      for(const e of session.includedEntries.filter(e=>e.substance==="Alkohol")){
        pure += Number(e.alcohol_pure_ml)||0;
      }
      return {value: pure, unit: "ml"};
    }
    if(sub){
      let mg = 0;
      for(const e of session.includedEntries.filter(e=>e.substance===sub)){
        mg += Number(e.dose_mg)||0;
      }
      return {value: mg, unit: "mg"};
    }
    // all: sum mg across non-alcohol drugs only
    let mg = 0;
    for(const e of session.includedEntries){
      if(e.substance === "Alkohol") continue;
      mg += Number(e.dose_mg)||0;
    }
    return {value: mg, unit: "mg"};
  }

  function computeAvgGapDays(sessions){
    const sorted = [...sessions].sort((a,b)=>a.start - b.start);
    const gaps = [];
    for(let i=1;i<sorted.length;i++){
      const prev = sorted[i-1];
      const cur = sorted[i];
      const gapH = (cur.start - prev.end) / HOUR;
      gaps.push(gapH/24);
    }
    if(!gaps.length) return NaN;
    return gaps.reduce((a,b)=>a+b,0) / gaps.length;
  }

  function computeLastConsumption(){
    const sessions = statSessionsAll().sort((a,b)=>b.start - a.start);
    const overall = sessions.length ? sessions[0].startStr : null;
    const bySub = {};
    for(const sub of SUBSTANCES) bySub[sub] = null;
    for(const s of sessions){
      const present = new Set(s.includedEntries.map(e=>e.substance));
      for(const sub of present){
        if(bySub[sub] == null) bySub[sub] = s.startStr;
      }
    }
    return {overall, bySub};
  }

  function renderLast(){
    if(!lastOverallEl || !lastSubstanceSelect || !lastSubstanceEl) return;
    const {overall, bySub} = computeLastConsumption();
    lastOverallEl.textContent = overall ? fmtDate(overall) : "–";
    const sub = lastSubstanceSelect.value || "sativa";
    lastSubstanceEl.textContent = bySub[sub] ? fmtDate(bySub[sub]) : "–";
  }

  function renderMonthly(){
    const sub = monthlyFilterSubstance.value || "";
    const sessions = sessionsForFilter(sub);

    kpiTotalDays.textContent = String(sessions.length);
    const avgGap = computeAvgGapDays(sessions);
    kpiAvgGapDays.textContent = Number.isFinite(avgGap) ? avgGap.toFixed(2) + " Tage" : "–";

    // Per month based on session.start
    const perMonth = new Map(); // monthKey -> {days, amount, unit}
    for(const s of sessions){
      const mk = monthKeyFromDate(s.start);
      const cur = perMonth.get(mk) || {days:0, amount:0, unit:(sub==="Alkohol"?"ml":"mg")};
      cur.days += 1;
      const a = sessionAmount(s, sub || null);
      cur.amount += a.value;
      cur.unit = a.unit;
      perMonth.set(mk, cur);
    }

    const months = [...perMonth.keys()].sort().reverse();
    monthlyTbody.innerHTML = "";
    for(const mk of months){
      const r = perMonth.get(mk);
      const avg = r.days ? (r.amount / r.days) : 0;
      const tr = document.createElement("tr");

      const tdM = document.createElement("td"); tdM.className="mono"; tdM.textContent = mk;
      const tdD = document.createElement("td"); tdD.className="mono"; tdD.textContent = String(r.days);
      const tdAvg = document.createElement("td"); tdAvg.className="mono"; tdAvg.textContent = `${avg.toFixed(1)} ${r.unit}/Tag`;
      const tdSum = document.createElement("td"); tdSum.className="mono"; tdSum.textContent = `${r.amount.toFixed(1)} ${r.unit}`;

      tr.appendChild(tdM); tr.appendChild(tdD); tr.appendChild(tdAvg); tr.appendChild(tdSum);
      monthlyTbody.appendChild(tr);
    }

    monthlyNote.textContent =
      (!sub && statSessionsAll().some(s=>s.includedEntries.some(e=>e.substance==="Alkohol")))
        ? "Hinweis: Ohne Filter wird „Konsummenge“ als mg-Summe (ohne Alkohol) gerechnet. Filter auf „Alkohol“ zeigt Alkohol in ml (reiner Alkohol)."
        : "";

    renderLast();
  }

  // ---- Graph (sessions)
  function rangeSpec(range){
    const now = new Date();
    // buckets are based on session.start date/month
    if(range === "week"){
      const days = 7;
      const keys = [];
      const start = new Date(now);
      start.setHours(0,0,0,0);
      start.setDate(start.getDate() - (days-1));
      for(let i=0;i<days;i++){
        const d = new Date(start); d.setDate(start.getDate()+i);
        keys.push(dayKeyFromDate(d));
      }
      return {type:"day", keys, start};
    }
    if(range === "1m"){
      const days = 30;
      const keys = [];
      const start = new Date(now);
      start.setHours(0,0,0,0);
      start.setDate(start.getDate() - (days-1));
      for(let i=0;i<days;i++){
        const d = new Date(start); d.setDate(start.getDate()+i);
        keys.push(dayKeyFromDate(d));
      }
      return {type:"day", keys, start};
    }
    const months = Number(range.replace("m",""));
    const keys = [];
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setMonth(start.getMonth() - (months-1));
    for(let i=0;i<months;i++){
      const d = new Date(start.getFullYear(), start.getMonth()+i, 1);
      keys.push(monthKeyFromDate(d));
    }
    return {type:"month", keys, start};
  }

  function bucketKeyForSession(spec, session){
    if(spec.type === "day") return dayKeyFromDate(session.start);
    return monthKeyFromDate(session.start);
  }

  function drawStackedBars(canvas, keys, seriesBySub, labelCountsBySub, subFilter, metricLabel){
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(700, rect.width || 900);
    const cssH = 360;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);

    ctx.clearRect(0,0,cssW,cssH);

    const padding = {l: 52, r: 16, t: 18, b: 54};
    const plotW = cssW - padding.l - padding.r;
    const plotH = cssH - padding.t - padding.b;

    const totals = keys.map(k => {
      if(subFilter){
        return (seriesBySub[subFilter]?.[k] || 0);
      }
      let sum = 0;
      for(const sub of Object.keys(seriesBySub)){
        sum += (seriesBySub[sub][k] || 0);
      }
      return sum;
    });
    const maxY = Math.max(1, ...totals);
    const yTicks = 4;
    const tickStep = Math.ceil(maxY / yTicks);

    // grid
    ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial";
    ctx.fillStyle = "rgba(142,160,191,.9)";
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;

    for(let i=0;i<=yTicks;i++){
      const yVal = i * tickStep;
      const y = padding.t + plotH - (yVal / (tickStep*yTicks)) * plotH;
      ctx.beginPath();
      ctx.moveTo(padding.l, y);
      ctx.lineTo(padding.l + plotW, y);
      ctx.stroke();
      ctx.fillText(String(yVal), 8, y + 4);
    }

    const n = keys.length;
    const gap = 6;
    const barW = Math.max(8, (plotW - gap*(n-1)) / n);

    // labels are "Konsumtage" counts
    ctx.font = "11px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial";
    ctx.textAlign = "center";

    for(let i=0;i<n;i++){
      const k = keys[i];
      const x = padding.l + i*(barW+gap);
      let yBase = padding.t + plotH;

      if(subFilter){
        const v = seriesBySub[subFilter]?.[k] || 0;
        const h = (v / (tickStep*yTicks)) * plotH;
        ctx.fillStyle = (COLORS[subFilter] || "#5dd6ff") + "cc";
        ctx.fillRect(x, yBase - h, barW, h);

        const dCount = labelCountsBySub[subFilter]?.[k] || 0;
        if(dCount > 0){
          ctx.fillStyle = "rgba(233,238,247,.95)";
          const yText = h > 18 ? (yBase - h + 12) : (yBase - h - 4);
          ctx.fillText(String(dCount), x + barW/2, yText);
        }
      }else{
        for(const sub of SUBSTANCES){
          if(!(sub in seriesBySub)) continue;
          const v = seriesBySub[sub][k] || 0;
          if(!v) continue;
          const h = (v / (tickStep*yTicks)) * plotH;
          ctx.fillStyle = (COLORS[sub] || "#5dd6ff") + "cc";
          ctx.fillRect(x, yBase - h, barW, h);

          const dCount = labelCountsBySub[sub]?.[k] || 0;
          if(dCount > 0 && h > 16){
            ctx.fillStyle = "rgba(233,238,247,.95)";
            ctx.fillText(String(dCount), x + barW/2, yBase - h/2 + 4);
          }
          yBase -= h;
        }
      }

      // x label
      ctx.fillStyle = "rgba(142,160,191,.9)";
      const lbl = k.includes("-") && k.length===10 ? k.slice(5) : k; // MM-DD for day, YYYY-MM for month
      if(n <= 14 || i % 2 === 0 || i === n-1){
        ctx.save();
        ctx.translate(x + barW/2, padding.t + plotH + 34);
        ctx.rotate(-0.55);
        ctx.textAlign = "center";
        ctx.fillText(lbl, 0, 0);
        ctx.restore();
      }
    }

    // axes
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.moveTo(padding.l, padding.t);
    ctx.lineTo(padding.l, padding.t + plotH);
    ctx.lineTo(padding.l + plotW, padding.t + plotH);
    ctx.stroke();

    // title (metric)
    ctx.fillStyle = "rgba(142,160,191,.9)";
    ctx.textAlign = "left";
    ctx.fillText(metricLabel, padding.l, 12);
  }

  function renderLegend(subFilter){
    chartLegend.innerHTML = "";
    const list = subFilter ? [subFilter] : SUBSTANCES;
    for(const sub of list){
      const item = document.createElement("div");
      item.className = "legend-item";
      const sw = document.createElement("span");
      sw.className = "legend-swatch";
      sw.style.background = COLORS[sub] || "#5dd6ff";
      item.appendChild(sw);
      const t = document.createElement("span");
      t.textContent = sub;
      item.appendChild(t);
      chartLegend.appendChild(item);
    }
  }

  function renderGraph(){
    if(!monthlyChartCanvas) return;

    const range = graphRange.value || "12m";
    const sub = graphSubstance.value || "";
    const metric = graphMetric.value || "days"; // days | mg

    const spec = rangeSpec(range);
    const keys = spec.keys;

    const sessionsAll = statSessionsAll();
    const sessions = sessionsAll.filter(s => s.start >= spec.start);

    // seriesBySub: metric values per bucket
    const seriesBySub = {};
    const dayCounts = {};

    for(const s of SUBSTANCES){
      seriesBySub[s] = Object.fromEntries(keys.map(k => [k, 0]));
      dayCounts[s] = Object.fromEntries(keys.map(k => [k, 0]));
    }

    for(const sess of sessions){
      const k = bucketKeyForSession(spec, sess);
      if(!(k in seriesBySub["sativa"])) continue;

      // count presence per substance (konsumtage per substance)
      const present = new Set(sess.includedEntries.map(e=>e.substance));
      for(const p of present){
        dayCounts[p][k] += 1;
      }

      if(metric === "days"){
        // metric is konsumtage per substance
        for(const p of present){
          seriesBySub[p][k] += 1;
        }
      }else{
        // metric is amount: mg for drugs; Alkohol only if filtered to Alkohol
        if(sub){
          if(sub === "Alkohol"){
            const a = sessionAmount(sess, "Alkohol");
            seriesBySub["Alkohol"][k] += a.value;
          }else{
            const a = sessionAmount(sess, sub);
            seriesBySub[sub][k] += a.value;
          }
        }else{
          // no filter: sum mg across non-alcohol substances, stacked by substance
          for(const p of present){
            if(p === "Alkohol") continue;
            const a = sessionAmount(sess, p);
            seriesBySub[p][k] += a.value;
          }
        }
      }
    }

    renderLegend(sub || null);

    let metricLabel = (metric === "days") ? "Konsumtage" : "Konsummenge";
    if(metric === "mg"){
      if(sub === "Alkohol") metricLabel += " (ml reiner Alkohol)";
      else metricLabel += " (mg)";
      if(!sub) metricLabel += " (ohne Alkohol)";
    }

    const subFilter = sub || null;
    drawStackedBars(monthlyChartCanvas, keys,
      seriesBySub,
      dayCounts,
      subFilter,
      metricLabel
    );

    // summary
    const totalDays = sessions.length;
    let extra = "";
    if(metric === "mg" && !sub){
      extra = " • Hinweis: Alkohol ist in der mg-Metrik ohne Filter nicht enthalten.";
    }
    graphSummary.textContent = `Zeitraum: ${rangeLabel(range)} • Konsumtage: ${totalDays} • Zahlen auf Balken = Konsumtage pro Substanz.` + extra;
  }

  function rangeLabel(range){
    switch(range){
      case "week": return "Letzte Woche";
      case "1m": return "Letzten Monat";
      case "3m": return "Letzten 3 Monate";
      case "6m": return "Letzten 6 Monate";
      case "12m": return "Letzten 12 Monate";
      case "24m": return "Letzten 24 Monate";
      default: return range;
    }
  }

  // ---- Intervals (6 months) using sessions (exclude excludedOnly)
  function median(nums){
    if(!nums.length) return NaN;
    const a = [...nums].sort((x,y)=>x-y);
    const mid = Math.floor(a.length/2);
    return a.length % 2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
  }

  function humanGap(hours){
    if(!Number.isFinite(hours)) return "–";
    if(hours < 24) return `${hours.toFixed(1)} h`;
    return `${(hours/24).toFixed(2)} d`;
  }

  function drawHistogram(canvas, bins, counts){
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(700, rect.width || 900);
    const cssH = 320;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);

    ctx.clearRect(0,0,cssW,cssH);

    const padding = {l: 52, r: 16, t: 18, b: 52};
    const plotW = cssW - padding.l - padding.r;
    const plotH = cssH - padding.t - padding.b;

    const maxY = Math.max(1, ...counts);
    const yTicks = 4;
    const tickStep = Math.ceil(maxY / yTicks);

    ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial";
    ctx.fillStyle = "rgba(142,160,191,.9)";
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;

    for(let i=0;i<=yTicks;i++){
      const yVal = i * tickStep;
      const y = padding.t + plotH - (yVal / (tickStep*yTicks)) * plotH;
      ctx.beginPath();
      ctx.moveTo(padding.l, y);
      ctx.lineTo(padding.l + plotW, y);
      ctx.stroke();
      ctx.fillText(String(yVal), 8, y + 4);
    }

    const n = bins.length;
    const gap = 10;
    const barW = Math.max(14, (plotW - gap*(n-1)) / n);

    for(let i=0;i<n;i++){
      const x = padding.l + i*(barW + gap);
      const v = counts[i];
      const h = (v / (tickStep*yTicks)) * plotH;
      ctx.fillStyle = "rgba(93,214,255,.55)";
      ctx.fillRect(x, padding.t + plotH - h, barW, h);

      ctx.save();
      ctx.translate(x + barW/2, padding.t + plotH + 34);
      ctx.rotate(-0.55);
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(142,160,191,.9)";
      ctx.fillText(bins[i], 0, 0);
      ctx.restore();
    }

    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.moveTo(padding.l, padding.t);
    ctx.lineTo(padding.l, padding.t + plotH);
    ctx.lineTo(padding.l + plotW, padding.t + plotH);
    ctx.stroke();
  }

  function renderIntervals6m(){
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 6);

    const sessions = statSessionsAll().filter(s => s.start >= cutoff).sort((a,b)=>a.start - b.start);

    const gaps = [];
    for(let i=1;i<sessions.length;i++){
      const prev = sessions[i-1];
      const cur = sessions[i];
      const dh = (cur.start - prev.end) / HOUR;
      gaps.push({from: prev, to: cur, deltaHours: dh});
    }

    const hours = gaps.map(g=>g.deltaHours).filter(h=>Number.isFinite(h) && h>=0);
    const avgH = hours.length ? hours.reduce((a,b)=>a+b,0)/hours.length : NaN;
    const medH = hours.length ? median(hours) : NaN;
    const minH = hours.length ? Math.min(...hours) : NaN;
    const maxH = hours.length ? Math.max(...hours) : NaN;

    kpi6mEvents.textContent = String(sessions.length);
    kpi6mAvg.textContent = Number.isFinite(avgH) ? humanGap(avgH) : "–";
    kpi6mMedian.textContent = Number.isFinite(medH) ? humanGap(medH) : "–";
    kpi6mMinMax.textContent = (Number.isFinite(minH) && Number.isFinite(maxH)) ? `${humanGap(minH)} / ${humanGap(maxH)}` : "–";

    // histogram bins
    const bins = ["<1d","1–2d","2–4d","4–7d","7–14d","14–30d",">30d"];
    const counts = [0,0,0,0,0,0,0];
    for(const h of hours){
      const d = h/24;
      if(d < 1) counts[0]++; 
      else if(d < 2) counts[1]++;
      else if(d < 4) counts[2]++;
      else if(d < 7) counts[3]++;
      else if(d < 14) counts[4]++;
      else if(d < 30) counts[5]++;
      else counts[6]++;
    }
    if(gapHistogramCanvas) drawHistogram(gapHistogramCanvas, bins, counts);

    gapsTbody.innerHTML = "";
    const last = [...gaps].sort((a,b)=>b.to.start - a.to.start).slice(0, 12);
    for(const g of last){
      const tr = document.createElement("tr");
      const tdF = document.createElement("td"); tdF.className="mono"; tdF.textContent = fmtDate(g.from.startStr);
      const tdT = document.createElement("td"); tdT.className="mono"; tdT.textContent = fmtDate(g.to.startStr);
      const tdD = document.createElement("td"); tdD.className="mono"; tdD.textContent = humanGap(g.deltaHours);
      const tdS = document.createElement("td"); tdS.textContent = `${shortSub(g.from)} → ${shortSub(g.to)}`;
      tr.appendChild(tdF); tr.appendChild(tdT); tr.appendChild(tdD); tr.appendChild(tdS);
      gapsTbody.appendChild(tr);
    }

    intervalsNote.textContent = `Zeitraum: ${cutoff.toISOString().slice(0,10)} bis heute. Abstände = (nächster Start) − (vorheriges Ende). Medizinische Xans werden nicht mitgezählt.`;
  }

  function shortSub(session){
    const subs = session.distinctSubstances.slice(0,3);
    return subs.length ? subs.join("+") : (session.anyMedical ? "Xans(med)" : "–");
  }

  // ---- Tabs
  function setActiveTab(tabId){
    for(const btn of tabButtons){
      const isActive = btn.dataset.tab === tabId;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    }
    for(const panel of tabPanels){
      panel.classList.toggle("active", panel.id === tabId);
    }
    if(tabId === "tab-graph") renderGraph();
    if(tabId === "tab-monthly") renderMonthly();
    if(tabId === "tab-intervals") renderIntervals6m();
  }
  tabButtons.forEach(btn => btn.addEventListener("click", () => setActiveTab(btn.dataset.tab)));

  // ---- Sync primitives
  function apiUrl(){ return `/.netlify/functions/konsum-sync?vault=${vaultId}`; }

  function latestUpdatedAt(entries){
    let best = "";
    for(const e of entries){
      const t = String(e.updated_at || "");
      if(t > best) best = t;
    }
    return best || new Date(0).toISOString();
  }
  function latestDeletedAt(map){
    let best = "";
    for(const t of Object.values(map || {})){
      const s = String(t || "");
      if(s > best) best = s;
    }
    return best || new Date(0).toISOString();
  }
  function syncRevision(entries, deleted){
    const a = latestUpdatedAt(entries || []);
    const b = latestDeletedAt(deleted || {});
    return a > b ? a : b;
  }

  function mergeDeleted(localDeleted, remoteDeleted){
    const out = { ...(localDeleted || {}) };
    for(const [id, t] of Object.entries(remoteDeleted || {})){
      if(!out[id] || String(t) > String(out[id])) out[id] = String(t);
    }
    return out;
  }

  function mergeEntries(localEntries, remoteEntries, deletedMap){
    const map = new Map();
    for(const e of (localEntries || []).map(normalizeEntry)) if(isValidEntry(e)) map.set(e.id, e);
    for(const e of (remoteEntries || []).map(normalizeEntry)){
      if(!isValidEntry(e)) continue;
      const cur = map.get(e.id);
      if(!cur) map.set(e.id, e);
      else map.set(e.id, (String(e.updated_at) > String(cur.updated_at)) ? e : cur);
    }
    const out = [...map.values()].filter(e => {
      const tomb = deletedMap?.[e.id];
      if(!tomb) return true;
      return String(e.updated_at || "") > String(tomb || "");
    });
    // keep stable order
    out.sort((a,b)=>String(a.dt||"").localeCompare(String(b.dt||"")));
    return out;
  }

  async function syncPushRaw(entries=null, deleted=null, reason="auto"){
    const payloadEntries = (entries ?? visibleEntries()).map(normalizeEntry);
    const payloadDeleted = deleted ?? loadDeleted();
    const updatedAt = syncRevision(payloadEntries, payloadDeleted);
    const body = JSON.stringify({ version: 8, updatedAt, entries: payloadEntries, deleted: payloadDeleted, reason });

    const resp = await fetch(apiUrl(), {
      method: "PUT",
      headers: {"Content-Type":"application/json"},
      cache: "no-store",
      body
    });
    if(!resp.ok) throw new Error("PUT " + resp.status);
    const state = await resp.json();
    // server may return newer state
    return state;
  }

  async function syncPull(force=false){
    if(!vaultId) return;
    if(syncing && !force) return;
    syncing = true;
    setSyncStatus("Sync: lade…", "busy");
    try{
      const resp = await fetch(apiUrl(), { method:"GET", cache:"no-store" });
      if(resp.status === 404){
        // seed server if we have local data
        const localE = visibleEntries();
        const localD = loadDeleted();
        if(localE.length || Object.keys(localD).length){
          setSyncStatus("Sync: initialisiere…", "busy");
          const state = await syncPushRaw(localE, localD, "init");
          applyRemoteState(state);
        }else{
          setSyncStatus("Sync: leer", "ok");
        }
        return;
      }
      if(!resp.ok) throw new Error("GET " + resp.status);
      const remote = await resp.json();

      const localEntries = visibleEntries();
      const localDeleted = loadDeleted();
      const remoteEntries = Array.isArray(remote?.entries) ? remote.entries : [];
      const remoteDeleted = (remote?.deleted && typeof remote.deleted === "object") ? remote.deleted : {};

      const mergedDeleted = mergeDeleted(localDeleted, remoteDeleted);
      const mergedEntries = mergeEntries(localEntries, remoteEntries, mergedDeleted);

      const localRev = syncRevision(localEntries, localDeleted);
      const remoteRev = syncRevision(remoteEntries.map(normalizeEntry).filter(isValidEntry), remoteDeleted);
      const mergedRev = syncRevision(mergedEntries, mergedDeleted);

      // Update local if needed
      if(mergedRev > localRev || (mergedEntries.length !== localEntries.length) || (JSON.stringify(mergedDeleted) !== JSON.stringify(localDeleted))){
        saveRaw(mergedEntries);
        saveDeleted(mergedDeleted);
      }

      // Push back if merged is newer than server
      if(mergedRev > remoteRev){
        setSyncStatus("Sync: merge…", "busy");
        const state = await syncPushRaw(mergedEntries, mergedDeleted, "merge");
        applyRemoteState(state);
      }else{
        // accept remote state time into meta
        saveMeta({ ...(loadMeta()), lastSyncAt: new Date().toISOString(), lastRemoteUpdatedAt: remote?.updatedAt || remoteRev });
      }

      setSyncStatus("Sync: ok", "ok");
    }catch(err){
      console.error(err);
      setSyncStatus("Sync: Fehler", "err");
    }finally{
      syncing = false;
      rerenderAll();
    }
  }

  function applyRemoteState(state){
    if(!state) return;
    if(Array.isArray(state.entries)){
      const mergedEntries = mergeEntries(visibleEntries(), state.entries, mergeDeleted(loadDeleted(), state.deleted || {}));
      saveRaw(mergedEntries);
    }
    if(state.deleted) saveDeleted(mergeDeleted(loadDeleted(), state.deleted));
    saveMeta({ ...(loadMeta()), lastSyncAt: new Date().toISOString(), lastRemoteUpdatedAt: state.updatedAt || "" });
  }

  async function syncPush(entries=null, reason="manual"){
    if(!vaultId) return;
    if(syncing) return;
    syncing = true;
    setSyncStatus("Sync: sende…", "busy");
    try{
      const state = await syncPushRaw(entries, loadDeleted(), reason);
      applyRemoteState(state);
      setSyncStatus("Sync: ok", "ok");
    }catch(err){
      console.error(err);
      setSyncStatus("Sync: Fehler", "err");
    }finally{
      syncing = false;
      rerenderAll();
    }
  }

  // ---- Auth gate
  function showAuth(){
    if(!authOverlay) return;
    authOverlay.style.display = "flex";
    setSyncStatus("Sync: gesperrt");
  }
  function hideAuth(){
    if(!authOverlay) return;
    authOverlay.style.display = "none";
  }

  // sha256 -> hex (WebCrypto)
  async function sha256Hex(str){
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    const bytes = new Uint8Array(buf);
    return [...bytes].map(b => b.toString(16).padStart(2,"0")).join("");
  }

  async function initAuth(){
    const existing = readAuth();
    if(existing){
      vaultId = existing;
      hideAuth();
      setSyncStatus("Sync: initialisiere…", "busy");
      await syncPull(true);
    }else{
      showAuth();
    }
  }

  authForm?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    authError.style.display = "none";
    const pw = authPassword.value || "";
    if(pw !== GATE_PASSWORD){
      authError.textContent = "Falsches Passwort.";
      authError.style.display = "block";
      return;
    }
    vaultId = await sha256Hex("konsum-tracker|" + pw);
    writeAuth(vaultId);
    hideAuth();
    setSyncStatus("Sync: initialisiere…", "busy");
    await syncPull(true);
  });

  // ---- Rerender all
  function rerenderAll(){
    renderTable();
    renderLast();
    const active = tabPanels.find(p => p.classList.contains("active"));
    if(active?.id === "tab-graph") renderGraph();
    if(active?.id === "tab-monthly") renderMonthly();
    if(active?.id === "tab-intervals") renderIntervals6m();
  }

  // ---- Events
  medicalToggle?.addEventListener("click", () => setMedicalToggle(!medicalXans));
  substanceInput?.addEventListener("change", applySubstanceUI);
  addDrinkBtn?.addEventListener("click", () => addDrinkRow("", ""));

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    try{
      const dt = dtInput.value;
      const sub = substanceInput.value;
      if(!dt){ status("Bitte Datum/Uhrzeit setzen.", "error"); return; }
      if(!sub){ status("Bitte Substanz auswählen.", "error"); return; }

      const nowIso = new Date().toISOString();

      let entry;
      if(sub === "Alkohol"){
        const drinks = getDrinkRows();
        if(!drinks.length){
          status("Bitte mindestens 1 Drink mit ml und % eingeben.", "error");
          return;
        }
        const total = sumAlcoholTotal(drinks);
        const pure = sumAlcoholPure(drinks);
        entry = normalizeEntry({
          id: editId ?? uuid(),
          dt,
          substance: "Alkohol",
          alcohol_drinks: drinks,
          alcohol_total_ml: total,
          alcohol_pure_ml: pure,
          updated_at: nowIso,
          medical: false
        });
      }else{
        const dose = parseDose(doseInput.value);
        if(!Number.isFinite(dose) || dose < 0){
          status("Bitte gültige mg-Dosierung eingeben (z. B. 120 oder 120,5).", "error");
          return;
        }
        entry = normalizeEntry({
          id: editId ?? uuid(),
          dt,
          substance: sub,
          dose_mg: dose,
          medical: (sub === "Xans") ? medicalXans : false,
          updated_at: nowIso
        });
      }

      if(!isValidEntry(entry)){
        status("Ungültiger Eintrag.", "error");
        return;
      }

      // upsert into raw storage
      const raw = loadRaw().map(normalizeEntry).filter(isValidEntry);
      const idx = raw.findIndex(x => x.id === entry.id);
      if(idx >= 0) raw[idx] = entry; else raw.push(entry);
      saveRaw(raw);

      // If edited entry had tombstone, clear it by setting older? easiest: leave; updated_at now will "resurrect" due to filter rule.
      formReset();
      rerenderAll();
      status(editId ? "Update gespeichert." : "Gespeichert.");
      syncPush(null, "save");
    }catch(err){
      console.error(err);
      status("Fehler beim Speichern.", "error");
    }
  });

  resetBtn.addEventListener("click", () => { formReset(); status("Zurückgesetzt."); });
  exportCsvBtn.addEventListener("click", exportCsv);
  backupBtn.addEventListener("click", backupJson);
  clearBtn.addEventListener("click", clearAll);

  filterSubstance.addEventListener("change", renderTable);
  searchInput.addEventListener("input", renderTable);

  restoreInput.addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if(file) await restoreJson(file);
    restoreInput.value = "";
  });

  graphRange?.addEventListener("change", renderGraph);
  graphSubstance?.addEventListener("change", renderGraph);
  graphMetric?.addEventListener("change", renderGraph);

  monthlyFilterSubstance?.addEventListener("change", renderMonthly);
  lastSubstanceSelect?.addEventListener("change", renderLast);

  intervalsRefreshBtn?.addEventListener("click", renderIntervals6m);

  syncNowBtn?.addEventListener("click", () => syncPull(true));

  // ---- Auto sync: focus/online + interval
  window.addEventListener("online", () => syncPull(true));
  document.addEventListener("visibilitychange", () => { if(!document.hidden) syncPull(true); });
  setInterval(() => { if(!document.hidden) syncPull(false); }, 15000);

  // ---- Boot
  formReset();
  renderTable();
  setActiveTab("tab-verlauf");
  renderLast();
  applySubstanceUI();
  initAuth().catch(()=>{});

  // Service Worker (HTTPS on Netlify)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }
})();
