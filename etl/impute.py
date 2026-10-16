"""Imputación robusta de datos faltantes en cascada.

La idea es no inventar información: cada hueco se rellena con la fuente de
evidencia más cercana disponible y se degrada solo cuando la anterior no
alcanza. El método usado queda registrado celda por celda.

1. **Temporal** (huecos <= 3 h). Interpolación lineal sobre la propia serie.
   A esa escala el PM2.5 es fuertemente autocorrelacionado.
2. **Espacial escalada** (huecos <= 48 h). Combinación IDW de las estaciones
   vecinas, reescalando cada vecina por la razón mediana histórica frente a la
   estación objetivo. Corrige el sesgo de nivel entre una estación de tráfico y
   una de fondo, que es el error clásico de copiar la vecina tal cual.
3. **Climatología** (resto). Mediana histórica de la estación para ese mes y
   esa hora del día; si la estación no tiene historia suficiente, la mediana
   del valle para ese mes y hora.

La mediana se usa en todas partes a propósito: es resistente a los picos que
caracterizan las contingencias atmosféricas del Valle de Aburrá.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .config import CONFIG, Config

EARTH_RADIUS_KM = 6371.0088


def haversine_matrix(lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Matriz de distancias en km entre todas las estaciones."""
    lat = np.radians(lats)[:, None]
    lon = np.radians(lons)[:, None]
    dlat = lat - lat.T
    dlon = lon - lon.T
    a = np.sin(dlat / 2) ** 2 + np.cos(lat) * np.cos(lat.T) * np.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def gap_lengths(mask: np.ndarray) -> np.ndarray:
    """Para cada posición faltante, la longitud de la racha de faltantes que la contiene."""
    out = np.zeros(mask.shape, dtype=int)
    if not mask.any():
        return out
    bordes = np.flatnonzero(np.diff(np.concatenate(([0], mask.view(np.int8), [0]))))
    for ini, fin in zip(bordes[::2], bordes[1::2]):
        out[ini:fin] = fin - ini
    return out


def impute(
    valores: pd.DataFrame,
    estaciones: pd.DataFrame,
    config: Config = CONFIG,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """Rellena la matriz ``fecha x estación``.

    Devuelve ``(imputado, metodos, reporte)`` donde ``metodos`` indica por celda
    ``observado`` | ``temporal`` | ``espacial`` | ``climatologia`` | ``sin_dato``.
    """
    cfg = config.imputation
    faltantes_inicial = int(valores.isna().to_numpy().sum())

    metodos = pd.DataFrame(
        np.where(valores.notna(), "observado", "sin_dato"),
        index=valores.index,
        columns=valores.columns,
        dtype=object,
    )
    resultado = valores.copy()

    # ---------------------------------------------------------------- etapa 1
    temporal = resultado.interpolate(
        method="time",
        limit=cfg.max_temporal_gap_hours,
        limit_area="inside",
        limit_direction="both",
    )
    nuevo = resultado.isna() & temporal.notna()
    resultado = resultado.where(~nuevo, temporal)
    metodos = metodos.mask(nuevo, "temporal")
    n_temporal = int(nuevo.to_numpy().sum())

    # ---------------------------------------------------------------- etapa 2
    resultado, nuevo_espacial = _impute_spatial(resultado, valores, estaciones, cfg)
    metodos = metodos.mask(nuevo_espacial, "espacial")
    n_espacial = int(nuevo_espacial.to_numpy().sum())

    # ---------------------------------------------------------------- etapa 3
    resultado, nuevo_clima = _impute_climatology(resultado, valores)
    metodos = metodos.mask(nuevo_clima, "climatologia")
    n_clima = int(nuevo_clima.to_numpy().sum())

    restantes = int(resultado.isna().to_numpy().sum())
    total = int(resultado.size)

    por_estacion = []
    for serial in resultado.columns:
        col = metodos[serial]
        por_estacion.append(
            {
                "codigo_serial": int(serial),
                "observado": int((col == "observado").sum()),
                "temporal": int((col == "temporal").sum()),
                "espacial": int((col == "espacial").sum()),
                "climatologia": int((col == "climatologia").sum()),
                "sin_dato": int((col == "sin_dato").sum()),
                "tasa_imputacion": round(float((col != "observado").mean()), 4),
            }
        )

    reporte = {
        "faltantes_entrada": faltantes_inicial,
        "imputados": {
            "temporal": n_temporal,
            "espacial": n_espacial,
            "climatologia": n_clima,
        },
        "sin_dato_restante": restantes,
        "completitud_final": round((total - restantes) / total, 4) if total else 0.0,
        "por_estacion": por_estacion,
        "parametros": {
            "hueco_max_temporal_h": cfg.max_temporal_gap_hours,
            "hueco_max_espacial_h": cfg.max_spatial_gap_hours,
            "vecinos": cfg.spatial_neighbors,
            "solape_minimo_h": cfg.min_neighbor_overlap,
        },
    }
    return resultado, metodos, reporte


def _impute_spatial(
    resultado: pd.DataFrame,
    observado: pd.DataFrame,
    estaciones: pd.DataFrame,
    cfg,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Imputa con vecinas reescaladas por su razón mediana (IDW sobre la razón)."""
    seriales = list(resultado.columns)
    meta = estaciones.set_index("codigo_serial").reindex(seriales)
    dist = haversine_matrix(meta["latitud"].to_numpy(), meta["longitud"].to_numpy())

    obs = observado.to_numpy(dtype=float)          # solo datos realmente observados
    actual = resultado.to_numpy(dtype=float)       # incluye lo imputado en la etapa 1
    relleno = np.full(actual.shape, np.nan)

    for j, _serial in enumerate(seriales):
        faltan = np.isnan(actual[:, j])
        if not faltan.any():
            continue
        # Solo huecos dentro del límite: más largo que eso no es interpolable con confianza.
        elegibles = faltan & (gap_lengths(faltan) <= cfg.max_spatial_gap_hours)
        if not elegibles.any():
            continue

        vecinos = np.argsort(dist[j])
        vecinos = [k for k in vecinos if k != j][: cfg.spatial_neighbors]

        num = np.zeros(actual.shape[0])
        den = np.zeros(actual.shape[0])
        for k in vecinos:
            comun = ~np.isnan(obs[:, j]) & ~np.isnan(obs[:, k]) & (obs[:, k] > 0)
            if comun.sum() < cfg.min_neighbor_overlap:
                continue
            razon = float(np.median(obs[comun, j] / obs[comun, k]))
            if not np.isfinite(razon) or razon <= 0:
                continue
            peso = 1.0 / max(dist[j, k], 0.05) ** 2
            estimado = obs[:, k] * razon
            util = elegibles & ~np.isnan(estimado)
            num[util] += peso * estimado[util]
            den[util] += peso

        ok = elegibles & (den > 0)
        relleno[ok, j] = num[ok] / den[ok]

    nuevo = pd.DataFrame(
        np.isnan(actual) & ~np.isnan(relleno), index=resultado.index, columns=resultado.columns
    )
    salida = resultado.where(~nuevo, pd.DataFrame(relleno, index=resultado.index, columns=resultado.columns))
    return salida, nuevo


def _impute_climatology(
    resultado: pd.DataFrame, observado: pd.DataFrame
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Último recurso: mediana histórica por (mes, hora) de la estación o del valle."""
    if not resultado.isna().to_numpy().any():
        vacio = pd.DataFrame(False, index=resultado.index, columns=resultado.columns)
        return resultado, vacio

    clave = pd.MultiIndex.from_arrays(
        [resultado.index.month, resultado.index.hour], names=["mes", "hora"]
    )
    perfil = observado.groupby(clave).median()
    perfil_valle = observado.stack().groupby(
        [observado.stack().index.get_level_values(0).month,
         observado.stack().index.get_level_values(0).hour]
    ).median()

    estimado = perfil.reindex(clave)
    estimado.index = resultado.index
    valle = perfil_valle.reindex(clave)
    valle.index = resultado.index
    estimado = estimado.apply(lambda col: col.fillna(valle))

    nuevo = resultado.isna() & estimado.notna()
    return resultado.where(~nuevo, estimado), nuevo
