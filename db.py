import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'horarios.db')

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    db = get_db()
    db.executescript('''
        CREATE TABLE IF NOT EXISTS empleados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            funcion TEXT DEFAULT '',
            empresa TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS feriados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL UNIQUE,
            descripcion TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS turnos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL,
            semana INTEGER,
            empleado_id INTEGER NOT NULL,
            tipo TEXT NOT NULL DEFAULT 'trabajo',
            funcion TEXT DEFAULT '',
            canal TEXT DEFAULT '',
            show_inicio TEXT DEFAULT '',
            show_fin TEXT DEFAULT '',
            ingreso TEXT DEFAULT '',
            egreso TEXT DEFAULT '',
            FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS comp_usados (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            empleado_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            descripcion TEXT DEFAULT '',
            FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE
        );
    ''')
    db.commit()
    db.close()

def time_diff_hours(t1, t2):
    """Hours between two HH:MM strings, handles overnight."""
    try:
        h1, m1 = map(int, t1.split(':'))
        h2, m2 = map(int, t2.split(':'))
        mins = (h2 * 60 + m2) - (h1 * 60 + m1)
        if mins < 0:
            mins += 24 * 60
        return mins / 60
    except Exception:
        return 0

def get_stats(empleado_id, year=None):
    db = get_db()
    year_filter = " AND strftime('%Y', t.fecha) = ?" if year else ""
    params_base = [empleado_id] + ([str(year)] if year else [])

    dias_trabajo = db.execute(
        f"SELECT COUNT(*) as c FROM turnos t WHERE t.empleado_id=? AND t.tipo='trabajo'{year_filter}",
        params_base
    ).fetchone()['c']

    dias_libres = db.execute(
        f"SELECT COUNT(*) as c FROM turnos t WHERE t.empleado_id=? AND t.tipo='libre'{year_filter}",
        params_base
    ).fetchone()['c']

    feriados_trabajados = db.execute(
        f"""SELECT COUNT(*) as c FROM turnos t
            JOIN feriados f ON t.fecha = f.fecha
            WHERE t.empleado_id=? AND t.tipo='trabajo'{year_filter}""",
        params_base
    ).fetchone()['c']

    shifts = db.execute(
        f"SELECT ingreso, egreso FROM turnos t WHERE t.empleado_id=? AND t.tipo='trabajo' AND ingreso!='' AND egreso!=''{year_filter}",
        params_base
    ).fetchall()

    horas_extra = sum(
        max(0, time_diff_hours(s['ingreso'], s['egreso']) - 8)
        for s in shifts
    )

    comp_params = [empleado_id] + ([str(year)] if year else [])
    comp_year_filter = " AND strftime('%Y', fecha) = ?" if year else ""
    comp_usados = db.execute(
        f"SELECT COUNT(*) as c FROM comp_usados WHERE empleado_id=?{comp_year_filter}",
        comp_params
    ).fetchone()['c']

    db.close()
    return {
        'dias_trabajados': dias_trabajo,
        'dias_libres': dias_libres,
        'feriados_trabajados': feriados_trabajados,
        'horas_extras': round(horas_extra, 1),
        'francos_disponibles': feriados_trabajados - comp_usados,
        'comp_usados': comp_usados,
    }
