"""CLI del ETL.

    python -m etl.run                                  # histórico completo, última hora disponible
    python -m etl.run --at "2020-01-15 08:00:00"       # publicar una hora concreta
    python -m etl.run --methods linear cubic nearest   # elegir métodos a comparar
    python -m etl.run --source replay --at "2019-08-01 12:00:00" --window-hours 72
    python -m etl.run --source live --base-url https://siata.gov.co/...   # (pendiente)

Para tiempo real, programar este mismo comando cada N minutos con
``--source live``: el backend recoge los artefactos nuevos sin reiniciarse.
"""

from __future__ import annotations

import argparse
from dataclasses import replace
import sys
from pathlib import Path

from .config import CONFIG, Config, PROCESSED_DIR
from .pipeline import run_pipeline
from .sources import build_source


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m etl.run",
        description="ETL de calidad del aire (PM2.5) del Valle de Aburrá con datos del SIATA.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--source", default="file", choices=("file", "replay", "live"),
                   help="Fuente de datos (por defecto: file)")
    p.add_argument("--raw", type=Path, default=None, help="Ruta al JSON crudo (sobreescribe la config)")
    p.add_argument("--at", default=None, help='Hora a publicar, p. ej. "2020-02-21 04:00:00"')
    p.add_argument("--window-hours", type=int, default=48, help="Ventana para replay/live (h)")
    p.add_argument("--base-url", default=None, help="Endpoint del SIATA para --source live")
    p.add_argument("--methods", nargs="+", default=None, metavar="M",
                   choices=("linear", "cubic", "nearest"),
                   help="Métodos de interpolación a calcular y comparar")
    p.add_argument("--incluir-trafico", action="store_true",
                   help="Usar también las estaciones de tráfico como nodos de interpolación "
                        "(por defecto se excluyen: sesgan la superficie de fondo)")
    p.add_argument("--out", type=Path, default=None, help="Carpeta de artefactos (por defecto data/processed)")
    p.add_argument("--dry-run", action="store_true", help="Ejecuta todo pero no escribe artefactos")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    config: Config = CONFIG
    if args.raw or args.out or args.incluir_trafico:
        interpolacion = CONFIG.interpolation
        if args.incluir_trafico:
            interpolacion = replace(interpolacion, exclude_name_pattern="", exclude_serials=())
        config = Config(
            raw_file=args.raw or CONFIG.raw_file,
            processed_dir=args.out or PROCESSED_DIR,
            interpolation=interpolacion,
        )

    kwargs: dict = {"config": config}
    if args.raw:
        kwargs["path"] = args.raw
    if args.source == "replay":
        if not args.at:
            print("error: --source replay requiere --at", file=sys.stderr)
            return 2
        kwargs.update({"at": args.at, "window_hours": args.window_hours})
    if args.source == "live":
        if not args.base_url:
            print("error: --source live requiere --base-url", file=sys.stderr)
            return 2
        kwargs = {"base_url": args.base_url, "window_hours": args.window_hours}

    try:
        source = build_source(args.source, **kwargs)
    except (TypeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(f"ETL calidad del aire — fuente: {source.name}")
    try:
        reporte = run_pipeline(
            source=source,
            at=args.at if args.source != "replay" else None,
            config=config,
            methods=tuple(args.methods) if args.methods else None,
            write=not args.dry_run,
        )
    except NotImplementedError as exc:
        print(f"\nFuente no disponible todavía:\n  {exc}", file=sys.stderr)
        return 3
    except (FileNotFoundError, ValueError) as exc:
        print(f"\nerror: {exc}", file=sys.stderr)
        return 1

    _print_summary(reporte, dry_run=args.dry_run, out=config.processed_dir)
    return 0


def _print_summary(reporte: dict, *, dry_run: bool, out: Path) -> None:
    calidad = reporte.get("calidad", {})
    imputacion = reporte.get("imputacion", {})
    interp = reporte.get("interpolacion", {})
    cv = (interp.get("validacion_cruzada") or {}).get("metodos", {})

    print("\n" + "=" * 62)
    print(f"Snapshot publicado : {(interp.get('snapshot') or {}).get('fecha')}")
    print(f"Estaciones         : {calidad.get('estaciones')}   Horas: {calidad.get('horas')}")
    excluidas = interp.get("excluidas") or []
    if excluidas:
        print(f"Nodos interpolación: {interp.get('nodos')}"
              f"   (excluidas: {', '.join(e['nombre_corto'] for e in excluidas)})")
    print(f"Cobertura cruda    : {_pct(calidad.get('cobertura_global'))}"
          f"   ->  completitud tras imputar: {_pct(imputacion.get('completitud_final'))}")
    descartes = calidad.get("descartes", {})
    if descartes:
        print("Descartes          : " + ", ".join(f"{k}={v}" for k, v in descartes.items() if v))
    imp = imputacion.get("imputados", {})
    if imp:
        print("Imputaciones       : " + ", ".join(f"{k}={v}" for k, v in imp.items()))
    if cv:
        validacion = interp.get("validacion_cruzada") or {}
        print("\nLOOCV (µg/m³)      MAE     RMSE    sesgo      R2    n   MAE*")
        for metodo, datos in cv.items():
            print(f"  {metodo:<10} {_n(datos.get('mae')):>7} {_n(datos.get('rmse')):>8}"
                  f" {_n(datos.get('sesgo')):>8} {_n(datos.get('r2')):>7}"
                  f" {datos.get('n', '-'):>4} {_n(datos.get('mae_comun')):>6}")
        print(f"  MAE* = sobre las {validacion.get('n_comun')} estaciones que los tres métodos cubren")
        print(f"  mejor: {validacion.get('mejor_metodo')} (criterio: {validacion.get('criterio_mejor')})")
    print("=" * 62)
    if dry_run:
        print("--dry-run: no se escribió ningún artefacto.")
    else:
        print(f"Artefactos en {out}")
    for aviso in reporte.get("avisos", []):
        print(f"  ! {aviso}")


def _pct(value) -> str:
    return "-" if value is None else f"{value * 100:.2f}%"


def _n(value) -> str:
    return "-" if value is None else f"{value:.3f}"


if __name__ == "__main__":
    raise SystemExit(main())
