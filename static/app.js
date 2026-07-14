const FUNCIONES = ['AIRE','EDICION','ZOCALOS','PLACAS','TEXTOS','CONTENIDOS'];
const CANALES   = ['ESPN','ESPN 2/ESPN3','CHI','COL','CAM','REGIONES'];

// ─── State ────────────────────────────────────────────────────────────────────
const SE = {  // state for extras view
  year: new Date().getFullYear(),
  week: getISOWeek(new Date()),
};

const S = {
  year: new Date().getFullYear(),
  week: getISOWeek(new Date()),
  weekData: null,
  employees: [],
  feriados: [],
  editTurnoId: null,
  editEmpId: null,
  turnoFecha: null,
  compEmpId: null,
  weekFilter: '',
  viewMode: 'tabla',  // 'tabla' | 'cards' | 'dia'
  currentDayIdx: 0,
  dayRange: 'week',   // 'week' (L-V) | 'weekend' (S-D)
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - y) / 86400000) + 1) / 7);
}

function timeDiffHours(t1, t2) {
  if (!t1 || !t2) return 0;
  const [h1, m1] = t1.split(':').map(Number);
  const [h2, m2] = t2.split(':').map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 1440;
  return mins / 60;
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateShort(iso) {
  const [, m, d] = iso.split('-');
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${parseInt(d)} ${months[parseInt(m)-1]}`;
}

function canalCss(canal) {
  if (!canal) return '';
  const c = canal.toUpperCase();
  if (c === 'ESPN') return 'c-ESPN';
  if (c.includes('2') || c.includes('3')) return 'c-ESPN23';
  if (c === 'CHI') return 'c-CHI';
  if (c === 'COL') return 'c-COL';
  if (c === 'CAM') return 'c-CAM';
  if (c.includes('REGION')) return 'c-REG';
  return '';
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[parts.length-1][0]).toUpperCase() : name.slice(0,2).toUpperCase();
}

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

function el(id) { return document.getElementById(id); }

// ─── Navigation ───────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    el(`view-${btn.dataset.view}`).classList.add('active');
    if (btn.dataset.view === 'empleados') loadEmployees();
    if (btn.dataset.view === 'compensatorios') loadCompensatorios();
    if (btn.dataset.view === 'extras') loadExtras();
    el('emp-detail').classList.add('hidden');
    el('emp-grid').classList.remove('hidden');
  });
});

// ─── WEEK VIEW ────────────────────────────────────────────────────────────────
function initYearSelect() {
  const sel = el('year-select');
  const cur = new Date().getFullYear();
  for (let y = cur - 1; y <= cur + 2; y++) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    if (y === S.year) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => { S.year = parseInt(sel.value); loadWeek(); });
}

el('btn-prev').addEventListener('click', () => { if (S.week > 1) { S.week--; loadWeek(); } else { S.year--; S.week = 52; el('year-select').value = S.year; loadWeek(); } });
el('btn-next').addEventListener('click', () => { if (S.week < 52) { S.week++; loadWeek(); } else { S.year++; S.week = 1; el('year-select').value = S.year; loadWeek(); } });

el('week-search').addEventListener('input', e => {
  S.weekFilter = e.target.value.toLowerCase();
  if (S.weekData) renderSchedule(S.weekData);
});

// Vista toggle
document.querySelectorAll('.view-toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.viewMode = btn.dataset.mode;
    if (S.weekData) renderSchedule(S.weekData);
  });
});

// Rango de días toggle (L-V / S-D)
document.querySelectorAll('.day-range-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.day-range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.dayRange = btn.dataset.range;
    if (S.weekData) renderSchedule(S.weekData);
  });
});

// Repetir semana
el('btn-repetir').addEventListener('click', async () => {
  const nextWeek = S.week >= 52 ? 1 : S.week + 1;
  const nextYear = S.week >= 52 ? S.year + 1 : S.year;
  const ok = confirm(`¿Copiar todos los turnos de la Semana ${S.week} a la Semana ${nextWeek} (${nextYear})?\n\nLos turnos ya existentes en la semana destino no se sobreescriben.`);
  if (!ok) return;

  const res = await api(`/api/semana/${S.year}/${S.week}/repetir`, 'POST', { dest_year: nextYear, dest_week: nextWeek });
  alert(`✓ Copiados: ${res.copiados} turnos.\n${res.omitidos > 0 ? `Omitidos (ya existían): ${res.omitidos}` : ''}`);

  // Navegar a la semana destino
  S.week = res.dest_week;
  S.year = res.dest_year;
  el('year-select').value = S.year;
  loadWeek();
});

// Excel buttons
el('btn-excel-upload').addEventListener('click', () => el('excel-file-input').click());
el('excel-file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  el('schedule-table-wrap').innerHTML = '<div class="loading">Importando Excel...</div>';
  const res = await fetch('/api/excel/import', { method: 'POST', body: fd });
  const data = await res.json();
  const errs = data.errores?.length ? `\nErrores: ${data.errores.join(', ')}` : '';
  alert(`Importado: ${data.turnos} turnos, ${data.empleados} empleados nuevos, ${data.feriados} feriados.${errs}`);
  e.target.value = '';
  await loadEmployees();
  await loadWeek();
});

async function loadWeek() {
  el('week-badge').textContent = `S#${S.week}`;
  el('schedule-grid').innerHTML = '<div class="loading">Cargando...</div>';
  const data = await api(`/api/semana/${S.year}/${S.week}`);
  S.weekData = data;
  if (data.dias && data.dias.length) {
    const first = data.dias[0].fecha, last = data.dias[6].fecha;
    el('week-dates').textContent = `${fmtDateShort(first)} – ${fmtDateShort(last)} · ${S.year}`;
  }
  renderSchedule(data);
}

function makeTurnoCard(t, day) {
  const hrs = timeDiffHours(t.ingreso, t.egreso);
  const extra = hrs > 8 ? hrs - 8 : 0;
  const cc = canalCss(t.canal);

  const card = document.createElement('div');
  card.className = 'turno-card' + (t.tipo === 'libre' ? ' tipo-libre' : (cc ? ' ' + cc : ''));

  if (t.tipo === 'libre') {
    card.innerHTML = '<div class="turno-emp">' + t.emp_nombre + '</div>' +
      '<div class="turno-libre-label">Franco / Libre</div>' +
      '<div class="turno-actions"><button class="turno-action-btn del">✕</button></div>';
  } else {
    const showTime = t.show_inicio && t.show_fin ? t.show_inicio + ' – ' + t.show_fin : '';
    const turnoTime = t.ingreso && t.egreso ? 'Turno: ' + t.ingreso + ' – ' + t.egreso : '';
    const extraHtml = extra > 0 ? '<div class="turno-extra">+' + extra.toFixed(1) + 'hs extra</div>' : '';
    card.innerHTML =
      '<div class="turno-canal ' + cc + '">' + (t.canal || '—') + '</div>' +
      '<div class="turno-show">' + showTime + '</div>' +
      '<div class="turno-emp">' + t.emp_nombre + '</div>' +
      '<div class="turno-horario">' + turnoTime + '</div>' +
      extraHtml +
      '<div class="turno-actions">' +
        '<button class="turno-action-btn edit">✎</button>' +
        '<button class="turno-action-btn del">✕</button>' +
      '</div>';
  }

  card.querySelector('.del').addEventListener('click', async e => {
    e.stopPropagation();
    if (confirm('¿Eliminar este turno?')) { await api(`/api/turnos/${t.id}`, 'DELETE'); loadWeek(); }
  });
  const editBtn = card.querySelector('.edit');
  if (editBtn) editBtn.addEventListener('click', e => { e.stopPropagation(); openTurnoModal(day.fecha, t); });
  return card;
}

function renderSchedule(data) {
  el('schedule-grid').classList.toggle('hidden', S.viewMode !== 'cards');
  el('schedule-table-wrap').classList.toggle('hidden', S.viewMode !== 'tabla');
  el('schedule-day-wrap').classList.toggle('hidden', S.viewMode !== 'dia');

  if (S.viewMode === 'tabla') {
    renderTableView(data);
  } else if (S.viewMode === 'cards') {
    renderCardsView(data);
  } else {
    renderDayView(data);
  }
}

// ─── TABLE VIEW ─────────────────────────────────────────────────
function renderTableView(data) {
  const wrap = el('schedule-table-wrap');
  const allDias = data.dias;
  const filter = S.weekFilter;
  const DN = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  // Filtrar días según rango seleccionado
  var diasIdx = S.dayRange === 'weekend' ? [5, 6] : [0, 1, 2, 3, 4];
  var dias = diasIdx.map(function(i) { return allDias[i]; });

  // Filtro por empleado
  const dayTurnos = dias.map(function(d) {
    var ts = d.turnos.filter(function(t) { return t.tipo === 'trabajo'; });
    if (filter) ts = ts.filter(function(t) { return t.emp_nombre.toLowerCase().includes(filter); });
    return ts;
  });

  // Armar secciones
  var sections = [];

  // ── SHOW (AIRE + ZOCALOS + EDICION-con-show combinados) ─────────────────────
  var aireAll = [], zocAll = [], edicionShowAll = [];
  dayTurnos.forEach(function(ts, di) {
    ts.filter(function(t) { return t.funcion === 'AIRE'; })
      .forEach(function(t) { aireAll.push(Object.assign({}, t, {di: di})); });
    ts.filter(function(t) { return t.funcion === 'ZOCALOS'; })
      .forEach(function(t) { zocAll.push(Object.assign({}, t, {di: di})); });
    ts.filter(function(t) { return t.funcion === 'EDICION' && t.show_inicio; })
      .forEach(function(t) { edicionShowAll.push(Object.assign({}, t, {di: di})); });
  });

  var CANAL_ORDER = ['ESPN','ESPN 2/ESPN3','CHI','COL','CAM','REGIONES'];
  function showSortKey(t) {
    if (!t) return 9999;
    var h = parseInt((t.split(':'))[0]) || 0;
    return h < 7 ? h + 24 : h;  // madrugada va al final
  }

  var showRows = [];
  if (aireAll.length > 0 || zocAll.length > 0 || edicionShowAll.length > 0) {
    // Group by canal → day → show slot (each day can have different show times)
    var canalDayMap = new Map();
    aireAll.concat(zocAll).concat(edicionShowAll).forEach(function(t) {
      if (!canalDayMap.has(t.canal)) {
        canalDayMap.set(t.canal, dias.map(function() { return []; }));
      }
      canalDayMap.get(t.canal)[t.di].push(t);
    });

    var canals = Array.from(canalDayMap.keys()).sort(function(a, b) {
      var oa = CANAL_ORDER.indexOf(a); if (oa < 0) oa = 99;
      var ob = CANAL_ORDER.indexOf(b); if (ob < 0) ob = 99;
      return oa - ob;
    });

    canals.forEach(function(canal) {
      // Per day: group turnos by show time, sort by show time
      var daySlots = canalDayMap.get(canal).map(function(turnos) {
        var slotMap = new Map();
        turnos.forEach(function(t) {
          var k = t.show_inicio + '||' + t.show_fin;
          if (!slotMap.has(k)) slotMap.set(k, {show_inicio: t.show_inicio, show_fin: t.show_fin, aire: null, zocalos: null, edicion: null});
          var sl = slotMap.get(k);
          if (t.funcion === 'AIRE') sl.aire = t;
          else if (t.funcion === 'ZOCALOS') sl.zocalos = t;
          else if (t.funcion === 'EDICION') sl.edicion = t;
        });
        return Array.from(slotMap.values()).sort(function(a, b) {
          return showSortKey(a.show_inicio) - showSortKey(b.show_inicio);
        });
      });

      var maxSlots = Math.max.apply(null, daySlots.map(function(d) { return d.length; }).concat([0]));
      if (maxSlots === 0) return;

      for (var p = 0; p < maxSlots; p++) {
        (function(pos) {
          showRows.push({
            canal: canal,
            canalBreak: pos === 0,
            perDay: dias.map(function(_, di) {
              var sl = daySlots[di][pos] || null;
              if (!sl) return {showLabel: '', aire: null, zocalos: null, edicion: null};
              var lbl = sl.show_inicio && sl.show_fin ? sl.show_inicio + ' – ' + sl.show_fin : '';
              return {showLabel: lbl, aire: sl.aire, zocalos: sl.zocalos, edicion: sl.edicion};
            }),
          });
        })(p);
      }
    });
  }

  if (showRows.length > 0) {
    sections.push({fn: 'SHOW', rows: showRows, isShow: true});
  }

  // ── Otras funciones ──────────────────────────────────────────────────────────
  ['EDICION','PLACAS','TEXTOS','CONTENIDOS'].forEach(function(fn) {
    var allFn = [];
    dayTurnos.forEach(function(ts, di) {
      ts.filter(function(t) {
        // EDICION con show_inicio va en la sección SHOW (junto a AIRE/ZOCALOS)
        if (fn === 'EDICION' && t.show_inicio) return false;
        return t.funcion === fn;
      }).forEach(function(t) { allFn.push(Object.assign({}, t, {di: di})); });
    });
    if (!allFn.length) return;

    var slotMap = new Map();
    allFn.forEach(function(t) {
      // EDICION uses canal (NC01/NC02) as slot identifier; others use ingreso+egreso
      var k = fn === 'EDICION'
        ? (t.canal + '||' + t.show_inicio + '||' + t.show_fin)
        : (t.ingreso + '||' + t.egreso);
      if (!slotMap.has(k)) slotMap.set(k, {canal: t.canal, show_inicio: t.show_inicio, show_fin: t.show_fin, ingreso: t.ingreso, egreso: t.egreso});
    });

    var slots = Array.from(slotMap.values()).sort(function(a, b) {
      if (fn === 'EDICION') {
        var cc = (a.canal || '').localeCompare(b.canal || '');
        if (cc !== 0) return cc;
        return (a.show_inicio || 'ZZ').localeCompare(b.show_inicio || 'ZZ');
      }
      // Turnos de trabajo: orden cronológico simple (06:00 va primero, no al final)
      var ha = parseInt((a.ingreso||'0').split(':')[0]) || 0;
      var hb = parseInt((b.ingreso||'0').split(':')[0]) || 0;
      return ha - hb;
    });

    var rows = slots.map(function(slot, i) {
      var prevSlot = i > 0 ? slots[i - 1] : null;
      return {
        canal: slot.canal, show_inicio: slot.show_inicio, show_fin: slot.show_fin,
        ingreso: slot.ingreso, egreso: slot.egreso,
        canalBreak: fn === 'EDICION' ? (!prevSlot || prevSlot.canal !== slot.canal) : (i === 0),
        perDay: dias.map(function(_, di) {
          return dayTurnos[di].filter(function(t) {
            if (fn === 'EDICION') {
              return t.funcion === fn && t.canal === slot.canal &&
                t.show_inicio === slot.show_inicio && t.show_fin === slot.show_fin;
            }
            return t.funcion === fn && t.ingreso === slot.ingreso && t.egreso === slot.egreso;
          });
        }),
      };
    });

    sections.push({fn: fn, rows: rows});
  });

  // ── Secciones de ausencia (OFF, COMPENSATORIO, VACACION) ─────────────────
  ['OFF','COMPENSATORIO','VACACION'].forEach(function(fn) {
    var perDay = dias.map(function(d) {
      var ts = d.turnos.filter(function(t) { return t.tipo === 'libre' && t.funcion === fn; });
      if (filter) ts = ts.filter(function(t) { return t.emp_nombre.toLowerCase().includes(filter); });
      return ts;
    });
    if (perDay.some(function(ts) { return ts.length > 0; })) {
      sections.push({fn: fn, rows: [{canalBreak: true, perDay: perDay}], isAbsence: true});
    }
  });

  // Header
  var thDays = '';
  dias.forEach(function(d, i) {
    var dnIdx = diasIdx[i];
    thDays += '<th class="th-day' + (d.es_feriado ? ' feriado' : '') + '">' +
      '<span class="th-dn">' + DN[dnIdx] + '</span>' +
      '<span class="th-dt">' + String(d.dia_num).padStart(2,'0') + '/' + String(d.mes).padStart(2,'0') + '</span>' +
      (d.es_feriado ? '<span class="th-fer">FERIADO</span>' : '') +
      '</th>';
  });

  var html = '<table class="sched-table"><thead><tr>' +
    '<th class="th-left"></th>' + thDays +
    '</tr></thead><tbody>';

  var CANAL_LABELS = {
    'ESPN': 'ESPN', 'ESPN 2/ESPN3': 'ESPN 2', 'CHI': 'ESPN CHI',
    'COL': 'ESPN COL', 'CAM': 'ESPN CAM', 'REGIONES': 'REGIONES'
  };

  // Pre-calcular rowspans
  var showCanalRowspans = {};
  showRows.forEach(function(r) {
    showCanalRowspans[r.canal] = (showCanalRowspans[r.canal] || 0) + 1;
  });
  var sectionRowspans = {};   // para PLACAS/TEXTOS/CONTENIDOS: total de rows
  var edicionCanalRowspans = {};  // para EDICION: rows por canal
  sections.forEach(function(sec) {
    if (sec.fn === 'EDICION') {
      sec.rows.forEach(function(r) {
        edicionCanalRowspans[r.canal] = (edicionCanalRowspans[r.canal] || 0) + 1;
      });
    } else if (!sec.isShow) {
      sectionRowspans[sec.fn] = sec.rows.length;
    }
  });

  sections.forEach(function(sec) {
    var fn = sec.fn;
    // Separador de sección (solo una línea divisoria, sin badge)
    html += '<tr class="section-hdr fn-' + fn + '"><td colspan="' + (1 + dias.length) + '"></td></tr>';

    sec.rows.forEach(function(row) {
      var showLabel = row.show_inicio && row.show_fin ? row.show_inicio + ' – ' + row.show_fin : '';
      var leftCell = '';

      if (sec.isShow) {
        // Canal name como celda con rowspan en la primera fila de cada canal
        if (row.canalBreak) {
          var rs = showCanalRowspans[row.canal] || 1;
          var canalLabel = CANAL_LABELS[row.canal] || row.canal || '';
          // Fila separadora con el nombre del canal
          html += '<tr class="canal-hdr-row"><td colspan="' + (1 + dias.length) + '"><span class="canal-hdr-label">' + canalLabel + '</span></td></tr>';
          leftCell = '<td class="td-left td-show-canal" rowspan="' + rs + '"><span class="td-canal-vert">' + canalLabel + '</span></td>';
        }
        // filas siguientes del mismo canal: sin td-left (ya cubre el rowspan)
      } else if (fn === 'EDICION') {
        if (row.canalBreak) {
          var rs = edicionCanalRowspans[row.canal] || 1;
          leftCell = '<td class="td-left td-show-canal" rowspan="' + rs + '"><span class="td-canal-vert">' + (row.canal || '') + '</span></td>';
        }
        // rows siguientes del mismo canal: sin td-left (cubierto por rowspan)
      } else if (sec.isAbsence) {
        if (row.canalBreak) {
          var ABSENCE_LABELS = {OFF:'OFF', COMPENSATORIO:'COMP.', VACACION:'VAC.'};
          leftCell = '<td class="td-left td-show-canal fn-left-' + fn + '" rowspan="1"><span class="td-canal-vert">' + (ABSENCE_LABELS[fn]||fn) + '</span></td>';
        }
      } else {
        // PLACAS, TEXTOS, CONTENIDOS: label de sección en primera fila
        if (row.canalBreak) {
          var rs = sectionRowspans[fn] || 1;
          leftCell = '<td class="td-left td-show-canal fn-left-' + fn + '" rowspan="' + rs + '"><span class="td-canal-vert">' + fn + '</span></td>';
        }
      }

      var dayCells = '';

      if (sec.isShow) {
        // Cada celda: horario a la izquierda + AIRE + ZOCALOS a la derecha
        row.perDay.forEach(function(daySlot, di) {
          var hasAny = daySlot.aire || daySlot.zocalos || daySlot.edicion;
          if (!hasAny) {
            dayCells += '<td class="td-day td-empty">—</td>';
            return;
          }
          var peopleHtml = '';
          ['aire', 'zocalos', 'edicion'].forEach(function(key) {
            var t = daySlot[key];
            if (!t) return;
            var subFn = key === 'aire' ? 'AIRE' : key === 'zocalos' ? 'ZOCALOS' : 'EDICION';
            var hrs = timeDiffHours(t.ingreso, t.egreso);
            var extraH = hrs > 8 ? '<span class="td-extra">+' + (hrs-8).toFixed(1) + 'h</span>' : '';
            var nameS = t.emp_nombre.trim();
            var shiftS = t.ingreso && t.egreso ? t.ingreso + '–' + t.egreso : '—';
            peopleHtml += '<div class="td-entry sublabel-' + subFn + '">' +
              '<span class="td-subfn sublabel-' + subFn + '">' + (subFn === 'AIRE' ? 'PROD. AIRE' : subFn === 'ZOCALOS' ? 'PROD. ZOCALOS' : 'EDICION') + '</span>' +
              '<div class="td-name">' + nameS + '</div>' +
              '<div class="td-shift">' + shiftS + extraH + '</div>' +
              '<div class="td-btns">' +
                '<button class="td-btn-e" data-id="' + t.id + '" data-di="' + di + '">✎</button>' +
                '<button class="td-btn-d" data-id="' + t.id + '">✕</button>' +
              '</div>' +
              '</div>';
          });
          var timeParts = daySlot.showLabel ? daySlot.showLabel.split(' – ') : ['', ''];
          var timeHtml = '<div class="show-time-left"><span class="st-ini">' + (timeParts[0]||'') + '</span><span class="st-sep">–</span><span class="st-fin">' + (timeParts[1]||'') + '</span></div>';
          dayCells += '<td class="td-day td-show-cell"><div class="show-cell-inner">' + timeHtml + '<div class="show-people">' + peopleHtml + '</div></div></td>';
        });
      } else if (sec.isAbsence) {
        row.perDay.forEach(function(ts) {
          if (!ts.length) { dayCells += '<td class="td-day td-empty">—</td>'; return; }
          var cellHtml = ts.map(function(t) {
            return '<div class="td-entry"><div class="td-name absence-name">' + t.emp_nombre.trim() + '</div></div>';
          }).join('');
          dayCells += '<td class="td-day">' + cellHtml + '</td>';
        });
      } else {
        row.perDay.forEach(function(turnos, di) {
          if (!turnos.length) {
            dayCells += '<td class="td-day td-empty">—</td>';
            return;
          }
          var cellHtml = '';
          turnos.forEach(function(t) {
            var hrs = timeDiffHours(t.ingreso, t.egreso);
            var extraH = hrs > 8 ? '<span class="td-extra">+' + (hrs-8).toFixed(1) + 'h</span>' : '';
            var nameS = t.emp_nombre.trim();
            var shiftS = t.ingreso && t.egreso ? t.ingreso + '–' + t.egreso : '—';
            cellHtml += '<div class="td-entry">' +
              '<div class="td-name">' + nameS + '</div>' +
              '<div class="td-shift">' + shiftS + extraH + '</div>' +
              '<div class="td-btns">' +
                '<button class="td-btn-e" data-id="' + t.id + '" data-di="' + diasIdx[di] + '">✎</button>' +
                '<button class="td-btn-d" data-id="' + t.id + '">✕</button>' +
              '</div></div>';
          });
          dayCells += '<td class="td-day td-show-cell">' + cellHtml + '</td>';
        });
      }

      var rowFn = sec.isShow ? 'SHOW' : fn;
      var canalBreakClass = (sec.isShow && row.canalBreak) ? ' canal-break' : '';
      html += '<tr class="data-row fn-row-' + rowFn + canalBreakClass + '">' + leftCell + dayCells + '</tr>';
    });
  });

  html += '</tbody></table>';

  // Botón por día
  var addRow = '<div class="add-day-row">';
  dias.forEach(function(d, i) {
    addRow += '<button class="add-day-btn" data-fecha="' + d.fecha + '">+ ' + DN[i] + '</button>';
  });
  addRow += '</div>';

  wrap.innerHTML = addRow + '<div style="overflow-x:auto">' + html + '</div>';

  // Eventos
  wrap.querySelectorAll('.td-btn-d').forEach(function(btn) {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      if (confirm('¿Eliminar turno?')) { await api('/api/turnos/' + btn.dataset.id, 'DELETE'); loadWeek(); }
    });
  });
  wrap.querySelectorAll('.td-btn-e').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var di = parseInt(btn.dataset.di);
      var t = data.dias[di].turnos.find(function(x) { return x.id === parseInt(btn.dataset.id); });
      if (t) openTurnoModal(data.dias[di].fecha, t);
    });
  });
  wrap.querySelectorAll('.add-day-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { openTurnoModal(btn.dataset.fecha); });
  });
}
// ─── CARDS VIEW ───────────────────────────────────────────────────────────────
function renderCardsView(data) {
  const grid = el('schedule-grid');
  grid.innerHTML = '';
  const filter = S.weekFilter;

  data.dias.forEach(day => {
    const col = document.createElement('div');
    col.className = 'day-col' + (day.es_feriado ? ' es-feriado' : '');

    col.innerHTML = `
      <div class="day-header">
        <div class="day-header-top">
          <span class="day-name">${day.dia_nombre}</span>
          <span class="week-num-badge">S#${S.week}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span class="day-num">${day.dia_num}/${day.mes < 10 ? '0'+day.mes : day.mes}</span>
          ${day.es_feriado ? '<span class="day-feriado-badge">FERIADO</span>' : ''}
        </div>
      </div>`;

    const body = document.createElement('div');
    body.className = 'day-body';

    let turnos = day.turnos;
    if (filter) turnos = turnos.filter(t => t.emp_nombre.toLowerCase().includes(filter));

    // Group by función
    const grouped = {};
    const sinFuncion = [];
    turnos.forEach(t => {
      if (t.tipo === 'libre') { sinFuncion.push(t); return; }
      const fn = t.funcion && FUNCIONES.includes(t.funcion) ? t.funcion : '__sin__';
      if (!grouped[fn]) grouped[fn] = [];
      grouped[fn].push(t);
    });

    // Render in order: defined functions first, then unlabeled
    const orderedKeys = [...FUNCIONES.filter(f => grouped[f]), ...(grouped['__sin__'] ? ['__sin__'] : [])];

    if (orderedKeys.length === 0 && sinFuncion.length === 0) {
      body.innerHTML = '';
    } else {
      orderedKeys.forEach(fn => {
        const section = document.createElement('div');
        section.className = `funcion-section fn-${fn}`;
        if (fn !== '__sin__') {
          const lbl = document.createElement('div');
          lbl.className = 'funcion-label';
          lbl.textContent = fn;
          section.appendChild(lbl);
        }
        grouped[fn].forEach(t => section.appendChild(makeTurnoCard(t, day)));
        body.appendChild(section);
      });

      // Libres at the bottom
      if (sinFuncion.length > 0) {
        const libSection = document.createElement('div');
        libSection.className = 'funcion-section';
        const lbl = document.createElement('div');
        lbl.className = 'funcion-label funcion-libre';
        lbl.textContent = 'LIBRE';
        libSection.appendChild(lbl);
        sinFuncion.forEach(t => libSection.appendChild(makeTurnoCard(t, day)));
        body.appendChild(libSection);
      }
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'add-btn';
    addBtn.textContent = '+ turno';
    addBtn.addEventListener('click', () => openTurnoModal(day.fecha));
    body.appendChild(addBtn);

    col.appendChild(body);
    grid.appendChild(col);
  });
}  // end renderCardsView

// ─── DAY VIEW ────────────────────────────────────────────────────────────────
function renderDayView(data) {
  const wrap = el('schedule-day-wrap');
  const dias = data.dias;
  const filter = S.weekFilter;

  const DN_SHORT = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  var idx = Math.min(S.currentDayIdx, dias.length - 1);

  // Tabs de días
  var tabsHtml = '<div class="dv-tabs">';
  dias.forEach(function(d, i) {
    var active = i === idx ? ' active' : '';
    tabsHtml += '<button class="dv-tab' + active + '" data-i="' + i + '">' +
      '<span class="dv-tab-name">' + DN_SHORT[i] + '</span>' +
      '<span class="dv-tab-num">' + String(d.dia_num).padStart(2,'0') + '/' + String(d.mes).padStart(2,'0') + '</span>' +
      (d.es_feriado ? '<span class="dv-tab-fer">FER</span>' : '') +
      '</button>';
  });
  tabsHtml += '</div>';

  // Contenido del día seleccionado
  var day = dias[idx];
  var turnos = day.turnos;
  if (filter) turnos = turnos.filter(function(t) { return t.emp_nombre.toLowerCase().includes(filter); });

  var CANAL_LABELS = {'ESPN':'ESPN','ESPN 2/ESPN3':'ESPN 2','CHI':'ESPN CHI','COL':'ESPN COL','CAM':'ESPN CAM'};
  var CANAL_ORDER  = ['ESPN','ESPN 2/ESPN3','CHI','COL','CAM'];

  // Agrupar shows por canal
  var showMap = {};
  turnos.forEach(function(t) {
    if (!t.show_inicio) return;
    if (!['AIRE','ZOCALOS','EDICION'].includes(t.funcion)) return;
    var c = t.canal || '';
    if (!showMap[c]) showMap[c] = {};
    var k = t.show_inicio + '||' + t.show_fin;
    if (!showMap[c][k]) showMap[c][k] = {show_inicio: t.show_inicio, show_fin: t.show_fin, turnos: []};
    showMap[c][k].turnos.push(t);
  });

  var FN_COLORS = {AIRE:'var(--fn-aire)',ZOCALOS:'var(--fn-zocalos)',EDICION:'var(--fn-edicion)'};
  var FN_LABELS = {AIRE:'PROD. AIRE',ZOCALOS:'PROD. ZOCALOS',EDICION:'EDICION'};

  var contentHtml = '<div class="dv-content">';

  // Sección SHOWS por canal
  var canalesConShows = CANAL_ORDER.filter(function(c) { return showMap[c] && Object.keys(showMap[c]).length; });
  canalesConShows.forEach(function(canal) {
    var label = CANAL_LABELS[canal] || canal;
    contentHtml += '<div class="dv-canal-hdr">' + label + '</div>';
    var shows = Object.values(showMap[canal]).sort(function(a,b) {
      return showSortKey(a.show_inicio) - showSortKey(b.show_inicio);
    });
    shows.forEach(function(show) {
      contentHtml += '<div class="dv-show-row">';
      contentHtml += '<div class="dv-show-time">' + show.show_inicio + '<span class="dv-sep">–</span>' + show.show_fin + '</div>';
      contentHtml += '<div class="dv-show-people">';
      show.turnos.forEach(function(t) {
        var color = FN_COLORS[t.funcion] || 'var(--text2)';
        var lbl = FN_LABELS[t.funcion] || t.funcion;
        var hrs = timeDiffHours(t.ingreso, t.egreso);
        var extra = hrs > 8 ? '<span class="td-extra">+' + (hrs-8).toFixed(1) + 'h</span>' : '';
        contentHtml += '<div class="dv-person" style="border-left-color:' + color + '">' +
          '<span class="dv-fn" style="color:' + color + '">' + lbl + '</span>' +
          '<span class="dv-name">' + t.emp_nombre + '</span>' +
          '<span class="dv-shift">' + (t.ingreso && t.egreso ? t.ingreso + '–' + t.egreso : '—') + extra + '</span>' +
          '<div class="dv-btns">' +
            '<button class="td-btn-e" data-id="' + t.id + '" data-di="' + idx + '">✎</button>' +
            '<button class="td-btn-d" data-id="' + t.id + '">✕</button>' +
          '</div>' +
          '</div>';
      });
      contentHtml += '</div></div>';
    });
  });

  // Secciones de tareas: PLACAS, TEXTOS, CONTENIDOS, EDICION sin show
  var TASK_SECTIONS = ['PLACAS','TEXTOS','CONTENIDOS','EDICION'];
  TASK_SECTIONS.forEach(function(fn) {
    var ts = turnos.filter(function(t) {
      if (t.funcion !== fn) return false;
      if (fn === 'EDICION' && t.show_inicio) return false;
      return true;
    });
    if (!ts.length) return;

    var color = 'var(--fn-' + fn.toLowerCase() + ')';
    contentHtml += '<div class="dv-canal-hdr" style="color:' + color + ';border-left-color:' + color + '">' + fn + '</div>';

    // Agrupar por ingreso-egreso
    var slotMap = {};
    ts.forEach(function(t) {
      var k = (t.canal || '') + '||' + t.ingreso + '||' + t.egreso;
      if (!slotMap[k]) slotMap[k] = {ingreso:t.ingreso, egreso:t.egreso, canal:t.canal, turnos:[]};
      slotMap[k].turnos.push(t);
    });
    Object.values(slotMap).sort(function(a,b) {
      var ha = parseInt((a.ingreso||'0').split(':')[0]) || 0;
      var hb = parseInt((b.ingreso||'0').split(':')[0]) || 0;
      return ha - hb;
    }).forEach(function(slot) {
      contentHtml += '<div class="dv-show-row">';
      contentHtml += '<div class="dv-show-time">' + (slot.ingreso||'—') + '<span class="dv-sep">–</span>' + (slot.egreso||'—') + '</div>';
      contentHtml += '<div class="dv-show-people">';
      slot.turnos.forEach(function(t) {
        var lbl = t.canal || fn;
        contentHtml += '<div class="dv-person" style="border-left-color:' + color + '">' +
          '<span class="dv-fn" style="color:' + color + '">' + lbl + '</span>' +
          '<span class="dv-name">' + t.emp_nombre + '</span>' +
          '<span class="dv-shift">' + (t.ingreso && t.egreso ? t.ingreso + '–' + t.egreso : '—') + '</span>' +
          '<div class="dv-btns">' +
            '<button class="td-btn-e" data-id="' + t.id + '" data-di="' + idx + '">✎</button>' +
            '<button class="td-btn-d" data-id="' + t.id + '">✕</button>' +
          '</div>' +
          '</div>';
      });
      contentHtml += '</div></div>';
    });
  });

  // Secciones de ausencia
  var ABSENCE_COLORS = {OFF:'var(--fn-off)', COMPENSATORIO:'var(--fn-compensatorio)', VACACION:'var(--fn-vacacion)'};
  var ABSENCE_LABELS_DV = {OFF:'OFF / Franco', COMPENSATORIO:'Compensatorio', VACACION:'Vacaciones'};
  ['OFF','COMPENSATORIO','VACACION'].forEach(function(fn) {
    var abs = turnos.filter(function(t) { return t.tipo === 'libre' && t.funcion === fn; });
    if (!abs.length) return;
    var color = ABSENCE_COLORS[fn];
    contentHtml += '<div class="dv-canal-hdr" style="color:' + color + ';border-left-color:' + color + '">' + ABSENCE_LABELS_DV[fn] + '</div>';
    contentHtml += '<div class="dv-show-row"><div class="dv-show-time"></div><div class="dv-show-people">';
    abs.forEach(function(t) {
      contentHtml += '<div class="dv-person" style="border-left-color:' + color + '">' +
        '<span class="dv-name">' + t.emp_nombre + '</span>' +
        '</div>';
    });
    contentHtml += '</div></div>';
  });
  // Libres sin categoría (tipo='libre' y funcion no reconocida)
  var libresOtros = turnos.filter(function(t) {
    return t.tipo === 'libre' && !ABSENCE_COLORS[t.funcion];
  });
  if (libresOtros.length) {
    contentHtml += '<div class="dv-canal-hdr" style="color:var(--text2);border-left-color:var(--text2)">LIBRE</div>';
    contentHtml += '<div class="dv-show-row"><div class="dv-show-time"></div><div class="dv-show-people">';
    libresOtros.forEach(function(t) {
      contentHtml += '<div class="dv-person" style="border-left-color:var(--text2)"><span class="dv-name">' + t.emp_nombre + '</span></div>';
    });
    contentHtml += '</div></div>';
  }

  if (!turnos.length) {
    contentHtml += '<div style="padding:2rem;text-align:center;color:var(--text2);font-size:0.85rem">Sin turnos este día</div>';
  }

  contentHtml += '<div style="margin-top:1rem"><button class="add-btn" id="dv-add-btn">+ turno</button></div>';
  contentHtml += '</div>';

  wrap.innerHTML = tabsHtml + contentHtml;

  // Eventos tabs
  wrap.querySelectorAll('.dv-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      S.currentDayIdx = parseInt(btn.dataset.i);
      renderDayView(data);
    });
  });

  // Eventos edit/delete
  wrap.querySelectorAll('.td-btn-d').forEach(function(btn) {
    btn.addEventListener('click', async function(e) {
      e.stopPropagation();
      if (confirm('¿Eliminar turno?')) { await api('/api/turnos/' + btn.dataset.id, 'DELETE'); loadWeek(); }
    });
  });
  wrap.querySelectorAll('.td-btn-e').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var t = data.dias[idx].turnos.find(function(x) { return x.id === parseInt(btn.dataset.id); });
      if (t) openTurnoModal(data.dias[idx].fecha, t);
    });
  });
  var addBtn = wrap.querySelector('#dv-add-btn');
  if (addBtn) addBtn.addEventListener('click', function() { openTurnoModal(day.fecha); });
}

// ─── TURNO MODAL ──────────────────────────────────────────────────────────────
el('btn-add-turno').addEventListener('click', () => openTurnoModal(S.weekData?.dias?.[0]?.fecha || ''));

function openTurnoModal(fecha, turno = null) {
  S.editTurnoId = turno ? turno.id : null;
  el('modal-turno-title').textContent = turno ? 'Editar Turno' : 'Agregar Turno';

  el('t-fecha').value = fecha || '';
  el('t-empleado').innerHTML = S.employees.map(e =>
    `<option value="${e.id}">${e.nombre}</option>`
  ).join('');

  if (turno) {
    el('t-empleado').value = turno.empleado_id;
    el('t-funcion').value = turno.funcion || '';
    el('t-canal').value = turno.canal || '';
    el('t-show-ini').value = turno.show_inicio || '';
    el('t-show-fin').value = turno.show_fin || '';
    el('t-ingreso').value = turno.ingreso || '';
    el('t-egreso').value = turno.egreso || '';
    setTipoActive(turno.tipo || 'trabajo');
  } else {
    el('t-funcion').value = '';
    el('t-canal').value = '';
    el('t-show-ini').value = '';
    el('t-show-fin').value = '';
    el('t-ingreso').value = '08:00';
    el('t-egreso').value = '16:00';
    setTipoActive('trabajo');
  }
  updateHorasPreview();
  el('modal-turno').classList.add('open');
}

function setTipoActive(tipo) {
  document.querySelectorAll('.tipo-btn').forEach(b => {
    b.className = 'tipo-btn';
    if (b.dataset.tipo === tipo) b.classList.add(`active-${tipo}`);
  });
  el('t-trabajo-fields').classList.toggle('hidden', tipo === 'libre');
}

document.querySelectorAll('.tipo-btn').forEach(btn => {
  btn.addEventListener('click', () => setTipoActive(btn.dataset.tipo));
});

function getSelectedTipo() {
  return document.querySelector('.tipo-btn[class*="active-"]')?.dataset.tipo || 'trabajo';
}

function updateHorasPreview() {
  const ini = el('t-ingreso').value, egr = el('t-egreso').value;
  const prev = el('t-horas-preview');
  if (ini && egr) {
    const hrs = timeDiffHours(ini, egr);
    const extra = hrs > 8 ? ` (+${(hrs-8).toFixed(1)}hs extra)` : '';
    prev.textContent = `Duración: ${hrs.toFixed(1)}hs${extra}`;
    prev.style.color = hrs > 8 ? 'var(--yellow)' : 'var(--text2)';
  } else { prev.textContent = ''; }
}
el('t-ingreso').addEventListener('change', updateHorasPreview);
el('t-egreso').addEventListener('change', updateHorasPreview);

el('modal-turno-cancel').addEventListener('click', () => el('modal-turno').classList.remove('open'));

el('modal-turno-save').addEventListener('click', async () => {
  const tipo = getSelectedTipo();
  const body = {
    fecha: el('t-fecha').value,
    empleado_id: parseInt(el('t-empleado').value),
    tipo,
    funcion: tipo === 'libre' ? '' : el('t-funcion').value,
    canal: tipo === 'libre' ? '' : el('t-canal').value,
    show_inicio: tipo === 'libre' ? '' : el('t-show-ini').value,
    show_fin: tipo === 'libre' ? '' : el('t-show-fin').value,
    ingreso: tipo === 'libre' ? '' : el('t-ingreso').value,
    egreso: tipo === 'libre' ? '' : el('t-egreso').value,
  };
  if (!body.fecha || !body.empleado_id) return alert('Fecha y empleado son obligatorios.');

  if (S.editTurnoId) {
    await api(`/api/turnos/${S.editTurnoId}`, 'PUT', body);
  } else {
    await api('/api/turnos', 'POST', body);
  }
  el('modal-turno').classList.remove('open');
  loadWeek();
});

// ─── EMPLOYEES ────────────────────────────────────────────────────────────────
async function loadEmployees() {
  S.employees = await api('/api/empleados');
  renderEmployees(S.employees);
}

function renderEmployees(list) {
  const grid = el('emp-grid');
  grid.innerHTML = '';
  list.forEach(emp => {
    const card = document.createElement('div');
    card.className = 'emp-card';
    card.innerHTML = `
      <div class="emp-avatar">${initials(emp.nombre)}</div>
      <div class="emp-info"><h3>${emp.nombre}</h3><p>${emp.funcion || emp.empresa || ''}</p></div>
    `;
    card.addEventListener('click', () => showEmpDetail(emp));
    grid.appendChild(card);
  });
  if (!list.length) grid.innerHTML = '<div class="loading">Sin empleados.</div>';
}

el('emp-search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  renderEmployees(S.employees.filter(emp => emp.nombre.toLowerCase().includes(q)));
});

el('btn-add-emp').addEventListener('click', () => openEmpModal());
el('modal-emp-cancel').addEventListener('click', () => el('modal-emp').classList.remove('open'));

function openEmpModal(emp = null) {
  S.editEmpId = emp ? emp.id : null;
  el('modal-emp-title').textContent = emp ? 'Editar Empleado' : 'Nuevo Empleado';
  el('e-nombre').value = emp?.nombre || '';
  el('e-funcion').value = emp?.funcion || '';
  el('e-empresa').value = emp?.empresa || '';
  el('modal-emp').classList.add('open');
}

el('modal-emp-save').addEventListener('click', async () => {
  const nombre = el('e-nombre').value.trim();
  if (!nombre) return alert('El nombre es obligatorio.');
  const body = { nombre, funcion: el('e-funcion').value, empresa: el('e-empresa').value };
  if (S.editEmpId) {
    await api(`/api/empleados/${S.editEmpId}`, 'PUT', body);
  } else {
    await api('/api/empleados', 'POST', body);
  }
  el('modal-emp').classList.remove('open');
  await loadEmployees();
});

async function showEmpDetail(emp) {
  el('emp-grid').classList.add('hidden');
  el('emp-detail').classList.remove('hidden');
  el('emp-detail-name').textContent = emp.nombre;

  const stats = await api(`/api/empleados/${emp.id}/stats`);
  const sr = el('emp-stats');
  sr.innerHTML = `
    <div class="stat-card"><div class="stat-val">${stats.dias_trabajados}</div><div class="stat-label">Días trabajados</div></div>
    <div class="stat-card"><div class="stat-val" style="color:var(--text2)">${stats.dias_libres}</div><div class="stat-label">Francos / Libres</div></div>
    <div class="stat-card"><div class="stat-val red">${stats.feriados_trabajados}</div><div class="stat-label">Feriados trabajados</div></div>
    <div class="stat-card"><div class="stat-val yellow">${stats.horas_extras}</div><div class="stat-label">Horas extra</div></div>
    <div class="stat-card"><div class="stat-val green">${stats.francos_disponibles}</div><div class="stat-label">Francos comp. disponibles</div></div>
    <div class="stat-card"><div class="stat-val blue">${stats.comp_usados}</div><div class="stat-label">Comp. utilizados</div></div>
  `;

  // Comp section
  const cs = el('emp-comp-section');
  cs.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
      <h3 style="font-size:0.95rem;">Francos Compensatorios</h3>
      <button class="btn btn-primary btn-sm" id="btn-use-comp">+ Registrar uso</button>
    </div>
    <p style="font-size:0.82rem;color:var(--text2);">
      Feriados trabajados: <strong>${stats.feriados_trabajados}</strong> &nbsp;|&nbsp;
      Usados: <strong>${stats.comp_usados}</strong> &nbsp;|&nbsp;
      Disponibles: <strong style="color:var(--green)">${stats.francos_disponibles}</strong>
    </p>
  `;
  cs.querySelector('#btn-use-comp').addEventListener('click', () => openCompUsarModal(emp));

  el('btn-edit-emp').onclick = () => openEmpModal(emp);
  el('btn-del-emp').onclick = async () => {
    if (confirm(`¿Eliminar a ${emp.nombre}?`)) {
      await api(`/api/empleados/${emp.id}`, 'DELETE');
      el('emp-back').click();
      await loadEmployees();
    }
  };

  S.editEmpId = emp.id;
}

el('emp-back').addEventListener('click', () => {
  el('emp-detail').classList.add('hidden');
  el('emp-grid').classList.remove('hidden');
});

// ─── COMPENSATORIOS ───────────────────────────────────────────────────────────
let compData = null;

async function loadCompensatorios() {
  compData = await api('/api/compensatorios');
  renderCompensatorios();
}

function renderCompensatorios() {
  if (!compData) return;
  const search = el('comp-search').value.toLowerCase();
  const onlyPending = el('comp-only-pending').checked;

  let emps = compData.empleados;
  if (search) emps = emps.filter(e => e.empleado.nombre.toLowerCase().includes(search));
  if (onlyPending) emps = emps.filter(e => e.francos_disponibles > 0);

  const feriados = compData.feriados;

  let html = `<table class="comp-table"><thead><tr>
    <th>Empleado</th>
    <th title="Días trabajados">Trabajados</th>
    <th title="Feriados trabajados">Feriados</th>
    <th title="Horas extra">Hs Extra</th>
    <th title="Francos comp. disponibles" style="color:var(--green)">Francos disp.</th>
    <th title="Comp. usados">Usados</th>
    ${feriados.map(f => `<th class="date-header" title="${f.descripcion || f.fecha}">${fmtDateShort(f.fecha)}</th>`).join('')}
  </tr></thead><tbody>`;

  emps.forEach(e => {
    const disp = e.francos_disponibles;
    html += `<tr>
      <td><strong>${e.empleado.nombre}</strong></td>
      <td>${e.dias_trabajados}</td>
      <td><span class="${e.feriados_trabajados > 0 ? 'badge-w' : 'badge-dim'}">${e.feriados_trabajados}</span></td>
      <td>${e.horas_extras > 0 ? `<span class="badge-y">${e.horas_extras}</span>` : '—'}</td>
      <td><span class="${disp > 0 ? 'badge-g' : 'badge-dim'}">${disp}</span></td>
      <td>${e.comp_usados}</td>
      ${feriados.map(f => '<td><span class="badge-dim">·</span></td>').join('')}
    </tr>`;
  });

  html += '</tbody></table>';
  el('comp-wrap').innerHTML = html;
}

el('comp-search').addEventListener('input', renderCompensatorios);
el('comp-only-pending').addEventListener('change', renderCompensatorios);

// ─── FERIADOS MODAL ───────────────────────────────────────────────────────────
el('btn-manage-feriados').addEventListener('click', () => openFeriadosModal());
el('modal-feriados-close').addEventListener('click', () => { el('modal-feriados').classList.remove('open'); loadCompensatorios(); });

async function openFeriadosModal() {
  el('modal-feriados').classList.add('open');
  await renderFeriadosList();
}

async function renderFeriadosList() {
  S.feriados = await api('/api/feriados');
  el('feriados-list').innerHTML = S.feriados.map(f => `
    <div class="feriado-chip">
      <span>${fmtDateShort(f.fecha)}${f.descripcion ? ' · ' + f.descripcion : ''}</span>
      <button class="del-chip" data-id="${f.id}">✕</button>
    </div>
  `).join('') || '<span style="color:var(--text2);font-size:0.82rem">Sin feriados cargados.</span>';

  el('feriados-list').querySelectorAll('.del-chip').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`/api/feriados/${btn.dataset.id}`, 'DELETE');
      await renderFeriadosList();
    });
  });
}

el('modal-feriados-add').addEventListener('click', async () => {
  const fecha = el('f-fecha').value;
  if (!fecha) return alert('Seleccioná una fecha.');
  await api('/api/feriados', 'POST', { fecha, descripcion: el('f-desc').value });
  el('f-fecha').value = ''; el('f-desc').value = '';
  await renderFeriadosList();
});

// ─── COMP USADO MODAL ─────────────────────────────────────────────────────────
function openCompUsarModal(emp) {
  S.compEmpId = emp.id;
  el('comp-usar-emp-label').textContent = `Empleado: ${emp.nombre}`;
  el('cu-fecha').value = '';
  el('cu-desc').value = '';
  el('modal-comp-usar').classList.add('open');
}
el('modal-comp-cancel').addEventListener('click', () => el('modal-comp-usar').classList.remove('open'));
el('modal-comp-save').addEventListener('click', async () => {
  const fecha = el('cu-fecha').value;
  if (!fecha) return alert('Seleccioná una fecha.');
  await api('/api/comp_usados', 'POST', { empleado_id: S.compEmpId, fecha, descripcion: el('cu-desc').value });
  el('modal-comp-usar').classList.remove('open');
  // Refresh detail
  const emp = S.employees.find(e => e.id === S.compEmpId);
  if (emp) showEmpDetail(emp);
});

// Close modals clicking overlay
document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); });
});

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  initYearSelect();
  await loadEmployees();
  await loadWeek();
}

init();

// ── GOOGLE SHEETS SYNC ────────────────────────────────────────────────────────
el('btn-gsheets-sync').addEventListener('click', () => {
  el('gs-week-from').value = S.week;
  el('gs-week-to').value   = S.week;
  el('gs-year').value      = S.year;
  el('gs-status').textContent = '';
  el('modal-gsheets').classList.add('open');
});
el('gs-cancel').addEventListener('click', () => el('modal-gsheets').classList.remove('open'));
el('gs-btn-all').addEventListener('click', () => {
  el('gs-week-from').value = 1;
  el('gs-week-to').value   = 52;
});
el('gs-confirm').addEventListener('click', async () => {
  const year  = parseInt(el('gs-year').value);
  const from  = parseInt(el('gs-week-from').value);
  const to    = parseInt(el('gs-week-to').value);
  const weeks = Array.from({length: to - from + 1}, (_, i) => from + i);

  el('gs-status').textContent = `Sincronizando semanas ${from} a ${to}...`;
  el('gs-confirm').disabled = true;

  const res = await fetch('/api/gsheets/sync', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({year, weeks}),
  });
  const data = await res.json();
  el('gs-confirm').disabled = false;

  const errMsg = data.errores?.length ? ` | Errores: ${data.errores.join(', ')}` : '';
  el('gs-status').textContent =
    `✓ ${data.semanas} semanas · ${data.turnos} turnos importados${errMsg}`;
  el('gs-status').style.color = data.errores?.length ? '#f87171' : '#34d399';

  await loadEmployees();
  await loadWeek();

  if (!data.errores?.length) {
    setTimeout(() => el('modal-gsheets').classList.remove('open'), 2000);
  }
});

// ─── HORAS EXTRA VIEW ─────────────────────────────────────────────────────────

(function() {
  var DN = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  function initExtrasYearSelect() {
    var sel = el('extras-year-select');
    if (sel.options.length) return;
    var cur = new Date().getFullYear();
    for (var y = cur - 1; y <= cur + 2; y++) {
      var o = document.createElement('option');
      o.value = y; o.textContent = y;
      if (y === SE.year) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', function() { SE.year = parseInt(sel.value); loadExtras(); });
  }

  el('extras-btn-prev').addEventListener('click', function() {
    if (SE.week > 1) { SE.week--; } else { SE.year--; SE.week = 52; el('extras-year-select').value = SE.year; }
    loadExtras();
  });
  el('extras-btn-next').addEventListener('click', function() {
    if (SE.week < 52) { SE.week++; } else { SE.year++; SE.week = 1; el('extras-year-select').value = SE.year; }
    loadExtras();
  });

  window.loadExtras = async function() {
    initExtrasYearSelect();
    el('extras-week-badge').textContent = 'S#' + SE.week;
    el('extras-wrap').innerHTML = '<div class="loading">Cargando...</div>';

    var data = await api('/api/semana/' + SE.year + '/' + SE.week);
    var dias = data.dias;

    if (dias && dias.length) {
      el('extras-week-dates').textContent = fmtDateShort(dias[0].fecha) + ' \u2013 ' + fmtDateShort(dias[6].fecha) + ' \u00b7 ' + SE.year;
    }

    // Recopilar todos los turnos de trabajo
    // Estructura: empMap[nombre] = { dias: { di: {hrs, extra} }, totalHrs, totalExtra, funcion }
    var empMap = {};
    dias.forEach(function(d, di) {
      d.turnos.forEach(function(t) {
        if (t.tipo !== 'trabajo') return;
        var hrs = timeDiffHours(t.ingreso, t.egreso);
        if (!hrs) return;
        var extra = hrs > 8 ? hrs - 8 : 0;
        var nombre = t.emp_nombre;
        if (!empMap[nombre]) empMap[nombre] = { dias: {}, totalHrs: 0, totalExtra: 0, funcion: t.funcion };
        var prev = empMap[nombre].dias[di] || { hrs: 0, extra: 0 };
        empMap[nombre].dias[di] = { hrs: prev.hrs + hrs, extra: prev.extra + extra };
        empMap[nombre].totalHrs += hrs;
        empMap[nombre].totalExtra += extra;
      });
    });

    var nombres = Object.keys(empMap).sort();
    if (!nombres.length) {
      el('extras-wrap').innerHTML = '<div class="empty-state">No hay turnos esta semana.</div>';
      return;
    }

    // Header
    var thDays = '';
    dias.forEach(function(d, i) {
      thDays += '<th class="th-day' + (d.es_feriado ? ' feriado' : '') + '">' +
        '<span class="th-dn">' + DN[i] + '</span>' +
        '<span class="th-dt">' + String(d.dia_num).padStart(2,'0') + '/' + String(d.mes).padStart(2,'0') + '</span>' +
        '</th>';
    });

    var html = '<table class="sched-table extras-table"><thead><tr>' +
      '<th class="th-left">EMPLEADO</th>' + thDays +
      '<th class="th-day"><span class="th-dn">TOTAL</span></th>' +
      '</tr></thead><tbody>';

    nombres.forEach(function(nombre) {
      var emp = empMap[nombre];
      var parts = nombre.trim().split(' ');
      var nameS = parts.length >= 2 ? parts[parts.length-1] + ', ' + parts[0] : nombre;
      var fnClass = 'fn-row-' + (emp.funcion || 'AIRE');

      html += '<tr class="data-row extras-row ' + fnClass + '">' +
        '<td class="td-left"><span class="td-name">' + nameS + '</span>' +
        (emp.funcion ? '<span class="td-shift" style="font-size:0.68rem;opacity:0.6">' + emp.funcion + '</span>' : '') +
        '</td>';

      dias.forEach(function(_, di) {
        var day = emp.dias[di];
        if (day) {
          var cls = day.extra > 0 ? 'extras-cell extras-has' : 'extras-cell';
          var extraTag = day.extra > 0 ? '<span class="extras-h">+' + day.extra.toFixed(1) + 'hs</span>' : '';
          html += '<td class="td-day ' + cls + '">' +
            '<span style="font-size:0.8rem">' + day.hrs.toFixed(1) + 'hs</span>' + extraTag +
            '</td>';
        } else {
          html += '<td class="td-day td-empty">—</td>';
        }
      });

      var totalTag = emp.totalExtra > 0 ? '<br><span class="extras-h">+' + emp.totalExtra.toFixed(1) + ' extra</span>' : '';
      html += '<td class="td-day extras-cell extras-total">' +
        '<span style="font-size:0.8rem">' + emp.totalHrs.toFixed(1) + 'hs</span>' + totalTag +
        '</td>';
      html += '</tr>';
    });

    // Fila de totales por día
    html += '<tr class="extras-totals-row"><td class="td-left"><strong>TOTAL DÍA</strong></td>';
    dias.forEach(function(_, di) {
      var totalHrsDia = nombres.reduce(function(sum, n) { return sum + ((empMap[n].dias[di] || {hrs:0}).hrs); }, 0);
      var totalExtraDia = nombres.reduce(function(sum, n) { return sum + ((empMap[n].dias[di] || {extra:0}).extra); }, 0);
      if (totalHrsDia > 0) {
        var extraTag = totalExtraDia > 0 ? '<br><span class="extras-h">+' + totalExtraDia.toFixed(1) + '</span>' : '';
        html += '<td class="td-day extras-cell extras-total"><span style="font-size:0.8rem">' + totalHrsDia.toFixed(1) + 'hs</span>' + extraTag + '</td>';
      } else {
        html += '<td class="td-day td-empty">—</td>';
      }
    });
    var totalHrsSemana = nombres.reduce(function(sum, n) { return sum + empMap[n].totalHrs; }, 0);
    var totalExtraSemana = nombres.reduce(function(sum, n) { return sum + empMap[n].totalExtra; }, 0);
    var grandExtraTag = totalExtraSemana > 0 ? '<br><span class="extras-h">+' + totalExtraSemana.toFixed(1) + ' extra</span>' : '';
    html += '<td class="td-day extras-cell extras-total extras-grand"><span style="font-size:0.8rem">' + totalHrsSemana.toFixed(1) + 'hs</span>' + grandExtraTag + '</td>';
    html += '</tr>';

    html += '</tbody></table>';
    el('extras-wrap').innerHTML = '<div style="overflow-x:auto">' + html + '</div>';
  };
})();
