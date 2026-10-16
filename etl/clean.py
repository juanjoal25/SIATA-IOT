"""Limpieza, control de calidad y detección de atípicos.

Trabaja sobre una matriz ancha ``fecha x estación`` porque así la rejilla
temporal queda explícita: una celda vacía es un dato faltante, no una fila
ausente.

Cada valor descartado queda con un motivo trazable:

=====================  ==========================================================
motivo                 significado
=====================  ==========================================================
``ok``                 dato válido
``ausente``            la hora no existe en la fuente (hueco estructural)
``centinela``          código de «sin dato» del SIATA (-999 / -9999)
``negativo``           concentración negativa por deriva de cero del sensor
``cero_sensor``        cero exacto: el piso del instrumento, no una medición
``fuera_rango``        por encima del máximo físico plausible
``bandera_calidad``    campo ``calidad`` != 1.0 (dato no validado por el SIATA)
``atipico_local``      filtro de Hampel: se aleja de su propia mediana móvil
``atipico_espacial``   incoherente con el resto del valle a la misma hora
=====================  ==========================================================
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .config import CONFIG, Config

MAD_SCALE = 1.4826  # convierte la MAD en un estimador consistente de sigma


def _hampel_mask(matrix: pd.DataFrame, window: int, sigmas: float) -> pd.DataFrame:
    """Máscara de atípicos locales por estación (mediana móvil +/- n*MAD)."""
    window = window if window % 2 == 1 else window + 1
    min_periods = max(5, window // 3)
    rolling = matrix.rolling(window=window, center=True, min_periods=min_periods)
    median = rolling.median()
    abs_dev = (matrix - median).abs()
    mad = abs_dev.rolling(window=window, center=True, min_periods=min_periods).median()
    # Donde la MAD es 0 (tramos planos) el criterio no discrimina: no marcamos.
    umbral = sigmas * MAD_SCALE * mad.replace(0.0, np.nan)
    return (abs_dev > umbral).fillna(False)


def _spatial_mask(matrix: pd.DataFrame, sigmas: float) -> pd.DataFrame:
    """Máscara de incoherencia espacial: z robusto contra el valle en esa hora."""
    med = matrix.median(axis=1)
    dev = matrix.sub(med, axis=0).abs()
    mad = dev.median(axis=1) * MAD_SCALE
    umbral = (mad * sigmas).replace(0.0, np.nan)
    return dev.gt(umbral, axis=0).fillna(False)


def to_matrix(obs: pd.DataFrame, columna: str = "valor") -> pd.DataFrame:
    """Pasa de formato largo a matriz ``fecha x codigo_serial`` con rejilla horaria completa."""
    ancho = obs.pivot_table(index="fecha", columns="codigo_serial", values=columna, aggfunc="last")
    rejilla = pd.date_range(ancho.index.min(), ancho.index.max(), freq="h")
    return ancho.reindex(rejilla).sort_index(axis=1)


def clean(obs: pd.DataFrame, config: Config = CONFIG) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """Aplica todo el control de calidad.

    Devuelve ``(valores, motivos, reporte)``:

    - ``valores``: matriz ``fecha x estación`` con ``NaN`` en todo lo descartado.
    - ``motivos``: matriz gemela con el motivo de cada celda.
    - ``reporte``: métricas por etapa y por estación para la vista de ETL.
    """
    cfg = config.cleaning

    duplicados = int(obs.duplicated(subset=["codigo_serial", "fecha"]).sum())
    obs = obs.drop_duplicates(subset=["codigo_serial", "fecha"], keep="last")
    filas_fuente = int(len(obs))

    crudo = to_matrix(obs, "valor")
    calidad = to_matrix(obs, "calidad").reindex_like(crudo)

    total_celdas = int(crudo.size)
    motivos = pd.DataFrame("ok", index=crudo.index, columns=crudo.columns, dtype=object)
    valores = crudo.copy()

    # 1. Huecos estructurales: la hora no vino en la fuente.
    ausente = crudo.isna()
    motivos = motivos.mask(ausente, "ausente")

    # 2. Centinelas de «sin dato».
    centinela = valores <= cfg.sentinel_threshold
    valores = valores.mask(centinela)
    motivos = motivos.mask(centinela, "centinela")

    # 3. Negativos residuales (deriva de cero del sensor).
    negativo = valores < cfg.physical_min
    valores = valores.mask(negativo)
    motivos = motivos.mask(negativo, "negativo")

    # 4. Piso del sensor: el cero exacto no es una medición (ver config).
    if cfg.zero_is_missing:
        cero = valores == 0.0
        valores = valores.mask(cero)
        motivos = motivos.mask(cero, "cero_sensor")
    else:
        cero = pd.DataFrame(False, index=valores.index, columns=valores.columns)

    # 5. Máximo físico plausible.
    fuera_rango = valores > cfg.physical_max
    valores = valores.mask(fuera_rango)
    motivos = motivos.mask(fuera_rango, "fuera_rango")

    # 6. Bandera de calidad del SIATA.
    sospechoso = calidad.notna() & (calidad != cfg.trusted_quality_flag) & valores.notna()
    if cfg.drop_flagged:
        valores = valores.mask(sospechoso)
    motivos = motivos.mask(sospechoso, "bandera_calidad")

    # 7. Atípicos locales (Hampel sobre cada serie).
    local = _hampel_mask(valores, cfg.hampel_window_hours, cfg.hampel_sigmas) & valores.notna()
    valores = valores.mask(local)
    motivos = motivos.mask(local, "atipico_local")

    # 8. Atípicos espaciales (incoherencia con el valle a la misma hora).
    espacial = _spatial_mask(valores, cfg.spatial_sigmas) & valores.notna()
    valores = valores.mask(espacial)
    motivos = motivos.mask(espacial, "atipico_espacial")

    conteos = {
        "ausente": int(ausente.to_numpy().sum()),
        "centinela": int(centinela.to_numpy().sum()),
        "negativo": int(negativo.to_numpy().sum()),
        "cero_sensor": int(cero.to_numpy().sum()),
        "fuera_rango": int(fuera_rango.to_numpy().sum()),
        "bandera_calidad": int(sospechoso.to_numpy().sum()),
        "atipico_local": int(local.to_numpy().sum()),
        "atipico_espacial": int(espacial.to_numpy().sum()),
    }
    validos = int(valores.notna().to_numpy().sum())

    por_estacion = []
    for serial in valores.columns:
        col_motivos = motivos[serial]
        col = valores[serial]
        por_estacion.append(
            {
                "codigo_serial": int(serial),
                "horas": int(len(col)),
                "validos": int(col.notna().sum()),
                "faltantes": int(col.isna().sum()),
                "cobertura": round(float(col.notna().mean()), 4),
                "centinela": int((col_motivos == "centinela").sum()),
                "negativo": int((col_motivos == "negativo").sum()),
                "cero_sensor": int((col_motivos == "cero_sensor").sum()),
                "fuera_rango": int((col_motivos == "fuera_rango").sum()),
                "bandera_calidad": int((col_motivos == "bandera_calidad").sum()),
                "atipico_local": int((col_motivos == "atipico_local").sum()),
                "atipico_espacial": int((col_motivos == "atipico_espacial").sum()),
                "hueco_max_horas": max_gap(col),
                "p50": round_or_none(col.median()),
                "p95": round_or_none(col.quantile(0.95)),
                "max": round_or_none(col.max()),
            }
        )

    reporte = {
        "filas_fuente": filas_fuente,
        "duplicados_eliminados": duplicados,
        "estaciones": int(valores.shape[1]),
        "horas": int(valores.shape[0]),
        "celdas_totales": total_celdas,
        "celdas_validas": validos,
        "celdas_descartadas": total_celdas - validos,
        "cobertura_global": round(validos / total_celdas, 4) if total_celdas else 0.0,
        "rango_temporal": {
            "desde": str(valores.index.min()),
            "hasta": str(valores.index.max()),
        },
        "descartes": conteos,
        "por_estacion": por_estacion,
        "reglas": {
            "centinela_umbral": cfg.sentinel_threshold,
            "rango_fisico": [cfg.physical_min, cfg.physical_max],
            "bandera_confiable": cfg.trusted_quality_flag,
            "descarta_banderas": cfg.drop_flagged,
            "hampel": {"ventana_horas": cfg.hampel_window_hours, "sigmas": cfg.hampel_sigmas},
            "coherencia_espacial_sigmas": cfg.spatial_sigmas,
        },
    }
    return valores, motivos, reporte


def max_gap(series: pd.Series) -> int:
    """Longitud del hueco consecutivo más largo de la serie."""
    nulo = series.isna().to_numpy()
    if not nulo.any():
        return 0
    # Longitud de cada racha de NaN, sin bucles en Python.
    idx = np.flatnonzero(np.diff(np.concatenate(([0], nulo.view(np.int8), [0]))))
    return int((idx[1::2] - idx[::2]).max())


def round_or_none(value: Any, nd: int = 2) -> float | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if pd.isna(value):
        return None
    return round(float(value), nd)
