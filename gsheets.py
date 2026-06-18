"""
Parser para leer la Google Sheet de horarios.
Estructura: cada pestaña = SEMANA N (ej: "SEMANA 1", "SEMANA 2"...)
Cada semana: 7 días × 4 columnas (show, turno, empleado, "--")
"""
import re
import requests
import pandas as pd
from io import StringIO
from datetime import date, timedelta

SHEET_ID = '117ohb5_Aku95LYRqWGl5cCwZpUcGx45sL8rzl_1Nutg'

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

    current_funcion = 'AIRE'
    current_canal   = 'ESPN'
    turnos = []

    for raw_row in rows:
        # Rellenar a 30 columnas
        row = [str(v).strip() for v in raw_row] + ['--'] * 30

        col0 = row[0]
        col2 = row[2]   # 3er col del día 1 → sirve para detectar ZOCALOS en header

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
            off = di * 4
            c0 = row[off]       # show time o tipo de tarea
            c1 = row[off + 1]   # turno de trabajo
            c2 = row[off + 2]   # empleado

            # Sin empleado → saltar
            if c2 in ('--', '', 'nan') or c2.upper() in ('PAUTA', 'HORARIO'):
                continue

            c0_up = c0.upper()

            # Detectar función por el valor de c0
            if c0_up in TASK_TO_FUNCION:
                fn    = TASK_TO_FUNCION[c0_up]
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
    tab = f'SEMANA {semana_num}'
    url = (
        f'https://docs.google.com/spreadsheets/d/{SHEET_ID}'
        f'/gviz/tq?tqx=out:csv&sheet={requests.utils.quote(tab)}'
    )
    r = requests.get(url, timeout=15)
    if r.status_code != 200 or len(r.text) < 100:
        return None
    return r.text


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
            if csv_text is None:
                continue   # pestaña no existe o vacía

            turnos = parse_semana(year, semana_num, csv_text)
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
