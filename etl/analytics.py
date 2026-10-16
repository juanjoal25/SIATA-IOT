"""Analítica descriptiva de la red: los números que la app traduce a gráficas.

Toma como referencia el cuaderno exploratorio ``datos_siata.py`` (auditoría de
datos, atípicos por estación, semáforo, perfil horario, mapa de calor día × hora
y validación de la imputación por enmascaramiento) y lo lleva a la escala de las
21 estaciones, apoyado en las matrices que ya produjeron ``clean`` e ``impute``.

Dos diferencias deliberadas frente al cuaderno:

* El cuaderno valida la imputación interpolando en el tiempo. Aquí se enmascara
  un 5 % de las observaciones **buenas** y se vuelve a ejecutar la cascada
  completa de producción, así que el error medido es el del sistema real.
* El semáforo se calcula sobre la media móvil de 24 h, que es la base que define
  la norma, y no sobre el dato horario suelto.

Este módulo no escribe nada: devuelve un diccionario que ``pipeline`` publica en
``analytics.json``.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from . import ica as ica_mod
from .config import CONFIG, Config
from .impute import impute

DIAS = ("Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo")
SEMILLA = 42
FRACCION_ENMASCARADA = 0.05
HORAS_SERIE_EJEMPLO = 480


def analyze(
    valores: pd.DataFrame,
    motivos: pd.DataFrame,
    imputado: pd.DataFrame,
    metodos_imp: pd.DataFrame,
    media24: pd.DataFrame,
    estaciones: pd.DataFrame,
    config: Config = CONFIG,
) -> dict[str, Any]:
    """Calcula todos los agregados descriptivos de la corrida."""
    meta = estaciones.set_index("codigo_serial").reindex(valores.columns)
    nombres = {int(s): str(meta.loc[s, "nombre_corto"]) for s in valores.columns}

    return {
        "rango": {"desde": str(valores.index.min()), "hasta": str(valores.index.max())},
        "auditoria": _auditoria(valores, motivos, nombres),
        "resumen_estaciones": _resumen(valores, motivos, imputado, nombres),
        "validacion_imputacion": _validar_imputacion(valores, estaciones, config, nombres),
        "semaforo": _semaforo(media24, nombres),
        "perfil_horario": _perfil_horario(valores, nombres),
        "heatmap": _heatmap(valores, nombres),
        "serie_diaria": _serie_diaria(imputado, nombres),
        "serie_ejemplo": _serie_ejemplo(valores, imputado, metodos_imp, nombres),
    }


# --------------------------------------------------------------------------- #
# Auditoría de calidad (bloque «salud de la red» del cuaderno)
# --------------------------------------------------------------------------- #
def _auditoria(valores: pd.DataFrame, motivos: pd.DataFrame, nombres: dict) -> dict[str, Any]:
    """Cuántos datos llegaron sanos y por qué se cayeron los demás."""
    # Tres familias que una persona entiende. Se cuentan **solo sobre lo que
    # efectivamente se descartó**: `bandera_calidad` marca el dato pero lo
    # conserva, así que va aparte y los totales cuadran con `descartados`.
    familias = {
        "sin_registro": ("ausente",),
        "falla_sensor": ("centinela", "negativo", "cero_sensor", "fuera_rango"),
        "incoherente": ("atipico_local", "atipico_espacial"),
    }
    descartado = valores.isna()

    por_estacion = []
    for serial in valores.columns:
        col = motivos[serial]
        fuera = descartado[serial]
        registros = int(len(col))
        sanos = int(valores[serial].notna().sum())
        por_estacion.append(
            {
                "codigo_serial": int(serial),
                "nombre_corto": nombres[int(serial)],
                "registros": registros,
                "sanos": sanos,
                "descartados": registros - sanos,
                **{
                    familia: int((col.isin(claves) & fuera).sum())
                    for familia, claves in familias.items()
                },
                "marcados_conservados": int((col == "bandera_calidad").sum()),
                "pct_descartado": round((registros - sanos) / registros * 100, 2) if registros else 0.0,
            }
        )

    por_estacion.sort(key=lambda fila: fila["pct_descartado"], reverse=True)
    registros = int(valores.size)
    sanos = int(valores.notna().to_numpy().sum())
    return {
        "global": {
            "registros": registros,
            "sanos": sanos,
            "descartados": registros - sanos,
            "pct_descartado": round((registros - sanos) / registros * 100, 2) if registros else 0.0,
            **{
                familia: int((motivos.isin(claves) & descartado).to_numpy().sum())
                for familia, claves in familias.items()
            },
            "marcados_conservados": int((motivos == "bandera_calidad").to_numpy().sum()),
        },
        "familias": {
            "sin_registro": "La hora nunca llegó en el archivo de origen",
            "falla_sensor": (
                "Códigos de «sin dato», valores negativos, ceros exactos del piso "
                "del instrumento y saturaciones"
            ),
            "incoherente": "El valor se contradice con su propio histórico o con el resto del valle",
        },
        "nota_marcados": (
            "El SIATA marca algunos datos como no validados. No se eliminan —serían "
            "demasiados— pero quedan señalados para poder auditarlos."
        ),
        "por_estacion": por_estacion,
    }


# --------------------------------------------------------------------------- #
# Resumen estadístico por estación
# --------------------------------------------------------------------------- #
def _resumen(
    valores: pd.DataFrame, motivos: pd.DataFrame, imputado: pd.DataFrame, nombres: dict
) -> list[dict[str, Any]]:
    fallas = ("centinela", "negativo", "cero_sensor", "fuera_rango")
    salida = []
    for serial in valores.columns:
        col = valores[serial].dropna()
        salida.append(
            {
                "codigo_serial": int(serial),
                "nombre_corto": nombres[int(serial)],
                "horas_validas": int(col.size),
                "media": _r(col.mean()),
                "mediana": _r(col.median()),
                "p95": _r(col.quantile(0.95)),
                "max": _r(col.max()),
                "media_imputada": _r(imputado[serial].mean()),
                "errores_sensor": int(motivos[serial].isin(fallas).sum()),
            }
        )
    salida.sort(key=lambda fila: fila["media"] or 0, reverse=True)
    return salida


# --------------------------------------------------------------------------- #
# Validación de la imputación por enmascaramiento
# --------------------------------------------------------------------------- #
def _validar_imputacion(
    valores: pd.DataFrame, estaciones: pd.DataFrame, config: Config, nombres: dict
) -> dict[str, Any]:
    """Esconde un 5 % de las observaciones buenas y mide qué tan bien las recupera.

    Es la prueba honesta de la cascada: se corre exactamente el mismo
    ``impute()`` que en producción sobre los datos mutilados y se compara contra
    el valor que sí se conocía.
    """
    rng = np.random.default_rng(SEMILLA)
    observado = valores.to_numpy(dtype=float)
    filas, columnas = np.nonzero(np.isfinite(observado))
    if filas.size < 100:
        return {"aplicable": False, "motivo": "Muy pocas observaciones válidas para validar."}

    n_mascara = int(filas.size * FRACCION_ENMASCARADA)
    elegidos = rng.choice(filas.size, size=n_mascara, replace=False)
    fi, ci = filas[elegidos], columnas[elegidos]

    # Copia-en-escritura de pandas 3: se muta el ndarray y se reconstruye el
    # DataFrame, en vez de escribir sobre `.values` (que es de solo lectura).
    mutilado_arr = observado.copy()
    mutilado_arr[fi, ci] = np.nan
    mutilado = pd.DataFrame(mutilado_arr, index=valores.index, columns=valores.columns)
    reconstruido, metodos, _ = impute(mutilado, estaciones, config)

    verdad = observado[fi, ci]
    estimado = reconstruido.to_numpy(dtype=float)[fi, ci]
    usado = metodos.to_numpy()[fi, ci]
    ok = np.isfinite(estimado)

    def _metricas(mask: np.ndarray) -> dict[str, Any]:
        if mask.sum() == 0:
            return {"n": 0, "rmse": None, "mae": None, "sesgo": None, "mape": None}
        err = estimado[mask] - verdad[mask]
        base = np.maximum(np.abs(verdad[mask]), 1.0)  # evita dividir por ~0
        return {
            "n": int(mask.sum()),
            "rmse": _r(np.sqrt(np.mean(err**2)), 3),
            "mae": _r(np.mean(np.abs(err)), 3),
            "sesgo": _r(np.mean(err), 3),
            "mape": _r(np.mean(np.abs(err) / base) * 100, 2),
        }

    por_metodo = {
        str(nombre): _metricas(ok & (usado == nombre))
        for nombre in np.unique(usado[ok])
    }

    por_estacion = []
    for idx, serial in enumerate(valores.columns):
        mask = ok & (ci == idx)
        if mask.sum() == 0:
            continue
        por_estacion.append(
            {"codigo_serial": int(serial), "nombre_corto": nombres[int(serial)], **_metricas(mask)}
        )
    por_estacion.sort(key=lambda fila: fila["mae"] or 0, reverse=True)

    return {
        "aplicable": True,
        "estrategia": f"Enmascaramiento aleatorio del {FRACCION_ENMASCARADA:.0%} de las observaciones válidas",
        "semilla": SEMILLA,
        "enmascarados": int(n_mascara),
        "recuperados": int(ok.sum()),
        "global": _metricas(ok),
        "por_metodo": por_metodo,
        "por_estacion": por_estacion,
    }


# --------------------------------------------------------------------------- #
# Semáforo: cuánto tiempo pasó cada estación en cada color
# --------------------------------------------------------------------------- #
def _semaforo(media24: pd.DataFrame, nombres: dict) -> dict[str, Any]:
    escala = ica_mod.scale_table()
    cortes = [-np.inf] + [tramo["pm25_max"] for tramo in escala]
    etiquetas = [tramo["slug"] for tramo in escala]

    def _porcentajes(serie: pd.Series) -> dict[str, float]:
        limpia = serie.dropna()
        if limpia.empty:
            return {slug: 0.0 for slug in etiquetas}
        cortada = pd.cut(limpia, bins=cortes, labels=etiquetas, right=True)
        conteo = cortada.value_counts(normalize=True) * 100
        return {slug: round(float(conteo.get(slug, 0.0)), 2) for slug in etiquetas}

    por_estacion = [
        {
            "codigo_serial": int(serial),
            "nombre_corto": nombres[int(serial)],
            "horas": int(media24[serial].notna().sum()),
            **_porcentajes(media24[serial]),
        }
        for serial in media24.columns
    ]
    # La estación con más horas en verde arriba: así la lista se lee como un ranking.
    por_estacion.sort(key=lambda fila: (fila["verde"], -fila["amarillo"]), reverse=True)

    return {
        "base": "Media móvil de 24 h (la que define la norma para PM2.5)",
        "escala": escala,
        "global": _porcentajes(media24.stack()),
        "por_estacion": por_estacion,
    }


# --------------------------------------------------------------------------- #
# Perfil horario y mapa de calor
# --------------------------------------------------------------------------- #
def _perfil_horario(valores: pd.DataFrame, nombres: dict) -> dict[str, Any]:
    """Distribución de la concentración por hora del día (banda p10–p90)."""

    def _perfil(serie: pd.Series) -> list[dict[str, Any]]:
        agrupado = serie.dropna().groupby(serie.dropna().index.hour)
        salida = []
        for hora in range(24):
            if hora not in agrupado.groups:
                salida.append({"hora": hora, "n": 0})
                continue
            valores_hora = agrupado.get_group(hora)
            salida.append(
                {
                    "hora": hora,
                    "n": int(valores_hora.size),
                    "p10": _r(valores_hora.quantile(0.10)),
                    "p25": _r(valores_hora.quantile(0.25)),
                    "mediana": _r(valores_hora.median()),
                    "p75": _r(valores_hora.quantile(0.75)),
                    "p90": _r(valores_hora.quantile(0.90)),
                    "media": _r(valores_hora.mean()),
                }
            )
        return salida

    apilado = valores.stack()
    apilado.index = apilado.index.get_level_values(0)
    return {
        "valle": _perfil(apilado),
        "por_estacion": {str(int(s)): _perfil(valores[s]) for s in valores.columns},
        "nombres": {str(k): v for k, v in nombres.items()},
    }


def _heatmap(valores: pd.DataFrame, nombres: dict) -> dict[str, Any]:
    """Promedio por día de la semana × hora: dónde se concentra el problema."""

    def _matriz(serie: pd.Series) -> list[list[float | None]]:
        limpia = serie.dropna()
        if limpia.empty:
            return [[None] * 24 for _ in DIAS]
        tabla = limpia.groupby([limpia.index.dayofweek, limpia.index.hour]).mean()
        return [
            [_r(tabla.get((dia, hora))) for hora in range(24)]
            for dia in range(7)
        ]

    apilado = valores.stack()
    apilado.index = apilado.index.get_level_values(0)
    return {
        "dias": list(DIAS),
        "valle": _matriz(apilado),
        "por_estacion": {str(int(s)): _matriz(valores[s]) for s in valores.columns},
    }


# --------------------------------------------------------------------------- #
# Series de tiempo
# --------------------------------------------------------------------------- #
def _serie_diaria(imputado: pd.DataFrame, nombres: dict) -> dict[str, Any]:
    diaria = imputado.resample("D").mean()
    return {
        "fechas": [d.strftime("%Y-%m-%d") for d in diaria.index],
        "valle": [_r(v) for v in diaria.mean(axis=1)],
        "por_estacion": {
            str(int(s)): [_r(v) for v in diaria[s]] for s in diaria.columns
        },
        "nombres": {str(k): v for k, v in nombres.items()},
    }


def _serie_ejemplo(
    valores: pd.DataFrame, imputado: pd.DataFrame, metodos_imp: pd.DataFrame, nombres: dict
) -> dict[str, Any]:
    """Ventana donde se ve el dato observado y lo que la imputación reconstruyó."""
    # La estación con más huecos es la que mejor ilustra el trabajo del pipeline.
    serial = valores.isna().sum().idxmax()
    faltantes = valores[serial].isna().to_numpy()
    if faltantes.any():
        # Centramos la ventana en el tramo con mayor densidad de huecos.
        densidad = pd.Series(faltantes.astype(float)).rolling(HORAS_SERIE_EJEMPLO).mean()
        fin = int(densidad.idxmax())
    else:
        fin = min(HORAS_SERIE_EJEMPLO, len(valores) - 1)
    inicio = max(0, fin - HORAS_SERIE_EJEMPLO)

    ventana = slice(inicio, fin)
    indice = valores.index[ventana]
    return {
        "codigo_serial": int(serial),
        "nombre_corto": nombres[int(serial)],
        "desde": str(indice.min()),
        "hasta": str(indice.max()),
        "puntos": [
            {
                "t": fecha.strftime("%Y-%m-%d %H:00"),
                "observado": _r(obs),
                "serie": _r(imp),
                "origen": str(origen),
            }
            for fecha, obs, imp, origen in zip(
                indice,
                valores[serial].to_numpy()[ventana],
                imputado[serial].to_numpy()[ventana],
                metodos_imp[serial].to_numpy()[ventana],
            )
        ],
    }


def _r(value: Any, nd: int = 2) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        return None
    return round(float(value), nd)
