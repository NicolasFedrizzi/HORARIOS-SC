from flask import Flask, jsonify, render_template, request, send_file
from datetime import date, timedelta
import sqlite3
import os
import threading
import pandas as pd
from db import get_db, init_db, get_stats
from gsheets import import_from_gsheets, fetch_semana_csv

EXCEL_PATH = os.path.join(os.path.dirname(__file__), 'horarios_data.xlsx')

app = Flask(__name__)

CANALES = ['ESPN', 'ESPN 2/ESPN3', 'CHI', 'COL', 'CAM', 'REGIONES']
FUNCIONES = ['AIRE', 'EDICION', 'ZOCALOS', 'PLACAS', 'TEXTOS', 'CONTENIDOS']

def iso_week_dates(year, week):
    """Return (monday, sunday) for ISO year+week."""
    jan4 = date(year, 1, 4)
    monday = jan4 + timedelta(weeks=week - 1, days=-jan4.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday

def row_to_dict(row):
    return dict(row)

# ── PAGES ──────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

# ── EMPLEADOS ──────────────────────────────────────────────────────────────────

@app.route('/api/empleados', methods=['GET'])
def api_get_empleados():
    db = get_db()
    rows = db.execute("SELECT * FROM empleados ORDER BY nombre").fetchall()
    db.close()
    return jsonify([row_to_dict(r) for r in rows])

@app.route('/api/empleados', methods=['POST'])
def api_add_empleado():
    data = request.json
    db = get_db()
    cur = db.execute(
        "INSERT INTO empleados (nombre, funcion, empresa) VALUES (?,?,?)",
        (data['nombre'].strip(), data.get('funcion',''), data.get('empresa',''))
    )
    db.commit()
    new_id = cur.lastrowid
    emp = db.execute("SELECT * FROM empleados WHERE id=?", (new_id,)).fetchone()
    db.close()
    return jsonify(row_to_dict(emp)), 201

@app.route('/api/empleados/<int:eid>', methods=['PUT'])
def api_update_empleado(eid):
    data = request.json
    db = get_db()
    db.execute(
        "UPDATE empleados SET nombre=?, funcion=?, empresa=? WHERE id=?",
        (data['nombre'].strip(), data.get('funcion',''), data.get('empresa',''), eid)
    )
    db.commit()
    emp = db.execute("SELECT * FROM empleados WHERE id=?", (eid,)).fetchone()
    db.close()
    return jsonify(row_to_dict(emp))

@app.route('/api/empleados/<int:eid>', methods=['DELETE'])
def api_delete_empleado(eid):
    db = get_db()
    db.execute("DELETE FROM empleados WHERE id=?", (eid,))
    db.commit()
    db.close()
    return jsonify({'ok': True})

@app.route('/api/empleados/<int:eid>/stats')
def api_empleado_stats(eid):
    year = request.args.get('year', type=int)
    stats = get_stats(eid, year)
    db = get_db()
    emp = db.execute("SELECT * FROM empleados WHERE id=?", (eid,)).fetchone()
    # Per week breakdown
    weeks = db.execute(
        "SELECT DISTINCT semana, strftime('%Y', fecha) as year FROM turnos WHERE empleado_id=? AND semana IS NOT NULL ORDER BY year, semana",
        (eid,)
    ).fetchall()
    db.close()
    return jsonify({**stats, 'empleado': row_to_dict(emp), 'semanas': [row_to_dict(w) for w in weeks]})

# ── FERIADOS ───────────────────────────────────────────────────────────────────

@app.route('/api/feriados', methods=['GET'])
def api_get_feriados():
    db = get_db()
    rows = db.execute("SELECT * FROM feriados ORDER BY fecha").fetchall()
    db.close()
    return jsonify([row_to_dict(r) for r in rows])

@app.route('/api/feriados', methods=['POST'])
def api_add_feriado():
    data = request.json
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO feriados (fecha, descripcion) VALUES (?,?)",
            (data['fecha'], data.get('descripcion',''))
        )
        db.commit()
        row = db.execute("SELECT * FROM feriados WHERE id=?", (cur.lastrowid,)).fetchone()
        db.close()
        return jsonify(row_to_dict(row)), 201
    except sqlite3.IntegrityError:
        db.close()
        return jsonify({'error': 'Feriado ya existe'}), 409

@app.route('/api/feriados/<int:fid>', methods=['DELETE'])
def api_delete_feriado(fid):
    db = get_db()
    db.execute("DELETE FROM feriados WHERE id=?", (fid,))
    db.commit()
    db.close()
    return jsonify({'ok': True})

# ── SEMANA ─────────────────────────────────────────────────────────────────────

@app.route('/api/semana/<int:year>/<int:week>')
def api_semana(year, week):
    monday, sunday = iso_week_dates(year, week)
    dates = [monday + timedelta(days=i) for i in range(7)]
    date_strs = [d.isoformat() for d in dates]

    db = get_db()
    feriados = {r['fecha'] for r in db.execute("SELECT fecha FROM feriados").fetchall()}
    turnos = db.execute(
        "SELECT t.*, e.nombre as emp_nombre FROM turnos t JOIN empleados e ON t.empleado_id=e.id WHERE t.fecha IN ({})".format(
            ','.join('?' * 7)
        ),
        date_strs
    ).fetchall()

    days = []
    DAY_NAMES = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']
    for i, (d, ds) in enumerate(zip(dates, date_strs)):
        day_turnos = [row_to_dict(t) for t in turnos if t['fecha'] == ds]
        days.append({
            'fecha': ds,
            'dia_nombre': DAY_NAMES[i],
            'dia_num': d.day,
            'mes': d.month,
            'es_feriado': ds in feriados,
            'turnos': day_turnos,
        })

    db.close()
    return jsonify({'year': year, 'semana': week, 'dias': days})

# ── TURNOS ─────────────────────────────────────────────────────────────────────

@app.route('/api/turnos', methods=['POST'])
def api_add_turno():
    data = request.json
    fecha = data['fecha']
    # Calculate ISO week
    d = date.fromisoformat(fecha)
    iso = d.isocalendar()
    semana = iso[1]

    db = get_db()
    cur = db.execute(
        """INSERT INTO turnos (fecha, semana, empleado_id, tipo, funcion, canal, show_inicio, show_fin, ingreso, egreso)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (fecha, semana, data['empleado_id'], data.get('tipo','trabajo'),
         data.get('funcion',''), data.get('canal',''), data.get('show_inicio',''), data.get('show_fin',''),
         data.get('ingreso',''), data.get('egreso',''))
    )
    db.commit()
    row = db.execute(
        "SELECT t.*, e.nombre as emp_nombre FROM turnos t JOIN empleados e ON t.empleado_id=e.id WHERE t.id=?",
        (cur.lastrowid,)
    ).fetchone()
    db.close()
    return jsonify(row_to_dict(row)), 201

@app.route('/api/turnos/<int:tid>', methods=['PUT'])
def api_update_turno(tid):
    data = request.json
    db = get_db()
    db.execute(
        """UPDATE turnos SET empleado_id=?, tipo=?, funcion=?, canal=?, show_inicio=?, show_fin=?, ingreso=?, egreso=?
           WHERE id=?""",
        (data['empleado_id'], data.get('tipo','trabajo'),
         data.get('funcion',''), data.get('canal',''), data.get('show_inicio',''), data.get('show_fin',''),
         data.get('ingreso',''), data.get('egreso',''), tid)
    )
    db.commit()
    row = db.execute(
        "SELECT t.*, e.nombre as emp_nombre FROM turnos t JOIN empleados e ON t.empleado_id=e.id WHERE t.id=?",
        (tid,)
    ).fetchone()
    db.close()
    return jsonify(row_to_dict(row))

@app.route('/api/turnos/<int:tid>', methods=['DELETE'])
def api_delete_turno(tid):
    db = get_db()
    db.execute("DELETE FROM turnos WHERE id=?", (tid,))
    db.commit()
    db.close()
    return jsonify({'ok': True})

# ── COMPENSATORIOS ─────────────────────────────────────────────────────────────

@app.route('/api/compensatorios')
def api_compensatorios():
    year = request.args.get('year', type=int)
    db = get_db()
    empleados = db.execute("SELECT * FROM empleados ORDER BY nombre").fetchall()
    feriados = db.execute("SELECT * FROM feriados ORDER BY fecha").fetchall()
    db.close()

    result = []
    for emp in empleados:
        stats = get_stats(emp['id'], year)
        result.append({
            'empleado': row_to_dict(emp),
            **stats,
        })

    return jsonify({
        'feriados': [row_to_dict(f) for f in feriados],
        'empleados': result,
    })

@app.route('/api/comp_usados', methods=['POST'])
def api_add_comp_usado():
    data = request.json
    db = get_db()
    cur = db.execute(
        "INSERT INTO comp_usados (empleado_id, fecha, descripcion) VALUES (?,?,?)",
        (data['empleado_id'], data['fecha'], data.get('descripcion',''))
    )
    db.commit()
    row = db.execute("SELECT * FROM comp_usados WHERE id=?", (cur.lastrowid,)).fetchone()
    db.close()
    return jsonify(row_to_dict(row)), 201

@app.route('/api/comp_usados/<int:cid>', methods=['DELETE'])
def api_delete_comp_usado(cid):
    db = get_db()
    db.execute("DELETE FROM comp_usados WHERE id=?", (cid,))
    db.commit()
    db.close()
    return jsonify({'ok': True})

# ── REPETIR SEMANA ─────────────────────────────────────────────────────────────

@app.route('/api/semana/<int:year>/<int:week>/repetir', methods=['POST'])
def api_repetir_semana(year, week):
    """Copia todos los turnos de la semana dada a la semana siguiente (o a dest_year/dest_week)."""
    data = request.json or {}
    dest_year = data.get('dest_year', year)
    dest_week = data.get('dest_week', week + 1)

    # Normalizar si semana > 52
    if dest_week > 52:
        dest_week = 1
        dest_year += 1

    monday_src, _ = iso_week_dates(year, week)
    monday_dst, _ = iso_week_dates(dest_year, dest_week)
    delta = monday_dst - monday_src  # timedelta de 7 días normalmente

    db = get_db()
    turnos = db.execute(
        "SELECT * FROM turnos WHERE semana=? AND strftime('%Y', fecha)=?",
        (week, str(year))
    ).fetchall()

    copiados = 0
    omitidos = 0
    for t in turnos:
        nueva_fecha = (date.fromisoformat(t['fecha']) + delta).isoformat()
        # No sobreescribir si ya existe turno del mismo empleado en esa fecha+show
        existe = db.execute(
            "SELECT id FROM turnos WHERE fecha=? AND empleado_id=? AND show_inicio=? AND show_fin=?",
            (nueva_fecha, t['empleado_id'], t['show_inicio'], t['show_fin'])
        ).fetchone()
        if existe:
            omitidos += 1
            continue
        db.execute(
            """INSERT INTO turnos (fecha, semana, empleado_id, tipo, funcion, canal, show_inicio, show_fin, ingreso, egreso)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (nueva_fecha, dest_week, t['empleado_id'], t['tipo'], t['funcion'],
             t['canal'], t['show_inicio'], t['show_fin'], t['ingreso'], t['egreso'])
        )
        copiados += 1

    db.commit()
    db.close()
    return jsonify({'copiados': copiados, 'omitidos': omitidos, 'dest_year': dest_year, 'dest_week': dest_week})

@app.route('/api/canales')
def api_canales():
    return jsonify(CANALES)

@app.route('/api/funciones')
def api_funciones():
    return jsonify(FUNCIONES)

# ── EXCEL IMPORT / EXPORT ──────────────────────────────────────────────────────

@app.route('/api/excel/download')
def api_excel_download():
    if not os.path.exists(EXCEL_PATH):
        from create_template import create_template
        create_template()
    return send_file(EXCEL_PATH, as_attachment=True, download_name='horarios_data.xlsx')

@app.route('/api/excel/import', methods=['POST'])
def api_excel_import():
    file = request.files.get('file')
    if not file:
        return jsonify({'error': 'No se envió archivo'}), 400

    file.save(EXCEL_PATH)
    result = _import_from_excel()
    return jsonify(result)

@app.route('/api/excel/sync', methods=['POST'])
def api_excel_sync():
    """Re-import from the existing horarios_data.xlsx on disk."""
    if not os.path.exists(EXCEL_PATH):
        return jsonify({'error': 'No existe horarios_data.xlsx'}), 404
    result = _import_from_excel()
    return jsonify(result)

def _import_from_excel():
    db = get_db()
    stats = {'turnos': 0, 'empleados': 0, 'feriados': 0, 'errores': []}

    # ── EMPLEADOS
    try:
        df_emp = pd.read_excel(EXCEL_PATH, sheet_name='EMPLEADOS', header=0)
        df_emp.columns = [c.strip().upper() for c in df_emp.columns]
        for _, row in df_emp.iterrows():
            nombre = str(row.get('NOMBRE', '')).strip()
            if not nombre or nombre in ('nan', 'NaN'): continue
            funcion = str(row.get('FUNCION', '')).strip()
            empresa = str(row.get('EMPRESA', '')).strip()
            funcion = '' if funcion in ('nan','NaN') else funcion
            empresa = '' if empresa in ('nan','NaN') else empresa
            existing = db.execute("SELECT id FROM empleados WHERE nombre=?", (nombre,)).fetchone()
            if existing:
                db.execute("UPDATE empleados SET funcion=?, empresa=? WHERE nombre=?", (funcion, empresa, nombre))
            else:
                db.execute("INSERT INTO empleados (nombre, funcion, empresa) VALUES (?,?,?)", (nombre, funcion, empresa))
                stats['empleados'] += 1
    except Exception as e:
        stats['errores'].append(f'Empleados: {e}')

    # ── FERIADOS
    try:
        df_fer = pd.read_excel(EXCEL_PATH, sheet_name='FERIADOS', header=0)
        df_fer.columns = [c.strip().upper() for c in df_fer.columns]
        for _, row in df_fer.iterrows():
            fecha_raw = row.get('FECHA', '')
            if pd.isna(fecha_raw): continue
            try:
                fecha = pd.to_datetime(fecha_raw, dayfirst=True).strftime('%Y-%m-%d')
            except Exception:
                continue
            desc = str(row.get('DESCRIPCION', '')).strip()
            desc = '' if desc in ('nan','NaN') else desc
            try:
                db.execute("INSERT INTO feriados (fecha, descripcion) VALUES (?,?)", (fecha, desc))
                stats['feriados'] += 1
            except sqlite3.IntegrityError:
                pass  # already exists
    except Exception as e:
        stats['errores'].append(f'Feriados: {e}')

    # ── TURNOS
    try:
        df_t = pd.read_excel(EXCEL_PATH, sheet_name='TURNOS', header=1)  # row 2 is header
        df_t.columns = [c.strip().upper() for c in df_t.columns]

        emp_map = {r['nombre']: r['id'] for r in db.execute("SELECT id, nombre FROM empleados").fetchall()}

        for _, row in df_t.iterrows():
            empleado = str(row.get('EMPLEADO', '')).strip()
            fecha_raw = row.get('FECHA', '')
            if pd.isna(fecha_raw) or not empleado or empleado in ('nan','NaN'): continue

            try:
                fecha = pd.to_datetime(fecha_raw, dayfirst=True).strftime('%Y-%m-%d')
            except Exception:
                continue

            emp_id = emp_map.get(empleado)
            if not emp_id:
                # try partial match
                for k, v in emp_map.items():
                    if empleado.lower() in k.lower() or k.lower() in empleado.lower():
                        emp_id = v; break
            if not emp_id:
                stats['errores'].append(f'Empleado no encontrado: {empleado}')
                continue

            d = date.fromisoformat(fecha)
            semana = int(row.get('SEMANA', d.isocalendar()[1]))
            tipo = str(row.get('TIPO', 'trabajo')).strip().lower()
            if tipo in ('nan','NaN',''): tipo = 'trabajo'
            funcion = str(row.get('FUNCION', '')).strip(); funcion = '' if funcion in ('nan','NaN') else funcion
            canal = str(row.get('CANAL', '')).strip(); canal = '' if canal in ('nan','NaN') else canal

            def t(col):
                v = row.get(col, '')
                if pd.isna(v): return ''
                s = str(v).strip()
                return '' if s in ('nan','NaN') else s

            # Upsert: delete existing and re-insert if same date+empleado+show
            db.execute(
                "DELETE FROM turnos WHERE fecha=? AND empleado_id=? AND show_inicio=? AND show_fin=?",
                (fecha, emp_id, t('SHOW_INICIO'), t('SHOW_FIN'))
            )
            db.execute(
                """INSERT INTO turnos (fecha, semana, empleado_id, tipo, funcion, canal, show_inicio, show_fin, ingreso, egreso)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (fecha, semana, emp_id, tipo, funcion, canal,
                 t('SHOW_INICIO'), t('SHOW_FIN'), t('INGRESO'), t('EGRESO'))
            )
            stats['turnos'] += 1
    except Exception as e:
        stats['errores'].append(f'Turnos: {e}')

    db.commit()
    db.close()
    return stats


# ── GOOGLE SHEETS ──────────────────────────────────────────────────────────────

@app.route('/api/gsheets/status')
def api_gsheets_status():
    try:
        csv = fetch_semana_csv(1)
        ok = csv is not None and len(csv) > 100
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)})
    return jsonify({'ok': ok})

@app.route('/api/gsheets/sync', methods=['POST'])
def api_gsheets_sync():
    secret = os.environ.get('SYNC_SECRET')
    if secret:
        data_raw = request.get_json() or {}
        if data_raw.get('secret') != secret:
            return jsonify({'error': 'No autorizado'}), 403
    data  = request.get_json() or {}
    year  = int(data.get('year', date.today().year))
    weeks = data.get('weeks', list(range(1, 53)))
    if isinstance(weeks, str) and weeks == 'all':
        weeks = list(range(1, 53))

    db     = get_db()
    result = import_from_gsheets(db, year, weeks)
    db.close()
    return jsonify(result)


# ── INIT ───────────────────────────────────────────────────────────────────────

init_db()

def _auto_sync():
    """Al arrancar, sincroniza semana actual ± 2 si alguna de esas semanas no tiene datos."""
    try:
        today = date.today()
        current_week = today.isocalendar()[1]
        year = today.year
        weeks = [w for w in range(current_week - 2, current_week + 3) if 1 <= w <= 52]

        db = get_db()
        weeks_to_sync = []
        for w in weeks:
            count = db.execute(
                "SELECT COUNT(*) FROM turnos WHERE semana=? AND strftime('%Y', fecha)=?",
                (w, str(year))
            ).fetchone()[0]
            if count == 0:
                weeks_to_sync.append(w)
        db.close()

        if weeks_to_sync:
            db = get_db()
            import_from_gsheets(db, year, weeks_to_sync)
            db.close()
    except Exception:
        pass

threading.Thread(target=_auto_sync, daemon=True).start()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5050))
    app.run(debug=False, host='0.0.0.0', port=port)
