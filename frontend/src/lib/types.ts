/** Contratos de la API (`backend/routes/*`). */

export type Slug = 'verde' | 'amarillo' | 'naranja' | 'rojo' | 'purpura' | 'marron' | 'sin-dato';

export interface Diagnostico {
  pm25: number | null;
  ica: number | null;
  categoria: string;
  color: string;
  slug: Slug;
  hex: string;
  recomendacion: string;
}

export interface Estacion {
  codigo_serial: number;
  nombre: string;
  nombre_corto: string;
  latitud: number;
  longitud: number;
  pm25_1h: number | null;
  pm25_24h: number | null;
  horas_observadas_24h?: number;
  origen_dato?: string;
  categoria?: string;
  hex?: string;
  slug?: Slug;
  ica?: number | null;
  distancia_km?: number;
  /** `false` en las estaciones de tráfico: se publican pero no interpolan. */
  nodo_interpolacion?: boolean;
}

export interface Comparacion {
  [metodo: string]: Diagnostico & { extrapolado: boolean };
}

export interface RespuestaAire {
  ubicacion: { latitud: number; longitud: number; dentro_del_valle: boolean };
  fuente: 'malla-etl' | 'tiempo-real';
  snapshot: string;
  generado_en: string;
  campo: string;
  metodo: string;
  metodos_disponibles: string[];
  diagnostico: Diagnostico;
  pm25_1h: number | null;
  comparacion: Comparacion;
  celda?: { i: number; j: number } | null;
  extrapolado: boolean;
  estacion_mas_cercana: Estacion | null;
  estaciones_cercanas: Estacion[];
  aporte_estaciones?: { nombre_corto: string; distancia_km: number; peso: number; valor: number }[];
  advertencias: string[];
}

export interface TramoEscala {
  slug: Slug;
  categoria: string;
  color: string;
  hex: string;
  pm25_min: number;
  pm25_max: number;
  ica_min: number;
  ica_max: number;
  recomendacion: string;
}

export interface EtapaEtl {
  orden: number;
  nombre: string;
  descripcion: string;
  duracion_s: number;
  /** Heterogéneas por diseño: cada etapa reporta lo que le es propio
   *  (conteos, razones, listas de métodos, marcas de tiempo). */
  metricas: Record<string, unknown>;
}

export interface MetricasMetodo {
  n: number;
  no_cubiertas: number;
  mae: number | null;
  rmse: number | null;
  sesgo: number | null;
  error_max: number | null;
  r2: number | null;
  /** Métricas sobre las estaciones que todos los métodos alcanzan a predecir. */
  mae_comun: number | null;
  rmse_comun: number | null;
}

export interface ReporteEtl {
  version: string;
  generado_en: string;
  duracion_total_s: number;
  fuente: { source: string; realtime: boolean; at?: string };
  etapas: EtapaEtl[];
  avisos: string[];
  calidad: {
    filas_fuente: number;
    duplicados_eliminados: number;
    estaciones: number;
    horas: number;
    celdas_totales: number;
    celdas_validas: number;
    celdas_descartadas: number;
    cobertura_global: number;
    rango_temporal: { desde: string; hasta: string };
    descartes: Record<string, number>;
    por_estacion: Record<string, number>[];
    reglas: Record<string, unknown>;
  };
  imputacion: {
    faltantes_entrada: number;
    imputados: Record<string, number>;
    sin_dato_restante: number;
    completitud_final: number;
    por_estacion: Record<string, number>[];
    parametros: Record<string, number>;
  };
  interpolacion: {
    malla: { nrows: number; ncols: number; resolution_deg: number; bbox: number[] };
    metodos: string[];
    metodo_por_defecto: string;
    nodos: number;
    excluidas: { codigo_serial: number; nombre_corto: string; nombre: string; motivo: string }[];
    nota_exclusion: string | null;
    celdas_extrapoladas: number;
    validacion_cruzada: {
      metodos: Record<string, MetricasMetodo>;
      mejor_metodo: string | null;
      criterio_mejor: string;
      n_comun: number;
      detalle: Record<string, number | string | null>[];
    };
    snapshot: { fecha: string; estaciones_con_dato: number };
  };
  estaciones: Estacion[];
}

export interface MetricasImputacion {
  n: number;
  rmse: number | null;
  mae: number | null;
  sesgo: number | null;
  mape: number | null;
}

export interface Analitica {
  generado_en: string;
  snapshot: string;
  rango: { desde: string; hasta: string };
  auditoria: {
    global: Record<string, number>;
    familias: Record<string, string>;
    nota_marcados: string;
    por_estacion: {
      nombre_corto: string;
      registros: number;
      sanos: number;
      descartados: number;
      sin_registro: number;
      falla_sensor: number;
      incoherente: number;
      marcados_conservados: number;
      pct_descartado: number;
    }[];
  };
  resumen_estaciones: {
    codigo_serial: number;
    nombre_corto: string;
    horas_validas: number;
    media: number | null;
    mediana: number | null;
    p95: number | null;
    max: number | null;
    errores_sensor: number;
  }[];
  validacion_imputacion: {
    aplicable: boolean;
    estrategia?: string;
    enmascarados?: number;
    recuperados?: number;
    global?: MetricasImputacion;
    por_metodo?: Record<string, MetricasImputacion>;
    por_estacion?: (MetricasImputacion & { nombre_corto: string })[];
  };
  semaforo: {
    base: string;
    escala: TramoEscala[];
    global: Record<string, number>;
    por_estacion: {
      codigo_serial: number;
      nombre_corto: string;
      horas: number;
      verde: number;
      amarillo: number;
      naranja: number;
      rojo: number;
      purpura: number;
      marron: number;
    }[];
  };
  perfil_horario: {
    valle: { hora: number; n: number; p10?: number | null; p25?: number | null; mediana?: number | null; p75?: number | null; p90?: number | null; media?: number | null }[];
    por_estacion: Record<string, { hora: number; n: number; p10?: number | null; p25?: number | null; mediana?: number | null; p75?: number | null; p90?: number | null; media?: number | null }[]>;
    nombres: Record<string, string>;
  };
  heatmap: {
    dias: string[];
    valle: (number | null)[][];
    por_estacion: Record<string, (number | null)[][]>;
  };
  serie_diaria: {
    fechas: string[];
    valle: (number | null)[];
    por_estacion: Record<string, (number | null)[]>;
    nombres: Record<string, string>;
  };
  serie_ejemplo: {
    codigo_serial: number;
    nombre_corto: string;
    desde: string;
    hasta: string;
    puntos: { t: string; observado: number | null; serie: number | null; origen: string }[];
  };
}

export interface CampoMalla {
  snapshot: string;
  metodos: string[];
  metodo: string;
  campo: string;
  paso: number;
  malla: {
    lat_min: number;
    lat_max: number;
    lon_min: number;
    lon_max: number;
    nrows: number;
    ncols: number;
    resolucion_deg: number;
  };
  valores: (number | null)[];
}

export interface EstadoEtl {
  listo: boolean;
  carpeta: string;
  cargado_en: string | null;
  faltantes: string[];
  snapshot: string | null;
  generado_en: string | null;
  fuente: { source: string; realtime: boolean } | null;
  metodos: string[] | null;
}
