const PATHS = {
  schools: 'data/infraestructura_educativa_2026.json',
  programs: 'data/programas_integradores.json',
  improvements: 'data/mejoras_infraestructura.json'
};
const CCT_FIELDS = ['cct1', 'cct2', 'cct3', 'cct4'];
const IMPROVEMENT_LABELS = {
  ilife_obra_2025_101: '101 ILIFE Obra 2025',
  dgcop_obra_2025_232: '232 DGCOP Obra 2025',
  ilife_obra_2025_en_2026_134: '134 ILIFE Obra 2025 en 2026',
  ilife_2026_180: '180 ILIFE 2026',
  sobse_2026_133: '133 SOBSE 2026',
  faltantes_151: '151 escuelas faltantes de mantenimiento'
};

let schools = [];
let catalog = new Map();
let state = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const keys = Object.keys(PATHS);
    const values = await Promise.all(keys.map(key => fetchJson(PATHS[key])));
    const data = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
    schools = (data.schools.features || []).map((feature, index) => normalizeSchool(feature.properties || {}, feature.geometry?.coordinates || [], index, false)).filter(Boolean);
    mergeProgramOnly(schools, data.programs);
    joinPrograms(schools, data.programs);
    joinImprovements(schools, data.improvements);
    buildCatalog(data.programs);
    populateFilters();
    bindUI();
    restoreState();
    applyStats();
  } catch (error) {
    console.error(error);
    q('statsContext').textContent = 'No fue posible cargar las bases del visor.';
  }
}

async function fetchJson(path) {
  const response = await fetch(path, {cache: 'no-store'});
  if (!response.ok) throw new Error(path);
  return response.json();
}

function normalizeSchool(props, coords, index, programOnly) {
  const lon = Number(coords[0] ?? props.lon);
  const lat = Number(coords[1] ?? props.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return {
    lat,
    lon,
    nombre: clean(props.inmueble || props.nombre) || 'Escuela sin nombre',
    alcaldia: clean(props.alcaldia).toLocaleUpperCase('es-MX'),
    nivel: clean(props.principal || props.nivel),
    ccts: (programOnly ? [props.cct] : CCT_FIELDS.map(field => props[field])).map(cct).filter(Boolean),
    territories: props.territorios || {},
    programOnly,
    programs: [],
    improvementIds: []
  };
}

function mergeProgramOnly(list, rows) {
  const known = new Set(list.flatMap(school => school.ccts));
  const missing = new Map();
  rows.forEach(row => {
    const key = cct(row.cct);
    if (key && !known.has(key) && !missing.has(key)) missing.set(key, row);
  });
  missing.forEach((row, key) => {
    const school = normalizeSchool({
      cct: key,
      nombre: row.nombre,
      alcaldia: row.alcaldia,
      nivel: row.nivel,
      lon: row.lon,
      lat: row.lat,
      territorios: row.territorios || {}
    }, [], `programa-${key}`, true);
    if (school) list.push(school);
  });
}

function joinPrograms(list, rows) {
  const index = new Map();
  rows.forEach(row => {
    const key = cct(row.cct);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  });
  list.forEach(school => {
    const uniqueRows = new Map();
    school.ccts.flatMap(key => index.get(key) || []).forEach(row => uniqueRows.set(`${cct(row.cct)}|${row.proyecto_id}`, row));
    school.programs = [...uniqueRows.values()];
  });
}

function joinImprovements(list, rows) {
  const index = new Map(rows.map(row => [cct(row.cct), row]));
  const byName = new Map();
  rows.forEach(row => {
    const key = norm(row.escuela);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  });
  list.forEach(school => {
    const ids = new Set();
    const matchedByCct = school.ccts.map(key => index.get(key)).filter(Boolean);
    const matchedByName = (byName.get(norm(school.nombre)) || []).filter(row =>
      Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon)) &&
      Math.abs(Number(row.lat) - school.lat) < 0.015 && Math.abs(Number(row.lon) - school.lon) < 0.015
    );
    [...new Map([...matchedByCct, ...matchedByName].map(row => [row.cct, row])).values()]
      .forEach(row => (row.categorias || []).forEach(category => ids.add(category.id)));
    school.improvementIds = [...ids];
  });
}

function buildCatalog(rows) {
  rows.forEach(row => {
    if (!catalog.has(row.proyecto_id)) catalog.set(row.proyecto_id, row.proyecto);
  });
}

function populateFilters() {
  fill('stNivel', unique(schools.map(school => school.nivel)));
}

function bindUI() {
  q('stNivel').onchange = applyStats;
  q('stCCT').oninput = applyStats;
  q('stNombre').oninput = applyStats;
  q('stLimpiar').onclick = () => {
    q('stNivel').value = '';
    q('stCCT').value = '';
    q('stNombre').value = '';
    applyStats();
  };
}

function restoreState() {
  try { state = JSON.parse(localStorage.getItem('visorProgramasStateV4') || '{}'); } catch { state = {}; }
  q('stNivel').value = state.nivel || '';
}

function applyStats() {
  const nivel = q('stNivel').value;
  const termCct = cct(q('stCCT').value);
  const termName = norm(q('stNombre').value);
  const projects = state.projects || [];
  const improvements = state.improvements || [];
  const territories = state.territories || {};
  const result = schools.filter(school => {
    if (nivel && school.nivel !== nivel) return false;
    if (termCct && !school.ccts.some(value => value.includes(termCct))) return false;
    if (termName && !norm(school.nombre).includes(termName)) return false;
    if (school.programOnly && projects.length === 0) return false;
    if (projects.length && !school.programs.some(row => projects.includes(row.proyecto_id))) return false;
    if (improvements.length && !school.improvementIds.some(id => improvements.includes(id))) return false;
    if (!matchesTerritories(school, territories)) return false;
    return true;
  });
  render(result, {projects, improvements, territories});
}

function matchesTerritories(school, territories) {
  return ['alcaldia', 'ageb', 'cp', 'colonia'].every(type => {
    const selected = territories[type] || [];
    return !selected.length || selected.includes(clean(school.territories?.[type]));
  });
}

function render(rows, selection) {
  const withPrograms = rows.filter(school => school.programs.length).length;
  const withImprovements = rows.filter(school => school.improvementIds.length).length;
  q('stTotal').textContent = rows.length.toLocaleString('es-MX');
  q('stPrograms').textContent = withPrograms.toLocaleString('es-MX');
  q('stImprovements').textContent = withImprovements.toLocaleString('es-MX');
  q('stAlcaldias').textContent = unique(rows.map(school => school.alcaldia)).length.toLocaleString('es-MX');

  const tags = [];
  selection.projects.forEach(id => tags.push(catalog.get(id) || id));
  selection.improvements.forEach(id => tags.push(IMPROVEMENT_LABELS[id] || id));
  const territoryCount = Object.values(selection.territories).reduce((sum, values) => sum + (values?.length || 0), 0);
  if (territoryCount) tags.push(`${territoryCount} límite${territoryCount === 1 ? '' : 's'} territorial${territoryCount === 1 ? '' : 'es'}`);
  q('statsContext').textContent = tags.length ? 'Se aplicó el cruce guardado desde el mapa.' : 'No hay cruces temáticos activos; se muestra la base general.';
  q('statsTags').innerHTML = tags.map(text => `<span class="mini-tag blue">${esc(text)}</span>`).join('');

  renderCoverage(rows);
  renderGrouped(rows, 'nivel', 'tablaNivel', false);
  renderGrouped(rows, 'alcaldia', 'tablaAlcaldia', true);
  renderRanking(rows);
}

function renderCoverage(rows) {
  const conditions = [
    ['Con programas', rows.filter(school => school.programs.length).length],
    ['Con mejoras', rows.filter(school => school.improvementIds.length).length],
    ['Con programas y mejoras', rows.filter(school => school.programs.length && school.improvementIds.length).length],
    ['Sin programas ni mejoras', rows.filter(school => !school.programs.length && !school.improvementIds.length).length]
  ];
  q('tablaCobertura').innerHTML = conditions.map(([label, count]) => `
    <tr><td>${esc(label)}</td><td>${count.toLocaleString('es-MX')}</td><td>${pct(count, rows.length)}%<div class="bar"><span style="width:${pct(count, rows.length)}%"></span></div></td></tr>`).join('');
}

function renderGrouped(rows, field, target, full) {
  const groups = {};
  rows.forEach(school => (groups[school[field] || 'No registrado'] ??= []).push(school));
  const result = Object.entries(groups).map(([name, list]) => ({
    name,
    total: list.length,
    programs: list.filter(school => school.programs.length).length,
    improvements: list.filter(school => school.improvementIds.length).length
  })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es'));
  q(target).innerHTML = result.length ? result.map(row => full
    ? `<tr><td>${esc(row.name)}</td><td>${row.total.toLocaleString('es-MX')}</td><td>${row.programs.toLocaleString('es-MX')}</td><td>${row.improvements.toLocaleString('es-MX')}</td><td>${pct(row.total, rows.length)}%</td></tr>`
    : `<tr><td>${esc(row.name)}</td><td>${row.total.toLocaleString('es-MX')}</td><td>${row.programs.toLocaleString('es-MX')}</td><td>${row.improvements.toLocaleString('es-MX')}</td></tr>`
  ).join('') : `<tr><td colspan="${full ? 5 : 4}" class="empty-row">No hay resultados.</td></tr>`;
}

function renderRanking(rows) {
  q('tablaRanking').innerHTML = rows.length ? [...rows]
    .sort((a, b) => a.alcaldia.localeCompare(b.alcaldia, 'es') || a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, 500)
    .map((school, index) => `<tr>
      <td>${index + 1}</td>
      <td>${esc(school.nombre)}</td>
      <td>${esc(school.ccts.join(', '))}</td>
      <td>${esc(school.alcaldia)}</td>
      <td>${esc(school.nivel)}</td>
      <td>${esc(unique(school.programs.map(row => row.proyecto)).join(' · ') || '—')}</td>
      <td>${esc(school.improvementIds.map(id => IMPROVEMENT_LABELS[id] || id).join(' · ') || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty-row">No hay resultados.</td></tr>';
}

function fill(id, values) {
  const select = q(id);
  const first = select.querySelector('option').outerHTML;
  select.innerHTML = first + values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
}

function pct(value, total) {
  return total ? (value / total * 100).toFixed(1) : '0.0';
}

function cct(value) {
  return clean(value).replace(/\s+/g, '').toUpperCase();
}

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim().replace(/\s+/g, ' ');
}

function norm(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

function q(id) {
  return document.getElementById(id);
}

function esc(value) {
  return clean(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[char]));
}
