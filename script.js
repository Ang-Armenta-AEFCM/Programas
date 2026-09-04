const DATA = {
  schools: 'data/infraestructura_educativa_2026.json',
  programs: 'data/programas_integradores.json',
  improvements: 'data/mejoras_infraestructura.json',
  indicators: 'data/indicadores_educativos.json',
  alcaldia: 'data/alcaldias.json',
  ageb: 'data/ageb.geojson',
  cp: 'data/codigos_postales.geojson',
  colonia: 'data/colonias_asentamientos.geojson'
};

const CCT_FIELDS = ['cct1', 'cct2', 'cct3', 'cct4'];
const PROGRAM_COLORS = ['#0369a1', '#7e22ce', '#047857', '#b45309', '#be123c', '#0f766e', '#4338ca', '#9f1239'];
const IMPROVEMENTS = {
  ilife_obra_2025_101: {label: '101 ILIFE Obra 2025', color: '#0f766e'},
  dgcop_obra_2025_232: {label: '232 DGCOP Obra 2025', color: '#2563eb'},
  ilife_obra_2025_en_2026_134: {label: '134 ILIFE Obra 2025 en 2026', color: '#7c3aed'},
  ilife_2026_180: {label: '180 ILIFE 2026', color: '#15803d'},
  sobse_2026_133: {label: '133 SOBSE 2026', color: '#c2410c'},
  faltantes_151: {label: '151 escuelas faltantes de mantenimiento', color: '#ca8a04'}
};
const TERRITORIES = {
  alcaldia: {label: 'Alcaldía', plural: 'alcaldías', color: '#0f4c75'},
  ageb: {label: 'AGEB', plural: 'AGEB', color: '#7c3aed'},
  cp: {label: 'Código postal', plural: 'códigos postales', color: '#c2410c'},
  colonia: {label: 'Colonia', plural: 'colonias', color: '#047857'}
};
const INDICATOR_LABELS = {
  abandono_preescolar: 'Abandono de preescolar',
  abandono_primaria: 'Abandono de primaria',
  abandono_secundaria: 'Abandono de secundaria',
  no_promovidos_primaria: 'No promovidos de primaria',
  no_promovidos_secundaria: 'No promovidos de secundaria'
};

let allSchools = [];
let filteredSchools = [];
let programRows = [];
let programCatalog = [];
let improvementsRows = [];
let indicatorsByCCT = {};
let territoryGeo = {};
let territoryFeatureMaps = {};
let territorySelectionLayers = {};
let baseAlcaldiaLayer = null;
let schoolsVisible = true;
let initialized = false;

const schoolLayer = L.layerGroup();
const summaryLayer = L.layerGroup();
const map = L.map('map', {zoomControl: false, preferCanvas: true}).setView([19.35, -99.13], 10);
L.control.zoom({position: 'topleft'}).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
schoolLayer.addTo(map);

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindUI();
  restoreDarkMode();
  try {
    const keys = Object.keys(DATA);
    const values = await Promise.all(keys.map(key => fetchJson(DATA[key])));
    const loaded = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
    programRows = loaded.programs;
    improvementsRows = loaded.improvements;
    indicatorsByCCT = loaded.indicators;
    territoryGeo = {alcaldia: loaded.alcaldia, ageb: loaded.ageb, cp: loaded.cp, colonia: loaded.colonia};

    allSchools = (loaded.schools.features || []).map(normalizeFeature).filter(Boolean);
    mergeProgramOnlySchools(allSchools, programRows);
    joinPrograms(allSchools, programRows);
    joinImprovements(allSchools, improvementsRows);
    joinIndicators(allSchools, indicatorsByCCT);

    buildProgramCatalog();
    buildProgramMenu();
    buildImprovementMenu();
    prepareTerritories();
    buildTerritoryMenus();
    populateGeneralFilters();
    drawBaseAlcaldias();
    restoreState();
    initialized = true;
    applyFilters(false);
    setStatus('');
  } catch (error) {
    console.error(error);
    setStatus('No fue posible cargar la información. Abre el visor desde un servidor web o desde GitHub Pages.', true);
  }
}

async function fetchJson(path) {
  const response = await fetch(path, {cache: 'no-store'});
  if (!response.ok) throw new Error(`No se pudo cargar ${path}`);
  return response.json();
}

function normalizeFeature(feature, index) {
  const props = feature.properties || {};
  const coords = feature.geometry?.coordinates || [];
  return normalizeSchool(props, Number(coords[1]), Number(coords[0]), index, false);
}

function normalizeSchool(props, lat, lon, index, programOnly) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id: clean(props.idinmueble) || `plantel-${index}`,
    lat,
    lon,
    props,
    nombre: clean(props.inmueble || props.nombre) || 'Escuela sin nombre',
    alcaldia: normalizeAlcaldia(props.alcaldia),
    nivel: clean(props.principal || props.nivel),
    ccts: (programOnly ? [props.cct] : CCT_FIELDS.map(field => props[field])).map(normalizeCCT).filter(Boolean),
    territories: props.territorios || {},
    programOnly,
    programs: [],
    improvementIds: [],
    improvementDetails: [],
    indicators: {byCct: [], totals: {}},
    marker: null
  };
}

function mergeProgramOnlySchools(schools, rows) {
  const known = new Set(schools.flatMap(school => school.ccts));
  const missing = new Map();
  rows.forEach(row => {
    const key = normalizeCCT(row.cct);
    if (key && !known.has(key) && !missing.has(key)) missing.set(key, row);
  });
  missing.forEach((row, key) => {
    const props = {
      cct: key,
      nombre: row.nombre,
      inmueble: row.nombre,
      alcaldia: row.alcaldia,
      nivel: row.nivel,
      principal: row.nivel,
      domicilio: row.domicilio,
      localidad: row.localidad,
      colonia: row.colonia,
      territorios: row.territorios || {}
    };
    const school = normalizeSchool(props, Number(row.lat), Number(row.lon), `programa-${key}`, true);
    if (school) schools.push(school);
  });
}

function joinPrograms(schools, rows) {
  const index = new Map();
  rows.forEach(row => {
    const key = normalizeCCT(row.cct);
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  });
  schools.forEach(school => {
    const uniqueRows = new Map();
    school.ccts.flatMap(key => index.get(key) || []).forEach(row => {
      uniqueRows.set(`${normalizeCCT(row.cct)}|${row.proyecto_id}`, row);
    });
    school.programs = [...uniqueRows.values()];
  });
}

function joinImprovements(schools, rows) {
  const index = new Map(rows.map(row => [normalizeCCT(row.cct), row]));
  const byName = new Map();
  rows.forEach(row => {
    const key = normalize(row.escuela);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  });
  schools.forEach(school => {
    const matchedByCct = school.ccts.map(key => index.get(key)).filter(Boolean);
    const matchedByName = (byName.get(normalize(school.nombre)) || []).filter(row =>
      Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon)) &&
      Math.abs(Number(row.lat) - school.lat) < 0.015 && Math.abs(Number(row.lon) - school.lon) < 0.015
    );
    const matched = [...new Map([...matchedByCct, ...matchedByName].map(row => [row.cct, row])).values()];
    const categories = new Map();
    matched.forEach(row => (row.categorias || []).forEach(category => categories.set(category.id, category)));
    school.improvementDetails = matched;
    school.improvementIds = [...categories.keys()];
  });
}

function joinIndicators(schools, source) {
  schools.forEach(school => {
    const byCct = school.ccts.map(key => ({cct: key, ...(source[key] || {})}));
    const totals = {};
    Object.keys(INDICATOR_LABELS).forEach(metric => {
      const values = byCct.map(row => row[metric]).filter(value => value !== null && value !== undefined && value !== '');
      totals[metric] = values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) : null;
    });
    school.indicators = {byCct, totals};
  });
}

function buildProgramCatalog() {
  const catalog = new Map();
  programRows.forEach(row => {
    if (!catalog.has(row.proyecto_id)) {
      catalog.set(row.proyecto_id, {id: row.proyecto_id, label: row.proyecto, program: row.programa, ccts: new Set()});
    }
    catalog.get(row.proyecto_id).ccts.add(normalizeCCT(row.cct));
  });
  programCatalog = [...catalog.values()].map(item => ({...item, count: item.ccts.size})).sort((a, b) =>
    a.program.localeCompare(b.program, 'es') || a.label.localeCompare(b.label, 'es')
  );
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
      <div>${projects.map(project => `
        <label class="inline-check program-option" data-search="${escapeAttr(normalize(`${program} ${project.label}`))}">
          <input type="checkbox" value="${escapeAttr(project.id)}">
          <span>${escapeHtml(project.label)} <em>${project.count.toLocaleString('es-MX')} CCT</em></span>
        </label>`).join('')}
      </div>
    </details>`).join('');
  q('programFilters').addEventListener('change', () => applyFilters(false));
}

function buildImprovementMenu() {
  const counts = Object.fromEntries(Object.keys(IMPROVEMENTS).map(key => [key, 0]));
  improvementsRows.forEach(row => (row.categorias || []).forEach(category => {
    counts[category.id] = (counts[category.id] || 0) + 1;
  }));
  q('improvementFilters').innerHTML = Object.entries(IMPROVEMENTS).map(([key, item]) => `
    <label class="inline-check">
      <input type="checkbox" value="${escapeAttr(key)}">
      <span>${escapeHtml(item.label)} <em>${(counts[key] || 0).toLocaleString('es-MX')} CCT</em></span>
    </label>`).join('');
  q('improvementFilters').addEventListener('change', () => applyFilters(false));
}

function prepareTerritories() {
  territoryFeatureMaps = {};
  Object.keys(TERRITORIES).forEach(type => {
    const mapById = new Map();
    (territoryGeo[type].features || []).forEach(feature => {
      const id = territoryFeatureId(type, feature);
      if (!id || !feature.geometry) return;
      feature.properties = feature.properties || {};
      feature.properties.__filterId = id;
      feature.properties.__filterLabel = territoryFeatureLabel(type, feature);
      mapById.set(id, feature);
    });
    territoryFeatureMaps[type] = mapById;
    territorySelectionLayers[type] = L.geoJSON([], {
      interactive: false,
      style: {color: TERRITORIES[type].color, weight: 3, opacity: 0.95, fillColor: TERRITORIES[type].color, fillOpacity: 0.10}
    }).addTo(map);
  });
}

function territoryFeatureId(type, feature) {
  const p = feature.properties || {};
  if (type === 'alcaldia' || type === 'ageb') return clean(p.CVEGEO);
  if (type === 'cp') return clean(p.cp).padStart(5, '0');
  return clean(p.cvegeo);
}

function territoryFeatureLabel(type, feature) {
  const p = feature.properties || {};
  if (type === 'alcaldia') return clean(p.NOMGEO) || clean(p.CVEGEO);
  if (type === 'ageb') return `AGEB ${clean(p.CVE_AGEB)}${p.alcaldia ? ` · ${clean(p.alcaldia)}` : ''}`;
  if (type === 'cp') return `C.P. ${clean(p.cp).padStart(5, '0')}`;
  return `${clean(p.nom_asen) || 'Colonia sin nombre'}${p.cp ? ` · C.P. ${clean(p.cp).padStart(5, '0')}` : ''}`;
}

function buildTerritoryMenus() {
  const counts = {};
  Object.keys(TERRITORIES).forEach(type => counts[type] = new Map());
  allSchools.filter(school => !school.programOnly).forEach(school => {
    Object.keys(TERRITORIES).forEach(type => {
      const id = clean(school.territories?.[type]);
      if (id) counts[type].set(id, (counts[type].get(id) || 0) + 1);
    });
  });

  q('territoryFilters').innerHTML = Object.entries(TERRITORIES).map(([type, definition], index) => {
    const options = [...territoryFeatureMaps[type].entries()].map(([id, feature]) => ({
      id,
      label: feature.properties.__filterLabel,
      count: counts[type].get(id) || 0
    })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
    return `
      <details class="territory-group" data-type="${type}" ${index === 0 ? 'open' : ''}>
        <summary><span>${escapeHtml(definition.label)}</span><small><strong id="territoryCount-${type}">0</strong> seleccionados</small></summary>
        <div class="territory-group-body">
          <input class="territory-search" data-type="${type}" type="search" placeholder="Buscar ${escapeAttr(definition.label.toLowerCase())}">
          <button class="territory-clear secondary-action" data-type="${type}" type="button">Quitar selección</button>
          <div class="territory-checklist" id="territory-${type}">
            ${options.map(option => `
              <label class="inline-check territory-option" data-search="${escapeAttr(normalize(option.label))}">
                <input class="territory-check" data-type="${type}" type="checkbox" value="${escapeAttr(option.id)}">
                <span>${escapeHtml(option.label)} <em>${option.count.toLocaleString('es-MX')} planteles</em></span>
              </label>`).join('')}
          </div>
        </div>
      </details>`;
  }).join('');

  document.querySelectorAll('.territory-check').forEach(input => input.addEventListener('change', () => {
    updateTerritoryCounts();
    applyFilters(true);
  }));
  document.querySelectorAll('.territory-search').forEach(input => input.addEventListener('input', event => filterTerritoryMenu(event.target.dataset.type, event.target.value)));
  document.querySelectorAll('.territory-clear').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll(`.territory-check[data-type="${button.dataset.type}"]`).forEach(input => input.checked = false);
    updateTerritoryCounts();
    applyFilters(false);
  }));
}

function bindUI() {
  q('filtroNivel').addEventListener('change', () => applyFilters(false));
  q('buscarCCT').addEventListener('input', debounce(() => applyFilters(false), 160));
  q('buscarNombre').addEventListener('input', debounce(() => applyFilters(false), 160));
  ['buscarCCT', 'buscarNombre'].forEach(id => {
    q(id).addEventListener('change', () => zoomToMatch(id === 'buscarCCT' ? 'cct' : 'nombre'));
    q(id).addEventListener('keydown', event => {
      if (event.key === 'Enter') zoomToMatch(id === 'buscarCCT' ? 'cct' : 'nombre');
    });
  });
  q('selectAllMejoras').onclick = () => setChecks('#improvementFilters input', true);
  q('clearMejoras').onclick = () => setChecks('#improvementFilters input', false);
  q('selectAllProgramas').onclick = () => {
    document.querySelectorAll('.program-option:not(.hidden-by-search) input').forEach(input => input.checked = true);
    applyFilters(false);
  };
  q('clearProgramas').onclick = () => setChecks('#programFilters input', false);
  q('btnLimpiar').onclick = clearAllFilters;
  q('toggleSchools').onchange = event => {
    schoolsVisible = event.target.checked;
    saveState();
    updateVisibility();
  };
  q('programSearch').addEventListener('input', filterProgramMenu);
  q('toggleTerritorios').onclick = () => toggleMenu('territoriosBody', 'territoriosArrow', 'toggleTerritorios');
  q('toggleProgramas').onclick = () => toggleMenu('programasBody', 'programasArrow', 'toggleProgramas');
  q('toggleMejoras').onclick = () => toggleMenu('mejorasBody', 'mejorasArrow', 'toggleMejoras');
  q('toggleSidebar').onclick = collapseSidebar;
  q('showSidebar').onclick = expandSidebar;
  q('closeDetail').onclick = () => q('detailPanel').classList.remove('open');
  q('toggleLegend').onclick = () => toggleBox('legendBody', 'toggleLegend');
  q('statsLink').onclick = saveState;
  q('toggleDark').onclick = toggleDarkMode;
  q('toggleFullscreen').onclick = toggleFullscreen;
  document.addEventListener('fullscreenchange', syncFullscreenButton);
  map.on('zoomend moveend', updateVisibility);
}

function populateGeneralFilters() {
  fillSelect('filtroNivel', unique(allSchools.map(school => school.nivel)));
  q('listaCCT').innerHTML = unique(allSchools.flatMap(school => school.ccts)).map(value => `<option value="${escapeAttr(value)}"></option>`).join('');
  q('listaNombres').innerHTML = unique(allSchools.map(school => school.nombre)).map(value => `<option value="${escapeAttr(value)}"></option>`).join('');
}

function applyFilters(zoomTerritories) {
  if (!initialized) return;
  const nivel = q('filtroNivel').value;
  const termCct = normalizeCCT(q('buscarCCT').value);
  const termName = normalize(q('buscarNombre').value);
  const projects = checkedValues('#programFilters input');
  const improvements = checkedValues('#improvementFilters input');
  const territories = selectedTerritories();

  filteredSchools = allSchools.filter(school => {
    if (nivel && school.nivel !== nivel) return false;
    if (termCct && !school.ccts.some(value => value.includes(termCct))) return false;
    if (termName && !normalize(school.nombre).includes(termName)) return false;
    if (school.programOnly && projects.length === 0) return false;
    if (projects.length && !school.programs.some(row => projects.includes(row.proyecto_id))) return false;
    if (improvements.length && !school.improvementIds.some(id => improvements.includes(id))) return false;
    if (!matchesTerritories(school, territories)) return false;
    return true;
  });

  q('programSelectionCount').textContent = projects.length.toLocaleString('es-MX');
  renderTerritoryLayers(territories);
  updateCrossSummary(projects, improvements, territories);
  saveState();
  updateMap();
  if (zoomTerritories) zoomToSelectedTerritories();
}

function selectedTerritories() {
  const result = {};
  Object.keys(TERRITORIES).forEach(type => {
    result[type] = [...document.querySelectorAll(`.territory-check[data-type="${type}"]:checked`)].map(input => input.value);
  });
  return result;
}

function matchesTerritories(school, selections) {
  return Object.keys(TERRITORIES).every(type => {
    const selected = selections[type];
    return !selected.length || selected.includes(clean(school.territories?.[type]));
  });
}

function updateCrossSummary(projects, improvements, territories) {
  const parts = [];
  if (projects.length) parts.push(`${projects.length} proyecto${projects.length === 1 ? '' : 's'}`);
  if (improvements.length) parts.push(`${improvements.length} mejora${improvements.length === 1 ? '' : 's'}`);
  const territoryCount = Object.values(territories).reduce((sum, values) => sum + values.length, 0);
  if (territoryCount) parts.push(`${territoryCount} límite${territoryCount === 1 ? '' : 's'} territorial${territoryCount === 1 ? '' : 'es'}`);
  q('activeCrossSummary').textContent = parts.length ? `Cruce activo: ${parts.join(' + ')}.` : 'Sin cruces temáticos activos.';
}

function renderTerritoryLayers(selections) {
  Object.keys(TERRITORIES).forEach(type => {
    const layer = territorySelectionLayers[type];
    layer.clearLayers();
    const features = selections[type].map(id => territoryFeatureMaps[type].get(id)).filter(Boolean);
    if (features.length) layer.addData(features);
    layer.bringToFront();
  });
}

function drawBaseAlcaldias() {
  baseAlcaldiaLayer = L.geoJSON(territoryGeo.alcaldia, {
    interactive: false,
    style: {color: '#164e63', weight: 2.4, opacity: 0.82, fillColor: '#0e7490', fillOpacity: 0.018}
  }).addTo(map);
  map.fitBounds(baseAlcaldiaLayer.getBounds(), {padding: [12, 12]});
}

function updateMap() {
  schoolLayer.clearLayers();
  if (map.getZoom() > 10.5) drawSchools();
  drawSummary();
  updateStats();
  renderLegend();
  updateVisibility();
}

function drawSchools() {
  schoolLayer.clearLayers();
  filteredSchools.forEach(school => {
    const marker = L.circleMarker([school.lat, school.lon], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: schoolColor(school),
      fillOpacity: 0.92
    });
    marker.bindPopup(buildPopup(school), {maxWidth: 370});
    marker.on('click', () => openDetail(school));
    school.marker = marker;
    schoolLayer.addLayer(marker);
  });
}

function drawSummary() {
  summaryLayer.clearLayers();
  const groups = new Map();
  filteredSchools.forEach(school => {
    const key = school.alcaldia || 'SIN ALCALDÍA';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(school);
  });
  groups.forEach((schools, alcaldia) => {
    const lat = schools.reduce((sum, school) => sum + school.lat, 0) / schools.length;
    const lon = schools.reduce((sum, school) => sum + school.lon, 0) / schools.length;
    const size = Math.max(34, Math.min(64, 28 + Math.sqrt(schools.length) * 3.5));
    const icon = L.divIcon({
      className: '',
      html: `<div class="summary-marker" style="width:${size}px;height:${size}px">${schools.length}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
    L.marker([lat, lon], {icon, title: `${alcaldia}: ${schools.length} planteles`})
      .bindTooltip(`${escapeHtml(alcaldia)}: ${schools.length.toLocaleString('es-MX')} planteles`)
      .on('click', () => fitSchools(schools, 12))
      .addTo(summaryLayer);
  });
}

function updateVisibility() {
  map.removeLayer(schoolLayer);
  map.removeLayer(summaryLayer);
  if (!schoolsVisible) return;
  const hasSearch = Boolean(q('buscarCCT').value || q('buscarNombre').value);
  if (map.getZoom() <= 10.5 && !hasSearch) {
    summaryLayer.addTo(map);
  } else {
    if (!schoolLayer.getLayers().length && filteredSchools.length) drawSchools();
    schoolLayer.addTo(map);
  }
}

function schoolColor(school) {
  const projects = checkedValues('#programFilters input');
  const improvements = checkedValues('#improvementFilters input');
  if (projects.length && improvements.length) return '#111827';
  if (projects.length) {
    const match = school.programs.find(row => projects.includes(row.proyecto_id));
    const index = Math.max(0, programCatalog.findIndex(item => item.id === match?.proyecto_id));
    return PROGRAM_COLORS[index % PROGRAM_COLORS.length];
  }
  if (improvements.length) {
    const key = improvements.find(id => school.improvementIds.includes(id));
    return IMPROVEMENTS[key]?.color || '#334155';
  }
  if (school.programs.length && school.improvementIds.length) return '#334155';
  if (school.programs.length) return '#2563eb';
  if (school.improvementIds.length) return '#0f766e';
  return '#64748b';
}

function buildPopup(school) {
  const tags = [];
  unique(school.programs.map(row => row.proyecto)).forEach(label => tags.push(`<span class="mini-tag blue">${escapeHtml(label)}</span>`));
  school.improvementIds.forEach(key => tags.push(`<span class="mini-tag teal">${escapeHtml(IMPROVEMENTS[key]?.label || key)}</span>`));
  return `
    <div class="popup-title">${escapeHtml(school.nombre)}</div>
    <div class="popup-meta">
      CCT: ${escapeHtml(school.ccts.join(', ') || 'No registrado')}<br>
      Alcaldía: ${escapeHtml(school.alcaldia || 'No registrada')}<br>
      Nivel: ${escapeHtml(school.nivel || 'No registrado')}
    </div>
    ${indicatorMiniHtml(school)}
    <div class="popup-flags">${tags.slice(0, 6).join('')}${tags.length > 6 ? `<span class="mini-tag">+${tags.length - 6}</span>` : ''}</div>`;
}

function indicatorMiniHtml(school) {
  return `<div class="indicator-mini"><strong>Indicadores educativos</strong>${Object.entries(INDICATOR_LABELS).map(([key, label]) => {
    const value = school.indicators.totals[key];
    return `<div><span>${escapeHtml(label)}</span><b>${value === null ? '—' : Number(value).toLocaleString('es-MX')}</b></div>`;
  }).join('')}</div>`;
}

function openDetail(school) {
  q('detailPanel').classList.add('open');
  q('detailTitle').textContent = school.nombre;
  const programs = school.programs.map(programCard).join('') || '<p class="muted-box">No tiene programas registrados.</p>';
  const improvements = renderImprovements(school);
  q('detailContent').innerHTML = `
    <div class="detail-tabs">
      <button class="tab-btn active" data-tab="general" type="button">General</button>
      <button class="tab-btn" data-tab="programas" type="button">Programas</button>
      <button class="tab-btn" data-tab="mejoras" type="button">Mejoras</button>
    </div>
    <div class="tab-pane active" data-pane="general">
      <dl>
        ${detailRow('CCT', school.ccts.join(', '))}
        ${detailRow('Alcaldía', school.alcaldia)}
        ${detailRow('Nivel', school.nivel)}
        ${detailRow('Domicilio', school.props.bm_domicilio_principal || school.props.domicilio)}
        ${detailRow('Localidad / colonia', school.props.bm_localidad || school.props.localidad || school.props.colonia)}
      </dl>
      ${indicatorDetailHtml(school)}
    </div>
    <div class="tab-pane" data-pane="programas">${programs}</div>
    <div class="tab-pane" data-pane="mejoras">${improvements}</div>`;
  activateTabs();
}

function indicatorDetailHtml(school) {
  return `<section class="indicator-card">
    <h3>Indicadores educativos</h3>
    <p>Valores acumulados para los CCT registrados en este inmueble.</p>
    <div class="indicator-grid">${Object.entries(INDICATOR_LABELS).map(([key, label]) => {
      const value = school.indicators.totals[key];
      return `<div><span>${escapeHtml(label)}</span><strong>${value === null ? 'Sin registro' : Number(value).toLocaleString('es-MX')}</strong></div>`;
    }).join('')}</div>
  </section>`;
}

function programCard(row) {
  const mapsUrl = safeUrl(row.google_maps);
  return `<div class="info-card blue-card">
    <div class="program-parent">${escapeHtml(row.programa)}</div>
    <h3>${escapeHtml(row.proyecto)}</h3>
    <dl>
      ${detailRow('CCT', row.cct)}
      ${detailRow('Nivel', row.nivel)}
      ${detailRow('Turno(s)', row.turno)}
      ${detailRow('Domicilio', row.domicilio)}
      ${detailRow('Localidad', row.localidad)}
      ${detailRow('Detalle', row.detalle)}
    </dl>
    ${mapsUrl ? `<a class="map-link" href="${escapeAttr(mapsUrl)}" target="_blank" rel="noopener noreferrer">Abrir ubicación de referencia</a>` : ''}
  </div>`;
}

function renderImprovements(school) {
  const cards = [];
  const seen = new Set();
  school.improvementDetails.forEach(row => (row.categorias || []).forEach(category => {
    const key = `${row.cct}|${category.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    cards.push(`<div class="info-card improvement-card" style="border-left-color:${IMPROVEMENTS[category.id]?.color || '#0f766e'}">
      <h3>${escapeHtml(category.label)}</h3>
      <dl>
        ${detailRow('CCT', row.cct)}
        ${detailRow('Código', row.codigo)}
        ${detailRow('Escuela', row.escuela)}
        ${detailRow('Nivel', row.nivel)}
        ${detailRow('Alcaldía', row.alcaldia)}
        ${detailRow('Colonia', row.colonia)}
        ${detailRow('Dirección', row.direccion)}
        ${detailRow('Fuente', category.fuente)}
      </dl>
    </div>`);
  }));
  return cards.join('') || '<p class="muted-box">No tiene mejoras registradas en las bases incorporadas.</p>';
}

function activateTabs() {
  const root = q('detailContent');
  root.querySelectorAll('.tab-btn').forEach(button => button.onclick = () => {
    root.querySelectorAll('.tab-btn').forEach(item => item.classList.toggle('active', item === button));
    root.querySelectorAll('.tab-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.pane === button.dataset.tab));
  });
}

function updateStats() {
  const withPrograms = filteredSchools.filter(school => school.programs.length).length;
  const withImprovements = filteredSchools.filter(school => school.improvementIds.length).length;
  const active = checkedValues('#programFilters input').length + checkedValues('#improvementFilters input').length +
    Object.values(selectedTerritories()).reduce((sum, values) => sum + values.length, 0);
  q('summaryTitle').textContent = active ? 'Resultado del cruce' : 'Resumen visible';
  const values = [
    [filteredSchools.length, 'Planteles'],
    [withPrograms, 'Con programas'],
    [withImprovements, 'Con mejoras'],
    [active, 'Selecciones activas']
  ];
  values.forEach(([value, label], index) => {
    q(`kpi${index + 1}`).textContent = Number(value).toLocaleString('es-MX');
    q(`kpiLabel${index + 1}`).textContent = label;
  });
}

function renderLegend() {
  const projects = checkedValues('#programFilters input');
  const improvements = checkedValues('#improvementFilters input');
  let title = 'Planteles escolares';
  let rows = [['#2563eb', 'Con programas'], ['#0f766e', 'Con mejoras'], ['#64748b', 'Sin selección temática']];
  if (projects.length && improvements.length) {
    title = 'Cruce de programas y mejoras';
    rows = [['#111827', 'Cumple ambos apartados activos']];
  } else if (projects.length) {
    title = 'Proyectos seleccionados';
    rows = projects.slice(0, 8).map(id => {
      const index = programCatalog.findIndex(item => item.id === id);
      return [PROGRAM_COLORS[Math.max(0, index) % PROGRAM_COLORS.length], programCatalog[index]?.label || id];
    });
  } else if (improvements.length) {
    title = 'Mejoras seleccionadas';
    rows = improvements.map(id => [IMPROVEMENTS[id]?.color || '#334155', IMPROVEMENTS[id]?.label || id]);
  }
  q('legendTitle').textContent = title;
  q('legendBody').innerHTML = rows.map(([color, label]) => `<div><span class="swatch" style="background:${color}"></span>${escapeHtml(label)}</div>`).join('');
}

function filterProgramMenu() {
  const term = normalize(q('programSearch').value);
  document.querySelectorAll('.program-option').forEach(label => label.classList.toggle('hidden-by-search', Boolean(term && !label.dataset.search.includes(term))));
  document.querySelectorAll('.program-group').forEach(group => {
    const visible = [...group.querySelectorAll('.program-option')].some(label => !label.classList.contains('hidden-by-search'));
    group.classList.toggle('hidden-by-search', !visible);
    if (term && visible) group.open = true;
  });
}

function filterTerritoryMenu(type, value) {
  const term = normalize(value);
  document.querySelectorAll(`#territory-${type} .territory-option`).forEach(label => {
    label.classList.toggle('hidden-by-search', Boolean(term && !label.dataset.search.includes(term)));
  });
}

function updateTerritoryCounts() {
  Object.keys(TERRITORIES).forEach(type => {
    const count = document.querySelectorAll(`.territory-check[data-type="${type}"]:checked`).length;
    q(`territoryCount-${type}`).textContent = count.toLocaleString('es-MX');
  });
}

function zoomToSelectedTerritories() {
  let bounds = null;
  Object.values(territorySelectionLayers).forEach(layer => {
    const layerBounds = layer.getBounds();
    if (!layerBounds.isValid()) return;
    bounds = bounds ? bounds.extend(layerBounds) : layerBounds;
  });
  if (bounds?.isValid()) map.fitBounds(bounds, {padding: [30, 30], maxZoom: 15});
}

function zoomToMatch(type) {
  if (!initialized) return;
  const value = type === 'cct' ? normalizeCCT(q('buscarCCT').value) : normalize(q('buscarNombre').value);
  if (!value) return;
  const school = allSchools.find(item => type === 'cct'
    ? item.ccts.some(key => key === value || key.includes(value))
    : normalize(item.nombre) === value || normalize(item.nombre).includes(value));
  if (!school) return;
  map.setView([school.lat, school.lon], 16);
  setTimeout(() => {
    updateVisibility();
    school.marker?.openPopup();
    openDetail(school);
  }, 80);
}

function clearAllFilters() {
  q('filtroNivel').value = '';
  q('buscarCCT').value = '';
  q('buscarNombre').value = '';
  q('programSearch').value = '';
  document.querySelectorAll('#programFilters input,#improvementFilters input,.territory-check').forEach(input => input.checked = false);
  document.querySelectorAll('.territory-search').forEach(input => input.value = '');
  Object.keys(TERRITORIES).forEach(type => filterTerritoryMenu(type, ''));
  filterProgramMenu();
  updateTerritoryCounts();
  q('detailPanel').classList.remove('open');
  applyFilters(false);
  if (baseAlcaldiaLayer) map.fitBounds(baseAlcaldiaLayer.getBounds(), {padding: [12, 12]});
}

function saveState() {
  if (!initialized) return;
  localStorage.setItem('visorProgramasStateV4', JSON.stringify({
    nivel: q('filtroNivel').value,
    projects: checkedValues('#programFilters input'),
    improvements: checkedValues('#improvementFilters input'),
    territories: selectedTerritories(),
    schools: schoolsVisible
  }));
}

function restoreState() {
  let state = {};
  try { state = JSON.parse(localStorage.getItem('visorProgramasStateV4') || '{}'); } catch {}
  q('filtroNivel').value = state.nivel || '';
  restoreChecks('#programFilters input', state.projects || []);
  restoreChecks('#improvementFilters input', state.improvements || []);
  Object.entries(state.territories || {}).forEach(([type, values]) => restoreChecks(`.territory-check[data-type="${type}"]`, values || []));
  schoolsVisible = state.schools !== false;
  q('toggleSchools').checked = schoolsVisible;
  updateTerritoryCounts();
}

function restoreDarkMode() {
  const enabled = localStorage.getItem('visorProgramasDark') === 'true';
  document.body.classList.toggle('dark-mode', enabled);
  syncDarkButton();
}

function toggleDarkMode() {
  const enabled = !document.body.classList.contains('dark-mode');
  document.body.classList.toggle('dark-mode', enabled);
  localStorage.setItem('visorProgramasDark', String(enabled));
  syncDarkButton();
}

function syncDarkButton() {
  const enabled = document.body.classList.contains('dark-mode');
  q('toggleDark').title = enabled ? 'Activar modo claro' : 'Activar modo oscuro';
  q('toggleDark').setAttribute('aria-label', q('toggleDark').title);
}

async function toggleFullscreen() {
  const target = q('maparea');
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await target.requestFullscreen();
  } catch (error) {
    console.warn('No fue posible cambiar a pantalla completa.', error);
  }
}

function syncFullscreenButton() {
  const enabled = Boolean(document.fullscreenElement);
  q('toggleFullscreen').textContent = enabled ? '×' : '⛶';
  q('toggleFullscreen').title = enabled ? 'Salir de pantalla completa' : 'Pantalla completa';
  q('toggleFullscreen').setAttribute('aria-label', q('toggleFullscreen').title);
  setTimeout(() => map.invalidateSize(), 80);
}

function setChecks(selector, checked) {
  document.querySelectorAll(selector).forEach(input => input.checked = checked);
  applyFilters(false);
}

function restoreChecks(selector, values) {
  document.querySelectorAll(selector).forEach(input => input.checked = values.includes(input.value));
}

function checkedValues(selector) {
  return [...document.querySelectorAll(`${selector}:checked`)].map(input => input.value);
}

function fillSelect(id, values) {
  const select = q(id);
  const first = select.querySelector('option').outerHTML;
  select.innerHTML = first + values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join('');
}

function toggleMenu(bodyId, arrowId, buttonId) {
  const body = q(bodyId);
  const open = body.classList.contains('hidden');
  body.classList.toggle('hidden', !open);
  q(arrowId).textContent = open ? '⌄' : '›';
  q(buttonId).setAttribute('aria-expanded', String(open));
}

function toggleBox(bodyId, buttonId) {
  const body = q(bodyId);
  const hidden = body.classList.toggle('hidden');
  q(buttonId).textContent = hidden ? '+' : '−';
}

function collapseSidebar() {
  q('layout').classList.add('sidebar-collapsed');
  q('sidebar').classList.add('hidden-panel');
  q('showSidebar').classList.remove('hidden');
  setTimeout(() => map.invalidateSize(), 200);
}

function expandSidebar() {
  q('layout').classList.remove('sidebar-collapsed');
  q('sidebar').classList.remove('hidden-panel');
  q('showSidebar').classList.add('hidden');
  setTimeout(() => map.invalidateSize(), 200);
}

function setStatus(message, error = false) {
  q('mapStatus').textContent = message;
  q('mapStatus').classList.toggle('error', error);
  q('mapStatus').classList.toggle('hidden', !message);
}

function fitSchools(schools, maxZoom = 14) {
  if (!schools.length) return;
  map.fitBounds(L.latLngBounds(schools.map(school => [school.lat, school.lon])), {padding: [40, 40], maxZoom});
}

function detailRow(label, value) {
  const text = clean(value);
  return text ? `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(text)}</dd>` : '';
}

function safeUrl(value) {
  const text = clean(value);
  return /^https:\/\//i.test(text) ? text : '';
}

function normalizeCCT(value) {
  return clean(value).replace(/\s+/g, '').toUpperCase();
}

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim().replace(/\s+/g, ' ');
}

function normalize(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeAlcaldia(value) {
  return clean(value).normalize('NFC').toLocaleUpperCase('es-MX');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

function escapeHtml(value) {
  return clean(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function q(id) {
  return document.getElementById(id);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
