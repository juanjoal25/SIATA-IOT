"""Capa de extracción: adaptadores de fuente de datos.

El resto del pipeline nunca sabe de dónde vienen los datos: solo consume el
contrato ``AirQualitySource.fetch() -> (observaciones, estaciones)`` con un
esquema normalizado. Añadir tiempo real es implementar una clase más.

Esquema normalizado
-------------------
observaciones : DataFrame
    codigo_serial : int      identificador de estación del SIATA
    fecha         : datetime hora de la observación (tz-naive, UTC-5)
    variable      : str      'pm25'
    valor         : float    µg/m³ en crudo (con centinelas incluidos)
    calidad       : float    bandera de calidad del SIATA (1.0 = validado)

estaciones : DataFrame
    codigo_serial, nombre, nombre_corto, latitud, longitud
"""

from __future__ import annotations

import abc
import json
from pathlib import Path

import pandas as pd

from .config import CONFIG, Config


class AirQualitySource(abc.ABC):
    """Contrato de cualquier fuente de datos de calidad del aire."""

    #: identificador que queda registrado en el reporte del ETL
    name: str = "abstract"
    #: ``True`` si la fuente entrega el dato más reciente disponible
    realtime: bool = False

    @abc.abstractmethod
    def fetch(self) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Devuelve ``(observaciones, estaciones)`` con el esquema normalizado."""

    def describe(self) -> dict:
        return {"source": self.name, "realtime": self.realtime}


class FileSource(AirQualitySource):
    """Lee el volcado histórico de SIATA en JSON (una entrada por estación).

    Estructura del archivo::

        [{"codigoSerial": 3, "nombre": "...", "nombreCorto": "GIR-SOSN",
          "latitud": 6.378, "longitud": -75.451,
          "datos": [{"variableConsulta": "pm25", "fecha": "2019-02-21 04:00:00",
                     "calidad": "1.0", "valor": 34.0}, ...]}]
    """

    name = "file"
    realtime = False

    def __init__(self, path: Path | str | None = None, config: Config = CONFIG):
        self.config = config
        self.path = Path(path) if path else config.raw_file

    def fetch(self) -> tuple[pd.DataFrame, pd.DataFrame]:
        if not self.path.exists():
            raise FileNotFoundError(
                f"No se encontró el archivo de datos crudos: {self.path}. "
                "Colócalo en data/raw/ o ajusta SIATA_RAW_FILE."
            )
        with self.path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)

        estaciones = pd.DataFrame(
            [
                {
                    "codigo_serial": int(st["codigoSerial"]),
                    "nombre": str(st.get("nombre", "")).strip(),
                    "nombre_corto": str(st.get("nombreCorto", "")).strip(),
                    "latitud": float(st["latitud"]),
                    "longitud": float(st["longitud"]),
                }
                for st in payload
            ]
        )

        # Aplanar a formato largo sin construir un DataFrame por estación.
        registros: list[dict] = []
        for st in payload:
            serial = int(st["codigoSerial"])
            for punto in st.get("datos", []):
                registros.append(
                    {
                        "codigo_serial": serial,
                        "fecha": punto.get("fecha"),
                        "variable": punto.get("variableConsulta", self.config.variable),
                        "valor": punto.get("valor"),
                        "calidad": punto.get("calidad"),
                    }
                )

        obs = pd.DataFrame.from_records(registros)
        obs["fecha"] = pd.to_datetime(obs["fecha"], errors="coerce")
        obs["valor"] = pd.to_numeric(obs["valor"], errors="coerce")
        obs["calidad"] = pd.to_numeric(obs["calidad"], errors="coerce")
        obs = obs[obs["variable"] == self.config.variable]
        return obs.sort_values(["codigo_serial", "fecha"]).reset_index(drop=True), estaciones


class LiveSiataSource(AirQualitySource):
    """Adaptador de tiempo real contra la API pública del SIATA. **Pendiente.**

    El pipeline ya funciona con esta fuente sin cambios: basta implementar
    ``fetch()`` devolviendo el mismo esquema normalizado. El endpoint público
    de SIATA entrega el último dato por estación; la idea es pedir una ventana
    móvil (p. ej. las últimas 48 h) para que la limpieza, la imputación y el
    ICA de 24 h sigan teniendo contexto suficiente.

    Ejecución sugerida en producción: este mismo ``run.py`` cada 10 minutos
    (cron / Task Scheduler / contenedor), escribiendo los artefactos que el
    backend ya sirve y versiona. El frontend no cambia.
    """

    name = "live-siata"
    realtime = True

    def __init__(self, base_url: str, window_hours: int = 48, api_key: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.window_hours = window_hours
        self.api_key = api_key

    def fetch(self) -> tuple[pd.DataFrame, pd.DataFrame]:
        raise NotImplementedError(
            "Adaptador de tiempo real no implementado todavía. "
            "Implementa fetch() devolviendo (observaciones, estaciones) con el "
            "esquema normalizado documentado en etl/sources.py. "
            f"Base URL configurada: {self.base_url}"
        )


class ReplaySource(FileSource):
    """Simula tiempo real reproduciendo el histórico hasta una hora ``t``.

    Sirve para probar el camino «streaming» sin depender todavía de la API:
    recorta el archivo a la ventana ``[t - window, t]`` y la presenta como si
    fuera lo último recibido.
    """

    name = "replay"
    realtime = True

    def __init__(self, at: str, window_hours: int = 48, path: Path | str | None = None, config: Config = CONFIG):
        super().__init__(path=path, config=config)
        self.at = pd.Timestamp(at)
        self.window_hours = window_hours

    def fetch(self) -> tuple[pd.DataFrame, pd.DataFrame]:
        obs, estaciones = super().fetch()
        desde = self.at - pd.Timedelta(hours=self.window_hours)
        ventana = obs[(obs["fecha"] > desde) & (obs["fecha"] <= self.at)]
        if ventana.empty:
            raise ValueError(f"No hay observaciones en la ventana {desde} .. {self.at}")
        return ventana.reset_index(drop=True), estaciones

    def describe(self) -> dict:
        return {**super().describe(), "at": str(self.at), "window_hours": self.window_hours}


def build_source(kind: str = "file", **kwargs) -> AirQualitySource:
    """Fábrica usada por la CLI (``--source file|replay|live``)."""
    kind = kind.lower()
    if kind == "file":
        return FileSource(**{k: v for k, v in kwargs.items() if k in {"path", "config"}})
    if kind == "replay":
        return ReplaySource(**{k: v for k, v in kwargs.items() if k in {"at", "window_hours", "path", "config"}})
    if kind == "live":
        return LiveSiataSource(**{k: v for k, v in kwargs.items() if k in {"base_url", "window_hours", "api_key"}})
    raise ValueError(f"Fuente desconocida: {kind!r}. Usa file, replay o live.")
