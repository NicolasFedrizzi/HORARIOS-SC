/**
 * HORARIOS SC – Procesador de Pendientes
 *
 * Instrucciones:
 *   1. Abrí el Sheet → Extensiones → Apps Script
 *   2. Pegá todo este archivo como un nuevo archivo .gs
 *   3. En el onOpen() existente, agregá esta línea al menú:
 *        .addItem('Procesar Pendientes', 'procesarPendientes')
 *      (o reemplazá el onOpen de abajo si no tenés uno propio)
 *   4. Guardá y recargá el Sheet – aparecerá en el menú "Horarios SC"
 */

// Descomentá esto si no tenés un onOpen propio en otro archivo:
// function onOpen() {
//   SpreadsheetApp.getUi()
//     .createMenu('Horarios SC')
//     .addItem('Procesar Pendientes', 'procesarPendientes')
//     .addToUi();
// }

/**
 * Lee la pestaña PENDIENTES y ejecuta cada movimiento en la pestaña semanal.
 * Al terminar borra las filas procesadas y muestra un resumen.
 */
function procesarPendientes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ps = ss.getSheetByName('PENDIENTES');

  if (!ps || ps.getLastRow() <= 1) {
    SpreadsheetApp.getUi().alert('No hay pendientes para procesar.');
    return;
  }

  var lastRow = ps.getLastRow();
  var data = ps.getRange(2, 1, lastRow - 1, 4).getValues();
  var errores = [];
  var procesados = 0;

  // Procesar de abajo hacia arriba para que deleteRow no cambie los índices
  for (var i = data.length - 1; i >= 0; i--) {
    var semana  = data[i][0];
    var empleado = data[i][1];
    var tipo    = data[i][2];
    var diasStr = data[i][3];

    if (!semana || !empleado || !tipo || !diasStr) {
      ps.deleteRow(i + 2);
      continue;
    }

    var tabName = 'HORARIO SC 2026 - S#' + semana;
    var ws = ss.getSheetByName(tabName);
    if (!ws) {
      errores.push('Pestaña "' + tabName + '" no encontrada');
      ps.deleteRow(i + 2);
      continue;
    }

    var dias = diasStr.toString().split(',').map(function(d) { return d.trim(); }).filter(Boolean);
    for (var j = 0; j < dias.length; j++) {
      var res = _moverEmpleado(
        ws,
        empleado.toString().trim().replace(/[\s.,;:]+$/, '').toUpperCase(),
        tipo.toString().trim().toUpperCase(),
        dias[j].toLowerCase()
      );
      if (!res.ok) {
        errores.push(empleado + ' (' + dias[j] + ' S#' + semana + '): ' + res.msg);
      }
    }

    ps.deleteRow(i + 2);
    procesados++;
  }

  var msg = '✓ Procesados: ' + procesados + ' registro(s).';
  if (errores.length) msg += '\n\nErrores:\n' + errores.join('\n');
  SpreadsheetApp.getUi().alert(msg);
}

/**
 * Mueve un empleado desde su turno de trabajo a la sección de ausencia correcta,
 * preservando el formato (color de fondo, tipografía) de las celdas vecinas.
 */
function _moverEmpleado(sheet, empleado, tipoKey, dia) {
  var COLS_PER_DAY = 4;
  var DAY_INDEX = {
    'lunes': 0, 'martes': 1, 'miercoles': 2, 'miércoles': 2,
    'jueves': 3, 'viernes': 4, 'sabado': 5, 'sábado': 5, 'domingo': 6
  };
  var SECTION_MAP = {
    'COMPENSATORIO':       'DIAS COMPENSATORIOS',
    'COMPENSATORIOS':      'DIAS COMPENSATORIOS',
    'DIAS COMPENSATORIOS': 'DIAS COMPENSATORIOS',
    'VACACION':   'VACACIONES',
    'VACACIONES': 'VACACIONES',
    'FRANCO': 'FRANCO',
    'OFF':    'OFF'
  };
  var ALL_HEADERS = [
    'FRANCO', 'VACACIONES', 'VACACION', 'OFF',
    'COMPENSATORIO', 'COMPENSATORIOS', 'DIAS COMPENSATORIOS'
  ];

  var di = DAY_INDEX[dia];
  if (di === undefined) return { ok: false, msg: 'Día no reconocido: ' + dia };

  var empCol = di * COLS_PER_DAY + 3;  // 1-indexed (col A=1)
  var sectionLabel = SECTION_MAP[tipoKey] || tipoKey;

  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), empCol);
  var vals = sheet.getRange(1, 1, lastRow, lastCol).getValues();

  // ── Paso 1: limpiar al empleado de su posición actual ─────────────────
  for (var r = 0; r < vals.length; r++) {
    var c0 = String(vals[r][0] || '').trim().toUpperCase();
    var cv = String(vals[r][empCol - 1] || '').trim().toUpperCase();
    if (cv !== empleado) continue;
    // No tocar otras secciones de ausencia
    if (ALL_HEADERS.indexOf(c0) >= 0 && c0 !== sectionLabel) continue;
    sheet.getRange(r + 1, empCol).clearContent().setBackground('#ffffff');
    vals[r][empCol - 1] = '';
  }

  // ── Paso 2: colocar en la primera fila vacía de la sección ─────────────
  // En v2b cada fila de la sección repite el label en col A.
  // Saltamos la primera aparición (header visual) y buscamos en las siguientes.
  var inSection = false;
  var headerRow = -1;  // primera fila de la sección (header visual)
  var refRow    = -1;  // fila con otro empleado en el mismo día (para copiar formato)

  for (var r = 0; r < vals.length; r++) {
    var c0 = String(vals[r][0] || '').trim().toUpperCase();

    if (c0 === sectionLabel && !inSection) {
      inSection  = true;
      headerRow  = r;
      continue;  // saltar header visual
    }
    if (!inSection) continue;

    // Salir si llegamos a otra sección
    if (ALL_HEADERS.indexOf(c0) >= 0 && c0 !== sectionLabel) break;
    if (c0 !== '' && c0 !== sectionLabel) break;

    var cv = String(vals[r][empCol - 1] || '').trim();
    if (cv) {
      refRow = r;  // celda ocupada → guardar referencia de formato
      continue;
    }

    // Celda vacía → colocar aquí
    var targetCell = sheet.getRange(r + 1, empCol);
    targetCell.setValue(empleado);

    // Copiar formato desde otra celda del mismo día en la misma sección,
    // o desde el header visual si no hay ninguna.
    var fmtRow = (refRow >= 0) ? refRow + 1 : headerRow + 1;
    sheet.getRange(fmtRow, empCol).copyFormatToRange(sheet, empCol, empCol, r + 1, r + 1);

    return { ok: true, row: r + 1 };
  }

  return { ok: false, msg: 'No se encontró fila libre en la sección' };
}
