/* Konsum Tracker PWA (Netlify Sync + Auth Gate) */
(() => {
  // ---- Storage keys
  const STORAGE_KEY = "konsumTracker.v1";              // entries array
  const AUTH_KEY    = "konsumTracker.auth.v1";         // { ok:1, vault:"<hex>" }
  const META_KEY    = "konsumTracker.meta.v1";         // { lastSyncAt, lastRemoteUpdatedAt }

  const SUBSTANCES = ["sativa","CBD","Keta","Xans","MDMA","2CB","Pilze"];
  const COLORS = {
    "sativa": "#5dd6ff",
    "CBD":    "#a07bff",
    "Keta":   "#ffb86b",
    "Xans":   "#6bff95",
    "MDMA":   "#ff6bd6",
    "2CB":    "#ffd86b",
    "Pilze":  "#6bd6ff"
  };

  // Simple gate password (visible in JS -> not high security)
  const GATE_PASSWORD = "PeachR";

  // ---- DOM
  const form = document.getElementById("entryForm");
  const dtInput = document.getElementById("dtInput");
  const substanceInput = document.getElementById("substanceInput");
  const doseInput = document.getElementById("doseInput");

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
  const chartCanvas = document.getElementById("monthlyChart");
  const chartLegend = document.getElementById("chartLegend");
  const graphSummary = document.getElementById("graphSummary");

  // Monthly tab
  const monthlyFilterSubstance = document.getElementById("monthlyFilterSubstance");
  const kpiTotalDays = document.getElementById("kpiTotalDays");
  const kpiAvgGapDays = document.getElementById("kpiAvgGapDays");
  const kpiAvgMgPerDay = document.getElementById("kpiAvgMgPerDay");
  const monthlyTbody = document.getElementById("monthlyTbody");
  const monthlyNote = document.getElementById("monthlyNote");

  // Last consumption
  const lastOverallEl = document.getElementById("lastOverall");
  const lastSubstanceSelect = document.getElementById("lastSubstanceSelect");
  const lastSubstanceEl = document.getElementById("lastSubstance");

  // Intervals tab (6 months)
  const intervalsRefreshBtn = document.getElementById("intervalsRefreshBtn");
  const kpi6mEvents = document.getElementById("kpi6mEvents");
  const kpi6mAvg = document.getElementById("kpi6mAvg");
  const kpi6mMedian = document.getElementById("kpi6mMedian");
  const kpi6mMinMax = document.getElementById("kpi6mMinMax");
  const gapHistogramCanvas = document.getElementById("gapHistogram");
  const gapsTbody = document.getElementById("gapsTbody");
  const intervalsNote = document.getElementById("intervalsNote");

  // ---- Inline status line under form
  const statusEl = (() => {
    const p = document.createElement("p");
    p.id = "statusLine";
    p.className = "hint";
    p.style.marginTop = "10px";
    p.style.display = "none";
    form.appendChild(p);
    return p;
  })();

  function status(msg, kind = "info") {
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

  function setSyncStatus(text, state="neutral"){
    if(!syncStatusEl) return;
    syncStatusEl.textContent = text;
    const base = "1px solid rgba(255,255,255,.10)";
    if(state === "ok") syncStatusEl.style.border = "1px solid rgba(107,255,149,.25)";
    else if(state === "err") syncStatusEl.style.border = "1px solid rgba(255,107,107,.25)";
    else if(state === "busy") syncStatusEl.style.border = "1px solid rgba(93,214,255,.25)";
    else syncStatusEl.style.border = base;
  }

  // ---- Helpers
  let editId = null;
  let vaultId = null;              // derived token after auth
  let syncTimer = null;
  let syncing = false;

  function pad(n){ return String(n).padStart(2,"0"); }

  function toLocalDatetimeValue(d){
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth()+1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  function nowDefault(){
    dtInput.value = toLocalDatetimeValue(new Date());
  }

  function parseDose(text){
    const t = String(text ?? "").trim().replace(",", ".");
    return Number(t);
  }

  function uuid(){
    try{
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
      }
    }catch{}
    try{
      if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
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

  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    }catch{
      return [];
    }
  }

  function save(data){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function loadMeta(){
    try{
      const raw = localStorage.getItem(META_KEY);
      return raw ? JSON.parse(raw) : {};
    }catch{
      return {};
    }
  }

  function saveMeta(meta){
    localStorage.setItem(META_KEY, JSON.stringify(meta || {}));
  }

  function normalizeEntry(e){
    const dt = String(e.dt || "");
    const updated_at = String(e.updated_at || dt || new Date().toISOString());
    return {
      id: String(e.id ?? uuid()),
      dt,
      substance: String(e.substance || ""),
      dose_mg: Number(e.dose_mg),
      updated_at
    };
  }

  function fmtDate(dtStr){
    const s = String(dtStr || "").replace("T"," ");
    return s.length >= 16 ? s.slice(0,16) : s;
  }

  function getDayKey(dtStr){ return String(dtStr || "").slice(0,10); }
  function getMonthKey(dtStr){ return String(dtStr || "").slice(0,7); }

  function parseDt(dtStr){
    const s = String(dtStr || "");
    return new Date(s.length === 16 ? (s + ":00") : s);
  }

  function daysBetween(a, b){
    const ms = Math.abs(b - a);
    return ms / (1000*60*60*24);
  }

  function median(nums){
    if(!nums.length) return NaN;
    const a = [...nums].sort((x,y)=>x-y);
    const mid = Math.floor(a.length/2);
    return a.length % 2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
  }

  // ---- Auth
  async function sha256Hex(str){
    const enc = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest("SHA-256", enc);
    const bytes = new Uint8Array(hash);
    return [...bytes].map(b => b.toString(16).padStart(2,"0")).join("");
  }

  function readAuth(){
    try{
      const raw = localStorage.getItem(AUTH_KEY);
      if(!raw) return null;
      const obj = JSON.parse(raw);
      if(obj && obj.ok && typeof obj.vault === "string") return obj;
      return null;
    }catch{
      return null;
    }
  }

  function writeAuth(vault){
    localStorage.setItem(AUTH_KEY, JSON.stringify({ ok: 1, vault }));
  }

  function showAuth(){
    if(!authOverlay) return;
    authOverlay.classList.add("show");
    setSyncStatus("Sync: gesperrt");
    setTimeout(() => authPassword?.focus(), 50);
  }

  function hideAuth(){
    if(!authOverlay) return;
    authOverlay.classList.remove("show");
  }

  authForm?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    authError.style.display = "none";
    const pw = (authPassword.value || "").trim();
    if(!pw){
      authError.textContent = "Bitte Passwort eingeben.";
      authError.style.display = "block";
      return;
    }
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

  // ---- Verlauf table
  function matchesSearch(e, q){
    if(!q) return true;
    const needle = q.toLowerCase();
    const hay = `${e.dt} ${e.substance} ${e.dose_mg}`.toLowerCase();
    return hay.includes(needle);
  }

  function renderTable(){
    const data = load().map(normalizeEntry).sort((a,b) => (b.dt || "").localeCompare(a.dt || ""));
    const fSub = filterSubstance.value;
    const q = (searchInput.value || "").trim();

    const filtered = data.filter(e => {
      if(fSub && e.substance !== fSub) return false;
      return matchesSearch(e, q);
    });

    tbody.innerHTML = "";
    for(const e of filtered){
      const tr = document.createElement("tr");

      const tdDate = document.createElement("td");
      tdDate.className = "mono";
      tdDate.textContent = fmtDate(e.dt);

      const tdSub = document.createElement("td");
      tdSub.textContent = e.substance;

      const tdDose = document.createElement("td");
      tdDose.className = "mono";
      tdDose.textContent = Number.isFinite(e.dose_mg) ? e.dose_mg : "";

      const tdAct = document.createElement("td");

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-secondary";
      editBtn.type = "button";
      editBtn.textContent = "Bearbeiten";
      editBtn.addEventListener("click", () => startEdit(e.id));

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-danger";
      delBtn.type = "button";
      delBtn.style.marginLeft = "8px";
      delBtn.textContent = "Löschen";
      delBtn.addEventListener("click", () => removeEntry(e.id));

      tdAct.appendChild(editBtn);
      tdAct.appendChild(delBtn);

      tr.appendChild(tdDate);
      tr.appendChild(tdSub);
      tr.appendChild(tdDose);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    }

    countInfo.textContent = `${filtered.length} Einträge (gesamt: ${load().length})`;
  }

  function upsertEntry(entry){
    const data = load().map(normalizeEntry);
    const idx = data.findIndex(x => x.id === entry.id);
    if(idx >= 0) data[idx] = entry; else data.push(entry);
    save(data);
  }

  function removeEntry(id){
    const ok = confirm("Diesen Eintrag wirklich löschen?");
    if(!ok) return;
    const data = load().map(normalizeEntry).filter(e => e.id !== id);
    save(data);
    if(editId === id){
      editId = null;
      formReset();
    }
    rerenderAll();
    queueSync();
    status("Eintrag gelöscht.");
  }

  function startEdit(id){
    const data = load().map(normalizeEntry);
    const e = data.find(x => x.id === id);
    if(!e) return;
    editId = id;
    dtInput.value = e.dt;
    substanceInput.value = e.substance;
    doseInput.value = String(e.dose_mg ?? "");
    document.getElementById("saveBtn").textContent = "Update speichern";
    status("Bearbeiten‑Modus.");
  }

  function formReset(){
    editId = null;
    substanceInput.value = "";
    doseInput.value = "";
    nowDefault();
    document.getElementById("saveBtn").textContent = "Speichern";
  }

  // ---- Export / Backup
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
    const data = load().map(normalizeEntry).sort((a,b) => (a.dt || "").localeCompare(b.dt || ""));
    const header = ["date_time", "substance", "dose_mg", "unit"];
    const rows = [header.join(delimiter)];
    for(const e of data){
      rows.push([
        escapeCsv(e.dt, delimiter),
        escapeCsv(e.substance, delimiter),
        escapeCsv(Number.isFinite(e.dose_mg) ? e.dose_mg : "", delimiter),
        "mg"
      ].join(delimiter));
    }
    const stamp = new Date();
    const fn = `konsum_export_${stamp.getFullYear()}-${String(stamp.getMonth()+1).padStart(2,"0")}-${String(stamp.getDate()).padStart(2,"0")}.csv`;
    download(fn, rows.join("\n"), "text/csv;charset=utf-8");
    status("CSV exportiert.");
  }

  function backupJson(){
    const data = load().map(normalizeEntry);
    const stamp = new Date();
    const fn = `konsum_backup_${stamp.getFullYear()}-${String(stamp.getMonth()+1).padStart(2,"0")}-${String(stamp.getDate()).padStart(2,"0")}.json`;
    download(fn, JSON.stringify({version:2, exported_at: stamp.toISOString(), entries: data}, null, 2), "application/json");
    status("Backup heruntergeladen.");
  }

  async function restoreJson(file){
    const text = await file.text();
    let obj;
    try{ obj = JSON.parse(text); }catch{ alert("Backup ist kein gültiges JSON."); return; }
    const entries = Array.isArray(obj) ? obj : (Array.isArray(obj.entries) ? obj.entries : null);
    if(!entries){ alert("Backup hat kein gültiges 'entries'-Feld."); return; }
    const normalized = entries.map(normalizeEntry).filter(e => e.dt && e.substance && Number.isFinite(e.dose_mg));
    const ok = confirm(`Restore überschreibt deinen lokalen Verlauf. Fortfahren? (Einträge: ${normalized.length})`);
    if(!ok) return;
    save(normalized);
    formReset();
    rerenderAll();
    queueSync(true);
    status("Restore abgeschlossen.");
  }

  function clearAll(){
    const ok = confirm("Wirklich ALLE Einträge löschen? (Nicht rückgängig)");
    if(!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    formReset();
    rerenderAll();
    queueSync(true);
    status("Alles gelöscht.");
  }

  // ---- Last consumption
  function computeLast(){
    const data = load().map(normalizeEntry).sort((a,b) => (b.dt || "").localeCompare(a.dt || ""));
    const overall = data.length ? data[0].dt : null;
    const bySub = {};
    for(const s of SUBSTANCES) bySub[s] = null;
    for(const e of data){
      if(bySub[e.substance] == null) bySub[e.substance] = e.dt;
    }
    return {overall, bySub};
  }

  function renderLast(){
    if(!lastOverallEl || !lastSubstanceSelect || !lastSubstanceEl) return;
    const {overall, bySub} = computeLast();
    lastOverallEl.textContent = overall ? fmtDate(overall) : "–";
    const s = lastSubstanceSelect.value || SUBSTANCES[0];
    lastSubstanceEl.textContent = bySub[s] ? fmtDate(bySub[s]) : "–";
  }

  // ---- Graph ranges & buckets
  function startOfDay(d){
    const x = new Date(d);
    x.setHours(0,0,0,0);
    return x;
  }
  function startOfWeek(d){
    const x = startOfDay(d);
    const day = (x.getDay() + 6) % 7; // Mon=0
    x.setDate(x.getDate() - day);
    return x;
  }
  function startOfMonth(d){
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
  function addMonths(d, n){ const x = new Date(d); x.setMonth(x.getMonth()+n); return x; }

  function keyDay(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function keyMonth(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; }
  function labelDay(key){ // YYYY-MM-DD -> DD.MM
    const [y,m,dd] = key.split("-");
    return `${dd}.${m}`;
  }
  function labelMonth(key){ // YYYY-MM -> MM/YY
    const [y,m] = key.split("-");
    return `${m}/${y.slice(2)}`;
  }
  function labelWeek(key){ // key is week-start YYYY-MM-DD
    const [y,m,dd] = key.split("-");
    return `KW ${dd}.${m}`;
  }

  function rangeConfig(value){
    const now = new Date();
    if(value === "week"){
      return { bucket:"day", start: addDays(startOfDay(now), -6), end: startOfDay(now) };
    }
    if(value === "1m"){
      return { bucket:"day", start: addDays(startOfDay(now), -29), end: startOfDay(now) };
    }
    if(value === "3m"){
      return { bucket:"week", start: startOfWeek(addMonths(now, -3)), end: startOfWeek(now) };
    }
    if(value === "6m"){
      return { bucket:"week", start: startOfWeek(addMonths(now, -6)), end: startOfWeek(now) };
    }
    if(value === "12m"){
      return { bucket:"month", start: startOfMonth(addMonths(now, -11)), end: startOfMonth(now) };
    }
    if(value === "24m"){
      return { bucket:"month", start: startOfMonth(addMonths(now, -23)), end: startOfMonth(now) };
    }
    return { bucket:"month", start: startOfMonth(addMonths(now, -11)), end: startOfMonth(now) };
  }

  function listKeys(cfg){
    const keys = [];
    if(cfg.bucket === "day"){
      let cur = new Date(cfg.start);
      while(cur <= cfg.end){
        keys.push(keyDay(cur));
        cur = addDays(cur, 1);
      }
      return keys;
    }
    if(cfg.bucket === "week"){
      let cur = new Date(cfg.start);
      while(cur <= cfg.end){
        keys.push(keyDay(cur)); // week-start as YYYY-MM-DD
        cur = addDays(cur, 7);
      }
      return keys;
    }
    // month
    let cur = new Date(cfg.start);
    while(cur <= cfg.end){
      keys.push(keyMonth(cur));
      cur = addMonths(cur, 1);
    }
    return keys;
  }

  function bucketKeyForDate(cfg, d){
    if(cfg.bucket === "day") return keyDay(startOfDay(d));
    if(cfg.bucket === "week") return keyDay(startOfWeek(d));
    return keyMonth(startOfMonth(d));
  }

  function labelForKey(cfg, key){
    if(cfg.bucket === "day") return labelDay(key);
    if(cfg.bucket === "week") return labelWeek(key);
    return labelMonth(key);
  }

  function buildGraphData(rangeValue, substanceFilter){
    const cfg = rangeConfig(rangeValue);
    const keys = listKeys(cfg);
    const labels = keys.map(k => labelForKey(cfg, k));

    const days = {};
    const mg = {};
    const daySets = {}; // {key: {sub: Set(dayKey)}}

    for(const s of SUBSTANCES){
      days[s] = Object.fromEntries(keys.map(k => [k, 0]));
      mg[s]   = Object.fromEntries(keys.map(k => [k, 0]));
    }
    for(const k of keys){
      daySets[k] = {};
      for(const s of SUBSTANCES) daySets[k][s] = new Set();
    }

    const data = load().map(normalizeEntry);
    for(const e of data){
      const d = parseDt(e.dt);
      if(Number.isNaN(d.getTime())) continue;
      const k = bucketKeyForDate(cfg, d);
      if(!(k in daySets)) continue;
      if(substanceFilter && e.substance !== substanceFilter) continue;
      if(!SUBSTANCES.includes(e.substance)) continue;

      mg[e.substance][k] = (mg[e.substance][k] || 0) + (Number.isFinite(e.dose_mg) ? e.dose_mg : 0);
      daySets[k][e.substance].add(getDayKey(e.dt));
    }

    for(const k of keys){
      for(const s of SUBSTANCES){
        days[s][k] = daySets[k][s].size;
      }
    }

    return {cfg, keys, labels, days, mg};
  }

  function renderLegend(substanceFilter){
    chartLegend.innerHTML = "";
    const list = substanceFilter ? [substanceFilter] : SUBSTANCES;
    for(const s of list){
      const item = document.createElement("div");
      item.className = "legend-item";
      const sw = document.createElement("span");
      sw.className = "legend-swatch";
      sw.style.background = (COLORS[s] || "#5dd6ff");
      item.appendChild(sw);
      const t = document.createElement("span");
      t.textContent = s;
      item.appendChild(t);
      chartLegend.appendChild(item);
    }
  }

  function drawStackedBarChart(canvas, labels, keys, valueMap, daysMap, substanceFilter){
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(600, rect.width || 900);
    const cssH = 360;

    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);

    ctx.clearRect(0,0,cssW,cssH);

    const padding = {l: 46, r: 16, t: 18, b: 54};
    const plotW = cssW - padding.l - padding.r;
    const plotH = cssH - padding.t - padding.b;

    const totals = keys.map(k => {
      if(substanceFilter) return valueMap[substanceFilter]?.[k] || 0;
      let sum = 0;
      for(const s of SUBSTANCES) sum += valueMap[s][k] || 0;
      return sum;
    });

    const maxY = Math.max(1, ...totals);
    const yTicks = 4;
    const tickStep = maxY <= 10 ? 2 : Math.ceil(maxY / yTicks);

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
    const gap = n > 20 ? 3 : 6;
    const barW = Math.max(6, (plotW - gap*(n-1)) / n);

    ctx.font = "11px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial";
    ctx.textAlign = "center";

    for(let i=0;i<n;i++){
      const k = keys[i];
      const x = padding.l + i*(barW + gap);
      let yBase = padding.t + plotH;

      if(substanceFilter){
        const v = valueMap[substanceFilter]?.[k] || 0;
        const h = (v / (tickStep*yTicks)) * plotH;
        ctx.fillStyle = (COLORS[substanceFilter] || "#5dd6ff") + "cc";
        ctx.fillRect(x, yBase - h, barW, h);

        const dCount = daysMap[substanceFilter]?.[k] || 0;
        if(dCount > 0){
          ctx.fillStyle = "rgba(233,238,247,.95)";
          const yText = h > 18 ? (yBase - h + 12) : (yBase - h - 4);
          ctx.fillText(String(dCount), x + barW/2, yText);
        }
      }else{
        for(const s of SUBSTANCES){
          const v = valueMap[s]?.[k] || 0;
          if(!v) continue;
          const h = (v / (tickStep*yTicks)) * plotH;
          ctx.fillStyle = (COLORS[s] || "#5dd6ff") + "cc";
          ctx.fillRect(x, yBase - h, barW, h);

          const dCount = daysMap[s]?.[k] || 0;
          if(dCount > 0 && h > 16){
            ctx.fillStyle = "rgba(233,238,247,.95)";
            ctx.fillText(String(dCount), x + barW/2, yBase - h/2 + 4);
          }
          yBase -= h;
        }
      }

      // x label
      if(n <= 14 || i % 2 === 0 || i === n-1){
        ctx.fillStyle = "rgba(142,160,191,.9)";
        const lbl = labels[i];
        ctx.save();
        ctx.translate(x + barW/2, padding.t + plotH + 36);
        ctx.rotate(-0.6);
        ctx.fillText(lbl, 0, 0);
        ctx.restore();
      }
    }

    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.moveTo(padding.l, padding.t);
    ctx.lineTo(padding.l, padding.t + plotH);
    ctx.lineTo(padding.l + plotW, padding.t + plotH);
    ctx.stroke();
  }

  function renderGraph(){
    if(!chartCanvas) return;
    const range = graphRange.value || "12m";
    const sub = graphSubstance.value || "";
    const metric = graphMetric.value || "days";

    const {keys, labels, days, mg} = buildGraphData(range, sub || null);

    const valueMap = metric === "mg" ? mg : days;

    renderLegend(sub || null);
    drawStackedBarChart(chartCanvas, labels, keys, valueMap, days, sub || null);

    // Summary
    const sumFor = (map, s) => keys.reduce((acc,k)=>acc + (map[s]?.[k]||0),0);
    const totalDaysAll = SUBSTANCES.reduce((acc,s)=>acc + sumFor(days, s), 0);
    const totalMgAll = SUBSTANCES.reduce((acc,s)=>acc + sumFor(mg, s), 0);
    const metricTxt = metric === "mg" ? "Konsummenge (mg)" : "Konsumtage";
    const valueTxt = metric === "mg" ? (sub ? sumFor(mg, sub) : totalMgAll) : (sub ? sumFor(days, sub) : totalDaysAll);

    const rangeLabel = {
      "week":"Letzte Woche",
      "1m":"Letzten Monat",
      "3m":"Letzten 3 Monate",
      "6m":"Letzten 6 Monate",
      "12m":"Letzten 12 Monate",
      "24m":"Letzten 24 Monate"
    }[range] || "Zeitraum";

    graphSummary.textContent = `Zeitraum: ${rangeLabel} • ${sub ? sub : "Alle"} • ${metricTxt}: ${Number.isFinite(valueTxt) ? valueTxt.toFixed(metric==="mg"?1:0) : "–"} • Zahlen auf Balken = Konsumtage.`;
  }

  // ---- Monthly stats (Konsumtage + mg pro Konsumtag)
  function computeMonthlyStats(subFilter){
    const data = load().map(normalizeEntry)
      .filter(e => !subFilter || e.substance === subFilter)
      .sort((a,b)=> (a.dt||"").localeCompare(b.dt||""));

    const daySet = new Set(data.map(e => getDayKey(e.dt)));
    const totalDays = daySet.size;

    const totalMg = data.reduce((acc,e)=> acc + (Number.isFinite(e.dose_mg) ? e.dose_mg : 0), 0);
    const avgMgPerDay = totalDays ? (totalMg / totalDays) : NaN;

    const daysList = [...daySet].sort();
    const gaps = [];
    for(let i=1;i<daysList.length;i++){
      const a = new Date(daysList[i-1] + "T00:00:00");
      const b = new Date(daysList[i] + "T00:00:00");
      gaps.push(daysBetween(a,b));
    }
    const avgGap = gaps.length ? (gaps.reduce((x,y)=>x+y,0)/gaps.length) : NaN;

    const monthMap = new Map(); // mk -> {mg, daySet}
    for(const e of data){
      const mk = getMonthKey(e.dt);
      if(!monthMap.has(mk)) monthMap.set(mk, { mg: 0, daySet: new Set() });
      const obj = monthMap.get(mk);
      obj.mg += Number.isFinite(e.dose_mg) ? e.dose_mg : 0;
      obj.daySet.add(getDayKey(e.dt));
    }

    const months = [...monthMap.keys()].sort().reverse();
    const rows = months.map(mk => {
      const obj = monthMap.get(mk);
      const days = obj.daySet.size;
      const mgPerDay = days ? (obj.mg / days) : NaN;
      return { month: mk, days, mgPerDay, mg: obj.mg };
    });

    return {totalDays, totalMg, avgMgPerDay, avgGap, rows};
  }

  function renderMonthly(){
    const sub = monthlyFilterSubstance.value || "";
    const {totalDays, avgMgPerDay, avgGap, rows} = computeMonthlyStats(sub || null);

    kpiTotalDays.textContent = String(totalDays);
    kpiAvgGapDays.textContent = Number.isFinite(avgGap) ? (avgGap.toFixed(2) + " Tage") : "–";
    kpiAvgMgPerDay.textContent = Number.isFinite(avgMgPerDay) ? (avgMgPerDay.toFixed(1) + " mg") : "–";

    monthlyTbody.innerHTML = "";
    for(const r of rows){
      const tr = document.createElement("tr");
      const tdM = document.createElement("td"); tdM.className = "mono"; tdM.textContent = r.month;
      const tdD = document.createElement("td"); tdD.className = "mono"; tdD.textContent = String(r.days);
      const tdA = document.createElement("td"); tdA.className = "mono"; tdA.textContent = Number.isFinite(r.mgPerDay) ? r.mgPerDay.toFixed(1) : "–";
      const tdS = document.createElement("td"); tdS.className = "mono"; tdS.textContent = Number.isFinite(r.mg) ? r.mg.toFixed(1) : "–";
      tr.appendChild(tdM); tr.appendChild(tdD); tr.appendChild(tdA); tr.appendChild(tdS);
      monthlyTbody.appendChild(tr);
    }

    monthlyNote.textContent = sub
      ? `Filter aktiv: ${sub}. Konsumtage = einzigartige Kalendertage mit mindestens 1 Eintrag.`
      : `Konsumtage = einzigartige Kalendertage mit mindestens 1 Eintrag.`;

    renderLast();
  }

  // ---- Intervals (last 6 months) (events-based)
  function computeIntervals6m(){
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 6);

    const data = load()
      .map(normalizeEntry)
      .filter(e => {
        const d = parseDt(e.dt);
        return d >= cutoff && d <= now;
      })
      .sort((a,b)=> (a.dt||"").localeCompare(a.dt||""));

    const gaps = [];
    for(let i=1;i<data.length;i++){
      const prev = data[i-1];
      const cur = data[i];
      const a = parseDt(prev.dt);
      const b = parseDt(cur.dt);
      const dh = (b - a) / (1000*60*60);
      gaps.push({ from: prev.dt, to: cur.dt, deltaHours: dh, fromSub: prev.substance, toSub: cur.substance });
    }

    const hours = gaps.map(g => g.deltaHours).filter(x => Number.isFinite(x) && x >= 0);
    const avgH = hours.length ? hours.reduce((x,y)=>x+y,0) / hours.length : NaN;
    const medH = hours.length ? median(hours) : NaN;
    const minH = hours.length ? Math.min(...hours) : NaN;
    const maxH = hours.length ? Math.max(...hours) : NaN;

    return {data, gaps, hours, avgH, medH, minH, maxH, cutoff};
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
    const cssW = Math.max(600, rect.width || 900);
    const cssH = 320;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);

    ctx.clearRect(0,0,cssW,cssH);

    const padding = {l: 46, r: 16, t: 18, b: 52};
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
    const {data, gaps, hours, avgH, medH, minH, maxH, cutoff} = computeIntervals6m();

    kpi6mEvents.textContent = String(data.length);
    kpi6mAvg.textContent = Number.isFinite(avgH) ? humanGap(avgH) : "–";
    kpi6mMedian.textContent = Number.isFinite(medH) ? humanGap(medH) : "–";
    kpi6mMinMax.textContent = (Number.isFinite(minH) && Number.isFinite(maxH)) ? `${humanGap(minH)} / ${humanGap(maxH)}` : "–";

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
    const last = [...gaps].sort((a,b)=> (b.to||"").localeCompare(a.to||"")).slice(0, 12);
    for(const g of last){
      const tr = document.createElement("tr");
      const tdF = document.createElement("td"); tdF.className="mono"; tdF.textContent = fmtDate(g.from);
      const tdT = document.createElement("td"); tdT.className="mono"; tdT.textContent = fmtDate(g.to);
      const tdD = document.createElement("td"); tdD.className="mono"; tdD.textContent = humanGap(g.deltaHours);
      const tdS = document.createElement("td"); tdS.textContent = `${g.fromSub} → ${g.toSub}`;
      tr.appendChild(tdF); tr.appendChild(tdT); tr.appendChild(tdD); tr.appendChild(tdS);
      gapsTbody.appendChild(tr);
    }

    intervalsNote.textContent = `Zeitraum: ${cutoff.toISOString().slice(0,10)} bis heute. Abstände werden zwischen aufeinanderfolgenden Einträgen berechnet (egal welche Substanz).`;
  }

  function rerenderAll(){
    renderTable();
    renderLast();
    const active = tabPanels.find(p => p.classList.contains("active"));
    if(active?.id === "tab-graph") renderGraph();
    if(active?.id === "tab-monthly") renderMonthly();
    if(active?.id === "tab-intervals") renderIntervals6m();
  }

  // ---- Sync (Netlify Blobs via function)
  function apiUrl(){
    return `/.netlify/functions/konsum-sync?vault=${vaultId}`;
  }

  

  async function syncPushRaw(entries=null, reason="auto"){
    if(!vaultId){ setSyncStatus("Sync: aus"); return false; }
    try{
      const payloadEntries = (entries ?? load().map(normalizeEntry)).map(normalizeEntry);
      const updatedAt = latestUpdatedAt(payloadEntries);
      const body = JSON.stringify({ version: 2, updatedAt, entries: payloadEntries, reason });
      const resp = await fetch(apiUrl(), { method: "PUT", headers: { "Content-Type": "application/json" }, body });
      if(!resp.ok){ setSyncStatus(`Sync: Fehler (${resp.status})`, "err"); return false; }
      setSyncStatus("Sync: ok", "ok");
      saveMeta({ ...(loadMeta()), lastSyncAt: new Date().toISOString(), lastRemoteUpdatedAt: updatedAt });
      return true;
    }catch(err){ console.error(err); setSyncStatus("Sync: offline/blocked", "err"); return false; }
  }

function latestUpdatedAt(entries){
    let best = "";
    for(const e of entries){
      const t = String(e.updated_at || "");
      if(t > best) best = t;
    }
    return best || new Date(0).toISOString();
  }

  function mergeEntries(localEntries, remoteEntries){
    const map = new Map();
    for(const e of localEntries.map(normalizeEntry)) map.set(e.id, e);
    for(const e of remoteEntries.map(normalizeEntry)){
      const cur = map.get(e.id);
      if(!cur) map.set(e.id, e);
      else{
        const a = String(cur.updated_at || "");
        const b = String(e.updated_at || "");
        map.set(e.id, (b > a) ? e : cur);
      }
    }
    return [...map.values()].filter(e => e.dt && e.substance && Number.isFinite(e.dose_mg));
  }

  async function syncPull(firstRun=false){
    if(!vaultId){
      setSyncStatus("Sync: aus");
      return;
    }
    if(syncing) return;
    syncing = true;
    setSyncStatus("Sync: lade…", "busy");

    try{
      const resp = await fetch(apiUrl(), { method: "GET", cache: "no-store" });
      if(resp.status === 404){
        // nothing remote yet
        setSyncStatus("Sync: leer", "ok");
        // push local if we have data
        const local = load().map(normalizeEntry);
        if(local.length) await syncPushRaw(local, "init");
        return;
      }
      if(!resp.ok){
        setSyncStatus(`Sync: Fehler (${resp.status})`, "err");
        return;
      }
      const remote = await resp.json();
      const remoteEntries = Array.isArray(remote.entries) ? remote.entries : [];
      const localEntries = load().map(normalizeEntry);

      const merged = mergeEntries(localEntries, remoteEntries);
      save(merged);

      // if our merged is "newer", push back
      const localLatest = latestUpdatedAt(merged);
      const remoteLatest = latestUpdatedAt(remoteEntries.map(normalizeEntry));
      if(localLatest > remoteLatest){
        await syncPushRaw(merged, "merge");
      }else{
        setSyncStatus("Sync: ok", "ok");
        saveMeta({ ...(loadMeta()), lastRemoteUpdatedAt: remoteLatest, lastSyncAt: new Date().toISOString() });
      }

      if(firstRun) rerenderAll();
    }catch(err){
      console.error(err);
      setSyncStatus("Sync: offline/blocked", "err");
    }finally{
      syncing = false;
    }
  }

  async function syncPush(entries=null, reason="auto"){
    if(!vaultId){ setSyncStatus("Sync: aus"); return; }
    if(syncing) return;
    syncing = true;
    setSyncStatus("Sync: sende…", "busy");
    try{
      await syncPushRaw(entries, reason);
    }finally{
      syncing = false;
    }
  }

  function queueSync(immediate=false){
    if(!vaultId) return;
    if(syncTimer) clearTimeout(syncTimer);
    const delay = immediate ? 50 : 900;
    syncTimer = setTimeout(() => syncPush(null, "debounced"), delay);
  }

  // manual sync
  syncNowBtn?.addEventListener("click", async () => {
    await syncPull();
    await syncPush(null, "manual");
    status("Sync ausgelöst.");
  });

  // ---- Events
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    try{
      const dt = dtInput.value;
      const substance = substanceInput.value;
      const dose = parseDose(doseInput.value);

      if(!dt){ status("Bitte Datum/Uhrzeit setzen.", "error"); return; }
      if(!substance){ status("Bitte eine Substanz auswählen.", "error"); return; }
      if(!Number.isFinite(dose)){ status("Bitte gültige mg‑Dosierung eingeben (z. B. 120 oder 120,5).", "error"); return; }
      if(dose < 0){ status("Dosierung muss ≥ 0 sein.", "error"); return; }

      const entryId = editId ?? uuid();
      const nowIso = new Date().toISOString();
      const entry = normalizeEntry({ id: entryId, dt, substance, dose_mg: dose, updated_at: nowIso });

      upsertEntry(entry);
      formReset();
      rerenderAll();
      queueSync();
      status("Gespeichert.");
    }catch(err){
      console.error(err);
      status("Fehler beim Speichern (Details in Konsole).", "error");
      alert("Fehler beim Speichern. Öffne die Seite ggf. neu und versuche es nochmal.");
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
  intervalsRefreshBtn?.addEventListener("click", renderIntervals6m);

  lastSubstanceSelect?.addEventListener("change", renderLast);

  // ---- Init
  function init(){
    // migrate/normalize without deleting
    const normalized = load().map(normalizeEntry);
    save(normalized);

    formReset();
    renderTable();
    renderLast();
    setActiveTab("tab-verlauf");
    setSyncStatus(vaultId ? "Sync: initialisiere…" : "Sync: aus", vaultId ? "busy" : "neutral");

    // Service Worker (needs HTTPS)
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./service-worker.js").catch(() => {});
      });
    }
  }

  (async () => {
    const auth = readAuth();
    if(auth && auth.vault){
      vaultId = auth.vault;
      hideAuth();
      init();
      await syncPull(true);
    }else{
      init(); // still allow local usage, but gate UI
      showAuth();
    }
  })();
})();
