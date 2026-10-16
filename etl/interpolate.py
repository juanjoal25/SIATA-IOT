"""Interpolación espacial: de 21 estaciones a una malla continua del valle.

Se exponen los tres métodos que pide el requerimiento, todos vía
``scipy.interpolate.griddata``:

``nearest``
    Vecino más cercano (diagrama de Voronoi). Cubre toda la malla, no inventa
    valores intermedios y es discontinuo en las fronteras. Es el respaldo
    natural fuera del casco convexo de las estaciones.
``linear``
    Triangulación de Delaunay + interpolación baricéntrica. Continua, sin
    sobreoscilación, acotada por los valores de las estaciones vecinas. Es el
    método por defecto.
``cubic``
    Clough-Tocher C1. Superficie suave y con gradientes plausibles, pero puede
    sobrepasar el rango observado cerca de estaciones con contraste fuerte.

Nota geodésica: ``griddata`` trabaja en el plano. Antes de triangular se
escala la longitud por ``cos(lat_media)`` para que un grado en x y uno en y
midan lo mismo sobre el terreno; de lo contrario la triangulación se deforma.
"""

from __future__ import annotations

from typing import Any, Iterable

import numpy as np
from scipy.interpolate import griddata

from .config import CONFIG, Config


def _project(lat: np.ndarray, lon: np.ndarray, lat0: float) -> np.ndarray:
    """Proyección equirectangular local: (lon, lat) -> plano isométrico."""
    return np.column_stack([lon * np.cos(np.radians(lat0)), lat])


def build_mesh(config: Config = CONFIG) -> dict[str, Any]:
    """Malla regular del Valle de Aburrá definida en la configuración."""
    cfg = config.interpolation
    lats = np.arange(cfg.lat_min, cfg.lat_max + cfg.resolution_deg / 2, cfg.resolution_deg)
    lons = np.arange(cfg.lon_min, cfg.lon_max + cfg.resolution_deg / 2, cfg.resolution_deg)
    return {
        "lats": lats,
        "lons": lons,
        "nrows": int(lats.size),
        "ncols": int(lons.size),
        "resolution_deg": cfg.resolution_deg,
        "bbox": [cfg.lat_min, cfg.lon_min, cfg.lat_max, cfg.lon_max],
    }


def interpolate_field(
    lat_pts: np.ndarray,
    lon_pts: np.ndarray,
    values: np.ndarray,
    mesh: dict[str, Any],
    methods: Iterable[str] | None = None,
    config: Config = CONFIG,
) -> dict[str, np.ndarray]:
    """Interpola un campo escalar sobre la malla con cada método pedido.

    Devuelve ``{metodo: matriz (nrows, ncols)}``. ``linear`` y ``cubic``
    devuelven ``NaN`` fuera del casco convexo de las estaciones: esa ausencia
    es información y se conserva (el relleno se decide arriba, en el pipeline).
    """
    cfg = config.interpolation
    methods = tuple(methods or cfg.methods)

    validos = np.isfinite(values)
    if validos.sum() < 4:
        raise ValueError(
            f"Se requieren al menos 4 estaciones con dato para interpolar; hay {int(validos.sum())}."
        )
    lat_pts, lon_pts, values = lat_pts[validos], lon_pts[validos], values[validos]

    lat0 = float(np.mean(mesh["lats"]))
    puntos = _project(lat_pts, lon_pts, lat0)
    malla_lon, malla_lat = np.meshgrid(mesh["lons"], mesh["lats"])
    destino = _project(malla_lat.ravel(), malla_lon.ravel(), lat0)

    campos: dict[str, np.ndarray] = {}
    for metodo in methods:
        z = griddata(puntos, values, destino, method=metodo)
        campos[metodo] = np.asarray(z, dtype=float).reshape(malla_lat.shape)
    return campos


def fill_outside_hull(
    campos: dict[str, np.ndarray], fallback: str = "nearest"
) -> tuple[dict[str, np.ndarray], np.ndarray]:
    """Rellena con ``nearest`` los huecos de linear/cubic fuera del casco convexo.

    Devuelve los campos rellenados y la máscara de celdas extrapoladas, para que
    el frontend pueda advertir que ese punto está fuera de la cobertura real de
    la red de estaciones.
    """
    if fallback not in campos:
        return campos, np.zeros(next(iter(campos.values())).shape, dtype=bool)

    base = campos[fallback]
    extrapolado = np.zeros(base.shape, dtype=bool)
    salida: dict[str, np.ndarray] = {}
    for metodo, campo in campos.items():
        hueco = ~np.isfinite(campo)
        if metodo != fallback:
            extrapolado |= hueco
        salida[metodo] = np.where(hueco, base, campo)
    return salida, extrapolado


def cross_validate(
    lat_pts: np.ndarray,
    lon_pts: np.ndarray,
    values: np.ndarray,
    methods: Iterable[str] | None = None,
    config: Config = CONFIG,
) -> dict[str, Any]:
    """Validación cruzada dejando una estación fuera (LOOCV).

    Es la única forma honesta de comparar los tres métodos con estos datos: se
    esconde una estación, se interpola en su coordenada con las 20 restantes y
    se mide el error contra lo que realmente midió.
    """
    cfg = config.interpolation
    methods = tuple(methods or cfg.methods)

    # Las predicciones se devuelven alineadas con la entrada original (una por
    # estación, `None` donde no había dato), para que quien llame pueda cruzarlas
    # con su propia lista de estaciones sin llevar el filtro por su cuenta.
    total = values.size
    validos = np.isfinite(values)
    indices = np.flatnonzero(validos)
    lat_v, lon_v, val_v = lat_pts[validos], lon_pts[validos], values[validos]
    n = val_v.size
    lat0 = float(np.mean(lat_pts))
    puntos = _project(lat_v, lon_v, lat0)

    # Primero se predicen todas las estaciones con todos los métodos.
    preds_por_metodo: dict[str, np.ndarray] = {}
    for metodo in methods:
        preds = np.full(n, np.nan)
        for i in range(n):
            fuera = np.ones(n, dtype=bool)
            fuera[i] = False
            if fuera.sum() < 4:
                continue
            z = griddata(puntos[fuera], val_v[fuera], puntos[i : i + 1], method=metodo)
            preds[i] = float(z[0]) if np.isfinite(z[0]) else np.nan
        preds_por_metodo[metodo] = preds

    # Al esconder una estación que está en el casco convexo, linear y cubic no
    # pueden predecirla (queda fuera de la triangulación) mientras que nearest
    # siempre responde. Comparar sus MAE sobre muestras distintas no es válido,
    # así que se reportan también las métricas sobre el subconjunto que todos
    # los métodos cubren, y es ese el que decide el mejor método.
    comun = np.ones(n, dtype=bool)
    for preds in preds_por_metodo.values():
        comun &= np.isfinite(preds)

    resultados: dict[str, Any] = {}
    predicciones: dict[str, list[float | None]] = {}
    for metodo, preds in preds_por_metodo.items():
        ok = np.isfinite(preds)
        err = preds[ok] - val_v[ok]
        err_comun = preds[comun] - val_v[comun]
        resultados[metodo] = {
            "n": int(ok.sum()),
            "no_cubiertas": int(n - ok.sum()),
            "mae": _r(np.mean(np.abs(err))) if ok.any() else None,
            "rmse": _r(np.sqrt(np.mean(err**2))) if ok.any() else None,
            "sesgo": _r(np.mean(err)) if ok.any() else None,
            "error_max": _r(np.max(np.abs(err))) if ok.any() else None,
            "r2": _r(_r2(val_v[ok], preds[ok])) if ok.sum() > 2 else None,
            "mae_comun": _r(np.mean(np.abs(err_comun))) if comun.any() else None,
            "rmse_comun": _r(np.sqrt(np.mean(err_comun**2))) if comun.any() else None,
        }
        completo: list[float | None] = [None] * total
        for pos, pred in zip(indices, preds):
            completo[int(pos)] = None if not np.isfinite(pred) else round(float(pred), 2)
        predicciones[metodo] = completo

    criterio = "mae_comun" if comun.sum() >= 4 else "mae"
    con_metrica = {m: v for m, v in resultados.items() if v[criterio] is not None}
    mejor = min(con_metrica, key=lambda m: con_metrica[m][criterio]) if con_metrica else None
    return {
        "metodos": resultados,
        "mejor_metodo": mejor,
        "criterio_mejor": criterio,
        "n_comun": int(comun.sum()),
        "predicciones": predicciones,
    }


def sample_point(
    campo: np.ndarray, mesh: dict[str, Any], lat: float, lon: float
) -> float | None:
    """Muestrea la malla en un punto con interpolación bilineal entre celdas.

    Es el mismo cálculo que hace el backend en ``backend/services/grid.js``; vive
    aquí también para poder verificar el artefacto desde Python.
    """
    lats, lons = mesh["lats"], mesh["lons"]
    if not (lats[0] <= lat <= lats[-1] and lons[0] <= lon <= lons[-1]):
        return None
    fi = (lat - lats[0]) / (lats[1] - lats[0])
    fj = (lon - lons[0]) / (lons[1] - lons[0])
    i0, j0 = int(np.floor(fi)), int(np.floor(fj))
    i1, j1 = min(i0 + 1, len(lats) - 1), min(j0 + 1, len(lons) - 1)
    di, dj = fi - i0, fj - j0
    esquinas = np.array(
        [
            campo[i0, j0] * (1 - di) * (1 - dj),
            campo[i1, j0] * di * (1 - dj),
            campo[i0, j1] * (1 - di) * dj,
            campo[i1, j1] * di * dj,
        ]
    )
    if not np.isfinite(esquinas).all():
        return None
    return float(esquinas.sum())


def _r2(y: np.ndarray, yhat: np.ndarray) -> float:
    ss_res = float(np.sum((y - yhat) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    return 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")


def _r(value: Any, nd: int = 3) -> float | None:
    if value is None:
        return None
    value = float(value)
    return None if not np.isfinite(value) else round(value, nd)
