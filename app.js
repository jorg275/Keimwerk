
let laatsteData = null;
const BASIS_GEVELS = ["Voorkant", "Rechts", "Achter", "Links"];

const TEMPLATE_TEXT = `Strekkende meter donkere band totaal woning:

Voorkant 
Totaal aantal deuren:
Totaal aantal ramen:
Totaal regenpijpen:

Muren

Ramen

Rechts  
Totaal aantal deuren:
Totaal aantal ramen:
Totaal regenpijpen:

Muren

Ramen

Achter
Totaal aantal deuren:
Totaal aantal ramen:
Totaal regenpijpen:

Muren

Ramen

Links 
Totaal aantal deuren:
Totaal aantal ramen:
Totaal regenpijpen:

Muren

Ramen

Extra toevoegingen:`;

function getExtraNames(){
  return (document.getElementById("extraOnderdelen")?.value || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}
function getAllSectionNames(){ return [...BASIS_GEVELS, ...getExtraNames()]; }
function normalizeNumber(str){ return parseFloat(String(str).replace(",", ".").trim()); }
function round2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }
function format2(n){ return round2(n).toFixed(2).replace(".", ","); }
function debounce(fn, wait){
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
function escapeHtml(str){
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function getAdresSamengesteld(){
  const straat = (document.getElementById("adresZoek")?.value || "").trim();
  const postcode = (document.getElementById("postcode")?.value || "").trim().toUpperCase();
  const plaats = (document.getElementById("plaats")?.value || "").trim();
  return [straat, [postcode, plaats].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}
function syncAdresHiddenField(){
  const hidden = document.getElementById("adres");
  if(hidden) hidden.value = getAdresSamengesteld();
}
function parseOptionalNumber(val){
  const s = String(val || "").trim().replace(",", ".");
  if(!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? round2(n) : null;
}
function copyText(text){
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand("copy"); } catch(e) {}
  document.body.removeChild(ta);
  return Promise.resolve();
}
function detectCount(line, patterns){
  const low = line.toLowerCase();
  for(const p of patterns){
    if(low.includes(p)){
      const m = low.match(/(\d+)/g);
      if(m && m.length) return parseInt(m[m.length-1], 10);
      return 0;
    }
  }
  return null;
}
function parseMeasurementLine(line){
  let clean = line.trim();
  if(!clean) return null;
  clean = clean.replace(/-/g, "").replace(/\s+/g, "");
  let m2Match = clean.match(/^(\d+(?:[.,]\d+)?)m2$/i);
  if(m2Match) return { expr: clean, m2: round2(normalizeNumber(m2Match[1])) };

  let plainNumber = clean.match(/^(\d+(?:[.,]\d+)?)$/);
  if(plainNumber) return { expr: clean + "m2", m2: round2(normalizeNumber(plainNumber[1])) };

  const multMatch = clean.match(/^(\d+(?:[.,]\d+)?)x(\d+(?:[.,]\d+)?)(?:x(\d+))?$/i);
  if(multMatch){
    const a = normalizeNumber(multMatch[1]), b = normalizeNumber(multMatch[2]), mult = multMatch[3] ? parseInt(multMatch[3], 10) : 1;
    return { expr: clean, m2: round2(a*b*mult) };
  }

  const formula = clean.toLowerCase().replace(/,/g, ".").replace(/x/g, "*");
  if(/^[0-9+*/().]+$/.test(formula) && /[*/+]/.test(formula)){
    try{
      const result = Function('"use strict"; return (' + formula + ');')();
      if(Number.isFinite(result)){
        return { expr: clean, m2: round2(result) };
      }
    } catch(e){}
  }
  return null;
}
function createSection(name){
  return { naam:name, deurCount:0, raamCount:0, pipeCount:0, muren:[], deuren:[], ramen:[], bruto:0, aftrekDeuren:0, aftrekRamen:0, aftrek:0, netto:0 };
}
function parseInput(text){
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const allNames = getAllSectionNames();
  const sections = {};
  let currentGevel = null, mode = null;
  allNames.forEach(g => sections[g] = createSection(g));
  const gevelLookup = {};
  allNames.forEach(name => gevelLookup[name.toLowerCase()] = name);
  const warnings = [];

  for(let raw of lines){
    const line = raw.trim();
    if(!line) continue;
    const normalized = line.toLowerCase().replace(/\s+/g, " ").trim();
    if(gevelLookup[normalized]){ currentGevel = gevelLookup[normalized]; mode = null; continue; }
    if(!currentGevel) continue;
    const cntDeur = detectCount(line, ["totaal aantal deuren", "aantal deuren"]);
    if(cntDeur !== null && !normalized.includes("ramen")){ sections[currentGevel].deurCount = cntDeur; continue; }
    const cntRaam = detectCount(line, ["totaal aantal ramen", "aantal ramen"]);
    if(cntRaam !== null){ sections[currentGevel].raamCount = cntRaam; continue; }
    const cntPipe = detectCount(line, ["totaal regenpijpen", "totaal regen pijpen"]);
    if(cntPipe !== null){ sections[currentGevel].pipeCount = cntPipe; continue; }
    if(normalized === "muren"){ mode = "muren"; continue; }
    if(normalized === "deuren"){ mode = "deuren"; continue; }
    if(normalized === "ramen"){ mode = "ramen"; continue; }
    const parsed = parseMeasurementLine(line);
    if(parsed){
      if(mode === "muren") sections[currentGevel].muren.push(parsed);
      else if(mode === "deuren") sections[currentGevel].deuren.push(parsed);
      else if(mode === "ramen") sections[currentGevel].ramen.push(parsed);
      else warnings.push(`Regel zonder blok bij ${currentGevel}: ${line}`);
    }
  }

  let totaalBruto=0, totaalAftrek=0, totaalDeuren=0, totaalRamen=0, totaalPipe=0;
  allNames.forEach(g => {
    const sec = sections[g];
    sec.bruto = round2(sec.muren.reduce((s,r)=>s+r.m2,0));
    sec.aftrekDeuren = round2(sec.deuren.reduce((s,r)=>s+r.m2,0));
    sec.aftrekRamen = round2(sec.ramen.reduce((s,r)=>s+r.m2,0));
    sec.aftrek = round2(sec.aftrekDeuren + sec.aftrekRamen);
    sec.netto = round2(sec.bruto - sec.aftrek);
    totaalBruto += sec.bruto; totaalAftrek += sec.aftrek; totaalDeuren += sec.deurCount || 0; totaalRamen += sec.raamCount || 0; totaalPipe += sec.pipeCount || 0;
  });

  let donkereBand = null;
  {
    const match = text.match(/Strekkende meter donkere band totaal woning\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
    if(match) donkereBand = parseOptionalNumber(match[1]);
  }

  return {
    naam: document.getElementById("naam").value.trim(),
    adres: getAdresSamengesteld(),
    datum: new Date().toLocaleDateString("nl-NL"),
    extraNames: getExtraNames(),
    donkereBand,
    sectionNames: allNames,
    gevels: sections,
    totaalBruto: round2(totaalBruto),
    totaalAftrek: round2(totaalAftrek),
    totaalNetto: round2(totaalBruto - totaalAftrek),
    totaalDeuren, totaalRamen, totaalPipe, warnings
  };
}
function renderResult(data){
  const res = document.getElementById("resultaat");
  res.classList.remove("leeg");
  let html = `
    <div class="overview">
      <div class="metric"><div class="label">Netto totaal</div><div class="value">${format2(data.totaalNetto)} m²</div></div>
      <div class="metric"><div class="label">Bruto totaal</div><div class="value">${format2(data.totaalBruto)} m²</div></div>
      <div class="metric"><div class="label">Aftrek totaal</div><div class="value">${format2(data.totaalAftrek)} m²</div></div>
      <div class="metric"><div class="label">Totaal deuren</div><div class="value">${data.totaalDeuren}</div></div>
      <div class="metric"><div class="label">Totaal ramen</div><div class="value">${data.totaalRamen}</div></div>
      <div class="metric"><div class="label">Regenpijpen</div><div class="value">${data.totaalPipe}</div></div>
      ${data.donkereBand !== null ? `<div class="metric"><div class="label">Donkere band</div><div class="value">${format2(data.donkereBand)} m1</div></div>` : ""}
    </div>`;
  data.sectionNames.forEach(g => {
    const sec = data.gevels[g];
    html += `<div class="gevel">
      <h3>${g}</h3>
      <table>
        <tr><th>Onderdeel</th><th>Waarde</th></tr>
        <tr><td>Bruto</td><td>${format2(sec.bruto)} m²</td></tr>
        <tr><td>Aftrek deuren</td><td>${format2(sec.aftrekDeuren)} m²</td></tr>
        <tr><td>Aftrek ramen</td><td>${format2(sec.aftrekRamen)} m²</td></tr>
        <tr><td>Aftrek totaal</td><td>${format2(sec.aftrek)} m²</td></tr>
        <tr><td>Netto</td><td>${format2(sec.netto)} m²</td></tr>
        <tr><td>Deuren</td><td>${sec.deurCount}</td></tr>
        <tr><td>Ramen</td><td>${sec.raamCount}</td></tr>
        <tr><td>Regenpijpen</td><td>${sec.pipeCount}</td></tr>
      </table>
      <table>
        <tr><th>Type</th><th>Berekening</th><th>m²</th></tr>
        ${sec.muren.map(r => `<tr><td>Muren</td><td>${r.expr}</td><td>${format2(r.m2)} m²</td></tr>`).join("")}
        ${sec.deuren.map(r => `<tr><td>Deuren aftrek</td><td>${r.expr}</td><td>${format2(r.m2)} m²</td></tr>`).join("")}
        ${sec.ramen.map(r => `<tr><td>Ramen aftrek</td><td>${r.expr}</td><td>${format2(r.m2)} m²</td></tr>`).join("")}
      </table>
    </div>`;
  });
  res.innerHTML = html;
}
function saveProject(){
  if(!laatsteData){ setMessage("Verwerk eerst de opname."); return; }
  const key = "keimwerken-projecten";
  const existing = JSON.parse(localStorage.getItem(key) || "[]");
  syncAdresHiddenField();
  const item = {
    id: Date.now(),
    naam: document.getElementById("naam").value.trim(),
    adres: getAdresSamengesteld(),
    extraOnderdelen: document.getElementById("extraOnderdelen").value.trim(),
    straat: document.getElementById("adresZoek").value.trim(),
    postcode: document.getElementById("postcode").value.trim(),
    plaats: document.getElementById("plaats").value.trim(),
    input: document.getElementById("input").value,
    datum: new Date().toLocaleString("nl-NL")
  };
  existing.unshift(item);
  localStorage.setItem(key, JSON.stringify(existing.slice(0, 50)));
  renderProjects(); setMessage("Project opgeslagen.");
}
function renderProjects(){
  const wrap = document.getElementById("projecten");
  const arr = JSON.parse(localStorage.getItem("keimwerken-projecten") || "[]");
  if(!arr.length){ wrap.innerHTML = '<div class="resultaat leeg">Nog geen projecten opgeslagen.</div>'; return; }
  wrap.innerHTML = arr.map(item => `
    <div class="project-item">
      <div class="project-meta">
        <strong>${item.naam || "Zonder naam"}</strong>
        <div>${item.adres || ""}</div>
        ${item.extraOnderdelen ? `<div>${item.extraOnderdelen}</div>` : ""}
        <div>${item.datum}</div>
      </div>
      <div class="project-actions">
        <button class="small-btn" onclick="openProject(${item.id})">Openen</button>
        <button class="small-btn" onclick="deleteProject(${item.id})">Verwijderen</button>
      </div>
    </div>`).join("");
}
function openProject(id){
  const arr = JSON.parse(localStorage.getItem("keimwerken-projecten") || "[]");
  const item = arr.find(x => x.id === id);
  if(!item) return;
  document.getElementById("naam").value = item.naam || "";
  document.getElementById("adresZoek").value = item.straat || "";
  document.getElementById("postcode").value = item.postcode || "";
  document.getElementById("plaats").value = item.plaats || "";
  syncAdresHiddenField();
  document.getElementById("extraOnderdelen").value = item.extraOnderdelen || "";
  document.getElementById("input").value = item.input || "";
  processInput();
}
function deleteProject(id){
  const arr = JSON.parse(localStorage.getItem("keimwerken-projecten") || "[]");
  localStorage.setItem("keimwerken-projecten", JSON.stringify(arr.filter(x => x.id !== id)));
  renderProjects();
}
function setMessage(msg){ document.getElementById("melding").textContent = msg || ""; }
function loadImageAsDataURL(url){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = url + "?v=" + Date.now();
  });
}
async function makePdf(){
  if(!laatsteData){ processInput(); if(!laatsteData) return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"mm", format:"a4"});
  const blue = [31,95,153], dark = [24,53,79];
  const logoImg = await loadImageAsDataURL("logo.png");

  function addHeader(title, subtitle1, subtitle2, subtitle3){
    doc.setFont("helvetica","bold"); doc.setFontSize(22); doc.setTextColor(...dark); doc.text(title, 14, 20);
    doc.setFont("helvetica","normal"); doc.setFontSize(10);
    doc.text(subtitle1 || "", 14, 31); doc.text(subtitle2 || "", 14, 37); doc.text(subtitle3 || "", 14, 43);
    const boxW = 78, boxH = 26;
    const props = doc.getImageProperties(logoImg);
    const ratio = Math.min(boxW / props.width, boxH / props.height);
    const w = props.width * ratio, h = props.height * ratio;
    doc.addImage(logoImg, "PNG", 210 - 14 - w, 12, w, h);
    doc.setDrawColor(180); doc.line(14, 48, 196, 48);
  }

  // Pagina 1: alleen overzicht
  addHeader("GEVELBEREKENING", laatsteData.naam, laatsteData.adres, "Datum: " + laatsteData.datum);
  doc.setFont("helvetica","bold"); doc.setFontSize(13); doc.text("Overzicht", 14, 58);

  const overviewBody = [
    ["Netto totaal", `${format2(laatsteData.totaalNetto)} m²`],
    ["Bruto totaal", `${format2(laatsteData.totaalBruto)} m²`],
    ["Aftrek totaal", `${format2(laatsteData.totaalAftrek)} m²`],
    ["Totaal deuren", `${laatsteData.totaalDeuren}`],
    ["Totaal ramen", `${laatsteData.totaalRamen}`],
    ["Totaal regenpijpen", `${laatsteData.totaalPipe}`],
  ];
  if(laatsteData.donkereBand !== null) overviewBody.push(["Donkere band", `${format2(laatsteData.donkereBand)} m1`]);

  doc.autoTable({
    startY:62,
    head:[["Omschrijving","Waarde"]],
    body:overviewBody,
    theme:"grid",
    headStyles:{fillColor:blue, halign:"left"},
    styles:{font:"helvetica", fontSize:10, cellPadding:3}
  });

  // Vanaf pagina 2: gevelspecificatie
  for(let i=0; i<laatsteData.sectionNames.length; i++){
    const g = laatsteData.sectionNames[i];
    const sec = laatsteData.gevels[g];

    doc.addPage();
    addHeader("GEVELBEREKENING", laatsteData.naam, laatsteData.adres, "Datum: " + laatsteData.datum);

    if(i === 0){
      doc.setFont("helvetica","bold");
      doc.setFontSize(12);
      doc.text("Gevelspecificatie", 14, 58);
      doc.setFontSize(11);
      doc.text(g, 14, 66);
      var startY = 70;
    } else {
      doc.setFont("helvetica","bold");
      doc.setFontSize(11);
      doc.text(g, 14, 58);
      var startY = 62;
    }

    doc.autoTable({
      startY,
      head:[["Onderdeel","Waarde"]],
      body:[
        ["Bruto", `${format2(sec.bruto)} m²`],
        ["Aftrek ramen en deuren", `${format2(sec.aftrek)} m²`],
        ["Netto", `${format2(sec.netto)} m²`],
        ["Deuren", `${sec.deurCount}`],
        ["Ramen", `${sec.raamCount}`],
        ["Regenpijpen", `${sec.pipeCount}`],
      ],
      theme:"grid",
      headStyles:{fillColor:blue, halign:"left"},
      styles:{font:"helvetica", fontSize:10, cellPadding:3}
    });

    let rows = [];
    sec.muren.forEach(r => rows.push(["Muren", r.expr, `${format2(r.m2)} m²`]));
    sec.deuren.forEach(r => rows.push(["Deuren aftrek", r.expr, `${format2(r.m2)} m²`]));
    sec.ramen.forEach(r => rows.push(["Ramen aftrek", r.expr, `${format2(r.m2)} m²`]));
    if(!rows.length) rows.push(["-","-","-"]);

    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head:[["Type","Berekening","m²"]],
      body:rows,
      theme:"plain",
      headStyles:{fillColor:[230,236,242], textColor:dark, halign:"left"},
      styles:{font:"helvetica", fontSize:10, cellPadding:3},
      alternateRowStyles:{fillColor:[248,250,252]}
    });
  }

  const safeName = (laatsteData.naam || "project").replace(/[^a-z0-9-_]/gi, "_");
  doc.save(`gevelberekening_${safeName}.pdf`);
}


let actieveSuggesties = [];

function hideSuggesties(){
  const box = document.getElementById("adresSuggesties");
  if(box){
    box.hidden = true;
    box.innerHTML = "";
  }
  actieveSuggesties = [];
}
function toonSuggesties(items){
  const box = document.getElementById("adresSuggesties");
  if(!box) return;
  actieveSuggesties = items || [];
  if(!items || !items.length){
    hideSuggesties();
    return;
  }
  box.innerHTML = items.map((item, index) => `
    <button type="button" class="suggestion-item" data-index="${index}">
      <strong>${escapeHtml(item.weergavenaam || "")}</strong>
      <span>${escapeHtml(item.postcode || "")} ${escapeHtml(item.woonplaatsnaam || "")}</span>
    </button>
  `).join("");
  box.hidden = false;
}
async function zoekAdresSuggesties(query){
  const q = String(query || "").trim();
  if(q.length < 4){
    hideSuggesties();
    return;
  }
  try{
    const suggestUrl = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest?fq=type:adres&q=" + encodeURIComponent(q);
    const suggestRes = await fetch(suggestUrl);
    const suggestData = await suggestRes.json();
    const docs = suggestData?.response?.docs || [];
    const items = docs.slice(0, 8).map(doc => ({
      id: doc.id,
      weergavenaam: doc.weergavenaam || q
    }));
    if(!items.length){
      hideSuggesties();
      return;
    }
    const enriched = await Promise.all(items.map(async (item) => {
      try{
        const lookupUrl = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup?id=" + encodeURIComponent(item.id);
        const lookupRes = await fetch(lookupUrl);
        const lookupData = await lookupRes.json();
        const detail = lookupData?.response?.docs?.[0] || {};
        return {
          ...item,
          straatnaam: detail.straatnaam || "",
          huisnummer: detail.huisnummer || "",
          huisletter: detail.huisletter || "",
          huisnummertoevoeging: detail.huisnummertoevoeging || "",
          postcode: detail.postcode || "",
          woonplaatsnaam: detail.woonplaatsnaam || ""
        };
      } catch(e){
        return item;
      }
    }));
    toonSuggesties(enriched);
  } catch(e){
    hideSuggesties();
  }
}
function kiesAdresSuggestie(item){
  if(!item) return;
  const straat = [item.straatnaam, item.huisnummer, item.huisletter, item.huisnummertoevoeging].filter(Boolean).join(" ");
  document.getElementById("adresZoek").value = straat || item.weergavenaam || "";
  document.getElementById("postcode").value = item.postcode || "";
  document.getElementById("plaats").value = item.woonplaatsnaam || "";
  syncAdresHiddenField();
  hideSuggesties();
}

function processInput(){
  syncAdresHiddenField();
  const text = document.getElementById("input").value.trim();
  if(!text) return;
  laatsteData = parseInput(text);
  renderResult(laatsteData);
  document.getElementById("melding").textContent = "Berekening verwerkt.";
}

document.getElementById("adresZoek")?.addEventListener("input", debounce((e) => {
  syncAdresHiddenField();
  zoekAdresSuggesties(e.target.value);
}, 250));
document.getElementById("postcode")?.addEventListener("input", syncAdresHiddenField);
document.getElementById("plaats")?.addEventListener("input", syncAdresHiddenField);
document.getElementById("adresSuggesties")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".suggestion-item");
  if(!btn) return;
  const item = actieveSuggesties[Number(btn.dataset.index)];
  kiesAdresSuggestie(item);
});
document.addEventListener("click", (e) => {
  if(!e.target.closest(".address-lookup-wrap")) hideSuggesties();
});

document.getElementById("templateText").value = TEMPLATE_TEXT;
document.getElementById("btnVerwerk").addEventListener("click", processInput);
document.getElementById("btnPdf").addEventListener("click", makePdf);
document.getElementById("btnOpslaan").addEventListener("click", saveProject);
document.getElementById("btnKopieerTemplate").addEventListener("click", async () => { await copyText(TEMPLATE_TEXT); document.getElementById("melding").textContent = "Voorbeeld gekopieerd."; });
document.getElementById("btnPlaatsTemplate").addEventListener("click", () => { document.getElementById("input").value = TEMPLATE_TEXT; document.getElementById("melding").textContent = "Leeg voorbeeld in plakvak geplaatst."; });
renderProjects();
