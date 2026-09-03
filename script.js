const DATA = {
  schools: 'data/infraestructura_educativa_2026.json',
  alcaldias: 'data/alcaldias.json',
  subsidencias: 'data/subsidencias.json',
  fracturamiento: 'data/fracturamiento.json',
  mantenimiento: 'data/mantenimiento.json',
  reforzamiento: 'data/reforzamiento.json',
  famPotenciado: 'data/fam_potenciado_2025.json',
  fam2026: 'data/fam_potenciado_basico_2026.json',
  alcaldiaApoyo: 'data/beneficiadas_alcaldia_iztapalapa.json',
  programas: 'data/programas_integradores.json'
};

const FIELDS = {
  ccts: ['cct1', 'cct2', 'cct3', 'cct4'], alcaldia: 'alcaldia', nivel: 'principal',
  nombre: 'inmueble', x: 'coord_x', y: 'coord_y', indice: 'Indice_Man'
};
const NEEDS = ['impermeabi','interior','exterior1','loseta','ventanas','ventanas1','ventanas2','puertas','escaleras','pluviales','techos','desazolve','deterioro','concreto','tinacos','cisterna','agua','agua1','hidrosanit','sanitarios','luminarias','electrica','transforma','lamina'];
const NEED_LABELS = {impermeabi:'Impermeabilización',interior:'Pintura interior',exterior1:'Pintura exterior',loseta:'Loseta',ventanas:'Vidrios / ventanas',ventanas1:'Cancelería de aluminio / ventanas',ventanas2:'Cancelería de herrería / ventanas',puertas:'Puertas',escaleras:'Barandales, pasillos o escaleras',pluviales:'Bajadas pluviales',techos:'Muros o techos',desazolve:'Desazolve',deterioro:'Deterioro de estructura o acabados',concreto:'Concreto',tinacos:'Tinacos',cisterna:'Cisterna',agua:'Agua potable',agua1:'Red o abastecimiento de agua',hidrosanit:'Instalación hidrosanitaria',sanitarios:'Sanitarios',luminarias:'Luminarias',electrica:'Instalación eléctrica',transforma:'Transformador',lamina:'Lámina'};
const CLASS_COLORS = {'Muy baja':'#2ca25f','Baja':'#86c98a','Media':'#f2c94c','Alta':'#f97316','Muy alta':'#dc2626'};
const PROGRAM_COLORS = ['#0369a1','#7e22ce','#047857','#b45309','#be123c','#0f766e','#4338ca','#9f1239'];
const IMPROVEMENTS = {
  fam_regular: {label:'FAM Regular 2025', color:'#0f766e'},
  programa_123_2025: {label:'1, 2, 3 por mi Escuela 2025', color:'#2563eb'},
  fam_potenciado: {label:'FAM Potenciado 2025', color:'#ca8a04'},
  fam_potenciado_basico_2026: {label:'FAM Potenciado + FAM Básico 2026', color:'#15803d'},
  fam_reforzamiento: {label:'FAM Reforzamiento estructural', color:'#7c3aed'},
  programa_123_2026: {label:'1, 2, 3 por mi Escuela 2026', color:'#0891b2'},
  alcaldia_apoyo: {label:'Intervención de Alcaldía', color:'#be123c'},
  ambas: {label:'Con mantenimiento y reforzamiento', color:'#111827'}
};
const OBS_COLORS = {obs_fractura:'#c2410c', obs_subsidencia:'#ca8a04', obs_combinada:'#b91c1c'};

let allSchools = [], filteredSchools = [], programRows = [], programCatalog = [];
let alcaldiasGeoJSON = null, subsidenciasGeoJSON = null, fracturamientoGeoJSON = null;
let alcaldiaBoundaryLayer = null, subsidenciaLayer = null, fracturamientoLayer = null;
let schoolsVisible = true, initialized = false;
const schoolLayer = L.layerGroup();
const summaryLayer = L.layerGroup();

const map = L.map('map', {zoomControl:false, preferCanvas:true}).setView([19.35, -99.13], 10);
L.control.zoom({position:'topright'}).addTo(map);
const baseLayers = {
  'Mapa claro': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {maxZoom:20, attribution:'© OpenStreetMap © CARTO'}),
  'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'© OpenStreetMap'}),
  'Satélite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19, attribution:'Tiles © Esri'}),
  'Mapa oscuro': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:20, attribution:'© OpenStreetMap © CARTO'})
};
baseLayers['Mapa claro'].addTo(map);
L.control.layers(baseLayers, {}, {collapsed:true, position:'bottomright'}).addTo(map);
schoolLayer.addTo(map);

document.addEventListener('DOMContentLoaded', init);

async function init() {
  buildMaintenanceMenu();
  bindUI();
  try {
    const [schoolGeo, alcaldias, subsidencias, fracturas, mantenimiento, reforzamiento, famPotenciado, fam2026, alcaldiaApoyo, programas] = await Promise.all([
      fetchJson(DATA.schools), fetchJson(DATA.alcaldias), fetchJson(DATA.subsidencias), fetchJson(DATA.fracturamiento),
      fetchJson(DATA.mantenimiento), fetchJson(DATA.reforzamiento), fetchJson(DATA.famPotenciado), fetchJson(DATA.fam2026),
      fetchJson(DATA.alcaldiaApoyo), fetchJson(DATA.programas)
    ]);
    programRows = programas;
    allSchools = (schoolGeo.features || []).map(normalizeFeature).filter(Boolean);
    mergeProgramOnlySchools(allSchools, programRows);
    joinPrograms(allSchools, programRows);
    joinImprovements(allSchools, mantenimiento, reforzamiento, famPotenciado, fam2026, alcaldiaApoyo, programRows);
    alcaldiasGeoJSON = alcaldias;
    subsidenciasGeoJSON = subsidencias;
    fracturamientoGeoJSON = fracturas;
    buildProgramCatalog();
    buildProgramMenu();
    populateFilters();
    drawBoundaries();
    drawExtraLayers();
    restoreState();
    initialized = true;
    applyFilters();
    setStatus('');
  } catch (error) {
    console.error(error);
    setStatus('No fue posible cargar la información del visor. Verifica que se publique mediante un servidor web.', true);
  }
}

async function fetchJson(path) {
  const response = await fetch(path, {cache:'no-store'});
  if (!response.ok) throw new Error(`No se pudo cargar ${path}`);
  return response.json();
}

function normalizeFeature(feature, index) {
  const p = feature.properties || {};
  const coords = feature.geometry?.coordinates || [];
  return normalizeSchool(p, Number(coords[1] ?? p[FIELDS.y]), Number(coords[0] ?? p[FIELDS.x]), index, false);
}

function normalizeSchool(p, lat, lon, index, programOnly) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const needs = NEEDS.filter(field => Number(p[field]) === 1);
  const indice = Number.isFinite(Number(p[FIELDS.indice])) ? Number(p[FIELDS.indice]) : needs.length;
  return {
    id: clean(p.idinmueble) || `escuela-${index}`, lat, lon, props:p,
    nombre: clean(p[FIELDS.nombre]) || clean(p.nombre) || 'Escuela sin nombre',
    alcaldia: normalizeAlcaldia(p[FIELDS.alcaldia] || p.alcaldia),
    nivel: clean(p[FIELDS.nivel] || p.nivel),
    ccts: (programOnly ? [p.cct] : FIELDS.ccts.map(field => p[field])).map(normalizeCCT).filter(Boolean),
    indice, clasificacion: classifyIndex(indice), needs,
    subsidenciaNivel: Number(p.subsidencia_nivel) || null,
    subsidenciaClase: clean(p.subsidencia_clase),
    distFractura: Number.isFinite(Number(p.dist_fractura_m)) ? Number(p.dist_fractura_m) : null,
    programOnly, programs:[], improvements:{}, marker:null
  };
}

function mergeProgramOnlySchools(schools, rows) {
  const known = new Set(schools.flatMap(s => s.ccts));
  const missing = new Map();
  rows.forEach(row => {
    if (!known.has(row.cct) && !missing.has(row.cct)) missing.set(row.cct, row);
  });
  missing.forEach((row, cct) => {
    const props = {cct, nombre:row.nombre, inmueble:row.nombre, alcaldia:row.alcaldia, nivel:row.nivel, principal:row.nivel, domicilio:row.domicilio, localidad:row.localidad, colonia:row.colonia};
    const school = normalizeSchool(props, Number(row.lat), Number(row.lon), `programa-${cct}`, true);
    if (school) schools.push(school);
  });
}

function joinPrograms(schools, rows) {
  const index = new Map();
  rows.forEach(row => {
    if (!index.has(row.cct)) index.set(row.cct, []);
    index.get(row.cct).push(row);
  });
  schools.forEach(school => {
    const uniqueRows = new Map();
    school.ccts.flatMap(cct => index.get(cct) || []).forEach(row => uniqueRows.set(`${row.cct}|${row.proyecto_id}`, row));
    school.programs = [...uniqueRows.values()];
  });
}

function joinImprovements(schools, maintenance, reinforcement, famPotenciado, fam2026, alcaldiaApoyo, programs) {
  const byCct = rows => {
    const result = new Map();
    rows.forEach(row => { const cct = normalizeCCT(row.cct); if (cct) result.set(cct, row); });
    return result;
  };
  const mm = byCct(maintenance), rr = byCct(reinforcement), fp = byCct(famPotenciado), f26 = byCct(fam2026), aa = byCct(alcaldiaApoyo);
  const p25 = new Set(programs.filter(row => normalize(row.programa) === '1 2 3 por mi escuela' && row.proyecto.includes('(2025)')).map(row => row.cct));
  const p26 = new Set(programs.filter(row => normalize(row.programa) === '1 2 3 por mi escuela' && row.proyecto.includes('(2026)')).map(row => row.cct));
  schools.forEach(school => {
    const first = map => school.ccts.map(cct => map.get(cct)).find(Boolean) || null;
    const mantenimiento = first(mm);
    const reforzamiento = first(rr);
    school.improvementDetails = {mantenimiento, reforzamiento, famPotenciado:first(fp), fam2026:first(f26), alcaldiaApoyo:first(aa)};
    school.improvements = {
      fam_regular: Boolean(mantenimiento && normalize(mantenimiento.responsable).includes('ilife')),
      programa_123_2025: school.ccts.some(cct => p25.has(cct)),
      fam_potenciado: Boolean(school.improvementDetails.famPotenciado),
      fam_potenciado_basico_2026: Boolean(school.improvementDetails.fam2026),
      fam_reforzamiento: Boolean(reforzamiento),
      programa_123_2026: school.ccts.some(cct => p26.has(cct)),
      alcaldia_apoyo: Boolean(school.improvementDetails.alcaldiaApoyo),
      ambas: Boolean(mantenimiento && reforzamiento)
    };
  });
}

function buildProgramCatalog() {
  const map = new Map();
  programRows.forEach(row => {
    if (!map.has(row.proyecto_id)) map.set(row.proyecto_id, {id:row.proyecto_id, label:row.proyecto, program:row.programa, count:0});
    map.get(row.proyecto_id).count += 1;
  });
  programCatalog = [...map.values()].sort((a,b) => a.program.localeCompare(b.program, 'es') || a.label.localeCompare(b.label, 'es'));
}

function buildProgramMenu() {
  const groups = new Map();
  programCatalog.forEach(item => {
    if (!groups.has(item.program)) groups.set(item.program, []);
    groups.get(item.program).push(item);
  });
  q('programFilters').innerHTML = [...groups.entries()].map(([program, projects], index) => `
    <details class="program-group" ${index < 2 ? 'open' : ''}>
      <summary><span>${escapeHtml(program)}</span><small>${projects.length} proyecto${projects.length === 1 ? '' : 's'}</small></summary>
      <div>${projects.map(project => `<label class="inline-check program-option" data-search="${escapeAttr(normalize(`${program} ${project.label}`))}"><input type="checkbox" value="${escapeAttr(project.id)}"><span>${escapeHtml(project.label)} <em>${project.count.toLocaleString('es-MX')} CCT</em></span></label>`).join('')}</div>
    </details>`).join('');
  q('programFilters').addEventListener('change', applyFilters);
}

function buildMaintenanceMenu() {
  q('maintenanceFilters').innerHTML = NEEDS.map(field => `<label><input type="checkbox" value="${field}"><span>${NEED_LABELS[field]}</span></label>`).join('');
}

function bindUI() {
  q('filtroAlcaldia').addEventListener('change', () => { applyFilters(); zoomToAlcaldia(); });
  q('filtroNivel').addEventListener('change', applyFilters);
  q('buscarCCT').addEventListener('input', debounce(() => { applyFilters(); zoomToMatch('cct'); }, 180));
  q('buscarNombre').addEventListener('input', debounce(() => { applyFilters(); zoomToMatch('nombre'); }, 180));
  q('maintenanceFilters').addEventListener('change', applyFilters);
  q('improvementFilters').addEventListener('change', applyFilters);
  document.querySelectorAll('input[name="riskMode"]').forEach(input => input.addEventListener('change', applyFilters));
  q('selectAllMaintenance').onclick = () => setChecks('#maintenanceFilters input', true);
  q('clearMaintenance').onclick = () => setChecks('#maintenanceFilters input', false);
  q('selectAllMejoras').onclick = () => setChecks('#improvementFilters input', true);
  q('clearMejoras').onclick = () => setChecks('#improvementFilters input', false);
  q('selectAllProgramas').onclick = () => setChecks('#programFilters input', true);
  q('clearProgramas').onclick = () => setChecks('#programFilters input', false);
  q('clearRiesgos').onclick = () => { document.querySelectorAll('input[name="riskMode"]').forEach(i => i.checked = false); applyFilters(); };
  q('btnLimpiar').onclick = clearAllFilters;
  q('modeMaintenance').onclick = () => { clearThematicSelections(); applyFilters(); };
  q('toggleSchools').onchange = event => { schoolsVisible = event.target.checked; saveState(); updateVisibility(); };
  q('toggleSubsidencias').onchange = event => { toggleLayer(subsidenciaLayer, event.target.checked); q('subsidenciaLegend').classList.toggle('hidden', !event.target.checked); saveState(); };
  q('toggleFracturamiento').onchange = event => { toggleLayer(fracturamientoLayer, event.target.checked); saveState(); };
  q('programSearch').addEventListener('input', filterProgramMenu);
  q('toggleMejoras').onclick = () => toggleMenu('mejorasBody','mejorasArrow','toggleMejoras');
  q('toggleProgramas').onclick = () => toggleMenu('programasBody','programasArrow','toggleProgramas');
  q('toggleRiesgos').onclick = () => toggleMenu('riesgosBody','riesgosArrow','toggleRiesgos');
  q('toggleSidebar').onclick = collapseSidebar;
  q('showSidebar').onclick = expandSidebar;
  q('closeDetail').onclick = () => q('detailPanel').classList.remove('open');
  q('toggleLegend').onclick = () => toggleBox('legendBody','toggleLegend');
  q('toggleSubLegend').onclick = () => toggleBox('subLegendBody','toggleSubLegend');
  q('statsLink').onclick = saveState;
  map.on('zoomend moveend', updateVisibility);
}

function setChecks(selector, checked) {
  document.querySelectorAll(selector).forEach(input => { input.checked = checked; });
  applyFilters();
}

function clearThematicSelections() {
  document.querySelectorAll('#maintenanceFilters input,#improvementFilters input,#programFilters input,input[name="riskMode"]').forEach(input => { input.checked = false; });
}

function clearAllFilters() {
  q('filtroAlcaldia').value = '';
  q('filtroNivel').value = '';
  q('buscarCCT').value = '';
  q('buscarNombre').value = '';
  q('programSearch').value = '';
  clearThematicSelections();
  filterProgramMenu();
  applyFilters();
  if (alcaldiaBoundaryLayer) map.fitBounds(alcaldiaBoundaryLayer.getBounds(), {padding:[15,15]});
}

function applyFilters() {
  if (!initialized) return;
  const alcaldia = q('filtroAlcaldia').value;
  const nivel = q('filtroNivel').value;
  const cct = normalizeCCT(q('buscarCCT').value);
  const nombre = normalize(q('buscarNombre').value);
  const needs = checkedValues('#maintenanceFilters input');
  const improvements = checkedValues('#improvementFilters input');
  const projects = checkedValues('#programFilters input');
  const risk = document.querySelector('input[name="riskMode"]:checked')?.value || '';

  filteredSchools = allSchools.filter(school => {
    if (alcaldia && school.alcaldia !== alcaldia) return false;
    if (nivel && school.nivel !== nivel) return false;
    if (cct && !school.ccts.some(value => value.includes(cct))) return false;
    if (nombre && !normalize(school.nombre).includes(nombre)) return false;
    if (school.programOnly && projects.length === 0) return false;
    if (needs.length && !needs.every(field => school.needs.includes(field))) return false;
    if (improvements.length && !improvements.some(key => school.improvements[key])) return false;
    if (projects.length && !school.programs.some(row => projects.includes(row.proyecto_id))) return false;
    if (risk === 'obs_fractura' && !hasFracture(school)) return false;
    if (risk === 'obs_subsidencia' && !hasSubsidence(school)) return false;
    if (risk === 'obs_combinada' && !(hasFracture(school) && hasSubsidence(school))) return false;
    return true;
  });

  q('programSelectionCount').textContent = projects.length;
  q('modeMaintenance').classList.toggle('active', !improvements.length && !projects.length && !risk);
  updateCrossSummary(needs, improvements, projects, risk);
  saveState();
  updateMap();
}

function updateCrossSummary(needs, improvements, projects, risk) {
  const parts = [];
  if (projects.length) parts.push(`${projects.length} proyecto${projects.length === 1 ? '' : 's'}`);
  if (improvements.length) parts.push(`${improvements.length} mejora${improvements.length === 1 ? '' : 's'}`);
  if (needs.length) parts.push(`${needs.length} variable${needs.length === 1 ? '' : 's'} de mantenimiento`);
  if (risk) parts.push('1 observación territorial');
  q('activeCrossSummary').textContent = parts.length ? `Cruce activo: ${parts.join(' + ')}.` : 'Sin cruces temáticos activos.';
}

function updateMap() {
  schoolLayer.clearLayers();
  if (map.getZoom() > 10) drawSchools();
  drawSummary();
  updateStats();
  renderLegend();
  updateVisibility();
}

function drawSchools() {
  schoolLayer.clearLayers();
  filteredSchools.forEach(school => {
    const marker = L.circleMarker([school.lat, school.lon], {radius:7, color:borderColor(school), weight:2, fillColor:schoolColor(school), fillOpacity:.9});
    marker.bindPopup(buildPopup(school), {maxWidth:340});
    marker.on('click', () => openDetail(school));
    school.marker = marker;
    schoolLayer.addLayer(marker);
  });
}

function drawSummary() {
  summaryLayer.clearLayers();
  const groups = new Map();
  filteredSchools.forEach(school => {
    if (!groups.has(school.alcaldia)) groups.set(school.alcaldia, []);
    groups.get(school.alcaldia).push(school);
  });
  groups.forEach((schools, alcaldia) => {
    if (!alcaldia) return;
    const lat = schools.reduce((sum,s) => sum + s.lat, 0) / schools.length;
    const lon = schools.reduce((sum,s) => sum + s.lon, 0) / schools.length;
    const size = Math.max(34, Math.min(64, 28 + Math.sqrt(schools.length) * 3.5));
    const icon = L.divIcon({className:'', html:`<div class="summary-marker" style="width:${size}px;height:${size}px">${schools.length}</div>`, iconSize:[size,size], iconAnchor:[size/2,size/2]});
    L.marker([lat,lon], {icon, title:`${alcaldia}: ${schools.length} escuelas`}).bindTooltip(`${escapeHtml(alcaldia)}: ${schools.length.toLocaleString('es-MX')} escuelas`).on('click', () => fitSchools(schools, 12)).addTo(summaryLayer);
  });
}

function updateVisibility() {
  map.removeLayer(schoolLayer);
  map.removeLayer(summaryLayer);
  if (!schoolsVisible) return;
  if (map.getZoom() <= 10 && !q('buscarCCT').value && !q('buscarNombre').value) summaryLayer.addTo(map);
  else {
    if (schoolLayer.getLayers().length === 0 && filteredSchools.length) drawSchools();
    schoolLayer.addTo(map);
  }
}

function schoolColor(school) {
  const projects = checkedValues('#programFilters input');
  const improvements = checkedValues('#improvementFilters input');
  const risk = document.querySelector('input[name="riskMode"]:checked')?.value || '';
  if ((projects.length && improvements.length) || (projects.length && checkedValues('#maintenanceFilters input').length) || (improvements.length && checkedValues('#maintenanceFilters input').length)) return '#111827';
  if (projects.length) {
    const match = school.programs.find(row => projects.includes(row.proyecto_id));
    return PROGRAM_COLORS[Math.max(0, programCatalog.findIndex(p => p.id === match?.proyecto_id)) % PROGRAM_COLORS.length];
  }
  if (improvements.length) {
    const key = improvements.find(value => school.improvements[value]);
    return IMPROVEMENTS[key]?.color || '#334155';
  }
  if (risk) return OBS_COLORS[risk];
  return CLASS_COLORS[school.clasificacion];
}

function borderColor(school) {
  if (school.improvementDetails?.reforzamiento) return '#5b21b6';
  if (school.programs.length) return '#0f172a';
  return '#fff';
}

function buildPopup(school) {
  const tags = [];
  school.programs.forEach(row => tags.push(`<span class="mini-tag blue">${escapeHtml(row.proyecto)}</span>`));
  Object.entries(school.improvements).filter(([,yes]) => yes).forEach(([key]) => tags.push(`<span class="mini-tag teal">${escapeHtml(IMPROVEMENTS[key].label)}</span>`));
  return `<div class="popup-title">${escapeHtml(school.nombre)}</div><div class="popup-meta">CCT: ${escapeHtml(school.ccts.join(', ') || 'No registrado')}<br>Alcaldía: ${escapeHtml(school.alcaldia || 'No registrada')}<br>Atenciones de revisión: <strong>${school.indice}</strong></div><div class="popup-flags">${tags.slice(0,6).join('')}${tags.length > 6 ? `<span class="mini-tag">+${tags.length-6}</span>` : ''}</div>`;
}

function openDetail(school) {
  q('detailPanel').classList.add('open');
  q('detailTitle').textContent = school.nombre;
  const needs = school.needs.map(field => `<li><span>${escapeHtml(NEED_LABELS[field])}</span></li>`).join('') || '<li>Sin variables registradas.</li>';
  const improvements = renderImprovements(school);
  const programs = school.programs.map(row => `<div class="info-card blue-card"><div class="program-parent">${escapeHtml(row.programa)}</div><h3>${escapeHtml(row.proyecto)}</h3><dl>${detailRow('CCT',row.cct)}${detailRow('Nivel',row.nivel)}${detailRow('Turno(s)',row.turno)}${detailRow('Domicilio',row.domicilio)}${detailRow('Localidad',row.localidad)}${detailRow('Detalle',row.detalle)}</dl></div>`).join('') || '<p class="muted-box">No tiene proyectos registrados.</p>';
  q('detailContent').innerHTML = `<div class="detail-tabs"><button class="tab-btn active" data-tab="general">General</button><button class="tab-btn" data-tab="mantenimiento">Mantenimiento</button><button class="tab-btn" data-tab="mejoras">Mejoras</button><button class="tab-btn" data-tab="programas">Programas</button><button class="tab-btn" data-tab="riesgos">Observaciones</button></div>
    <div class="tab-pane active" data-pane="general"><dl>${detailRow('CCT',school.ccts.join(', '))}${detailRow('Alcaldía',school.alcaldia)}${detailRow('Nivel',school.nivel)}${detailRow('Domicilio',school.props.bm_domicilio_principal || school.props.domicilio)}${detailRow('Localidad / colonia',school.props.bm_localidad || school.props.localidad || school.props.colonia)}<dt>Atenciones de revisión</dt><dd>${school.indice} · ${school.clasificacion}</dd></dl></div>
    <div class="tab-pane" data-pane="mantenimiento"><ul class="need-list">${needs}</ul></div>
    <div class="tab-pane" data-pane="mejoras">${improvements}</div>
    <div class="tab-pane" data-pane="programas">${programs}</div>
    <div class="tab-pane" data-pane="riesgos">${riskDetail(school)}</div>`;
  activateTabs();
}

function renderImprovements(school) {
  const cards = [];
  const details = school.improvementDetails;
  if (school.improvements.fam_regular) cards.push(improvementCard('FAM Regular 2025', details.mantenimiento));
  if (school.improvements.programa_123_2025) cards.push(improvementCard('1, 2, 3 por mi Escuela 2025', projectDetailsByYear(school, '(2025)')));
  if (school.improvements.fam_potenciado) cards.push(improvementCard('FAM Potenciado 2025', details.famPotenciado));
  if (school.improvements.fam_potenciado_basico_2026) cards.push(improvementCard('FAM Potenciado + FAM Básico 2026', details.fam2026));
  if (school.improvements.fam_reforzamiento) cards.push(improvementCard('FAM Reforzamiento estructural', details.reforzamiento));
  if (school.improvements.programa_123_2026) cards.push(improvementCard('1, 2, 3 por mi Escuela 2026', projectDetailsByYear(school, '(2026)')));
  if (school.improvements.alcaldia_apoyo) cards.push(improvementCard('Intervención de Alcaldía', details.alcaldiaApoyo));
  return cards.join('') || '<p class="muted-box">No tiene mejoras registradas en las bases incorporadas.</p>';
}

function projectDetailsByYear(school, year) {
  return school.programs.filter(row => normalize(row.programa) === '1 2 3 por mi escuela' && row.proyecto.includes(year)).map(row => ({proyecto:row.proyecto, detalle:row.detalle}));
}

function improvementCard(title, data) {
  const records = Array.isArray(data) ? data : [data];
  const content = records.filter(Boolean).map(record => {
    const entries = Object.entries(record).filter(([key,value]) => value && !['escuela','cct'].includes(key)).slice(0,9);
    return `<dl>${entries.map(([key,value]) => detailRow(humanize(key), value)).join('')}</dl>`;
  }).join('');
  return `<div class="info-card teal-card"><h3>${escapeHtml(title)}</h3>${content}</div>`;
}

function riskDetail(school) {
  const rows = [];
  if (hasFracture(school)) rows.push(`<div class="observation-card"><strong>Cercanía a fracturamiento</strong><p>Distancia aproximada: ${Math.round(school.distFractura).toLocaleString('es-MX')} m.</p></div>`);
  if (hasSubsidence(school)) rows.push(`<div class="observation-card"><strong>Subsidencia alta</strong><p>Clasificación registrada: ${escapeHtml(school.subsidenciaClase || String(school.subsidenciaNivel))}.</p></div>`);
  if (school.improvementDetails.reforzamiento) rows.push('<div class="observation-card reinforced"><strong>Reforzamiento estructural registrado</strong></div>');
  return rows.join('') || '<p class="muted-box">Sin observaciones territoriales bajo los criterios del visor.</p>';
}

function activateTabs() {
  const root = q('detailContent');
  root.querySelectorAll('.tab-btn').forEach(button => button.onclick = () => {
    root.querySelectorAll('.tab-btn').forEach(item => item.classList.toggle('active', item === button));
    root.querySelectorAll('.tab-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.pane === button.dataset.tab));
  });
}

function updateStats() {
  const projects = checkedValues('#programFilters input');
  const improvements = checkedValues('#improvementFilters input');
  const needs = checkedValues('#maintenanceFilters input');
  const high = filteredSchools.filter(s => s.indice >= 15).length;
  const alcs = new Set(filteredSchools.map(s => s.alcaldia).filter(Boolean)).size;
  q('summaryTitle').textContent = (projects.length + improvements.length + needs.length) ? 'Resultado del cruce' : 'Resumen visible';
  const values = [[filteredSchools.length,'Escuelas'],[alcs,'Alcaldías'],[high,'Con 15 o más atenciones'],[projects.length + improvements.length + needs.length,'Opciones activas']];
  values.forEach(([value,label], index) => { q(`kpi${index+1}`).textContent = Number(value).toLocaleString('es-MX'); q(`kpiLabel${index+1}`).textContent = label; });
}

function renderLegend() {
  const projects = checkedValues('#programFilters input');
  const improvements = checkedValues('#improvementFilters input');
  const needs = checkedValues('#maintenanceFilters input');
  const risk = document.querySelector('input[name="riskMode"]:checked')?.value || '';
  let title = 'Atención de Revisión Diagnóstico';
  let rows = Object.entries(CLASS_COLORS).map(([label,color]) => [color,label]);
  if ([projects.length > 0, improvements.length > 0, needs.length > 0, Boolean(risk)].filter(Boolean).length > 1) {
    title = 'Cruce de selecciones'; rows = [['#111827','Cumple todos los apartados activos']];
  } else if (projects.length) {
    title = 'Proyectos seleccionados';
    rows = projects.slice(0,8).map(id => { const i = programCatalog.findIndex(item => item.id === id); return [PROGRAM_COLORS[i % PROGRAM_COLORS.length], programCatalog[i]?.label || id]; });
  } else if (improvements.length) {
    title = 'Mejoras seleccionadas'; rows = improvements.map(key => [IMPROVEMENTS[key].color, IMPROVEMENTS[key].label]);
  } else if (risk) {
    title = 'Observación territorial'; rows = [[OBS_COLORS[risk], 'Escuela con observación']];
  }
  q('legendTitle').textContent = title;
  q('legendBody').innerHTML = rows.map(([color,label]) => `<div><span class="swatch" style="background:${color}"></span>${escapeHtml(label)}</div>`).join('');
}

function drawBoundaries() {
  alcaldiaBoundaryLayer = L.geoJSON(alcaldiasGeoJSON, {style:{color:'#1f4e79',weight:1,fillOpacity:0,opacity:.6}}).addTo(map);
  map.fitBounds(alcaldiaBoundaryLayer.getBounds(), {padding:[10,10]});
}

function drawExtraLayers() {
  subsidenciaLayer = L.geoJSON(subsidenciasGeoJSON, {style:feature => ({color:'#fff',weight:.3,fillColor:CLASS_COLORS[subClass(Number(feature.properties?.gridcode))] || '#64748b',fillOpacity:.48})});
  fracturamientoLayer = L.geoJSON(fracturamientoGeoJSON, {style:{color:'#7c2d12',weight:2.2,opacity:.82}, onEachFeature:(feature,layer) => layer.bindTooltip(clean(feature.properties?.TIPO) || 'Fracturamiento', {sticky:true})});
}

function toggleLayer(layer, on) { if (!layer) return; if (on) layer.addTo(map); else map.removeLayer(layer); }

function populateFilters() {
  allSchools.forEach(school => { school.alcaldia = normalizeAlcaldia(school.alcaldia); });
  fillSelect('filtroAlcaldia', unique(allSchools.map(s => s.alcaldia)));
  fillSelect('filtroNivel', unique(allSchools.map(s => s.nivel)));
  q('listaCCT').innerHTML = unique(allSchools.flatMap(s => s.ccts)).map(value => `<option value="${escapeAttr(value)}"></option>`).join('');
  q('listaNombres').innerHTML = unique(allSchools.map(s => s.nombre)).map(value => `<option value="${escapeAttr(value)}"></option>`).join('');
}

function fillSelect(id, values) {
  const select = q(id), first = select.querySelector('option').outerHTML;
  select.innerHTML = first + values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join('');
}

function filterProgramMenu() {
  const term = normalize(q('programSearch').value);
  document.querySelectorAll('.program-option').forEach(label => label.classList.toggle('hidden-by-search', term && !label.dataset.search.includes(term)));
  document.querySelectorAll('.program-group').forEach(group => {
    const visible = [...group.querySelectorAll('.program-option')].some(label => !label.classList.contains('hidden-by-search'));
    group.classList.toggle('hidden-by-search', !visible);
    if (term && visible) group.open = true;
  });
}

function saveState() {
  if (!initialized) return;
  localStorage.setItem('visorStateV3', JSON.stringify({
    alcaldia:q('filtroAlcaldia').value, nivel:q('filtroNivel').value,
    needs:checkedValues('#maintenanceFilters input'), improvements:checkedValues('#improvementFilters input'), projects:checkedValues('#programFilters input'),
    risk:document.querySelector('input[name="riskMode"]:checked')?.value || '', schools:schoolsVisible,
    subsidencias:q('toggleSubsidencias').checked, fracturamiento:q('toggleFracturamiento').checked
  }));
}

function restoreState() {
  let state = {};
  try { state = JSON.parse(localStorage.getItem('visorStateV3') || '{}'); } catch {}
  q('filtroAlcaldia').value = state.alcaldia || '';
  q('filtroNivel').value = state.nivel || '';
  restoreChecks('#maintenanceFilters input', state.needs || []);
  restoreChecks('#improvementFilters input', state.improvements || []);
  restoreChecks('#programFilters input', state.projects || []);
  if (state.risk) { const input = document.querySelector(`input[name="riskMode"][value="${CSS.escape(state.risk)}"]`); if (input) input.checked = true; }
  schoolsVisible = state.schools !== false;
  q('toggleSchools').checked = schoolsVisible;
  q('toggleSubsidencias').checked = Boolean(state.subsidencias);
  q('toggleFracturamiento').checked = Boolean(state.fracturamiento);
  toggleLayer(subsidenciaLayer, q('toggleSubsidencias').checked);
  toggleLayer(fracturamientoLayer, q('toggleFracturamiento').checked);
  q('subsidenciaLegend').classList.toggle('hidden', !q('toggleSubsidencias').checked);
}

function restoreChecks(selector, values) { document.querySelectorAll(selector).forEach(input => { input.checked = values.includes(input.value); }); }
function checkedValues(selector) { return [...document.querySelectorAll(`${selector}:checked`)].map(input => input.value); }
function hasFracture(s) { return s.distFractura !== null && s.distFractura <= 250; }
function hasSubsidence(s) { return s.subsidenciaNivel >= 4 || ['alta','muy alta'].includes(normalize(s.subsidenciaClase)); }
function classifyIndex(value) { return value >= 20 ? 'Muy alta' : value >= 15 ? 'Alta' : value >= 10 ? 'Media' : value >= 5 ? 'Baja' : 'Muy baja'; }
function subClass(code) { return ({1:'Muy baja',2:'Baja',3:'Media',4:'Alta',5:'Muy alta'})[code] || 'No clasificada'; }
function normalizeCCT(value) { return clean(value).replace(/\s+/g,'').toUpperCase(); }
function clean(value) { return value === null || value === undefined ? '' : String(value).trim().replace(/\s+/g,' '); }
function normalize(value) { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function normalizeAlcaldia(value) { return clean(value).normalize('NFC').toLocaleUpperCase('es-MX'); }
function unique(values) { return [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b,'es')); }
function humanize(value) { return value.replaceAll('_',' ').replace(/^./, char => char.toUpperCase()); }
function detailRow(label, value) { const text = clean(value); return text ? `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(text)}</dd>` : ''; }
function escapeHtml(value) { return clean(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char])); }
function escapeAttr(value) { return escapeHtml(value); }
function q(id) { return document.getElementById(id); }
function debounce(fn, delay) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }

function toggleMenu(bodyId, arrowId, buttonId) {
  const body = q(bodyId), open = body.classList.contains('hidden');
  body.classList.toggle('hidden', !open); q(arrowId).textContent = open ? '⌄' : '›'; q(buttonId).setAttribute('aria-expanded', String(open));
}
function toggleBox(bodyId, buttonId) { const body=q(bodyId), hidden=body.classList.toggle('hidden'); q(buttonId).textContent=hidden?'+':'−'; }
function collapseSidebar() { q('layout').classList.add('sidebar-collapsed'); q('sidebar').classList.add('hidden-panel'); q('showSidebar').classList.remove('hidden'); setTimeout(() => map.invalidateSize(), 200); }
function expandSidebar() { q('layout').classList.remove('sidebar-collapsed'); q('sidebar').classList.remove('hidden-panel'); q('showSidebar').classList.add('hidden'); setTimeout(() => map.invalidateSize(), 200); }
function setStatus(message, error=false) { q('mapStatus').textContent=message; q('mapStatus').classList.toggle('error',error); q('mapStatus').classList.toggle('hidden',!message); }
function fitSchools(schools, maxZoom=14) { if (!schools.length) return; map.fitBounds(L.latLngBounds(schools.map(s => [s.lat,s.lon])), {padding:[40,40], maxZoom}); }
function zoomToAlcaldia() { const name=q('filtroAlcaldia').value; if (!name) return; const matches=allSchools.filter(s => s.alcaldia===name); fitSchools(matches,12); }
function zoomToMatch(type) { const value=type==='cct'?normalizeCCT(q('buscarCCT').value):normalize(q('buscarNombre').value); if (!value) return; const school=allSchools.find(s => type==='cct'?s.ccts.some(c => c.includes(value)):normalize(s.nombre).includes(value)); if (school) map.setView([school.lat,school.lon],16); }
