"""Configuración central del ETL.

Todos los umbrales del pipeline viven aquí para que el comportamiento se pueda
auditar y ajustar sin tocar la lógica. Cualquier valor puede sobreescribirse por
variable de entorno con el prefijo ``SIATA_``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"


def _env(name: str, default: Any, cast=str) -> Any:
    value = os.environ.get(f"SIATA_{name}")
    if value is None or value == "":
        return default
    if cast is bool:
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return cast(value)


# --------------------------------------------------------------------------- #
# Índice de Calidad del Aire (ICA) — PM2.5, promedio 24 h
# --------------------------------------------------------------------------- #
# Puntos de corte de la Resolución 2254 de 2017 (MinAmbiente, Colombia), que es
# la tabla que usa el SIATA para publicar el semáforo del Valle de Aburrá.
# Formato: (c_lo, c_hi, ica_lo, ica_hi, categoría, color, slug, recomendación).
ICA_BREAKPOINTS: tuple[tuple[float, float, float, float, str, str, str, str], ...] = (
    (0.0, 12.0, 0, 50, "Buena", "Verde", "verde",
     "La calidad del aire es satisfactoria. Puedes hacer actividades al aire libre sin restricción."),
    (12.1, 37.0, 51, 100, "Moderada", "Amarillo", "amarillo",
     "Aceptable. Personas inusualmente sensibles deberían considerar reducir el esfuerzo prolongado al aire libre."),
    (37.1, 55.0, 101, 150, "Dañina a grupos sensibles", "Naranja", "naranja",
     "Niños, adultos mayores y personas con asma o enfermedad cardiaca deben limitar el esfuerzo al aire libre."),
    (55.1, 150.0, 151, 200, "Dañina a la salud", "Rojo", "rojo",
     "Toda la población puede sentir efectos. Evita el ejercicio prolongado al aire libre y usa tapabocas."),
    (150.1, 250.0, 201, 300, "Muy dañina a la salud", "Púrpura", "purpura",
     "Alerta sanitaria: el riesgo es alto para todos. Permanece en interiores con ventanas cerradas."),
    (250.1, 500.0, 301, 500, "Peligrosa", "Marrón", "marron",
     "Emergencia sanitaria. Evita cualquier actividad al aire libre y atiende las instrucciones del AMVA."),
)

# Hex asociado a cada color del semáforo (compartido con el frontend).
ICA_COLORS: dict[str, str] = {
    "verde": "#00e400",
    "amarillo": "#ffff00",
    "naranja": "#ff7e00",
    "rojo": "#ff0000",
    "purpura": "#8f3f97",
    "marron": "#7e0023",
}


@dataclass(frozen=True)
class CleaningConfig:
    """Reglas de limpieza y detección de atípicos."""

    # El SIATA codifica «sin dato» con centinelas negativos (-999, -9999).
    sentinel_values: tuple[float, ...] = (-999.0, -9999.0)
    sentinel_threshold: float = -900.0     # cualquier valor <= se considera centinela
    physical_min: float = 0.0              # µg/m³: una concentración no puede ser negativa
    physical_max: float = 1000.0           # por encima es falla de sensor, no un evento real
    # El archivo trae 995 lecturas de exactamente 0.0 y **ninguna** en el
    # intervalo (0, 1). Una distribución real no tiene un pico en cero con un
    # vacío justo encima: es el piso del sensor, la misma familia que la deriva
    # negativa. Se trata como dato ausente, no como aire perfectamente limpio.
    zero_is_missing: bool = True
    # `calidad` == 1.0 es dato validado por SIATA. 2.x/3.x/4.x son banderas de sospecha.
    trusted_quality_flag: float = 1.0
    drop_flagged: bool = False             # False => se marcan como sospechosos, no se eliminan
    # Filtro de Hampel (mediana móvil ± n·MAD) para atípicos locales.
    hampel_window_hours: int = 25          # impar, ~1 día centrado
    hampel_sigmas: float = 4.0
    # Coherencia espacial: z-robusto contra la mediana del valle en la misma hora.
    spatial_sigmas: float = 5.0


@dataclass(frozen=True)
class ImputationConfig:
    """Estrategia de imputación en cascada (de más a menos informada)."""

    max_temporal_gap_hours: int = 3        # huecos cortos -> interpolación temporal
    max_spatial_gap_hours: int = 48        # huecos medios -> vecinos escalados por razón
    spatial_neighbors: int = 4             # k vecinos usados en la imputación espacial
    min_neighbor_overlap: int = 168        # horas comunes mínimas para estimar la razón (1 semana)
    # Los huecos que sobrevivan caen al perfil climatológico (mediana por mes × hora).


@dataclass(frozen=True)
class InterpolationConfig:
    """Malla e interpolación espacial."""

    # Bounding box del Valle de Aburrá (10 municipios del AMVA) con margen.
    lat_min: float = 6.05
    lat_max: float = 6.50
    lon_min: float = -75.72
    lon_max: float = -75.28
    resolution_deg: float = 0.005           # ~550 m por celda (~8.1k celdas en el valle)
    methods: tuple[str, ...] = ("linear", "cubic", "nearest")
    # --- Estaciones excluidas como nodos de interpolación -------------------
    # Las estaciones de tráfico miden el microentorno de una calzada, no el
    # aire de fondo del sector, así que como vértices deforman la superficie.
    # Medido con validación cruzada sobre las mismas 19 estaciones de fondo en
    # 250 horas al azar, excluirlas baja el MAE un 22,7 % (linear), 32,3 %
    # (cubic) y 23,3 % (nearest), y sobre todo elimina el sesgo sistemático
    # (linear: +0,87 -> -0,29 µg/m³).
    # Siguen publicándose en `stations.json` y en el análisis histórico: son
    # mediciones legítimas, solo que no representativas del fondo.
    # Se filtran por nombre para que el criterio siga valiendo si el SIATA
    # añade estaciones de tráfico nuevas; `exclude_serials` es el escape manual.
    exclude_name_pattern: str = r"tr[áa]fico"
    exclude_serials: tuple[int, ...] = ()
    # `nearest` siempre cubre la malla completa; linear/cubic solo el casco convexo.
    # Fuera del casco se reporta el valor de `nearest` marcado como extrapolado.
    fallback_method: str = "nearest"
    decimals: int = 2                      # redondeo del artefacto para bajar su peso


@dataclass(frozen=True)
class Config:
    raw_file: Path = field(default_factory=lambda: RAW_DIR / _env("RAW_FILE", "Datos_SIATA_Aire_pm25.json"))
    processed_dir: Path = field(default_factory=lambda: PROCESSED_DIR)
    variable: str = "pm25"
    timezone: str = "America/Bogota"       # los timestamps de SIATA vienen en UTC-5
    cleaning: CleaningConfig = field(default_factory=CleaningConfig)
    imputation: ImputationConfig = field(default_factory=ImputationConfig)
    interpolation: InterpolationConfig = field(default_factory=InterpolationConfig)
    # Ventana de promedio móvil para el ICA (la norma define PM2.5 a 24 h).
    ica_window_hours: int = 24
    # Mínimo de horas válidas dentro de la ventana para publicar un ICA de 24 h.
    ica_min_coverage: int = 18

    def to_dict(self) -> dict[str, Any]:
        raw = asdict(self)
        raw["raw_file"] = str(self.raw_file)
        raw["processed_dir"] = str(self.processed_dir)
        return raw


CONFIG = Config()
