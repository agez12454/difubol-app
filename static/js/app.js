// ─── Estado global ────────────────────────────────────────────────────────────
const ROLES = [
  'Árbitro',
  '1° árbitro asistente',
  '2° árbitro asistente',
  'Cuarto árbitro',
];

let selectedFile = null;
let partidoEditandoId = null;

// ─── Utilidades ───────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => el.classList.add('hidden'), 3000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Error desconocido' }));
    throw new Error(err.detail || 'Error');
  }
  return res.json();
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => { t.classList.add('hidden'); t.classList.remove('active'); });
    btn.classList.add('active');
    const tab = document.getElementById(`tab-${btn.dataset.tab}`);
    tab.classList.remove('hidden');
    tab.classList.add('active');
    if (btn.dataset.tab === 'conflictos') cargarConflictos();
    if (btn.dataset.tab === 'arbitros') cargarArbitros();
    if (btn.dataset.tab === 'partidos') cargarPartidos();
  });
});

// ─── Upload imagen ─────────────────────────────────────────────────────────────
document.getElementById('btn-subir-imagen').addEventListener('click', () => {
  document.getElementById('upload-area').classList.toggle('hidden');
  resetUpload();
});

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) mostrarPreview(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) mostrarPreview(fileInput.files[0]);
});

function mostrarPreview(file) {
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('preview-img').src = e.target.result;
    document.getElementById('imagen-referencia').classList.remove('hidden');
    document.getElementById('upload-area').classList.add('hidden');
    llenarFormulario({});
    document.getElementById('form-titulo').textContent = 'Datos del partido';
    document.getElementById('form-partido').classList.remove('hidden');
    document.getElementById('form-partido').scrollIntoView({ behavior: 'smooth' });
    toast('Imagen cargada. Usa "Extraer datos con IA" o llena el formulario manualmente.');
  };
  reader.readAsDataURL(file);
}

document.getElementById('btn-procesar').addEventListener('click', async () => {
  if (!selectedFile) return;
  const btnProcesar = document.getElementById('btn-procesar');
  const loading = document.getElementById('upload-loading');
  btnProcesar.disabled = true;
  loading.classList.remove('hidden');

  try {
    const fd = new FormData();
    fd.append('file', selectedFile);
    const res = await api('/api/procesar-imagen', { method: 'POST', body: fd });
    llenarFormulario(res.datos);
    document.getElementById('form-titulo').textContent = 'Datos extraídos — revisa y confirma';
    toast('✓ Datos extraídos. Revisa y guarda.');
  } catch (e) {
    toast(`Error IA: ${e.message}`, 'error');
  } finally {
    btnProcesar.disabled = false;
    loading.classList.add('hidden');
  }
});

function resetUpload() {
  selectedFile = null;
  fileInput.value = '';
  document.getElementById('preview-img').src = '';
  document.getElementById('imagen-referencia').classList.add('hidden');
  document.getElementById('drop-zone').classList.remove('hidden');
}

// ─── Formulario de partido ────────────────────────────────────────────────────
function llenarFormulario(datos) {
  partidoEditandoId = null;
  document.getElementById('f-local').value = datos.equipo_local || '';
  document.getElementById('f-visitante').value = datos.equipo_visitante || '';
  document.getElementById('f-competicion').value = datos.competicion || '';
  document.getElementById('f-estadio').value = datos.estadio || '';
  document.getElementById('f-fechahora').value = datos.fecha_hora || '';
  document.getElementById('f-ciudad').value = datos.ciudad || '';

  // Asignaciones
  const cont = document.getElementById('asignaciones-form');
  cont.innerHTML = '';
  ROLES.forEach(rol => {
    const asig = (datos.asignaciones || []).find(a => a.rol === rol);
    const row = document.createElement('div');
    row.className = 'asignacion-row';
    row.innerHTML = `
      <span class="rol-label">${rol}</span>
      <input type="text" placeholder="Nombre árbitro" value="${asig ? asig.nombre : ''}" data-rol="${rol}" />
    `;
    cont.appendChild(row);
  });
}

function leerFormulario() {
  const asignaciones = [];
  document.querySelectorAll('#asignaciones-form input').forEach(inp => {
    if (inp.value.trim()) {
      asignaciones.push({ rol: inp.dataset.rol, nombre: inp.value.trim() });
    }
  });
  return {
    numero: partidoEditandoId ? String(partidoEditandoId) : String(Date.now()),
    equipo_local: document.getElementById('f-local').value.trim(),
    equipo_visitante: document.getElementById('f-visitante').value.trim(),
    competicion: document.getElementById('f-competicion').value.trim(),
    fecha_jornada: '',
    estadio: document.getElementById('f-estadio').value.trim(),
    fecha_hora: document.getElementById('f-fechahora').value.trim(),
    numero_partido: '',
    departamento: '',
    ciudad: document.getElementById('f-ciudad').value.trim(),
    asignaciones,
  };
}

document.getElementById('btn-ocultar-img').addEventListener('click', () => {
  document.getElementById('imagen-referencia').classList.add('hidden');
});

document.getElementById('btn-cancelar-form').addEventListener('click', () => {
  document.getElementById('form-partido').classList.add('hidden');
  document.getElementById('imagen-referencia').classList.add('hidden');
  partidoEditandoId = null;
});

document.getElementById('btn-guardar-partido').addEventListener('click', async () => {
  const datos = leerFormulario();
  if (!datos.equipo_local || !datos.equipo_visitante) { toast('Los equipos son obligatorios', 'error'); return; }

  try {
    const res = await api('/api/partidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    document.getElementById('form-partido').classList.add('hidden');
    partidoEditandoId = null;
    await cargarPartidos();

    if (res.tiene_conflicto) {
      toast(`⚠️ Partido guardado con ${res.conflictos.length} conflicto(s)`, 'error');
    } else {
      toast('Partido guardado sin conflictos ✓');
    }
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  }
});

// ─── Lista de partidos ────────────────────────────────────────────────────────
async function cargarPartidos() {
  const partidos = await api('/api/partidos');
  const cont = document.getElementById('lista-partidos');

  // Actualizar badge
  const totalConflictos = partidos.filter(p => p.tiene_conflicto).length;
  const badge = document.getElementById('badge-conflictos');
  if (totalConflictos > 0) {
    badge.textContent = totalConflictos;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  if (partidos.length === 0) {
    cont.innerHTML = `<div class="empty-state"><i class="fa-solid fa-calendar-xmark"></i><p>No hay partidos cargados.<br>Sube una imagen o agrega uno manualmente.</p></div>`;
    return;
  }

  cont.innerHTML = partidos.map(p => {
    const conflictoArbitros = [...new Set(p.conflictos.map(c => c.arbitro_id))];
    return `
    <div class="partido-card ${p.tiene_conflicto ? 'conflicto' : ''}" id="partido-${p.id}">
      <div class="partido-header">
        <div class="partido-equipos">
          ${p.equipo_local} <span class="vs">vs</span> ${p.equipo_visitante}
          ${p.tiene_conflicto ? `<span class="conflicto-tag"><i class="fa-solid fa-triangle-exclamation"></i> ${p.conflictos.length} conflicto${p.conflictos.length > 1 ? 's' : ''}</span>` : ''}
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <button class="btn btn-sm btn-ghost" onclick="editarPartido(${p.id})"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-sm btn-danger" onclick="eliminarPartido(${p.id})"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <div class="partido-meta">
        <span><i class="fa-solid fa-trophy"></i> ${p.competicion}</span>
        <span><i class="fa-solid fa-clock"></i> ${p.fecha_hora}</span>
        <span><i class="fa-solid fa-location-dot"></i> ${p.estadio}</span>
        <span><i class="fa-solid fa-city"></i> ${p.ciudad}</span>
      </div>
      <div class="oficiales-list">
        ${p.asignaciones.map(a => {
          const tieneConflicto = conflictoArbitros.includes(a.arbitro_id);
          return `<div class="oficial-item">
            <span class="rol">${a.rol}:</span>
            <span class="nombre">${a.nombre}</span>
            ${tieneConflicto ? `<span class="conflicto-tag" onclick="verSugerencias(${a.arbitro_id},${p.id},'${a.nombre}')">⚠ Ver reemplazos</span>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

async function editarPartido(id) {
  try {
    const p = await api(`/api/partidos/${id}`);
    partidoEditandoId = id;
    llenarFormulario({
      numero: p.numero,
      equipo_local: p.equipo_local,
      equipo_visitante: p.equipo_visitante,
      competicion: p.competicion,
      fecha_jornada: p.fecha_jornada,
      estadio: p.estadio,
      fecha_hora: p.fecha_hora,
      numero_partido: p.numero_partido,
      departamento: p.departamento,
      ciudad: p.ciudad,
      asignaciones: p.asignaciones.map(a => ({ rol: a.rol, nombre: a.nombre })),
    });
    document.getElementById('form-titulo').textContent = 'Editar partido';
    document.getElementById('form-partido').classList.remove('hidden');
    document.getElementById('form-partido').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  }
}

async function eliminarPartido(id) {
  if (!confirm('¿Eliminar este partido?')) return;
  try {
    await api(`/api/partidos/${id}`, { method: 'DELETE' });
    toast('Partido eliminado');
    cargarPartidos();
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  }
}

// ─── Conflictos ───────────────────────────────────────────────────────────────
async function cargarConflictos() {
  const conflictos = await api('/api/conflictos');
  const cont = document.getElementById('lista-conflictos');

  if (conflictos.length === 0) {
    cont.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-check" style="color:var(--success)"></i><p>No hay conflictos de horario detectados.</p></div>`;
    return;
  }

  cont.innerHTML = conflictos.map(c => `
    <div class="conflicto-card">
      <div class="conflicto-titulo">
        <i class="fa-solid fa-triangle-exclamation"></i>
        ${c.arbitro_nombre}
        <span class="tipo-badge tipo-${c.tipo}">${c.tipo === 'solapamiento' ? 'SOLAPAMIENTO' : 'MISMO DÍA'}</span>
      </div>
      <div class="conflicto-detalle">
        <strong>Partido 1:</strong> ${c.equipos_origen} — ${c.fecha_origen} (${c.rol_en_este})
        ${c.competicion_origen ? `<br><i class="fa-solid fa-trophy" style="color:var(--primary);font-size:0.75rem"></i> ${c.competicion_origen}` : ''}
        ${c.estadio_origen ? `&nbsp;·&nbsp;<i class="fa-solid fa-location-dot" style="color:var(--primary);font-size:0.75rem"></i> ${c.estadio_origen}` : ''}
        ${c.ciudad_origen ? `, ${c.ciudad_origen}` : ''}
      </div>
      <div class="conflicto-detalle">
        <strong>Partido 2:</strong> ${c.equipos_conflicto} — ${c.fecha_conflicto} (${c.rol_en_conflicto})
        ${c.competicion_conflicto ? `<br><i class="fa-solid fa-trophy" style="color:var(--primary);font-size:0.75rem"></i> ${c.competicion_conflicto}` : ''}
        ${c.estadio_conflicto ? `&nbsp;·&nbsp;<i class="fa-solid fa-location-dot" style="color:var(--primary);font-size:0.75rem"></i> ${c.estadio_conflicto}` : ''}
        ${c.ciudad_conflicto ? `, ${c.ciudad_conflicto}` : ''}
      </div>
      <div style="margin-top:14px">
        <p style="font-size:0.8rem;color:var(--text2);margin-bottom:8px"><i class="fa-solid fa-hand-pointer"></i> ¿En cuál partido necesita reemplazo?</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-ghost" onclick="verSugerencias(${c.arbitro_id},${c.partido_origen_id},'${c.arbitro_nombre}')">
            <i class="fa-solid fa-shuffle"></i> Partido 1: ${c.equipos_origen} (${c.fecha_origen})
          </button>
          <button class="btn btn-sm btn-ghost" onclick="verSugerencias(${c.arbitro_id},${c.partido_conflicto_id},'${c.arbitro_nombre}')">
            <i class="fa-solid fa-shuffle"></i> Partido 2: ${c.equipos_conflicto} (${c.fecha_conflicto})
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// ─── Sugerencias ──────────────────────────────────────────────────────────────
async function verSugerencias(arbitroId, partidoId, nombre) {
  const modal = document.getElementById('modal-sugerencias');
  const body = document.getElementById('modal-body');
  body.innerHTML = `<div class="loading"><div class="spinner"></div> Buscando disponibles...</div>`;
  modal.classList.remove('hidden');

  try {
    const sugerencias = await api(`/api/sugerencias/${arbitroId}/${partidoId}`);
    if (sugerencias.length === 0) {
      body.innerHTML = `<div class="no-sugerencias"><i class="fa-solid fa-user-slash" style="font-size:2rem;margin-bottom:12px;display:block;opacity:0.4"></i>No hay árbitros disponibles de la misma categoría para ese horario.</div>`;
    } else {
      body.innerHTML = `
        <p style="color:var(--text2);font-size:0.85rem;margin-bottom:14px">
          Árbitros disponibles para reemplazar a <strong style="color:var(--text)">${nombre}</strong>:
        </p>
        ${sugerencias.map(s => `
          <div class="sugerencia-item ${s.aviso_mismo_dia ? 'aviso-dia' : ''}">
            <div>
              <div class="nombre">${s.nombre}</div>
              ${s.aviso_mismo_dia ? s.partidos_ese_dia.map(p => `
                <div class="aviso-dia-tag">
                  <i class="fa-solid fa-circle-exclamation"></i>
                  Tiene partido ese día a las <strong>${p.hora}</strong>${p.estadio ? ` · ${p.estadio}` : ''}${p.ciudad ? `, ${p.ciudad}` : ''}
                </div>`).join('') : ''}
            </div>
            <i class="fa-solid fa-circle-check" style="color:var(--success)"></i>
          </div>
        `).join('')}
      `;
    }
  } catch (e) {
    body.innerHTML = `<div class="no-sugerencias" style="color:var(--danger)">Error cargando sugerencias</div>`;
  }
}

document.getElementById('cerrar-modal').addEventListener('click', () => {
  document.getElementById('modal-sugerencias').classList.add('hidden');
});
document.getElementById('modal-sugerencias').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-sugerencias'))
    document.getElementById('modal-sugerencias').classList.add('hidden');
});

// ─── Árbitros ─────────────────────────────────────────────────────────────────
async function cargarArbitros() {
  const arbitros = await api('/api/arbitros');
  const cont = document.getElementById('lista-arbitros');

  if (arbitros.length === 0) {
    cont.innerHTML = `<div class="empty-state" style="padding:30px"><i class="fa-solid fa-user-slash"></i><p>No hay árbitros registrados.</p></div>`;
    return;
  }

  cont.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden">
      <table class="ranking-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Árbitro</th>
            <th>Central</th>
            <th>1° Asist.</th>
            <th>2° Asist.</th>
            <th>4° Árb.</th>
            <th>Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${arbitros.map((a, i) => `
            <tr>
              <td class="rank">${i + 1}</td>
              <td class="arb-name">${a.nombre}</td>
              <td class="num">${a.por_rol['Árbitro'] || 0}</td>
              <td class="num">${a.por_rol['1° árbitro asistente'] || 0}</td>
              <td class="num">${a.por_rol['2° árbitro asistente'] || 0}</td>
              <td class="num">${a.por_rol['Cuarto árbitro'] || 0}</td>
              <td class="num total"><strong>${a.total_partidos}</strong></td>
              <td><button class="btn btn-sm btn-danger" onclick="eliminarArbitro(${a.id})"><i class="fa-solid fa-trash"></i></button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

// ─── Importar Excel ───────────────────────────────────────────────────────────
document.getElementById('excel-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const panel = document.getElementById('excel-panel');
  const preview = document.getElementById('excel-preview');
  panel.classList.remove('hidden');
  preview.innerHTML = `<div class="loading"><div class="spinner"></div> Leyendo Excel...</div>`;

  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await api('/api/importar-excel', { method: 'POST', body: fd });
    window._excelFile = file;

    preview.innerHTML = `
      <p style="color:var(--text2);margin-bottom:12px">Se encontraron <strong style="color:var(--text)">${res.total_filas} filas</strong>. Columnas detectadas:</p>
      <div class="columnas-grid">
        ${res.columnas.map((c, i) => `<div class="col-chip"><span class="col-num">${i}</span> ${c}</div>`).join('')}
      </div>
      <p style="color:var(--text2);font-size:0.85rem;margin:14px 0 8px">Indica el número de columna para cada campo (-1 si no existe en tu Excel):</p>
      <div class="form-grid">
        <div class="field"><label>Nombre árbitro</label><input type="number" id="xc-nombre" value="0" min="-1"/></div>
        <div class="field"><label>Rol</label><input type="number" id="xc-rol" value="1" min="-1"/></div>
        <div class="field"><label>Fecha/Hora</label><input type="number" id="xc-fecha" value="2" min="-1"/></div>
        <div class="field"><label>Equipo local</label><input type="number" id="xc-local" value="3" min="-1"/></div>
        <div class="field"><label>Equipo visitante</label><input type="number" id="xc-visitante" value="4" min="-1"/></div>
        <div class="field"><label>Estadio</label><input type="number" id="xc-estadio" value="-1" min="-1"/></div>
        <div class="field"><label>Ciudad</label><input type="number" id="xc-ciudad" value="-1" min="-1"/></div>
      </div>
      <p style="color:var(--text2);font-size:0.82rem;margin-bottom:12px">Primeras filas de ejemplo:<br><code style="color:var(--primary)">${res.preview.map(r => r.join(' | ')).join('<br>')}</code></p>
      <div style="display:flex;gap:10px">
        <button class="btn btn-success" onclick="confirmarExcel()"><i class="fa-solid fa-file-import"></i> Importar datos</button>
        <button class="btn btn-ghost" onclick="document.getElementById('excel-panel').classList.add('hidden')">Cancelar</button>
      </div>`;
  } catch (e) {
    preview.innerHTML = `<p style="color:var(--danger)">Error: ${e.message}</p>`;
  }
});

async function confirmarExcel() {
  if (!window._excelFile) return;
  const fd = new FormData();
  fd.append('file', window._excelFile);
  const params = new URLSearchParams({
    col_nombre: document.getElementById('xc-nombre').value,
    col_rol: document.getElementById('xc-rol').value,
    col_fecha: document.getElementById('xc-fecha').value,
    col_local: document.getElementById('xc-local').value,
    col_visitante: document.getElementById('xc-visitante').value,
    col_estadio: document.getElementById('xc-estadio').value,
    col_ciudad: document.getElementById('xc-ciudad').value,
  });
  try {
    const res = await api(`/api/importar-excel/confirmar?${params}`, { method: 'POST', body: fd });
    toast(`✓ Importado: ${res.arbitros_creados} árbitros y ${res.partidos_creados} partidos nuevos`);
    document.getElementById('excel-panel').classList.add('hidden');
    cargarArbitros();
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  }
}

document.getElementById('btn-agregar-arbitro').addEventListener('click', async () => {
  const apellidos = document.getElementById('arb-apellidos').value.trim().toUpperCase();
  const nombres = document.getElementById('arb-nombres').value.trim().toUpperCase();
  if (!apellidos || !nombres) { toast('Apellidos y nombres son obligatorios', 'error'); return; }
  const nombre = `${apellidos}, ${nombres}`;

  try {
    await api('/api/arbitros', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, categoria: '' }),
    });
    document.getElementById('arb-apellidos').value = '';
    document.getElementById('arb-nombres').value = '';
    toast('Árbitro registrado ✓');
    cargarArbitros();
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  }
});

async function eliminarArbitro(id) {
  if (!confirm('¿Eliminar este árbitro?')) return;
  try {
    await api(`/api/arbitros/${id}`, { method: 'DELETE' });
    toast('Árbitro eliminado');
    cargarArbitros();
  } catch (e) {
    toast(`Error: ${e.message}`, 'error');
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
cargarPartidos();
