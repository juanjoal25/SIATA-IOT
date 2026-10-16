"""Orquestación del pipeline: extracción -> limpieza -> imputación -> interpolación.

Produce los artefactos que consume el backend, todos en ``data/processed/``:

===================  =========================================================
artefacto            contenido
===================  =========================================================
``meta.json``        versión, fuente, instante del snapshot, índice de archivos
``stations.json``    estaciones con su última medición, ICA y trazabilidad
``grid.json``        malla interpolada del valle por método (1 h y 24 h)
``etl_report.json``  el proceso completo, etapa por etapa (vista «Proceso ETL»)
``analytics.json``   analítica descriptiva del histórico (vista «Análisis»)
``ica_scale.json``   tabla del semáforo, única fuente de verdad del frontend
``runs.json``        historial de las últimas ejecuciones
===================  =========================================================
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from . import __version__, ica as ica_mod
from .analytics import analyze
from .clean import clean
from .config import CONFIG, Config
from .impute import impute
from .interpolate import build_mesh, cross_validate, fill_outside_hull, interpolate_field
from .report import RunReport, append_run_history, write_json
from .sources import AirQualitySource, FileSource

# Campos que se interpolan y publican en la malla.
CAMPOS = ("pm25_24h", "pm25_1h")


def run_pipeline(
    source: AirQualitySource | None = None,
    at: str | None = None,
    config: Config = CONFIG,
    methods: tuple[str, ...] | None = None,
    write: bool = True,
) -> dict[str, Any]:
    """Ejecuta el ETL completo y escribe los artefactos. Devuelve el reporte."""
    source = source or FileSource(config=config)
    methods = tuple(methods or config.interpolation.methods)
    reporte = RunReport(version=__version__, fuente=source.describe(), config=_config_publico(config))

    # ------------------------------------------------------------ extracción
    with reporte.stage("extraccion", "Leer la fuente y normalizar el esquema") as m:
        obs, estaciones = source.fetch()
        m.update(
            {
                "filas": int(len(obs)),
                "estaciones": int(len(estaciones)),
                "variable": config.variable,
                "desde": str(obs["fecha"].min()),
                "hasta": str(obs["fecha"].max()),
            }
        )

    # -------------------------------------------------------------- limpieza
    with reporte.stage("limpieza", "Centinelas, rango físico, banderas de calidad y atípicos") as m:
        valores, motivos, rep_limpieza = clean(obs, config)
        m.update(
            {
                "celdas": rep_limpieza["celdas_totales"],
                "validas": rep_limpieza["celdas_validas"],
                "descartadas": rep_limpieza["celdas_descartadas"],
                "cobertura": rep_limpieza["cobertura_global"],
                **{f"descarte_{k}": v for k, v in rep_limpieza["descartes"].items()},
            }
        )
    reporte.add("calidad", rep_limpieza)

    # ------------------------------------------------------------ imputación
    with reporte.stage("imputacion", "Cascada temporal -> espacial escalada -> climatología") as m:
        imputado, metodos_imp, rep_imputacion = impute(valores, estaciones, config)
        m.update(
            {
                "faltantes_entrada": rep_imputacion["faltantes_entrada"],
                **{f"imputado_{k}": v for k, v in rep_imputacion["imputados"].items()},
                "sin_dato_restante": rep_imputacion["sin_dato_restante"],
                "completitud": rep_imputacion["completitud_final"],
            }
        )
    reporte.add("imputacion", rep_imputacion)

    # ------------------------------------------------------- agregación ICA
    with reporte.stage("agregacion", f"Media móvil de {config.ica_window_hours} h para el ICA") as m:
        media24 = imputado.rolling(
            window=config.ica_window_hours, min_periods=config.ica_min_coverage
        ).mean()
        observados24 = (
            valores.notna().rolling(window=config.ica_window_hours, min_periods=1).sum()
        )
        m.update(
            {
                "ventana_h": config.ica_window_hours,
                "cobertura_minima_h": config.ica_min_coverage,
                "filas_con_ica": int(media24.notna().any(axis=1).sum()),
            }
        )

    # ------------------------------------------------------------- snapshot
    snapshot_ts = _pick_snapshot(media24, at)
    fila_24h = media24.loc[snapshot_ts]
    fila_1h = imputado.loc[snapshot_ts]

    meta = estaciones.set_index("codigo_serial").reindex(media24.columns)
    lat = meta["latitud"].to_numpy(dtype=float)
    lon = meta["longitud"].to_numpy(dtype=float)

    # Las estaciones de tráfico se publican y se analizan, pero no sirven de
    # vértice de la superficie de fondo (ver InterpolationConfig).
    nodos, excluidas = _nodos_interpolacion(meta, config)

    # -------------------------------------------------------- interpolación
    mesh = build_mesh(config)
    etiqueta_excluidas = (
        f", sin {'/'.join(e['nombre_corto'] for e in excluidas)}" if excluidas else ""
    )
    with reporte.stage(
        "interpolacion",
        f"griddata sobre malla {mesh['nrows']}x{mesh['ncols']} "
        f"({', '.join(methods)}) con {int(nodos.sum())} nodos{etiqueta_excluidas}",
    ) as m:
        campos: dict[str, dict[str, np.ndarray]] = {}
        extrapolado = None
        for campo, serie in (("pm25_24h", fila_24h), ("pm25_1h", fila_1h)):
            crudos = interpolate_field(
                lat[nodos], lon[nodos], serie.to_numpy(dtype=float)[nodos], mesh, methods, config
            )
            rellenos, mask = fill_outside_hull(crudos, config.interpolation.fallback_method)
            campos[campo] = rellenos
            extrapolado = mask if extrapolado is None else (extrapolado | mask)
        m.update(
            {
                "celdas": mesh["nrows"] * mesh["ncols"],
                "resolucion_deg": mesh["resolution_deg"],
                "metodos": list(methods),
                "nodos": int(nodos.sum()),
                "excluidas": [e["nombre_corto"] for e in excluidas],
                "celdas_extrapoladas": int(extrapolado.sum()),
                "pct_extrapolado": round(float(extrapolado.mean()) * 100, 2),
            }
        )

    # ----------------------------------------------------- validación cruzada
    with reporte.stage("validacion", "LOOCV: error de cada método contra las estaciones reales") as m:
        cv = cross_validate(
            lat[nodos], lon[nodos], fila_24h.to_numpy(dtype=float)[nodos], methods, config
        )
        # Las predicciones vuelven alineadas con los nodos; se expanden a la
        # lista completa de estaciones para que el resto del pipeline las cruce
        # por posición sin tener que conocer el filtro.
        cv["predicciones"] = _expandir(cv["predicciones"], nodos)
        m.update({metodo: datos["mae"] for metodo, datos in cv["metodos"].items()})
        m["mejor_metodo"] = cv["mejor_metodo"]

    # ----------------------------------------------------------- analítica
    with reporte.stage(
        "analitica", "Auditoría, semáforo histórico, perfil horario y validación de la imputación"
    ) as m:
        analitica = analyze(valores, motivos, imputado, metodos_imp, media24, estaciones, config)
        validacion_imp = analitica["validacion_imputacion"]
        m.update(
            {
                "estaciones_resumidas": len(analitica["resumen_estaciones"]),
                "enmascarados": validacion_imp.get("enmascarados", 0),
                "mae_imputacion": (validacion_imp.get("global") or {}).get("mae"),
                "rmse_imputacion": (validacion_imp.get("global") or {}).get("rmse"),
            }
        )

    estaciones_out = _stations_payload(
        meta, fila_1h, fila_24h, observados24.loc[snapshot_ts], metodos_imp.loc[snapshot_ts],
        motivos.loc[snapshot_ts], cv, config
    )
    seriales_excluidos = {e["codigo_serial"] for e in excluidas}
    for fila in estaciones_out:
        fila["nodo_interpolacion"] = fila["codigo_serial"] not in seriales_excluidos

    reporte.add(
        "interpolacion",
        {
            "malla": {k: v for k, v in mesh.items() if k not in {"lats", "lons"}},
            "metodos": list(methods),
            "metodo_por_defecto": "linear" if "linear" in methods else methods[0],
            "fallback": config.interpolation.fallback_method,
            "nodos": int(nodos.sum()),
            "excluidas": excluidas,
            "nota_exclusion": (
                "Las estaciones de tráfico miden el microentorno de una calzada y no el aire "
                "de fondo del sector. Usarlas como vértices sesga la superficie hacia arriba; "
                "medido sobre 250 horas y las mismas 19 estaciones de fondo, excluirlas baja "
                "el MAE entre un 23 % y un 32 % según el método. Siguen publicándose como "
                "mediciones."
            )
            if excluidas
            else None,
            "celdas_extrapoladas": int(extrapolado.sum()),
            "validacion_cruzada": {
                "metodos": cv["metodos"],
                "mejor_metodo": cv["mejor_metodo"],
                "criterio_mejor": cv["criterio_mejor"],
                "n_comun": cv["n_comun"],
                "detalle": [
                    {
                        "codigo_serial": int(serial),
                        "nombre_corto": str(meta.loc[serial, "nombre_corto"]),
                        "observado": _r(fila_24h[serial]),
                        **{
                            f"pred_{metodo}": cv["predicciones"][metodo][i]
                            for metodo in methods
                        },
                    }
                    for i, serial in enumerate(media24.columns)
                ],
            },
            "snapshot": {
                "fecha": str(snapshot_ts),
                "estaciones_con_dato": int(np.isfinite(fila_24h.to_numpy(dtype=float)).sum()),
            },
        },
    )
    reporte.add("estaciones", estaciones_out)

    # ------------------------------------------------------------ artefactos
    if not write:
        return reporte.to_dict()

    with reporte.stage("publicacion", "Escribir artefactos JSON para el backend") as m:
        out = config.processed_dir
        tamanos = {
            "stations.json": write_json(out / "stations.json", {
                "generado_en": reporte.generado_en,
                "snapshot": str(snapshot_ts),
                "estaciones": estaciones_out,
            }),
            "grid.json": write_json(out / "grid.json", _grid_payload(
                mesh, campos, extrapolado, methods, snapshot_ts, reporte.generado_en, config
            )),
            "ica_scale.json": write_json(out / "ica_scale.json", {
                "variable": config.variable,
                "ventana_horas": config.ica_window_hours,
                "norma": "Resolución 2254 de 2017 (MinAmbiente, Colombia)",
                "escala": ica_mod.scale_table(),
            }),
            "analytics.json": write_json(out / "analytics.json", {
                "generado_en": reporte.generado_en,
                "snapshot": str(snapshot_ts),
                **analitica,
            }),
        }
        payload_reporte = reporte.to_dict()
        tamanos["etl_report.json"] = write_json(out / "etl_report.json", payload_reporte)
        tamanos["meta.json"] = write_json(out / "meta.json", {
            "version": __version__,
            "generado_en": reporte.generado_en,
            "fuente": source.describe(),
            "snapshot": str(snapshot_ts),
            "variable": config.variable,
            "metodos": list(methods),
            "metodo_por_defecto": "linear" if "linear" in methods else methods[0],
            "artefactos": {k: {"bytes": v} for k, v in tamanos.items()},
        })
        m.update({"archivos": len(tamanos), "bytes_totales": int(sum(tamanos.values()))})
        m.update({f"bytes_{k}": v for k, v in tamanos.items()})

    append_run_history(config.processed_dir / "runs.json", reporte.resumen())
    # El reporte final incluye la etapa de publicación, así que se reescribe.
    write_json(config.processed_dir / "etl_report.json", reporte.to_dict())
    return reporte.to_dict()


# --------------------------------------------------------------------------- #
# Auxiliares
# --------------------------------------------------------------------------- #
def _nodos_interpolacion(meta: pd.DataFrame, config: Config) -> tuple[np.ndarray, list[dict[str, Any]]]:
    """Máscara de estaciones que sí sirven de vértice de la superficie de fondo.

    Devuelve ``(mascara, excluidas)``. Excluir no es descartar: esas estaciones
    siguen en ``stations.json``, en el análisis histórico y en la lista de
    «estaciones cercanas» de la app. Solo dejan de deformar la interpolación.
    """
    cfg = config.interpolation
    patron = (cfg.exclude_name_pattern or "").strip()
    por_nombre = (
        meta["nombre"].str.contains(patron, case=False, regex=True, na=False)
        if patron
        else pd.Series(False, index=meta.index)
    )
    por_serial = meta.index.isin(cfg.exclude_serials)
    fuera = (por_nombre.to_numpy() | por_serial)

    excluidas = [
        {
            "codigo_serial": int(serial),
            "nombre_corto": str(meta.loc[serial, "nombre_corto"]),
            "nombre": str(meta.loc[serial, "nombre"]),
            "motivo": "estación de tráfico: mide calzada, no aire de fondo",
        }
        for serial, es_fuera in zip(meta.index, fuera)
        if es_fuera
    ]
    # Nunca se deja la red sin nodos suficientes para triangular.
    if (~fuera).sum() < 4:
        return np.ones(len(meta), dtype=bool), []
    return ~fuera, excluidas


def _expandir(
    predicciones: dict[str, list[float | None]], nodos: np.ndarray
) -> dict[str, list[float | None]]:
    """Reinserta ``None`` en la posición de las estaciones excluidas."""
    indices = np.flatnonzero(nodos)
    salida: dict[str, list[float | None]] = {}
    for metodo, valores in predicciones.items():
        completo: list[float | None] = [None] * len(nodos)
        for pos, valor in zip(indices, valores):
            completo[int(pos)] = valor
        salida[metodo] = completo
    return salida


def _pick_snapshot(media24: pd.DataFrame, at: str | None) -> pd.Timestamp:
    """Hora a publicar: la pedida, o la última con suficiente cobertura."""
    if at:
        ts = pd.Timestamp(at)
        if ts not in media24.index:
            raise ValueError(f"{ts} no está en el rango {media24.index.min()} .. {media24.index.max()}")
        return ts
    con_dato = media24.index[media24.notna().sum(axis=1) >= 4]
    if con_dato.empty:
        raise ValueError("Ninguna hora tiene al menos 4 estaciones con ICA de 24 h calculable.")
    return con_dato[-1]


def _stations_payload(meta, fila_1h, fila_24h, observados24, metodos_imp, motivos, cv, config) -> list[dict]:
    salida = []
    for i, serial in enumerate(fila_24h.index):
        v24 = fila_24h[serial]
        diagnostico = ica_mod.classify(None if pd.isna(v24) else float(v24))
        salida.append(
            {
                "codigo_serial": int(serial),
                "nombre": str(meta.loc[serial, "nombre"]),
                "nombre_corto": str(meta.loc[serial, "nombre_corto"]),
                "latitud": float(meta.loc[serial, "latitud"]),
                "longitud": float(meta.loc[serial, "longitud"]),
                "pm25_1h": _r(fila_1h[serial]),
                "pm25_24h": _r(v24),
                "horas_observadas_24h": int(observados24[serial]),
                "origen_dato": str(metodos_imp[serial]),
                "motivo_descarte": str(motivos[serial]),
                "ica": diagnostico["ica"],
                "categoria": diagnostico["categoria"],
                "color": diagnostico["color"],
                "slug": diagnostico["slug"],
                "hex": diagnostico["hex"],
                "error_loocv": {
                    metodo: (
                        None
                        if cv["predicciones"][metodo][i] is None or pd.isna(v24)
                        else round(cv["predicciones"][metodo][i] - float(v24), 2)
                    )
                    for metodo in cv["predicciones"]
                },
            }
        )
    return salida


def _grid_payload(mesh, campos, extrapolado, methods, snapshot_ts, generado_en, config) -> dict:
    nd = config.interpolation.decimals
    return {
        "generado_en": generado_en,
        "snapshot": str(snapshot_ts),
        "variable": config.variable,
        "malla": {
            "lat_min": float(mesh["lats"][0]),
            "lat_max": float(mesh["lats"][-1]),
            "lon_min": float(mesh["lons"][0]),
            "lon_max": float(mesh["lons"][-1]),
            "nrows": mesh["nrows"],
            "ncols": mesh["ncols"],
            "resolucion_deg": mesh["resolution_deg"],
            "orden": "row-major, fila 0 = lat_min, columna 0 = lon_min",
        },
        "metodos": list(methods),
        "campos": {
            campo: {metodo: _flatten(valores, nd) for metodo, valores in por_metodo.items()}
            for campo, por_metodo in campos.items()
        },
        "extrapolado": [bool(x) for x in extrapolado.ravel()],
    }


def _flatten(matrix: np.ndarray, nd: int) -> list[float | None]:
    plano = np.round(matrix, nd).ravel()
    return [None if not np.isfinite(v) else float(v) for v in plano]


def _config_publico(config: Config) -> dict[str, Any]:
    datos = config.to_dict()
    datos.pop("raw_file", None)  # ruta local, no hace falta exponerla
    return datos


def _r(value: Any, nd: int = 2) -> float | None:
    if value is None or pd.isna(value):
        return None
    return round(float(value), nd)
