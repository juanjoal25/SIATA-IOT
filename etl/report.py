"""Registro del proceso: cronómetro por etapa y escritura de artefactos.

El reporte que produce este módulo es lo que alimenta la vista «Proceso ETL»
del frontend, así que su forma es parte del contrato con el backend.
"""

from __future__ import annotations

import json
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import numpy as np


class RunReport:
    """Acumula las etapas del pipeline con su duración y sus métricas."""

    def __init__(self, version: str, fuente: dict[str, Any], config: dict[str, Any]):
        self.version = version
        self.fuente = fuente
        self.config = config
        self.inicio = time.perf_counter()
        self.generado_en = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
        self.etapas: list[dict[str, Any]] = []
        self.secciones: dict[str, Any] = {}
        self.avisos: list[str] = []

    @contextmanager
    def stage(self, nombre: str, descripcion: str) -> Iterator[dict[str, Any]]:
        """Cronometra una etapa. Lo que se escriba en el dict cedido va al reporte."""
        t0 = time.perf_counter()
        entrada: dict[str, Any] = {}
        print(f"  -> {nombre}: {descripcion}", flush=True)
        try:
            yield entrada
        finally:
            duracion = time.perf_counter() - t0
            self.etapas.append(
                {
                    "orden": len(self.etapas) + 1,
                    "nombre": nombre,
                    "descripcion": descripcion,
                    "duracion_s": round(duracion, 3),
                    "metricas": entrada,
                }
            )
            print(f"     ok ({duracion:.2f}s)", flush=True)

    def add(self, clave: str, valor: Any) -> None:
        self.secciones[clave] = valor

    def warn(self, mensaje: str) -> None:
        self.avisos.append(mensaje)
        print(f"     ! {mensaje}", flush=True)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "generado_en": self.generado_en,
            "duracion_total_s": round(time.perf_counter() - self.inicio, 3),
            "fuente": self.fuente,
            "config": self.config,
            "etapas": self.etapas,
            "avisos": self.avisos,
            **self.secciones,
        }

    def resumen(self) -> dict[str, Any]:
        """Fila corta para el historial de ejecuciones."""
        calidad = self.secciones.get("calidad", {})
        imputacion = self.secciones.get("imputacion", {})
        interpolacion = self.secciones.get("interpolacion", {})
        return {
            "generado_en": self.generado_en,
            "version": self.version,
            "fuente": self.fuente.get("source"),
            "tiempo_real": self.fuente.get("realtime", False),
            "duracion_s": round(time.perf_counter() - self.inicio, 3),
            "estaciones": calidad.get("estaciones"),
            "horas": calidad.get("horas"),
            "cobertura_global": calidad.get("cobertura_global"),
            "completitud_final": imputacion.get("completitud_final"),
            "snapshot": (interpolacion.get("snapshot") or {}).get("fecha"),
            "mejor_metodo": (interpolacion.get("validacion_cruzada") or {}).get("mejor_metodo"),
            "avisos": len(self.avisos),
        }


class _NpEncoder(json.JSONEncoder):
    """numpy -> JSON, con NaN/inf convertidos a ``null`` (JSON válido)."""

    def default(self, o: Any) -> Any:
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            value = float(o)
            return None if not np.isfinite(value) else value
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, (np.bool_,)):
            return bool(o)
        return super().default(o)


def _sanitize(value: Any) -> Any:
    """Reemplaza NaN/Infinity por null: ``JSON.parse`` del navegador los rechaza."""
    if isinstance(value, float):
        return None if not np.isfinite(value) else value
    if isinstance(value, dict):
        return {k: _sanitize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize(v) for v in value]
    return value


def write_json(path: Path, payload: Any) -> int:
    """Escribe un artefacto de forma atómica y devuelve su tamaño en bytes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(_sanitize(payload), handle, cls=_NpEncoder, ensure_ascii=False, separators=(",", ":"))
    tmp.replace(path)
    return path.stat().st_size


def append_run_history(path: Path, resumen: dict[str, Any], keep: int = 50) -> None:
    """Mantiene las últimas ``keep`` ejecuciones para la vista de historial."""
    historial: list[dict[str, Any]] = []
    if path.exists():
        try:
            historial = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            historial = []
    historial.append(resumen)
    write_json(path, historial[-keep:])
