const PATHS = {
  schools:'data/infraestructura_educativa_2026.json',
  maintenance:'data/mantenimiento.json',
  reinforcement:'data/reforzamiento.json',
  famPotenciado:'data/fam_potenciado_2025.json',
  fam2026:'data/fam_potenciado_basico_2026.json',
  alcaldia:'data/beneficiadas_alcaldia_iztapalapa.json',
  programa123:'data/programa_123_mejoras.json'
};
const CCT_FIELDS = ['cct1','cct2','cct3','cct4'];
const NEEDS = ['impermeabi','interior','exterior1','loseta','ventanas','ventanas1','ventanas2','puertas','escaleras','pluviales','techos','desazolve','deterioro','concreto','tinacos','cisterna','agua','agua1','hidrosanit','sanitarios','luminarias','electrica','transforma','lamina'];
const NEED_LABELS = {impermeabi:'Impermeabilización',interior:'Pintura interior',exterior1:'Pintura exterior',loseta:'Loseta',ventanas:'Vidrios / ventanas',ventanas1:'Cancelería de aluminio / ventanas',ventanas2:'Cancelería de herrería / ventanas',puertas:'Puertas',escaleras:'Barandales, pasillos o escaleras',pluviales:'Bajadas pluviales',techos:'Muros o techos',desazolve:'Desazolve',deterioro:'Deterioro de estructura o acabados',concreto:'Concreto',tinacos:'Tinacos',cisterna:'Cisterna',agua:'Agua potable',agua1:'Red o abastecimiento de agua',hidrosanit:'Instalación hidrosanitaria',sanitarios:'Sanitarios',luminarias:'Luminarias',electrica:'Instalación eléctrica',transforma:'Transformador',lamina:'Lámina'};
const IMPROVEMENTS = {
  fam_regular:'FAM Regular 2025',
  programa_123_2025:'1, 2, 3 por mi Escuela 2025',
  fam_potenciado:'FAM Potenciado 2025',
  fam_potenciado_basico_2026:'FAM Potenciado + FAM Básico 2026',
  fam_reforzamiento:'FAM Reforzamiento estructural',
  programa_123_2026:'1, 2, 3 por mi Escuela 2026',
  alcaldia_apoyo:'Intervención de Alcaldía',
  ambas:'Con mantenimiento y reforzamiento'
};
const RISK_LABELS = {obs_fractura:'Revisión por cercanía a fracturamiento',obs_subsidencia:'Seguimiento por subsidencia alta',obs_combinada:'Observación territorial combinada'};
let schools = [];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  buildMenus();
  bindUI();
  try {
    const keys = Object.keys(PATHS);
    const values = await Promise.all(keys.map(key => fetchJson(PATHS[key])));
    const data = Object.fromEntries(keys.map((key,index) => [key, values[index]]));
    schools = (data.schools.features || []).map(normalizeFeature).filter(Boolean);
    joinImprovements(schools, data.maintenance, data.reinforcement, data.famPotenciado, data.fam2026, data.alcaldia, data.programa123);
    populateFilters();
    restoreState();
    applyStats();
  } catch (error) {
    console.error(error);
    q('statsContext').textContent = 'No fue posible cargar la información estadística.';
  }
}

async function fetchJson(path) {
  const response = await fetch(path, {cache:'no-store'});
  if (!response.ok) throw new Error(`No se pudo cargar ${path}`);
  return response.json();
}

function normalizeFeature(feature, index) {
  const p = feature.properties || {};
  const coordinates = feature.geometry?.coordinates || [];
  const lon = Number(coordinates[0] ?? p.coord_x);
  const lat = Number(coordinates[1] ?? p.coord_y);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const records = Array.isArray(p.coord_cct_records) ? p.coord_cct_records : [];
  const ccts = unique([...CCT_FIELDS.map(field => p[field]), ...(p.cct_extra || []), ...records.map(row => row.cct)].map(normalizeCCT));
  const nombres = unique([p.inmueble, p.coord_NOMBRE, p.bm_nombre_1, p.bm_nombre_2, p.bm_nombre_3, p.bm_nombre_4, ...records.map(row => row.nombre)].map(clean));
  const niveles = unique([p.principal, p.nivel, ...(p.niveles_cct || []), ...records.map(row => row.nivel)].map(clean));
  const needs = NEEDS.filter(field => Number(p[field]) === 1);
  const indice = Number.isFinite(Number(p.Indice_Man)) ? Number(p.Indice_Man) : needs.length;
  return {
    id:clean(p.idinmueble) || `escuela-${index}`,
    nombre:clean(p.inmueble) || nombres[0] || 'Escuela sin nombre',
    nombres,ccts,niveles,
    nivel:clean(p.principal) || niveles[0] || '',
    alcaldia:normalizeAlcaldia(p.alcaldia || p.coord_ALCALDÍA),
    needs,indice,clasificacion:classifyIndex(indice),
    subsidenciaNivel:Number(p.subsidencia_nivel) || null,
    subsidenciaClase:clean(p.subsidencia_clase),
    distFractura:Number.isFinite(Number(p.dist_fractura_m)) ? Number(p.dist_fractura_m) : null,
    improvements:{},reinforcement:null
  };
}

function joinImprovements(list, maintenance, reinforcement, famPotenciado, fam2026, alcaldia, programa123) {
  const byCct = (rows, multiple=false) => {
    const result = new Map();
    rows.forEach(row => {
      const value = normalizeCCT(row.cct);
      if (!value) return;
      if (multiple) {
        if (!result.has(value)) result.set(value, []);
        result.get(value).push(row);
      } else result.set(value, row);
    });
    return result;
  };
  const mm=byCct(maintenance), rr=byCct(reinforcement), fp=byCct(famPotenciado), f26=byCct(fam2026), aa=byCct(alcaldia);
  const p25=byCct(programa123.filter(row => clean(row.proyecto).includes('(2025)')), true);
  const p26=byCct(programa123.filter(row => clean(row.proyecto).includes('(2026)')), true);
  list.forEach(school => {
    const first = index => school.ccts.map(value => index.get(value)).find(Boolean) || null;
    const mantenimiento=first(mm), reforzamiento=first(rr);
    school.reinforcement=reforzamiento;
    school.improvements={
      fam_regular:Boolean(mantenimiento && normalize(mantenimiento.responsable).includes('ilife')),
      programa_123_2025:school.ccts.some(value => (p25.get(value) || []).length),
      fam_potenciado:Boolean(first(fp)),
      fam_potenciado_basico_2026:Boolean(first(f26)),
      fam_reforzamiento:Boolean(reforzamiento),
      programa_123_2026:school.ccts.some(value => (p26.get(value) || []).length),
      alcaldia_apoyo:Boolean(first(aa)),
      ambas:Boolean(mantenimiento && reforzamiento)
    };
  });
}

function buildMenus() {
  q('stNeeds').innerHTML = NEEDS.map(field => `<label><input type="checkbox" value="${field}"><span>${escapeHtml(NEED_LABELS[field])}</span></label>`).join('');
  q('stImprovements').innerHTML = Object.entries(IMPROVEMENTS).map(([key,label]) => `<label><input type="checkbox" value="${key}"><span>${escapeHtml(label)}</span></label>`).join('');
}

function populateFilters() {
  fillSelect('stAlcaldia', unique(schools.map(school => school.alcaldia)));
  fillSelect('stNivel', unique(schools.flatMap(school => school.niveles)));
}

function fillSelect(id, values) {
  const select=q(id), first=select.querySelector('option').outerHTML;
  select.innerHTML = first + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
}

function bindUI() {
  ['stAlcaldia','stNivel'].forEach(id => q(id).addEventListener('change', applyStats));
  ['stCCT','stNombre'].forEach(id => q(id).addEventListener('input', debounce(applyStats, 160)));
  q('stNeeds').addEventListener('change', applyStats);
  q('stImprovements').addEventListener('change', applyStats);
  document.querySelectorAll('input[name="stRisk"]').forEach(input => input.addEventListener('change', applyStats));
  q('stAllNeeds').onclick = () => setChecks('#stNeeds input', true);
  q('stClearNeeds').onclick = () => setChecks('#stNeeds input', false);
  q('stAllImprovements').onclick = () => setChecks('#stImprovements input', true);
  q('stClearImprovements').onclick = () => setChecks('#stImprovements input', false);
  q('stClearRisk').onclick = () => { document.querySelectorAll('input[name="stRisk"]').forEach(input => { input.checked=false; }); applyStats(); };
  q('stLimpiar').onclick = clearAll;
}

function setChecks(selector, checked) {
  document.querySelectorAll(selector).forEach(input => { input.checked=checked; });
  applyStats();
}

function clearAll() {
  q('stAlcaldia').value=''; q('stNivel').value=''; q('stCCT').value=''; q('stNombre').value='';
  document.querySelectorAll('#stNeeds input,#stImprovements input,input[name="stRisk"]').forEach(input => { input.checked=false; });
  applyStats();
}

function restoreState() {
  let state={};
  try { state=JSON.parse(localStorage.getItem('visorInfraStateV4') || '{}'); } catch {}
  q('stAlcaldia').value=state.alcaldia || '';
  q('stNivel').value=state.nivel || '';
  restoreChecks('#stNeeds input', state.needs || []);
  restoreChecks('#stImprovements input', state.improvements || []);
  if (state.risk) {
    const input=document.querySelector(`input[name="stRisk"][value="${CSS.escape(state.risk)}"]`);
    if (input) input.checked=true;
  }
}

function restoreChecks(selector, values) {
  const selected=new Set(values);
  document.querySelectorAll(selector).forEach(input => { input.checked=selected.has(input.value); });
}

function saveState(filters) {
  let previous={};
  try { previous=JSON.parse(localStorage.getItem('visorInfraStateV4') || '{}'); } catch {}
  localStorage.setItem('visorInfraStateV4', JSON.stringify({...previous,alcaldia:filters.alcaldia,nivel:filters.nivel,needs:filters.needs,improvements:filters.improvements,risk:filters.risk}));
}

function applyStats() {
  const filters={
    alcaldia:q('stAlcaldia').value,
    nivel:q('stNivel').value,
    cct:normalizeCCT(q('stCCT').value),
    nombre:normalize(q('stNombre').value),
    needs:checkedValues('#stNeeds input'),
    improvements:checkedValues('#stImprovements input'),
    risk:document.querySelector('input[name="stRisk"]:checked')?.value || ''
  };
  const result=schools.filter(school => {
    if (filters.alcaldia && school.alcaldia !== filters.alcaldia) return false;
    if (filters.nivel && !school.niveles.includes(filters.nivel)) return false;
    if (filters.cct && !school.ccts.some(value => value.includes(filters.cct))) return false;
    if (filters.nombre && !school.nombres.some(value => normalize(value).includes(filters.nombre))) return false;
    if (filters.needs.length && !filters.needs.every(field => school.needs.includes(field))) return false;
    if (filters.improvements.length && !filters.improvements.some(key => school.improvements[key])) return false;
    if (filters.risk === 'obs_fractura' && !hasFracture(school)) return false;
    if (filters.risk === 'obs_subsidencia' && !hasSubsidence(school)) return false;
    if (filters.risk === 'obs_combinada' && !(hasFracture(school) && hasSubsidence(school))) return false;
    return true;
  });
  saveState(filters);
  render(result,filters);
}

function render(rows, filters) {
  q('stTotal').textContent=rows.length.toLocaleString('es-MX');
  q('stMax').textContent=rows.length ? Math.max(...rows.map(school => school.indice)) : 0;
  q('stAux1').textContent=unique(rows.map(school => school.alcaldia)).length;
  q('stAux2').textContent=rows.length ? (rows.reduce((sum,school) => sum+school.indice,0)/rows.length).toFixed(1) : '0.0';
  const tags=[];
  if (filters.alcaldia) tags.push(filters.alcaldia);
  if (filters.nivel) tags.push(filters.nivel);
  if (filters.cct) tags.push(`CCT: ${filters.cct}`);
  if (filters.nombre) tags.push(`Escuela: ${q('stNombre').value.trim()}`);
  filters.needs.forEach(field => tags.push(NEED_LABELS[field] || field));
  filters.improvements.forEach(key => tags.push(IMPROVEMENTS[key] || key));
  if (filters.risk) tags.push(RISK_LABELS[filters.risk]);
  q('statsContext').textContent=tags.length ? `Cruce completo aplicado a ${rows.length.toLocaleString('es-MX')} inmueble(s).` : 'No hay filtros activos; se muestra la base general.';
  q('statsTags').innerHTML=tags.map(text => `<span class="mini-tag blue">${escapeHtml(text)}</span>`).join('');
  renderDistribution(rows);
  renderGrouped(rows,'nivel','tablaNivel',false);
  renderGrouped(rows,'alcaldia','tablaAlcaldia',true);
  renderRanking(rows);
}

function renderDistribution(rows) {
  const classes=['Muy baja','Baja','Media','Alta','Muy alta'];
  q('tablaDistribucion').innerHTML=classes.map(label => {
    const count=rows.filter(school => school.clasificacion === label).length;
    return `<tr><td>${label}</td><td>${count.toLocaleString('es-MX')}</td><td>${pct(count,rows.length)}%<div class="bar"><span style="width:${pct(count,rows.length)}%"></span></div></td></tr>`;
  }).join('');
}

function renderGrouped(rows, field, target, full) {
  const groups={};
  rows.forEach(school => {
    const values=field === 'nivel' ? (school.niveles.length ? school.niveles : ['No registrado']) : [school.alcaldia || 'No registrado'];
    unique(values).forEach(value => (groups[value] ??=[]).push(school));
  });
  const result=Object.entries(groups).map(([name,list]) => ({name,total:list.length,max:Math.max(...list.map(school => school.indice)),ref:list.filter(school => school.reinforcement).length})).sort((a,b) => b.total-a.total || a.name.localeCompare(b.name,'es'));
  q(target).innerHTML=result.length ? result.map(row => full
    ? `<tr><td>${escapeHtml(row.name)}</td><td>${row.total.toLocaleString('es-MX')}</td><td>${row.max}</td><td>${row.ref.toLocaleString('es-MX')}</td><td>${pct(row.total,rows.length)}%</td></tr>`
    : `<tr><td>${escapeHtml(row.name)}</td><td>${row.total.toLocaleString('es-MX')}</td><td>${row.max}</td></tr>`).join('')
    : `<tr><td colspan="${full ? 5 : 3}" class="empty-row">No hay resultados.</td></tr>`;
}

function renderRanking(rows) {
  q('tablaRanking').innerHTML=rows.length ? [...rows].sort((a,b) => b.indice-a.indice || a.nombre.localeCompare(b.nombre,'es')).slice(0,500).map((school,index) => {
    const improvements=Object.entries(school.improvements).filter(([,yes]) => yes).map(([key]) => IMPROVEMENTS[key]);
    return `<tr><td>${index+1}</td><td>${escapeHtml(school.nombre)}</td><td>${escapeHtml(school.ccts.join(', ') || '—')}</td><td>${escapeHtml(school.alcaldia || '—')}</td><td>${escapeHtml(school.niveles.join(', ') || '—')}</td><td><strong>${school.indice}</strong></td><td>${escapeHtml(unique(improvements).join(' · ') || '—')}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty-row">No hay resultados.</td></tr>';
}

function checkedValues(selector) { return [...document.querySelectorAll(`${selector}:checked`)].map(input => input.value); }
function hasFracture(school) { return school.distFractura !== null && school.distFractura <= 250; }
function hasSubsidence(school) { return school.subsidenciaNivel >= 4 || ['alta','muy alta'].includes(normalize(school.subsidenciaClase)); }
function classifyIndex(value) { return value <= 6 ? 'Muy baja' : value <= 10 ? 'Baja' : value <= 14 ? 'Media' : value <= 18 ? 'Alta' : 'Muy alta'; }
function pct(a,b) { return b ? (a/b*100).toFixed(1) : '0.0'; }
function normalizeCCT(value) { return clean(value).replace(/\s+/g,'').toUpperCase(); }
function clean(value) { return value === null || value === undefined ? '' : String(value).trim().replace(/\s+/g,' '); }
function normalize(value) { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function normalizeAlcaldia(value) { return clean(value).normalize('NFC').toLocaleUpperCase('es-MX'); }
function unique(values) { return [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b,'es')); }
function q(id) { return document.getElementById(id); }
function escapeHtml(value) { return clean(value).replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char])); }
function debounce(fn, delay) { let timer; return (...args) => { clearTimeout(timer);timer=setTimeout(() => fn(...args),delay); }; }
