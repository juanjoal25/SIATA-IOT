"""Conversión de concentración PM2.5 (µg/m³) a ICA y a la categoría del semáforo.

La fórmula es la interpolación lineal por tramos de la EPA, adoptada en Colombia
por la Resolución 2254 de 2017:

    ICA = (ICA_hi - ICA_lo) / (C_hi - C_lo) * (C - C_lo) + ICA_lo
"""

from __future__ import annotations

from typing import Any, Iterable

import numpy as np
import pandas as pd

from .config import ICA_BREAKPOINTS, ICA_COLORS


def _truncate(concentration: float) -> float:
    """La norma exige truncar PM2.5 a un decimal antes de calcular el índice."""
    return float(np.floor(round(concentration, 4) * 10) / 10)


def concentration_to_ica(concentration: float | None) -> float | None:
    """Devuelve el ICA (0-500) para una concentración de PM2.5. ``None`` si no hay dato."""
    if concentration is None or (isinstance(concentration, float) and np.isnan(concentration)):
        return None
    c = _truncate(max(float(concentration), 0.0))
    for c_lo, c_hi, i_lo, i_hi, *_ in ICA_BREAKPOINTS:
        if c <= c_hi:
            return round((i_hi - i_lo) / (c_hi - c_lo) * (c - c_lo) + i_lo, 1)
    # Por encima de 500 µg/m³ el índice se satura en 500 (fuera de escala).
    return 500.0


def classify(concentration: float | None) -> dict[str, Any]:
    """Diagnóstico completo del semáforo para una concentración dada."""
    if concentration is None or (isinstance(concentration, float) and np.isnan(concentration)):
        return {
            "pm25": None,
            "ica": None,
            "categoria": "Sin dato",
            "color": "Gris",
            "slug": "sin-dato",
            "hex": "#6b7280",
            "recomendacion": "No hay suficientes datos válidos para emitir un diagnóstico en este punto.",
        }
    c = _truncate(max(float(concentration), 0.0))
    for c_lo, c_hi, i_lo, i_hi, categoria, color, slug, consejo in ICA_BREAKPOINTS:
        if c <= c_hi:
            break
    else:  # fuera de escala
        c_lo, c_hi, i_lo, i_hi, categoria, color, slug, consejo = ICA_BREAKPOINTS[-1]
    return {
        "pm25": round(float(concentration), 2),
        "ica": concentration_to_ica(concentration),
        "categoria": categoria,
        "color": color,
        "slug": slug,
        "hex": ICA_COLORS[slug],
        "recomendacion": consejo,
    }


def classify_series(values: Iterable[float]) -> pd.DataFrame:
    """Versión vectorizada: una fila por valor con ICA, categoría y color."""
    return pd.DataFrame([classify(v) for v in values])


def scale_table() -> list[dict[str, Any]]:
    """Tabla del semáforo lista para exportar al frontend y a la vista de ETL."""
    return [
        {
            "slug": slug,
            "categoria": categoria,
            "color": color,
            "hex": ICA_COLORS[slug],
            "pm25_min": c_lo,
            "pm25_max": c_hi,
            "ica_min": i_lo,
            "ica_max": i_hi,
            "recomendacion": consejo,
        }
        for c_lo, c_hi, i_lo, i_hi, categoria, color, slug, consejo in ICA_BREAKPOINTS
    ]
