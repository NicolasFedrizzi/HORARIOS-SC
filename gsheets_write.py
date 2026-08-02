"""
Módulo para modificar la Google Sheet de horarios.
Permite mover empleados a secciones de ausencia (FRANCO, VACACIONES, COMPENSATORIO, OFF).
"""
import os
import json
import re
import gspread
from google.oauth2.service_account import Credentials

SHEET_ID_V3 = '1YV5tyWpZ_0D1m09NmgRSfy2pDaUfZmF0'

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

    changes = []

    for dia_raw in dias:
        di = DAY_INDEX.get(dia_raw.lower().strip())
        if di is None:
            changes.append({'dia': dia_raw, 'ok': False, 'msg': 'Día no reconocido'})
            continue

        emp_col = di * COLS_PER_DAY + 2  # columna del empleado para este día (0-indexed)

        # ── 1. Borrar de la sección de trabajo ──────────────────────────────
        removed_from = None
        for row_idx, row in enumerate(all_values):
            if emp_col < len(row):
                cell_val = row[emp_col].strip().upper()
                if cell_val == emp_upper:
                    # Verificar que no sea una fila de ausencia (evitar quitar de la sección correcta)
                    c0 = row[0].strip().upper() if row else ''
                    if c0 in ('FRANCO', 'VACACIONES', 'VACACION', 'OFF',
                              'COMPENSATORIO', 'COMPENSATORIOS', 'DIAS COMPENSATORIOS'):
                        continue
                    # Borrar la celda (row_idx y emp_col son 0-indexed, gspread usa 1-indexed)
                    ws.update_cell(row_idx + 1, emp_col + 1, '')
                    removed_from = row_idx + 1
                    break

        # ── 2. Agregar en la sección de ausencia ────────────────────────────
        placed_at = None
        in_section = False
        for row_idx, row in enumerate(all_values):
            c0 = row[0].strip().upper() if row else ''
            # Detectar inicio de la sección
            if c0 == section_label:
                in_section = True
            # Si estamos en la sección: buscar la primera celda vacía del día
            if in_section and c0 in (section_label, ''):
                if emp_col >= len(row) or not row[emp_col].strip():
                    ws.update_cell(row_idx + 1, emp_col + 1, empleado_name.strip().upper())
                    placed_at = row_idx + 1
                    # Refrescar all_values para que las siguientes iteraciones vean el cambio
                    all_values[row_idx][emp_col] = empleado_name.strip().upper()
                    break
            # Salir si llegamos a otra sección diferente
            elif in_section and c0 not in (section_label, ''):
                break

        changes.append({
            'dia':          dia_raw,
            'empleado':     emp_upper,
            'absence_type': section_label,
            'removed_row':  removed_from,
            'placed_row':   placed_at,
            'ok':           placed_at is not None,
            'msg':          'OK' if placed_at else 'No se encontró fila libre en la sección',
        })

    return {'semana': semana_num, 'changes': changes}
