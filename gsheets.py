"""
Parser para leer la Google Sheet de horarios.
Estructura: cada pestaña = "HORARIOS SC - SEMANA #N" (ej: "HORARIOS SC - SEMANA #25")
Cada semana: 7 días × 4 columnas (show, turno, empleado, "--")
"""
import re
import requests
import pandas as pd
from io import StringIO
from datetime import date, timedelta

SHEET_ID    = '19j3H-fgf6dYwDqHISyjEbejrwg0xivf1'
SHEET_ID_V2 = '1ViiKSaVKdha4c-6Bb9lvfChOz9OltHrc'   # formato alternativo (col1=sección, col2+=datos)

# Canales para el formato v2 (filas intermedias con nombre de canal)
CANAL_DETECT_V2 = [
    ('ESPN 2',   'ESPN 2/ESPN3'),
    ('ESPN CHI', 'CHI'),
    ('ESPN COL', 'COL'),
    ('ESPN CAM', 'CAM'),
    ('ESPN',     'ESPN'),
]

# Detección de canal a partir del nombre de sección
CANAL_DETECT = [
    ('ESPN 1 CHILE',    'CHI'),
    ('ESPN 1 COLOMBIA', 'COL'),
    ('ESPN CAM',        'CAM'),
    ('ESPN 2',          'ESPN 2/ESPN3'),
    ('ESPN 1',          'ESPN'),
]

# Palabras en col0 de fila de datos que indican función directamente
TASK_TO_FUNCION = {
    'PLACAS':    'PLACAS',
    'CONTENIDOS':'CONTENIDOS',
    'EDICION':   'EDICION',
    'TEXTOS':    'TEXTOS',
    'ZOCALOS':   'ZOCALOS',
}

# Secciones de ausencia (tipo='libre')
ABSENCE_SECTIONS = {
    'OFF':           'OFF',
    'COMPENSATORIOS':'COMPENSATORIO',
    'COMPENSATORIO': 'COMPENSATORIO',
    'VACACIONES':    'VACACION',
    'VACACION':      'VACACION',
}

DAY_HEADERS = {
    'LUNES','MARTES','MIERCOLES','MIÉRCOLES',
    'JUEVES','VIERNES','SABADO','SÁBADO','DOMINGO',
    'HORARIO','PAUTA','SHOWS','--','',
}


def _detect_canal(text):
    t = text.upper()
    for key, val in CANAL_DETECT:
        if key in t:
            return val
    return None


def _parse_time_range(s):
    """'12:00 a 14:00' → ('12:00', '14:00')"""
    if not s: return '', ''
    s = str(s).strip()
    if s in ('--', 'nan', '', 'a confirmar', 'A CONFIRMAR'): return '', ''
    m = re.match(r'(\d{1,2}:\d{2})\s+a\s+(\d{1,2}:\d{2})', s)
    return (m.group(1), m.group(2)) if m else ('', '')


def semana_start_date(year, semana_num):
    """
    Devuelve el lunes de SEMANA N usando la fórmula ISO
    (el 4 de enero siempre cae en la semana 1).
    """
    jan4 = date(year, 1, 4)
    return jan4 + timedelta(weeks=semana_num - 1, days=-jan4.weekday())


def parse_semana(year, semana_num, raw_csv):
    """
    Parsea el CSV de una pestaña y devuelve lista de dicts con cada turno.
    """
    monday = semana_start_date(year, semana_num)
    day_dates = [monday + timedelta(days=i) for i in range(7)]

    df = pd.read_csv(StringIO(raw_csv), header=None, dtype=str).fillna('--')
    rows = df.values.tolist()

    # Auto-detectar offset: algunas pestañas tienen columna vacía/-- al inicio
    first_row = [str(v).strip() for v in rows[0]] + [''] * 5
    col_offset = 1 if first_row[0] in ('--', '', 'nan') else 0

    current_funcion = 'AIRE'
    current_canal   = 'ESPN'
    turnos = []

    for raw_row in rows:
        # Rellenar a 35 columnas
        row = [str(v).strip() for v in raw_row] + ['--'] * 35

        col0 = row[col_offset]
        col2 = row[col_offset + 2]   # sirve para detectar ZOCALOS en header

        # ── Saltar filas de encabezado de días ──────────────────────────────
        if col0.upper() in DAY_HEADERS:
            continue

        # ── Detectar sección nueva ──────────────────────────────────────────
        if 'SHOWS' in col0.upper():
            canal = _detect_canal(col0)

            if canal:
                current_canal = canal
                # Si el header dice "ZOCALOS" en la 3ra columna → función ZOCALOS
                current_funcion = 'ZOCALOS' if col2.upper() == 'ZOCALOS' else 'AIRE'
            elif 'VARIOS' in col0.upper():
                # "SHOWS VARIOS" → ZOCALOS o CONTENIDOS
                current_funcion = 'ZOCALOS' if col2.upper() == 'ZOCALOS' else 'CONTENIDOS'
                current_canal   = ''
            continue

        if 'CONTENIDOS' in col0.upper() and 'SHOWS' in col0.upper():
            current_funcion = 'CONTENIDOS'
            current_canal   = ''
            continue

        # Detectar encabezado de sección EDICION (fila "NC","HORARIO","EDICION")
        if col0.upper() == 'NC' and col2.upper() == 'EDICION':
            current_funcion = 'EDICION'
            current_canal   = ''
            continue

        # ── Parsear datos por día ────────────────────────────────────────────
        for di in range(7):
            off = col_offset + di * 4
            c0 = row[off]       # show time o tipo de tarea
            c1 = row[off + 1]   # turno de trabajo
            c2 = row[off + 2]   # empleado

            # Sin empleado → saltar
            if c2 in ('--', '', 'nan') or c2.upper() in ('PAUTA', 'HORARIO'):
                continue

            c0_up = c0.upper()

            # Detectar función por el valor de c0 (match exacto o prefijo)
            fn_match = TASK_TO_FUNCION.get(c0_up) or next(
                (v for k, v in TASK_TO_FUNCION.items() if c0_up.startswith(k)), None
            )
            if fn_match:
                fn    = fn_match
                canal = ''
                show_i, show_f = '', ''
                ingreso, egreso = _parse_time_range(c1)

            elif c0_up.startswith('UX'):
                fn    = 'TEXTOS'
                canal = c0       # ID de workstation ("UX - 10.70.174.110")
                show_i, show_f = '', ''
                ingreso, egreso = _parse_time_range(c1)

            elif re.match(r'^NC\d+', c0_up):
                # Fila de EDICION (NC01, NC02, etc.)
                fn    = 'EDICION'
                canal = c0       # identificador (NC01, NC02...)
                show_i, show_f = '', ''
                ingreso, egreso = _parse_time_range(c1)

            elif c0 in ('--', '') or not re.search(r'\d{1,2}:\d{2}', c0):
                # No es horario de show ni tarea reconocida → saltar
                continue

            else:
                # Horario de show (e.g. "12:00 a 14:00")
                fn    = current_funcion
                canal = current_canal
                show_i, show_f = _parse_time_range(c0)
                ingreso, egreso = _parse_time_range(c1)

            turnos.append({
                'fecha':       day_dates[di].isoformat(),
                'semana':      semana_num,
                'funcion':     fn,
                'canal':       canal,
                'show_inicio': show_i,
                'show_fin':    show_f,
                'empleado':    c2.strip(),
                'ingreso':     ingreso,
                'egreso':      egreso,
                'tipo':        'trabajo',
            })

    return turnos


def fetch_semana_csv(semana_num):
    """Descarga el CSV de una pestaña de la Google Sheet pública."""
    tab = f'HORARIOS SC 2026 - S#{semana_num}'
    url = (
        f'https://docs.google.com/spreadsheets/d/{SHEET_ID}'
        f'/gviz/tq?tqx=out:csv&sheet={requests.utils.quote(tab)}'
    )
    r = requests.get(url, timeout=15)
    if r.status_code != 200 or len(r.text) < 100:
        return None
    return r.text


def fetch_semana_v2_csv(semana_num=None):
    """Descarga el CSV del sheet alternativo. Busca pestaña 'HORARIOS 2026 - SEMANA #N'."""
    base = f'https://docs.google.com/spreadsheets/d/{SHEET_ID_V2}/gviz/tq?tqx=out:csv'
    if semana_num is not None:
        tab = f'HORARIOS 2026 - SEMANA #{semana_num}'
        url = base + '&sheet=' + requests.utils.quote(tab)
        r = requests.get(url, timeout=15)
        if r.status_code == 200 and len(r.text) > 100:
            return r.text
    # Fallback: primera pestaña
    r = requests.get(base, timeout=15)
    if r.status_code != 200 or len(r.text) < 100:
        return None
    return r.text


def _detect_canal_v2(text):
    t = text.strip().upper()
    for key, val in CANAL_DETECT_V2:
        if t.startswith(key):
            return val
    return None


def parse_semana_v2(year, semana_num, raw_csv):
    """
    Parser para el formato alternativo donde:
      col0: vacío | col1: sección (AIRE/EDICION/ZOCALOS) | col2+: datos por día
    Cada día ocupa 4 columnas: show_time, work_time, empleado, separador.
    Los canales aparecen como filas intermedias con el nombre del canal en col2.
    """
    monday = semana_start_date(year, semana_num)
    day_dates = [monday + timedelta(days=i) for i in range(7)]

    df = pd.read_csv(StringIO(raw_csv), header=None, dtype=str).fillna('--')
    rows = df.values.tolist()

    DATA_START = 2
    DAY_NAMES_UP = {'LUNES', 'MARTES', 'MIERCOLES', 'MIÉRCOLES',
                    'JUEVES', 'VIERNES', 'SABADO', 'SÁBADO', 'DOMINGO'}
    SKIP_TASKS = {'SC NEXT', 'TDC', 'NDC', 'TDC', 'NDC'}

    current_funcion   = 'AIRE'
    current_canal     = 'ESPN'
    current_task_fn   = None   # función activa para secciones tipo PLACAS (tarea en col1)
    current_absence_fn = None  # sección de ausencia activa (OFF/COMPENSATORIO/VACACION)
    turnos = []

    for raw_row in rows:
        row = [str(v).strip() for v in raw_row] + ['--'] * 40
        col1    = row[1]
        col2    = row[2]
        col1_up = col1.upper()
        col2_up = col2.upper()

        # Saltar filas de encabezado de días
        if col2_up.rstrip() in DAY_NAMES_UP:
            continue

        # Fila de canal: col2 = nombre de canal, col3 vacío/HORARIO/PAUTA
        canal_det = _detect_canal_v2(col2)
        if canal_det and row[3].upper() in ('', '--', 'HORARIO', 'PAUTA', 'NAN'):
            current_canal = canal_det
            current_task_fn = None
            current_absence_fn = None
            continue

        # Sección: col1 = AIRE / EDICION / ZOCALOS → resetea contexto de tarea
        if col1_up in ('AIRE', 'EDICION', 'ZOCALOS'):
            current_funcion = col1_up
            current_task_fn = None
            current_absence_fn = None
        # Tarea de sección: col1 = PLACAS / TEXTOS / CONTENIDOS (identificador en col1, no col2)
        elif col1_up in TASK_TO_FUNCION:
            current_task_fn = TASK_TO_FUNCION[col1_up]
            current_absence_fn = None

        # Sección de ausencia: identificador en c0 del primer día (no en col1)
        # Ej: row[DATA_START] = 'OFF' / 'COMPENSATORIO' / 'VACACIONES'
        c0_day0 = row[DATA_START].strip().upper()
        if c0_day0 in ABSENCE_SECTIONS:
            current_absence_fn = ABSENCE_SECTIONS[c0_day0]
            current_task_fn = None
            continue  # fila de encabezado: sin empleados, solo marca de sección

        # Procesar cada día
        for di in range(7):
            off = DATA_START + di * 4
            c0 = row[off]       # show_time o tipo de tarea
            c1 = row[off + 1]   # work_time
            c2 = row[off + 2]   # empleado

            if c2 in ('--', '', 'nan') or c2.upper() in ('PAUTA', 'HORARIO'):
                continue

            c0_up = c0.upper().rstrip()

            if c0_up in SKIP_TASKS:
                continue
            elif c0_up.startswith('CONTENIDOS'):
                fn, canal = 'CONTENIDOS', ''
                show_i = show_f = ''
                ingreso, egreso = _parse_time_range(c1)
            elif c0_up.startswith('PLACAS'):
                fn, canal = 'PLACAS', ''
                show_i = show_f = ''
                ingreso, egreso = _parse_time_range(c1)
            elif c0_up.startswith('UX'):
                fn, canal = 'TEXTOS', c0
                show_i = show_f = ''
                ingreso, egreso = _parse_time_range(c1)
            elif re.match(r'^NC\d+', c0_up):
                fn, canal = 'EDICION', c0
                show_i = show_f = ''
                ingreso, egreso = _parse_time_range(c1)
            elif re.search(r'\d{1,2}:\d{2}', c0):
                fn    = current_funcion
                canal = current_canal
                show_i, show_f = _parse_time_range(c0)
                ingreso, egreso = _parse_time_range(c1)
            elif c0 in ('--', '', 'nan') and current_task_fn and re.search(r'\d{1,2}:\d{2}', c1):
                # Fila de continuación: c0 vacío, c1=work_time, c2=empleado.
                # Ocurre en PLACAS donde el identificador está en col1 de la fila
                # y las filas de continuación no repiten el identificador en c0.
                fn, canal = current_task_fn, ''
                show_i = show_f = ''
                ingreso, egreso = _parse_time_range(c1)
            elif current_absence_fn:
                # Fila de ausencia (OFF / COMPENSATORIO / VACACION): solo nombre, sin horario
                ingreso, egreso = _parse_time_range(c1) if c1 not in ('--', '', 'nan') else ('', '')
                turnos.append({
                    'fecha':       day_dates[di].isoformat(),
                    'semana':      semana_num,
                    'funcion':     current_absence_fn,
                    'canal':       '',
                    'show_inicio': '',
                    'show_fin':    '',
                    'empleado':    c2.strip(),
                    'ingreso':     ingreso,
                    'egreso':      egreso,
                    'tipo':        'libre',
                })
                continue
            else:
                continue

            turnos.append({
                'fecha':       day_dates[di].isoformat(),
                'semana':      semana_num,
                'funcion':     fn,
                'canal':       canal,
                'show_inicio': show_i,
                'show_fin':    show_f,
                'empleado':    c2.strip(),
                'ingreso':     ingreso,
                'egreso':      egreso,
                'tipo':        'trabajo',
            })


    return turnos


def import_from_gsheets(db, year, weeks):
    """
    Importa semanas desde la Google Sheet a la DB.
    Retorna dict con estadísticas.
    """
    stats = {
        'turnos':          0,
        'semanas':         0,
        'empleados_nuevos': 0,
        'errores':         [],
    }

    # Mapa nombre→id de empleados (en mayúsculas para matching)
    emp_map = {
        r['nombre'].upper().strip(): r['id']
        for r in db.execute("SELECT id, nombre FROM empleados").fetchall()
    }

    for semana_num in weeks:
        try:
            csv_text = fetch_semana_csv(semana_num)
            turnos = parse_semana(year, semana_num, csv_text) if csv_text else []

            # Si el sheet principal devolvió muy pocos turnos (formato incorrecto),
            # intentar con el sheet alternativo v2
            if len(turnos) < 10:
                csv_v2 = fetch_semana_v2_csv(semana_num)
                if csv_v2:
                    turnos_v2 = parse_semana_v2(year, semana_num, csv_v2)
                    if len(turnos_v2) > len(turnos):
                        turnos = turnos_v2
        except Exception as e:
            stats['errores'].append(f'SEMANA {semana_num}: {e}')
            continue

        if not turnos:
            continue

        # Borrar turnos existentes de esa semana
        monday = semana_start_date(year, semana_num)
        for i in range(7):
            db.execute(
                "DELETE FROM turnos WHERE fecha=?",
                ((monday + timedelta(days=i)).isoformat(),)
            )

        for t in turnos:
            emp_key = t['empleado'].upper().strip()
            emp_id  = emp_map.get(emp_key)

            if not emp_id:
                # Búsqueda parcial
                for k, v in emp_map.items():
                    if emp_key in k or k in emp_key:
                        emp_id = v
                        break

            if not emp_id:
                # Crear empleado nuevo
                db.execute(
                    "INSERT INTO empleados (nombre, funcion) VALUES (?,?)",
                    (t['empleado'], t['funcion'])
                )
                emp_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
                emp_map[emp_key] = emp_id
                stats['empleados_nuevos'] += 1

            db.execute(
                """INSERT INTO turnos
                   (fecha, semana, empleado_id, tipo, funcion, canal,
                    show_inicio, show_fin, ingreso, egreso)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (t['fecha'], t['semana'], emp_id, t['tipo'],
                 t['funcion'], t['canal'],
                 t['show_inicio'], t['show_fin'],
                 t['ingreso'], t['egreso'])
            )
            stats['turnos'] += 1

        db.commit()
        stats['semanas'] += 1

    return stats
