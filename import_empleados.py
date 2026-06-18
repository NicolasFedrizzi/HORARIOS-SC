import pandas as pd
from db import get_db, init_db

EXCEL_PATH = '/Users/nicolas.m.fedrizzi/Desktop/borrdor horarios.xlsx'

init_db()
df = pd.read_excel(EXCEL_PATH, sheet_name='DATOS', header=None)

db = get_db()
count = 0
for _, row in df.iterrows():
    num = row[0]
    if pd.notna(num) and str(num).replace('.0', '').isdigit():
        nombre = str(row[1]).strip()
        funcion = str(row[2]).strip() if pd.notna(row[2]) else ''
        empresa = str(row[4]).strip() if pd.notna(row[4]) else ''
        if funcion in ('nan', 'NaN'): funcion = ''
        if empresa in ('nan', 'NaN'): empresa = ''

        existing = db.execute("SELECT id FROM empleados WHERE nombre=?", (nombre,)).fetchone()
        if not existing:
            db.execute("INSERT INTO empleados (nombre, funcion, empresa) VALUES (?,?,?)", (nombre, funcion, empresa))
            count += 1
            print(f"  + {nombre}")
        else:
            print(f"  ~ ya existe: {nombre}")

db.commit()
db.close()
print(f"\nImportados: {count} empleados")
