"""
Módulo para modificar la Google Sheet de horarios.
Permite mover empleados a secciones de ausencia (FRANCO, VACACIONES, COMPENSATORIO, OFF).
"""
import os
import json
import re
from datetime import date, timedelta
import gspread
from google.oauth2.service_account import Credentials

MONTHS_ES = {
    1: 'ENERO', 2: 'FEBRERO', 3: 'MARZO', 4: 'ABRIL',
    5: 'MAYO', 6: 'JUNIO', 7: 'JULIO', 8: 'AGOSTO',
    9: 'SEPTIEMBRE', 10: 'OCTUBRE', 11: 'NOVIEMBRE', 12: 'DICIEMBRE',
}

# En v2b (4 cols/día) los encabezados de días están en estas columnas (0-indexed)
DAY_NAMES_V2B = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO']
DAY_COLS_V2B  = [0, 4, 8, 12, 16, 20, 24]
TOTAL_COLS_V2B = 27

SHEET_ID_V3 = '1fE-3M8n9DvlUaNZVFYit-mq-oAQAP4Yxy7DM1L5lKyg'

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
]

ABSENCE_SECTION_LABELS = {
    'FRANCO':        'FRANCO',
    'VACACION':      'VACACIONES',
    'VACACIONES':    'VACACIONES',
    'COMPENSATORIO': 'DIAS COMPENSATORIOS',
    'OFF':           'OFF',
}

DAY_INDEX = {
    'lunes':     0,
    'martes':    1,
    'miercoles': 2,
    'miércoles': 2,
    'jueves':    3,
    'viernes':   4,
    'sabado':    5,
    'sábado':    5,
    'domingo':   6,
}

COLS_PER_DAY = 4  # show_time, work_time, empleado, sep


def _get_client():
    creds_json = os.environ.get('GOOGLE_SHEETS_CREDENTIALS')
    if not creds_json:
        raise RuntimeError('GOOGLE_SHEETS_CREDENTIALS no configurado')
    info = json.loads(creds_json)
    creds = Credentials.from_service_account_info(info, scopes=SCOPES)
    return gspread.authorize(creds)


def _tab_name(semana_num):
    return f'HORARIO SC 2026 - S#{semana_num}'


def move_to_absence(semana_num, empleado_name, dias, absence_type):
    """
    Para cada día en `dias` (lista de strings como 'lunes', 'martes', ...):
      1. Busca el nombre del empleado en la sección de trabajo y lo borra de esa celda.
      2. Lo agrega en la primera fila vacía de la sección de ausencia correspondiente.

    Parámetros:
      semana_num   : int  (ej: 32)
      empleado_name: str  (ej: 'JUAN PEREZ')
      dias         : list de str (ej: ['lunes', 'martes'])
      absence_type : str  (ej: 'VACACION', 'FRANCO', 'COMPENSATORIO', 'OFF')

    Retorna dict con resumen de cambios.
    """
    gc = _get_client()
    sh = gc.open_by_key(SHEET_ID_V3)
    ws = sh.worksheet(_tab_name(semana_num))

    all_values = ws.get_all_values()
    emp_upper  = empleado_name.strip().upper()
    section_label = ABSENCE_SECTION_LABELS.get(absence_type.upper(), absence_type.upper())

    ABSENCE_HEADERS = {'FRANCO', 'VACACIONES', 'VACACION', 'OFF',
                       'COMPENSATORIO', 'COMPENSATORIOS', 'DIAS COMPENSATORIOS'}

    changes = []

    for dia_raw in dias:
        di = DAY_INDEX.get(dia_raw.lower().strip())
        if di is None:
            changes.append({'dia': dia_raw, 'ok': False, 'msg': 'Día no reconocido'})
            continue

        emp_col = di * COLS_PER_DAY + 2  # columna del empleado para este día (0-indexed)

        # ── 1. Borrar TODAS las ocurrencias en filas de trabajo ──────────────
        removed_rows = []
        for row_idx, row in enumerate(all_values):
            if emp_col < len(row) and row[emp_col].strip().upper() == emp_upper:
                c0 = row[0].strip().upper() if row else ''
                if c0 in ABSENCE_HEADERS:
                    continue  # no tocar filas de ausencia
                a1 = gspread.utils.rowcol_to_a1(row_idx + 1, emp_col + 1)
                ws.update_cell(row_idx + 1, emp_col + 1, '')
                # Limpiar color de fondo de la celda
                ws.format(a1, {
                    'backgroundColor': {'red': 1.0, 'green': 1.0, 'blue': 1.0, 'alpha': 1.0}
                })
                all_values[row_idx][emp_col] = ''
                removed_rows.append(row_idx + 1)

        # ── 2. Agregar en la primera fila vacía DEBAJO del header de ausencia ─
        placed_at = None
        in_section = False
        for row_idx, row in enumerate(all_values):
            c0 = row[0].strip().upper() if row else ''
            if c0 == section_label:
                in_section = True
                continue  # saltar la fila del header; colocar en las de abajo
            if in_section:
                if c0 != '':  # llegamos a otra sección
                    break
                if emp_col >= len(row) or not row[emp_col].strip():
                    ws.update_cell(row_idx + 1, emp_col + 1, empleado_name.strip().upper())
                    placed_at = row_idx + 1
                    all_values[row_idx][emp_col] = empleado_name.strip().upper()
                    break

        changes.append({
            'dia':          dia_raw,
            'empleado':     emp_upper,
            'absence_type': section_label,
            'removed_rows': removed_rows,
            'placed_row':   placed_at,
            'ok':           placed_at is not None,
            'msg':          'OK' if placed_at else 'No se encontró fila libre en la sección',
        })

    return {'semana': semana_num, 'changes': changes}


def setup_week_tabs(start_week=32, end_week=52, year=2026, template_week=34):
    """
    Para cada semana de start_week a end_week:
      - Si la pestaña existe: actualiza la fila 1 con los días fechados
        (ej: 'LUNES 3 DE AGOSTO').
      - Si no existe: duplica la pestaña template_week y actualiza los encabezados.
    Retorna lista de resultados por semana.
    """
    gc = _get_client()
    sh = gc.open_by_key(SHEET_ID_V3)

    worksheets = sh.worksheets()
    existing = {ws.title: ws for ws in worksheets}

    # Buscar la pestaña template
    template_name = _tab_name(template_week)
    if template_name not in existing:
        raise RuntimeError(f'Pestaña template "{template_name}" no existe')
    template_id = existing[template_name].id

    results = []

    for week in range(start_week, end_week + 1):
        tab_name = _tab_name(week)
        monday = date.fromisocalendar(year, week, 1)

        # Construir los 7 labels con fecha
        labels = []
        for di, name in enumerate(DAY_NAMES_V2B):
            d = monday + timedelta(days=di)
            month_name = MONTHS_ES[d.month]
            label = f'{name} {d.day} DE {month_name}'
            if name == 'DOMINGO':
                label += ' / ESPN'
            labels.append(label)

        if tab_name in existing:
            ws = existing[tab_name]
            action = 'updated'
        else:
            # Duplicar la pestaña template
            ws = sh.duplicate_sheet(
                source_sheet_id=template_id,
                new_sheet_name=tab_name,
            )
            action = 'created (copy of S#{})'.format(template_week)

        # Actualizar solo las celdas de nombre de día en fila 1
        batch = []
        for col_idx, label in zip(DAY_COLS_V2B, labels):
            a1 = gspread.utils.rowcol_to_a1(1, col_idx + 1)
            batch.append({'range': a1, 'values': [[label]]})
        ws.batch_update(batch)

        results.append({
            'semana': week,
            'tab':    tab_name,
            'monday': monday.isoformat(),
            'action': action,
            'labels': labels,
        })

    return results
