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
  programa123: 'data/programa_123_mejoras.json'
};

const CCT_FIELDS = ['cct1', 'cct2', 'cct3', 'cct4'];
const NEEDS = ['impermeabi','interior','exterior1','loseta','ventanas','ventanas1','ventanas2','puertas','escaleras','pluviales','techos','desazolve','deterioro','concreto','tinacos','cisterna','agua','agua1','hidrosanit','sanitarios','luminarias','electrica','transforma','lamina'];
const NEED_LABELS = {impermeabi:'Impermeabilización',interior:'Pintura interior',exterior1:'Pintura exterior',loseta:'Loseta',ventanas:'Vidrios / ventanas',ventanas1:'Cancelería de aluminio / ventanas',ventanas2:'Cancelería de herrería / ventanas',puertas:'Puertas',escaleras:'Barandales, pasillos o escaleras',pluviales:'Bajadas pluviales',techos:'Muros o techos',desazolve:'Desazolve',deterioro:'Deterioro de estructura o acabados',concreto:'Concreto',tinacos:'Tinacos',cisterna:'Cisterna',agua:'Agua potable',agua1:'Red o abastecimiento de agua',hidrosanit:'Instalación hidrosanitaria',sanitarios:'Sanitarios',luminarias:'Luminarias',electrica:'Instalación eléctrica',transforma:'Transformador',lamina:'Lámina'};
const CLASS_COLORS = {'Muy baja':'#2ca25f','Baja':'#86c98a','Media':'#f2c94c','Alta':'#f97316','Muy alta':'#dc2626'};
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

let allSchools = [];
let cctSchools = [];
let filteredSchools = [];
let viewMode = 'inmueble';
let alcaldiasGeoJSON = null;
let subsidenciasGeoJSON = null;
let fracturamientoGeoJSON = null;
let alcaldiaBoundaryLayer = null;
let subsidenciaLayer = null;
let fracturamientoLayer = null;
let schoolsVisible = true;
let initialized = false;

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
    const [schoolGeo, alcaldias, subsidencias, fracturas, mantenimiento, reforzamiento, famPotenciado, fam2026, alcaldiaApoyo, programa123] = await Promise.all([
      fetchJson(DATA.schools), fetchJson(DATA.alcaldias), fetchJson(DATA.subsidencias), fetchJson(DATA.fracturamiento),
      fetchJson(DATA.mantenimiento), fetchJson(DATA.reforzamiento), fetchJson(DATA.famPotenciado), fetchJson(DATA.fam2026),
      fetchJson(DATA.alcaldiaApoyo), fetchJson(DATA.programa123)
    ]);
    allSchools = (schoolGeo.features || []).map(normalizeFeature).filter(Boolean).filter(school => ['visor','base_madre'].includes(clean(school.props.fuente_registro)));
    joinImprovements(allSchools, mantenimiento, reforzamiento, famPotenciado, fam2026, alcaldiaApoyo, programa123);
    cctSchools = buildCctSchools(allSchools);
    alcaldiasGeoJSON = alcaldias;
    subsidenciasGeoJSON = subsidencias;
    fracturamientoGeoJSON = fracturas;
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
  const coordinates = feature.geometry?.coordinates || [];
  const lon = Number(coordinates[0] ?? p.coord_x);
  const lat = Number(coordinates[1] ?? p.coord_y);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const needs = NEEDS.filter(field => Number(p[field]) === 1);
  const indice = Number.isFinite(Number(p.Indice_Man)) ? Number(p.Indice_Man) : needs.length;
  const records = Array.isArray(p.coord_cct_records) ? p.coord_cct_records : [];
  const ccts = unique([...CCT_FIELDS.map(field => p[field]), ...(p.cct_extra || []), ...records.map(row => row.cct)].map(normalizeCCT));
  const nombres = unique([p.inmueble, p.coord_NOMBRE, p.bm_nombre_1, p.bm_nombre_2, p.bm_nombre_3, p.bm_nombre_4, ...records.map(row => row.nombre)].map(clean));
  const niveles = unique([p.principal, p.nivel, ...(p.niveles_cct || []), ...records.map(row => row.nivel)].map(clean));
  return {
    id: clean(p.idinmueble) || `escuela-${index}`,
    lat, lon, props:p, records,
    nombre: clean(p.inmueble) || nombres[0] || 'Escuela sin nombre',
    nombres, ccts, niveles,
    nivel: clean(p.principal) || niveles[0] || '',
    alcaldia: normalizeAlcaldia(p.alcaldia || p.coord_ALCALDÍA),
    indice, clasificacion:classifyIndex(indice), needs,
    subsidenciaNivel:Number(p.subsidencia_nivel) || null,
    subsidenciaClase:clean(p.subsidencia_clase),
    distFractura:Number.isFinite(Number(p.dist_fractura_m)) ? Number(p.dist_fractura_m) : null,
    tieneMantenimiento:normalize(p.tiene_registro_mantenimiento) === 'si',
    improvements:{}, improvementDetails:{}, marker:null
  };
}

function joinImprovements(schools, maintenance, reinforcement, famPotenciado, fam2026, alcaldiaApoyo, programa123) {
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
  const mm = byCct(maintenance);
  const rr = byCct(reinforcement);
  const fp = byCct(famPotenciado);
  const f26 = byCct(fam2026);
  const aa = byCct(alcaldiaApoyo);
  const p25 = byCct(programa123.filter(row => row.proyecto.includes('(2025)')), true);
  const p26 = byCct(programa123.filter(row => row.proyecto.includes('(2026)')), true);

  const profile = value => {
    const mantenimiento = mm.get(value) || null;
    const reforzamiento = rr.get(value) || null;
    const details = {
      mantenimiento,
      reforzamiento,
      famPotenciado:fp.get(value) || null,
      fam2026:f26.get(value) || null,
      alcaldiaApoyo:aa.get(value) || null,
      programa123_2025:p25.get(value) || [],
      programa123_2026:p26.get(value) || []
    };
    return {details, improvements:{
      fam_regular:Boolean(mantenimiento && normalize(mantenimiento.responsable).includes('ilife')),
      programa_123_2025:details.programa123_2025.length > 0,
      fam_potenciado:Boolean(details.famPotenciado),
      fam_potenciado_basico_2026:Boolean(details.fam2026),
      fam_reforzamiento:Boolean(reforzamiento),
      programa_123_2026:details.programa123_2026.length > 0,
      alcaldia_apoyo:Boolean(details.alcaldiaApoyo),
      ambas:Boolean(mantenimiento && reforzamiento)
    }};
  };

  schools.forEach(school => {
    const first = index => school.ccts.map(value => index.get(value)).find(Boolean) || null;
    const collect = index => {
      const uniqueRows = new Map();
      school.ccts.flatMap(value => index.get(value) || []).forEach(row => uniqueRows.set(`${row.cct}|${row.proyecto}`, row));
      return [...uniqueRows.values()];
    };
    const mantenimiento = first(mm);
    const reforzamiento = first(rr);
    school.cctProfiles = Object.fromEntries(school.ccts.map(value => [value, profile(value)]));
    school.improvementDetails = {
      mantenimiento,
      reforzamiento,
      famPotenciado:first(fp),
      fam2026:first(f26),
      alcaldiaApoyo:first(aa),
      programa123_2025:collect(p25),
      programa123_2026:collect(p26)
    };
    school.improvements = {
      fam_regular:Boolean(mantenimiento && normalize(mantenimiento.responsable).includes('ilife')),
      programa_123_2025:school.improvementDetails.programa123_2025.length > 0,
      fam_potenciado:Boolean(school.improvementDetails.famPotenciado),
      fam_potenciado_basico_2026:Boolean(school.improvementDetails.fam2026),
      fam_reforzamiento:Boolean(reforzamiento),
      programa_123_2026:school.improvementDetails.programa123_2026.length > 0,
      alcaldia_apoyo:Boolean(school.improvementDetails.alcaldiaApoyo),
      ambas:Boolean(mantenimiento && reforzamiento)
    };
  });
}

function buildCctSchools(schools) {
  return schools.flatMap(school => school.ccts.map((value,index) => {
    const record = school.records.find(row => normalizeCCT(row.cct) === value) || {};
    const profile = school.cctProfiles?.[value] || {details:{},improvements:{}};
    const total = school.ccts.length;
    const radius = total > 1 ? Math.min(18, 8 + total * 2) : 0;
    const angle = total > 1 ? (Math.PI * 2 * index / total) - Math.PI / 2 : 0;
    const lat = school.lat + Math.sin(angle) * radius / 110540;
    const lon = school.lon + Math.cos(angle) * radius / (111320 * Math.cos(school.lat * Math.PI / 180));
    const nombre = clean(record.nombre) || clean(school.props[`bm_nombre_${index+1}`]) || school.nombre;
    const nivel = clean(record.nivel) || school.nivel;
    const selectedRecord = {cct:value,nombre,nivel,turno:clean(record.turno),domicilio:clean(record.domicilio),localidad:clean(record.localidad)};
    return {
      ...school,
      id:`${school.id}-${value}`,
      lat,lon,
      originalLat:school.lat,originalLon:school.lon,
      selectedCct:value,
      inmuebleNombre:school.nombre,
      nombre,
      nombres:unique([nombre,school.nombre]),
      ccts:[value],
      niveles:nivel ? [nivel] : school.niveles,
      nivel:nivel || school.nivel,
      records:[selectedRecord],
      improvements:profile.improvements,
      improvementDetails:profile.details,
      marker:null,
      viewType:'cct'
    };
  }));
}

function currentSchools() { return viewMode === 'cct' ? cctSchools : allSchools; }
function unitLabel(plural=true) { return viewMode === 'cct' ? 'CCT' : (plural ? 'inmuebles' : 'inmueble'); }

function buildMaintenanceMenu() {
  q('maintenanceFilters').innerHTML = NEEDS.map(field => `<label><input type="checkbox" value="${field}"><span>${NEED_LABELS[field]}</span></label>`).join('');
}

function bindUI() {
  document.querySelectorAll('input[name="viewMode"]').forEach(input => input.addEventListener('change', event => {
    viewMode = event.target.value;
    q('buscarNombre').placeholder = viewMode === 'cct' ? 'Nombre de la escuela / CCT' : 'Nombre del inmueble';
    populateViewDatalists();
    q('detailPanel').classList.remove('open');
    applyFilters();
  }));
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
  q('clearRiesgos').onclick = () => { document.querySelectorAll('input[name="riskMode"]').forEach(input => { input.checked = false; }); applyFilters(); };
  q('btnLimpiar').onclick = clearAllFilters;
  q('modeMaintenance').onclick = () => { clearThematicSelections(); applyFilters(); };
  q('toggleSchools').onchange = event => { schoolsVisible = event.target.checked; saveState(); updateVisibility(); };
  q('toggleSubsidencias').onchange = event => { toggleLayer(subsidenciaLayer, event.target.checked); q('subsidenciaLegend').classList.toggle('hidden', !event.target.checked); saveState(); };
  q('toggleFracturamiento').onchange = event => { toggleLayer(fracturamientoLayer, event.target.checked); saveState(); };
  q('toggleMejoras').onclick = () => toggleMenu('mejorasBody','mejorasArrow','toggleMejoras');
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
  document.querySelectorAll('#maintenanceFilters input,#improvementFilters input,input[name="riskMode"]').forEach(input => { input.checked = false; });
}

function clearAllFilters() {
  q('filtroAlcaldia').value = '';
  q('filtroNivel').value = '';
  q('buscarCCT').value = '';
  q('buscarNombre').value = '';
  clearThematicSelections();
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
  const risk = document.querySelector('input[name="riskMode"]:checked')?.value || '';

  filteredSchools = currentSchools().filter(school => {
    if (alcaldia && school.alcaldia !== alcaldia) return false;
    if (nivel && !school.niveles.includes(nivel)) return false;
    if (cct && !school.ccts.some(value => value.includes(cct))) return false;
    if (nombre && !school.nombres.some(value => normalize(value).includes(nombre))) return false;
    if (needs.length && !needs.every(field => school.needs.includes(field))) return false;
    if (improvements.length && !improvements.some(key => school.improvements[key])) return false;
    if (risk === 'obs_fractura' && !hasFracture(school)) return false;
    if (risk === 'obs_subsidencia' && !hasSubsidence(school)) return false;
    if (risk === 'obs_combinada' && !(hasFracture(school) && hasSubsidence(school))) return false;
    return true;
  });

  q('modeMaintenance').classList.toggle('active', !improvements.length && !risk);
  updateCrossSummary(needs, improvements, risk);
  saveState();
  updateMap();
}

function updateCrossSummary(needs, improvements, risk) {
  const parts = [];
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
    const lat = schools.reduce((sum, school) => sum + school.lat, 0) / schools.length;
    const lon = schools.reduce((sum, school) => sum + school.lon, 0) / schools.length;
    const size = Math.max(34, Math.min(64, 28 + Math.sqrt(schools.length) * 3.5));
    const unit = viewMode === 'cct' ? 'CCT' : 'inmuebles';
    const icon = L.divIcon({className:'', html:`<div class="summary-marker" style="width:${size}px;height:${size}px">${schools.length}</div>`, iconSize:[size,size], iconAnchor:[size/2,size/2]});
    L.marker([lat,lon], {icon, title:`${alcaldia}: ${schools.length} ${unit}`}).bindTooltip(`${escapeHtml(alcaldia)}: ${schools.length.toLocaleString('es-MX')} ${unit}`).on('click', () => fitSchools(schools, 12)).addTo(summaryLayer);
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
  const improvements = checkedValues('#improvementFilters input');
  const needs = checkedValues('#maintenanceFilters input');
  const risk = document.querySelector('input[name="riskMode"]:checked')?.value || '';
  if ([improvements.length > 0, needs.length > 0, Boolean(risk)].filter(Boolean).length > 1) return '#111827';
  if (improvements.length) {
    const key = improvements.find(value => school.improvements[value]);
    return IMPROVEMENTS[key]?.color || '#334155';
  }
  if (risk) return OBS_COLORS[risk];
  return CLASS_COLORS[school.clasificacion];
}

function borderColor(school) {
  if (school.improvementDetails.reforzamiento) return '#5b21b6';
  if (Object.values(school.improvements).some(Boolean)) return '#0f172a';
  return '#fff';
}

function buildPopup(school) {
  const tags = Object.entries(school.improvements).filter(([,yes]) => yes).map(([key]) => `<span class="mini-tag teal">${escapeHtml(IMPROVEMENTS[key].label)}</span>`);
  const inmueble = school.viewType === 'cct' ? `<br>Inmueble: ${escapeHtml(school.inmuebleNombre)}` : '';
  return `<div class="popup-title">${escapeHtml(school.nombre)}</div><div class="popup-meta">ID inmueble: ${escapeHtml(school.id || 'No registrado')}<br>CCT: ${escapeHtml(school.ccts.join(', ') || 'No registrado')}${inmueble}<br>Alcaldía: ${escapeHtml(school.alcaldia || 'No registrada')}<br>Atenciones de revisión: <strong>${school.indice}</strong></div><div class="popup-flags">${tags.slice(0,6).join('')}${tags.length > 6 ? `<span class="mini-tag">+${tags.length-6}</span>` : ''}</div>`;
}

function openDetail(school) {
  q('detailPanel').classList.add('open');
  q('detailTitle').textContent = school.nombre;
  const needs = school.needs.map(field => `<li><span>${escapeHtml(NEED_LABELS[field])}</span></li>`).join('') || '<li>Sin variables registradas.</li>';
  const records = renderSchoolRecords(school);
  const inmuebleRow = school.viewType === 'cct' ? detailRow('Inmueble asociado',school.inmuebleNombre) : '';
  const maintenanceNote = school.viewType === 'cct'
    ? 'Las necesidades de mantenimiento corresponden al inmueble asociado a este CCT.'
    : (school.tieneMantenimiento ? 'El inmueble cuenta con registro de mantenimiento.' : 'El plantel fue incorporado desde la base de coordenadas y no cuenta con variables de mantenimiento registradas en la base del visor.');
  q('detailContent').innerHTML = `<div class="detail-tabs"><button class="tab-btn active" data-tab="general">General</button><button class="tab-btn" data-tab="mantenimiento">Mantenimiento</button><button class="tab-btn" data-tab="mejoras">Mejoras</button><button class="tab-btn" data-tab="riesgos">Observaciones</button></div>
    <div class="tab-pane active" data-pane="general"><dl>${detailRow('ID del inmueble',school.id)}${detailRow('CCT',school.ccts.join(', '))}${inmuebleRow}${detailRow('Alcaldía',school.alcaldia)}${detailRow('Nivel',school.niveles.join(', '))}${detailRow('Domicilio',school.props.bm_domicilio_principal || school.props.coord_DOMICILIO)}${detailRow('Localidad / colonia',school.props.bm_localidad || school.props.coord_LOCALIDAD || school.props.coord_colonia)}${detailRow('Fuente de coordenadas',school.props.fuente_coordenadas)}<dt>Atenciones de revisión</dt><dd>${school.indice} · ${school.clasificacion}</dd></dl>${records}</div>
    <div class="tab-pane" data-pane="mantenimiento"><p class="method-note">${maintenanceNote}</p><ul class="need-list">${needs}</ul></div>
    <div class="tab-pane" data-pane="mejoras">${renderImprovements(school)}</div>
    <div class="tab-pane" data-pane="riesgos">${riskDetail(school)}</div>`;
  activateTabs();
}

function renderSchoolRecords(school) {
  if (!school.records.length) return '';
  const rows = school.records.map(record => `<tr><td>${escapeHtml(record.cct)}</td><td>${escapeHtml(record.nombre)}</td><td>${escapeHtml(record.turno || '—')}</td><td>${escapeHtml(record.nivel || '—')}</td></tr>`).join('');
  return `<div class="school-records"><h3>${school.viewType === 'cct' ? 'CCT seleccionado' : 'CCT del inmueble'}</h3><div class="records-scroll"><table><thead><tr><th>CCT</th><th>Escuela</th><th>Turno</th><th>Nivel</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderImprovements(school) {
  const cards = [];
  const details = school.improvementDetails;
  if (school.improvements.fam_regular) cards.push(improvementCard('FAM Regular 2025', details.mantenimiento));
  if (school.improvements.programa_123_2025) cards.push(improvementCard('1, 2, 3 por mi Escuela 2025', details.programa123_2025));
  if (school.improvements.fam_potenciado) cards.push(improvementCard('FAM Potenciado 2025', details.famPotenciado));
  if (school.improvements.fam_potenciado_basico_2026) cards.push(improvementCard('FAM Potenciado + FAM Básico 2026', details.fam2026));
  if (school.improvements.fam_reforzamiento) cards.push(improvementCard('FAM Reforzamiento estructural', details.reforzamiento));
  if (school.improvements.programa_123_2026) cards.push(improvementCard('1, 2, 3 por mi Escuela 2026', details.programa123_2026));
  if (school.improvements.alcaldia_apoyo) cards.push(improvementCard('Intervención de Alcaldía', details.alcaldiaApoyo));
  return cards.join('') || '<p class="muted-box">No tiene mejoras registradas en las bases incorporadas.</p>';
}

function improvementCard(title, data) {
  const records = Array.isArray(data) ? data : [data];
  const content = records.filter(Boolean).map(record => {
    const priority = ['proyecto','detalle','turno','responsable','estado','avance','codigo','intervencion','direccion','colonia','nivel','alcaldia'];
    const entries = priority.filter(key => clean(record[key])).map(key => [key,record[key]]).slice(0,9);
    return `<dl>${entries.map(([key,value]) => detailRow(humanize(key), value)).join('')}</dl>`;
  }).join('');
  return `<div class="info-card teal-card"><h3>${escapeHtml(title)}</h3>${content}</div>`;
}

function riskDetail(school) {
  const rows = [];
  if (hasFracture(school)) rows.push(`<div class="observation-card"><strong>Cercanía a fracturamiento</strong><p>Distancia aproximada: ${Math.round(school.distFractura).toLocaleString('es-MX')} m. Es una referencia de proximidad y no un diagnóstico estructural.</p></div>`);
  if (hasSubsidence(school)) rows.push(`<div class="observation-card"><strong>Subsidencia alta</strong><p>Clasificación registrada: ${escapeHtml(school.subsidenciaClase || String(school.subsidenciaNivel))}. Se recomienda seguimiento de posibles asentamientos diferenciales.</p></div>`);
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
  const improvements = checkedValues('#improvementFilters input');
  const needs = checkedValues('#maintenanceFilters input');
  const risk = document.querySelector('input[name="riskMode"]:checked')?.value || '';
  const high = filteredSchools.filter(school => school.indice >= 15).length;
  const alcaldias = new Set(filteredSchools.map(school => school.alcaldia).filter(Boolean)).size;
  const active = improvements.length + needs.length + (risk ? 1 : 0);
  q('summaryTitle').textContent = active ? 'Resultado del cruce' : 'Resumen visible';
  const values = [[filteredSchools.length,viewMode === 'cct' ? 'CCT' : 'Inmuebles'],[alcaldias,'Alcaldías'],[high,'Con atención alta o muy alta'],[active,'Opciones activas']];
  values.forEach(([value,label], index) => { q(`kpi${index+1}`).textContent = Number(value).toLocaleString('es-MX'); q(`kpiLabel${index+1}`).textContent = label; });
}

function renderLegend() {
  const improvements = checkedValues('#improvementFilters input');
  const needs = checkedValues('#maintenanceFilters input');
  const risk = document.querySelector('input[name="riskMode"]:checked')?.value || '';
  let title = 'Atención de Revisión Diagnóstico';
  let rows = Object.entries(CLASS_COLORS).map(([label,color]) => [color,label]);
  if ([improvements.length > 0, needs.length > 0, Boolean(risk)].filter(Boolean).length > 1) {
    title = 'Cruce de selecciones';
    rows = [['#111827','Cumple todos los apartados activos']];
  } else if (improvements.length) {
    title = 'Mejoras seleccionadas';
    rows = improvements.map(key => [IMPROVEMENTS[key].color, IMPROVEMENTS[key].label]);
  } else if (risk) {
    title = 'Observación territorial';
    rows = [[OBS_COLORS[risk], viewMode === 'cct' ? 'CCT con observación' : 'Inmueble con observación']];
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

function toggleLayer(layer, on) {
  if (!layer) return;
  if (on) layer.addTo(map); else map.removeLayer(layer);
}

function populateFilters() {
  allSchools.forEach(school => { school.alcaldia = normalizeAlcaldia(school.alcaldia); });
  fillSelect('filtroAlcaldia', unique(allSchools.map(school => school.alcaldia)));
  fillSelect('filtroNivel', unique(allSchools.flatMap(school => school.niveles)));
  populateViewDatalists();
}

function populateViewDatalists() {
  const items = currentSchools();
  q('listaCCT').innerHTML = unique(items.flatMap(school => school.ccts)).map(value => `<option value="${escapeAttr(value)}"></option>`).join('');
  q('listaNombres').innerHTML = unique(items.flatMap(school => school.nombres)).map(value => `<option value="${escapeAttr(value)}"></option>`).join('');
}

function fillSelect(id, values) {
  const select = q(id);
  const first = select.querySelector('option').outerHTML;
  select.innerHTML = first + values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join('');
}

function saveState() {
  if (!initialized) return;
  localStorage.setItem('visorInfraStateV4', JSON.stringify({
    alcaldia:q('filtroAlcaldia').value,
    nivel:q('filtroNivel').value,
    needs:checkedValues('#maintenanceFilters input'),
    improvements:checkedValues('#improvementFilters input'),
    risk:document.querySelector('input[name="riskMode"]:checked')?.value || '',
    viewMode,
    schools:schoolsVisible,
    subsidencias:q('toggleSubsidencias').checked,
    fracturamiento:q('toggleFracturamiento').checked
  }));
}

function restoreState() {
  let state = {};
  try { state = JSON.parse(localStorage.getItem('visorInfraStateV4') || '{}'); } catch {}
  q('filtroAlcaldia').value = state.alcaldia || '';
  q('filtroNivel').value = state.nivel || '';
  viewMode = state.viewMode === 'cct' ? 'cct' : 'inmueble';
  const viewInput = document.querySelector(`input[name="viewMode"][value="${viewMode}"]`);
  if (viewInput) viewInput.checked = true;
  q('buscarNombre').placeholder = viewMode === 'cct' ? 'Nombre de la escuela / CCT' : 'Nombre del inmueble';
  populateViewDatalists();
  restoreChecks('#maintenanceFilters input', state.needs || []);
  restoreChecks('#improvementFilters input', state.improvements || []);
  if (state.risk) {
    const input = document.querySelector(`input[name="riskMode"][value="${CSS.escape(state.risk)}"]`);
    if (input) input.checked = true;
  }
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
function hasFracture(school) { return school.distFractura !== null && school.distFractura <= 250; }
function hasSubsidence(school) { return school.subsidenciaNivel >= 4 || ['alta','muy alta'].includes(normalize(school.subsidenciaClase)); }
function classifyIndex(value) { return value <= 6 ? 'Muy baja' : value <= 10 ? 'Baja' : value <= 14 ? 'Media' : value <= 18 ? 'Alta' : 'Muy alta'; }
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
function toggleMenu(bodyId, arrowId, buttonId) { const body=q(bodyId),open=body.classList.contains('hidden');body.classList.toggle('hidden',!open);q(arrowId).textContent=open?'⌄':'›';q(buttonId).setAttribute('aria-expanded',String(open)); }
function toggleBox(bodyId, buttonId) { const body=q(bodyId),hidden=body.classList.toggle('hidden');q(buttonId).textContent=hidden?'+':'−'; }
function collapseSidebar() { q('layout').classList.add('sidebar-collapsed');q('sidebar').classList.add('hidden-panel');q('showSidebar').classList.remove('hidden');setTimeout(()=>map.invalidateSize(),200); }
function expandSidebar() { q('layout').classList.remove('sidebar-collapsed');q('sidebar').classList.remove('hidden-panel');q('showSidebar').classList.add('hidden');setTimeout(()=>map.invalidateSize(),200); }
function setStatus(message,error=false) { q('mapStatus').textContent=message;q('mapStatus').classList.toggle('error',error);q('mapStatus').classList.toggle('hidden',!message); }
function fitSchools(schools,maxZoom=14) { if (!schools.length) return;map.fitBounds(L.latLngBounds(schools.map(school=>[school.lat,school.lon])),{padding:[40,40],maxZoom}); }
function zoomToAlcaldia() { const name=q('filtroAlcaldia').value;if(!name)return;fitSchools(currentSchools().filter(school=>school.alcaldia===name),12); }
function zoomToMatch(type) { const value=type==='cct'?normalizeCCT(q('buscarCCT').value):normalize(q('buscarNombre').value);if(!value)return;const school=currentSchools().find(item=>type==='cct'?item.ccts.some(c=>c.includes(value)):item.nombres.some(name=>normalize(name).includes(value)));if(school)map.setView([school.lat,school.lon],16); }
