"""¿Ayuda o estorba usar las estaciones de tráfico como nodos de interpolación?

Es el experimento que respalda `exclude_name_pattern` en `etl/config.py`. Se
evalúa sobre las MISMAS 19 estaciones de fondo en los dos escenarios; lo único
que cambia es si CEN-TRAF y SUR-TRAF están disponibles como predictoras. Medir
sobre conjuntos objetivo distintos daría una mejora ficticia, porque las de
tráfico son justamente las más difíciles de predecir.

    python scripts/experimento_trafico.py

Tarda ~1 min. Resultado (250 horas, semilla 7): excluirlas baja el MAE un
22,7 % en linear, 32,3 % en cubic y 23,3 % en nearest, y elimina el sesgo
sistemático hacia arriba.
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from etl.sources import FileSource
from etl.clean import clean
from etl.impute import impute
from etl.config import CONFIG
from etl.interpolate import _project
from scipy.interpolate import griddata

TRAFICO = (12, 48)          # CEN-TRAF, SUR-TRAF
METODOS = ("linear", "cubic", "nearest")
N_HORAS = 250
rng = np.random.default_rng(7)

obs, est = FileSource(config=CONFIG).fetch()
valores, _motivos, _rep = clean(obs, CONFIG)
imputado, _m, _r = impute(valores, est, CONFIG)
media24 = imputado.rolling(window=24, min_periods=18).mean()

meta = est.set_index("codigo_serial").reindex(media24.columns)
lat = meta["latitud"].to_numpy(float); lon = meta["longitud"].to_numpy(float)
nombres = meta["nombre_corto"].tolist()
seriales = list(media24.columns)
P = _project(lat, lon, float(np.mean(lat)))

es_trafico = np.array([s in TRAFICO for s in seriales])
print(f"Estaciones de tráfico: {[n for n, t in zip(nombres, es_trafico) if t]}")
print(f"Objetivos evaluados: {int((~es_trafico).sum())} estaciones de fondo\n")

filas = media24.index[media24.notna().sum(axis=1) == len(seriales)]
horas = rng.choice(len(filas), size=min(N_HORAS, len(filas)), replace=False)
print(f"Horas evaluadas: {len(horas)} (elegidas al azar entre {len(filas)} con datos completos)\n")

err = {m: {"con": [], "sin": []} for m in METODOS}
for h in horas:
    v = media24.loc[filas[h]].to_numpy(float)
    for i in range(len(seriales)):
        if es_trafico[i]:
            continue                      # solo se evalúan estaciones de fondo
        for metodo in METODOS:
            for escenario, permitidas in (("con", ~es_trafico | True), ("sin", ~es_trafico)):
                usar = permitidas.copy(); usar[i] = False
                if usar.sum() < 4:
                    continue
                z = griddata(P[usar], v[usar], P[i:i+1], method=metodo)
                if np.isfinite(z[0]):
                    err[metodo][escenario].append(float(z[0]) - v[i])

print(f"{'método':<9} {'escenario':<26} {'n':>7} {'MAE':>7} {'RMSE':>7} {'sesgo':>7}")
print("-" * 68)
for metodo in METODOS:
    for escenario, etiqueta in (("con", "CON estaciones de tráfico"), ("sin", "SIN estaciones de tráfico")):
        e = np.array(err[metodo][escenario])
        if e.size == 0:
            continue
        print(f"{metodo:<9} {etiqueta:<26} {e.size:>7} {np.mean(np.abs(e)):>7.3f} "
              f"{np.sqrt(np.mean(e**2)):>7.3f} {np.mean(e):>7.3f}")
    a = np.array(err[metodo]["con"]); b = np.array(err[metodo]["sin"])
    if a.size and b.size:
        mejora = (np.mean(np.abs(a)) - np.mean(np.abs(b))) / np.mean(np.abs(a)) * 100
        print(f"{'':<9} {'-> excluirlas cambia el MAE en':<26} {mejora:>6.1f} %\n")
