# Aire Valle de Aburrá — PWA de calidad del aire con datos del SIATA

PWA instalable que responde una sola pregunta: **¿cómo está el aire exactamente donde estoy?**
Toma la posición GPS del dispositivo, la cruza con una malla de PM2.5 interpolada a partir de
las 21 estaciones del SIATA y devuelve el semáforo del ICA colombiano.

Monolito: un repositorio, un `package.json`, tres carpetas con responsabilidades separadas.

```
SIATA-IOT/
├── etl/                    Pipeline de datos en Python (pandas · numpy · scipy)
│   ├── config.py           Umbrales, bounding box y tabla del ICA — todo lo ajustable
│   ├── sources.py          Adaptadores de fuente: archivo, replay y tiempo real
│   ├── clean.py            Centinelas, rango físico, banderas de calidad, atípicos
│   ├── impute.py           Imputación en cascada: temporal → espacial → climatología
│   ├── interpolate.py      griddata linear/cubic/nearest + LOOCV + muestreo puntual
│   ├── analytics.py        Auditoría, semáforo histórico, perfil horario, validación
│   ├── ica.py              Concentración → ICA → categoría/color del semáforo
│   ├── report.py           Cronómetro por etapa y escritura atómica de artefactos
│   ├── pipeline.py         Orquestación de las etapas
│   └── run.py              CLI (`python -m etl.run`)
│
├── backend/                API en Node + Express 5 (sirve, no calcula)
│   ├── config.js
│   ├── index.js
│   ├── routes/             air.js · stations.js · etl.js
│   └── services/           artifacts.js · grid.js · ica.js · geo.js · replay.js
│
├── frontend/               PWA en React 19 + Vite 7 + TypeScript estricto + Recharts
│   ├── public/             manifest.webmanifest · sw.js · icons/
│   └── src/
│       ├── lib/            api.ts · geolocation.ts · pwa.ts · types.ts · viz.ts
│       ├── components/     Resultado · ComparadorMetodos · EstacionesCercanas · LeyendaIca · MapaMalla
│       │   └── charts/     Marco · SemaforoEstaciones · PerfilHorario · MapaCalor ·
│       │                   SerieAnual · CalidadDatos · Reconstruccion
│       └── views/          Analizar.tsx · Analisis.tsx · ProcesoEtl.tsx
│
├── data/
│   ├── raw/                Datos_SIATA_Aire_pm25.json (entrada, 18,6 MB)
│   └── processed/          Artefactos del ETL (generados)
│
└── scripts/make-icons.mjs  Genera los PNG de la PWA sin dependencias
```

---

## Arranque rápido

Requisitos: **Node ≥ 20.19** y **Python ≥ 3.11** (probado en 3.13 con pandas 3.0).

> En Windows, si `python` abre la tienda de Microsoft, el instalador no agregó el intérprete al
> PATH. Usa la ruta completa —`%LOCALAPPDATA%\Programs\Python\Python313\python.exe`— o vuelve a
> ejecutar el instalador con «Add python.exe to PATH» marcado.

```bash
npm install
```

```bash
pip install -r requirements.txt
```

```bash
python -m etl.run
```

```bash
npm run dev:full
```

El sitio queda en `http://localhost:5173` y la API en `http://localhost:8787/api`.
El frontend llama rutas relativas (`/api/...`) y el proxy de Vite las enruta a Express, así que
la app funciona igual en desarrollo que compilada.

| Script | Qué hace |
|---|---|
| `npm run dev` | Solo el frontend (Vite con HMR) |
| `npm run dev:api` | Solo la API, con recarga (`node --watch`) |
| `npm run dev:full` | Ambos en paralelo — lo habitual |
| `npm run build` | Type-check + build de producción a `frontend/dist` |
| `npm start` | Producción: Express sirve la API **y** el build |
| `npm run etl` | Atajo de `python -m etl.run` |
| `npm run icons` | Regenera los iconos de la PWA |

> Sin haber corrido el ETL la app **igual funciona**: el backend cae al modo de tiempo real
> simulado e interpola en línea con IDW sobre el histórico. La comparación de los tres métodos
> y la vista «Proceso ETL» sí requieren los artefactos de Python.

---

## 1 · Los datos de entrada

`data/raw/Datos_SIATA_Aire_pm25.json` — un arreglo con una entrada por estación:

```json
[{ "codigoSerial": 3, "nombre": "Girardota - S.O.S Aburrá Norte", "nombreCorto": "GIR-SOSN",
   "latitud": 6.3784332, "longitud": -75.4511414,
   "datos": [{ "variableConsulta": "pm25", "fecha": "2019-02-21 04:00:00",
               "calidad": "1.0", "valor": 34.0 }] }]
```

Lo que hay realmente dentro (perfilado antes de escribir el pipeline):

| Hecho | Valor |
|---|---|
| Estaciones | 21 (Medellín, Bello, Itagüí, Envigado, Sabaneta, Caldas, La Estrella, Copacabana, Girardota, Barbosa) |
| Rango temporal | 2019-02-21 04:00 → 2020-02-21 04:00, horario |
| Registros | 183 981 (8 761 por estación, rejilla completa) |
| Nulos JSON | 0 — **el faltante viene disfrazado** |
| Centinelas `-9999` | 1 009 |
| Negativos residuales | 1 279 (deriva de cero del sensor) |
| Valores > 1 000 µg/m³ | 464 (saturación; el máximo bruto es 115 035) |
| `calidad` ≠ 1.0 | 12 928 (7 %) — dato no validado por el SIATA |

Que no haya un solo `null` es justamente la trampa del dataset: si se carga tal cual, esos
`-9999` y esos `115035` entran al promedio y arruinan el ICA. De ahí el orden del pipeline.

---

## 2 · El ETL

```bash
python -m etl.run                                   # última hora disponible
python -m etl.run --at "2020-01-15 08:00:00"        # publicar una hora concreta
python -m etl.run --methods linear cubic nearest    # métodos a comparar
python -m etl.run --incluir-trafico                 # no excluir las estaciones de tráfico
python -m etl.run --dry-run                         # correr sin escribir artefactos
```

### Etapas

**1. Extracción** — `sources.py` normaliza cualquier fuente al mismo esquema
(`codigo_serial`, `fecha`, `variable`, `valor`, `calidad`). El resto del pipeline no sabe si
los datos vienen de un archivo o de una API.

**2. Limpieza** — se trabaja sobre una matriz `fecha × estación`, de modo que una celda vacía
*es* un faltante. Cada descarte queda con su motivo:

| Motivo | Regla |
|---|---|
| `ausente` | la hora no existe en la fuente |
| `centinela` | `valor ≤ -900` |
| `negativo` | `valor < 0` |
| `cero_sensor` | `valor == 0.0` exacto — ver abajo |
| `fuera_rango` | `valor > 1000 µg/m³` |
| `bandera_calidad` | `calidad ≠ 1.0` (se marca; no se elimina por defecto) |
| `atipico_local` | filtro de **Hampel**: se aleja > 4 MAD de su mediana móvil de 25 h |
| `atipico_espacial` | > 5 MAD respecto a la mediana del valle en esa misma hora |

Sobre el cero exacto: el archivo trae **995 lecturas de exactamente `0.0` y ninguna en el
intervalo `(0, 1)`**. Una distribución real no tiene un pico en cero con un vacío justo encima;
es el piso del instrumento, la misma familia que la deriva negativa. Se trata como dato ausente
y se imputa. La regla se puede desactivar con `zero_is_missing = False` en `etl/config.py`.

Hampel en vez de z-score clásico porque la media y la desviación estándar se contaminan
justamente con los picos que se quieren detectar; la mediana y la MAD no.

**3. Imputación en cascada** — de la evidencia más cercana a la más genérica:

1. **Temporal** (huecos ≤ 3 h): interpolación lineal sobre la propia serie.
2. **Espacial escalada** (huecos ≤ 48 h): combinación IDW de las 4 estaciones vecinas,
   reescalando cada una por la **razón mediana histórica** contra la estación objetivo. Copiar
   la vecina tal cual es el error clásico: una estación de tráfico y una de fondo no miden lo
   mismo aunque estén a 1 km.
3. **Climatología**: mediana histórica de la estación para ese mes y esa hora del día; si no
   alcanza, la mediana del valle.

Cada celda queda etiquetada con el método que la rellenó (`observado`, `temporal`, `espacial`,
`climatologia`, `sin_dato`) y eso se reporta por estación.

**4. Agregación** — media móvil de 24 h con mínimo 18 horas válidas, que es la base que la
norma define para el ICA de PM2.5.

**5. Interpolación espacial** — `scipy.interpolate.griddata` sobre una malla regular del valle
(bbox 6,05–6,50 N / −75,72 a −75,28 W, resolución 0,005° ≈ 550 m ≈ 8 100 celdas):

| Método | Qué hace | Cuándo conviene |
|---|---|---|
| `nearest` | Voronoi. Cubre toda la malla, discontinuo | respaldo fuera del casco convexo |
| `linear` | Delaunay + baricéntrica. Continua y acotada | **por defecto** |
| `cubic` | Clough-Tocher C1. Suave | gradientes plausibles; puede sobrepasar el rango |

Antes de triangular, la longitud se escala por `cos(lat_media)`: `griddata` trabaja en el plano
y sin esa corrección la triangulación sale deformada.

#### Las estaciones de tráfico no son nodos

**CEN-TRAF** y **SUR-TRAF** miden el microentorno de una calzada, no el aire de fondo del
sector. Usarlas como vértices arrastra toda la superficie hacia arriba. Se excluyen de la
interpolación —pero **siguen publicándose** en `stations.json`, en el análisis histórico y en la
lista de «estaciones cercanas» de la app, marcadas como `tráfico`: son mediciones legítimas.

La decisión está medida, no intuida. El experimento compara los dos escenarios sobre **las
mismas 19 estaciones de fondo** en 250 horas al azar, variando solo si las de tráfico están
disponibles como predictoras:

| Método | MAE con tráfico | MAE sin tráfico | Δ | Sesgo con → sin |
|---|---|---|---|---|
| linear | 4,34 | **3,36** | −22,7 % | +0,87 → −0,29 |
| cubic | 5,78 | **3,91** | −32,3 % | +2,51 → +0,17 |
| nearest | 5,22 | **4,00** | −23,3 % | +2,36 → +0,72 |

Lo relevante no es solo el error menor: el **sesgo sistemático desaparece**. Con las de tráfico
dentro, la interpolación sobreestimaba el aire de fondo de forma consistente.

El filtro es por nombre (`exclude_name_pattern = r"tr[áa]fico"`) para que el criterio siga
valiendo si el SIATA añade estaciones de tráfico nuevas; `exclude_serials` permite añadir
exclusiones manuales. Para volver al comportamiento anterior:

```bash
python -m etl.run --incluir-trafico
```

`linear` y `cubic` devuelven `NaN` fuera del casco convexo de las estaciones. Esa ausencia se
conserva como información: se rellena con `nearest` y la celda queda marcada como
**extrapolada**, y la app lo advierte al usuario.

**6. Validación cruzada (LOOCV)** — única forma honesta de comparar los tres métodos con estos
datos: se esconde cada estación, se interpola en su coordenada con las otras 20 y se mide el
error contra lo que de verdad midió. Salen MAE, RMSE, sesgo, R² y error máximo por método.

Hay una trampa aquí que el pipeline resuelve explícitamente: al esconder una estación que está
en el **casco convexo**, `linear` y `cubic` ya no pueden predecirla (queda fuera de la
triangulación) mientras que `nearest` siempre responde. En este dataset eso deja a linear/cubic
evaluándose sobre 13 estaciones y a nearest sobre 21 — muestras distintas, MAE no comparables.
Por eso se reporta además **`mae_comun`**, calculado sobre las 13 estaciones que los tres
métodos alcanzan, y es ese el criterio que elige el mejor método.

**7. Publicación** — artefactos JSON en `data/processed/`:

| Artefacto | Contenido |
|---|---|
| `meta.json` | versión, fuente, snapshot, índice de archivos |
| `stations.json` | estaciones con su lectura, ICA y trazabilidad del dato |
| `grid.json` | malla interpolada por método, campos `pm25_24h` y `pm25_1h` |
| `etl_report.json` | el proceso completo, etapa por etapa |
| `analytics.json` | analítica descriptiva del histórico (vista «Análisis») |
| `ica_scale.json` | tabla del semáforo (fuente de verdad del frontend) |
| `runs.json` | historial de las últimas 50 ejecuciones |

### Resultados de la corrida sobre el histórico completo

Verificado con Python 3.13 / pandas 3.0.6 / numpy 2.5.3 / scipy 1.18.1. Duración: **1,5 s**.

```
Cobertura cruda   : 96,10 %   →  completitud tras imputar: 100,00 %
Descartes         : centinela 1 009 · negativo 1 279 · cero_sensor 995 · fuera_rango 464
                    bandera_calidad 9 589 · atípico_local 2 331 · atípico_espacial 1 102
Imputaciones      : temporal 6 628 · espacial 399 · climatología 153
Snapshot          : 2020-02-21 04:00, 21 estaciones con dato
```

LOOCV sobre el promedio de 24 h del snapshot (µg/m³):

| Método | n | MAE* | MAE | RMSE | Sesgo | R² |
|---|---|---|---|---|---|---|
| **linear** ★ | 11 | **2,99** | 2,99 | 4,20 | −0,37 | −0,12 |
| cubic | 11 | 4,79 | 4,79 | 5,67 | −0,01 | −1,05 |
| nearest | 19 | 3,60 | 3,44 | 4,54 | +0,31 | −0,74 |

`MAE*` es el error sobre las 11 estaciones que los tres métodos alcanzan. Sin esa corrección
`nearest` parece más competitivo de lo que es, porque se evalúa sobre una muestra más fácil.

> Ojo al comparar con la corrida anterior (linear 5,25 → 2,99): **parte de esa caída no es
> mérito del cambio**. Al excluir las dos estaciones de tráfico también se deja de intentar
> predecirlas, y eran las dos más difíciles de la red. La medición limpia del efecto es la tabla
> del experimento controlado de arriba —mismas 19 estaciones objetivo en los dos escenarios—,
> que da entre −23 % y −32 %.

**El R² sigue siendo negativo y eso es un hallazgo, no un error.** Excluir las estaciones de
tráfico lo mejoró mucho (linear: −0,62 → −0,12) porque eran la mayor fuente de varianza no
explicable, pero en esa hora el campo de fondo es casi plano y ITA-CJUS (39,0) sigue siendo un
punto alto que sus vecinas no anticipan. Conclusión práctica sin cambios: el valor interpolado
sirve como **referencia de fondo del sector**, no como sustituto de una medición puntual, y la
app lo dice. La vista «Proceso ETL» muestra ese aviso automáticamente cuando el R² sale
negativo.

Otro número que conviene leer bien: **83 % de las celdas de la malla quedan marcadas como
extrapoladas**. No es un fallo del pipeline sino la geometría del problema — las 21 estaciones
forman un corredor diagonal estrecho y el *bounding box* es un rectángulo, así que la mayor
parte del rectángulo cae fuera del casco convexo y se rellena con `nearest`. Los puntos poblados
del valle sí están dentro del casco.

---

## 2b · Analítica descriptiva (`etl/analytics.py`)

El cuaderno exploratorio `datos_siata.py` sirvió de referencia para esta capa: auditoría de
datos, atípicos por estación, semáforo, perfil horario, mapa de calor día × hora y validación
de la imputación por enmascaramiento. Aquí se lleva a las 21 estaciones y se publica en
`analytics.json` para que el frontend solo tenga que dibujar.

Dos diferencias deliberadas frente al cuaderno:

- **La validación mide el sistema real.** El cuaderno esconde datos y los recupera con
  interpolación temporal. Aquí se enmascara el 5 % de las observaciones buenas de toda la red
  (semilla fija, reproducible) y se vuelve a ejecutar **la cascada completa de producción**. El
  resultado sobre el histórico: **MAE 4,1 µg/m³, RMSE 5,5, sesgo +0,01** en 8 889 valores.
- **El semáforo se calcula sobre la media móvil de 24 h**, que es la base que define la norma,
  y no sobre el dato horario suelto.

Una limitación honesta del método: como el enmascaramiento es aleatorio, casi todos los huecos
que genera son de una sola hora y los resuelve la etapa temporal. La estrategia espacial apenas
recibe un par de casos, así que su error medido no es representativo. Para evaluarla de verdad
habría que enmascarar **tramos** completos, no puntos sueltos.

Lo que sale del año analizado:

| Pregunta | Respuesta |
|---|---|
| ¿Cómo estuvo el aire? | 17,1 % del tiempo bueno · 77,8 % moderado · 4,6 % dañino a grupos sensibles · 0,5 % dañino |
| ¿Dónde se respira mejor? | Barbosa (BAR-TORR), 57 % del año en verde |
| ¿Dónde peor? | Estación Tráfico Centro (CEN-TRAF), 0,2 % del año en verde |
| ¿A qué hora? | Peor hacia las 9:00, mejor hacia las 16:00 |
| ¿Qué día? | Peor el viernes a las 9:00, mejor el domingo a las 16:00 |
| ¿El peor día del año? | 2019-03-17 con 57,2 µg/m³; 13 días superaron el umbral naranja |
| ¿Qué estación pierde más datos? | SUR-TRAF, 8,9 % descartado (el doble que la siguiente) |

---

## 3 · El semáforo (ICA)

Puntos de corte de la **Resolución 2254 de 2017** (MinAmbiente), que es la tabla que publica el
SIATA, aplicados sobre el promedio móvil de 24 h:

| Color | Categoría | PM2.5 (µg/m³) | ICA |
|---|---|---|---|
| 🟢 Verde | Buena | 0 – 12 | 0 – 50 |
| 🟡 Amarillo | Moderada | 12,1 – 37 | 51 – 100 |
| 🟠 Naranja | Dañina a grupos sensibles | 37,1 – 55 | 101 – 150 |
| 🔴 Rojo | Dañina a la salud | 55,1 – 150 | 151 – 200 |
| 🟣 Púrpura | Muy dañina a la salud | 150,1 – 250 | 201 – 300 |
| 🟤 Marrón | Peligrosa | 250,1 – 500 | 301 – 500 |

`ICA = (ICA_hi − ICA_lo) / (C_hi − C_lo) × (C − C_lo) + ICA_lo`, con la concentración truncada a
un decimal como exige la norma. La tabla vive en `etl/config.py`; el frontend la consume vía
`/api/ica/escala` para que nunca haya dos versiones del semáforo.

---

## 4 · La API

| Ruta | Para qué |
|---|---|
| `GET /api/health` | estado del servicio y del ETL |
| `GET /api/meta` | metadatos de la última corrida |
| `GET /api/air?lat=&lon=&metodo=&campo=` | **diagnóstico en un punto** (lo que llama el botón) |
| `GET /api/stations?lat=&lon=` | red de estaciones, opcionalmente por cercanía |
| `GET /api/ica/escala` | tabla del semáforo |
| `GET /api/etl/status` | ¿hay artefactos? ¿de cuándo? |
| `GET /api/etl/report` | reporte completo del pipeline |
| `GET /api/etl/analytics` | analítica descriptiva (alimenta las gráficas) |
| `GET /api/etl/runs` | historial de ejecuciones |
| `GET /api/etl/grid?metodo=&campo=&max=` | campo interpolado para pintar (submuestreable) |

`/api/air` devuelve el diagnóstico con el método elegido **y** la comparación con los otros dos,
la estación real más cercana y las advertencias que apliquen (punto extrapolado, fuera del
valle, malla ausente). La comparación sale en la misma respuesta para que cambiar de método en
la interfaz no dispare otra consulta.

El backend **no recalcula nada del ETL**: lee `data/processed/`, vigila los `mtime` y recarga en
caliente. Si el ETL vuelve a correr, la API sirve lo nuevo sin reiniciarse.

Cruzar la coordenada con la malla es una interpolación bilineal entre las cuatro celdas que
rodean al punto (`backend/services/grid.js`), el mismo cálculo que `etl/interpolate.py::sample_point`.

---

## 5 · La PWA

- **Instalable**: `manifest.webmanifest` con iconos 192/512 y uno *maskable*, `display:
  standalone`, y accesos directos a «Analizar» y «Proceso ETL».
- **Offline básico** (`public/sw.js`): el *app shell* va cache-first, la API network-first con
  respaldo en caché marcado con `X-Desde-Cache`. La calidad del aire caduca, así que **nunca**
  se sirve caché habiendo red. El último diagnóstico también queda en `localStorage` para poder
  mostrarlo sin conexión, fechado.
- **Geolocalización HTML5** (`src/lib/geolocation.ts`): errores traducidos y detección del caso
  que más confunde — el navegador solo entrega la posición en **contexto seguro** (HTTPS o
  `localhost`). Probando desde el móvil contra `http://<ip-lan>:5173` el permiso se deniega sin
  explicación; la app lo dice explícitamente.
- **Dos vistas**: «Analizar» (un botón, un resultado, comparación de métodos, estaciones que lo
  sostienen, leyenda) y «Proceso ETL».

### La vista «Análisis» (gráficas)

Pensada para alguien que no sabe qué es un percentil. Usa **Recharts**, que se carga con
`React.lazy` solo al abrir la pestaña: la pantalla principal se queda en 75 kB gzip en vez de
208 kB.

| Gráfica | Forma | Por qué esa forma |
|---|---|---|
| Reparto del año | barra única al 100 % | la conclusión en una sola línea, con el porcentaje escrito encima |
| El año día a día | línea sobre franjas del ICA | la gráfica del cuaderno; el color de fondo dice si el día fue bueno |
| ¿Dónde se respira mejor? | barras apiladas por estación | ranking directo: «¿qué tan limpio es el aire en mi zona?» |
| ¿A qué hora está peor? | banda p10–p90 + mediana | un diagrama de caja es preciso pero ilegible sin entrenamiento; la banda se lee sola |
| Día × hora | mapa de calor, rampa de un tono | codifica magnitud, no categorías: un arcoíris inventaría fronteras |
| Confiabilidad de los datos | barras del % descartado | en una barra al 100 % el 3 % que importa queda invisible |
| Medición vs. estimación | puntos + línea | donde la línea avanza sin puntos, el pipeline está rellenando |

Decisiones de color, tomadas con el validador de contraste/CVD y no a ojo:

- El par **azul/naranja** para «utilizable vs. descartado» en lugar de verde/rojo: ese par mide
  ΔE 4,1 en deuteranopía, es decir, indistinguible para el daltonismo más frecuente.
- El **semáforo del ICA no se puede recolorear** — lo fija la norma — y su púrpura y marrón
  quedan por debajo de 3:1 contra el fondo oscuro. La compensación es que toda gráfica que lo
  use lleva etiquetas visibles y un botón **«Ver tabla»**: el color nunca carga solo con el
  significado.
- La rampa del mapa de calor es de un solo tono ámbar, luminosidad monótona verificada.

### Verificar que la ubicación funciona

Bajo el botón principal hay un desplegable **«Consultar una coordenada concreta»**. Si escribes
la coordenada exacta de una estación, el resultado debe indicarla a **0,00 km**. También
funciona por URL: `?lat=6.1555305&lon=-75.6441727`.

Ejemplo con **EST-HOSP** (código serial 78, «La Estrella - Hospital», `6.1555305, -75.6441727`):

```
Estación más cercana: EST-HOSP a 0.00 km · midió 23.96 µg/m³
vecino más cercano: 24.0   ·   lineal: 24.7   ·   cúbica: 24.9
```

El aviso de «fuera del casco convexo» que aparece ahí es correcto y esperado: EST-HOSP es un
vértice del casco de la red, así que en su propia coordenada `linear` y `cubic` no tienen
triángulo que las sostenga y caen al vecino más cercano. Es la misma razón por la que esa
estación no tiene error LOOCV para esos dos métodos.

### La vista «Proceso ETL»

Es la trazabilidad del número que se le muestra al usuario:

- KPIs de la corrida: snapshot, cobertura cruda, completitud tras imputar, mejor método, duración.
- Las etapas del pipeline con su duración y sus métricas.
- Calidad: barra de descartes por motivo y tabla por estación (cobertura, centinelas, atípicos,
  hueco máximo).
- Imputación: cuántos valores puso cada estrategia.
- Interpolación: tabla LOOCV de los tres métodos y el campo interpolado pintado en un canvas
  con las estaciones reales encima; se puede alternar el método y ver cómo cambia el mapa.
- Historial de ejecuciones.

---

## 6 · Tiempo real (la puerta que queda abierta)

El diseño ya separa *de dónde vienen los datos* de *qué se hace con ellos*. Hay tres fuentes en
`etl/sources.py`, todas con el mismo contrato `fetch() -> (observaciones, estaciones)`:

| Fuente | Estado | Uso |
|---|---|---|
| `FileSource` | lista | histórico completo |
| `ReplaySource` | lista | reproduce el histórico como si llegara ahora (`--source replay --at ...`) |
| `LiveSiataSource` | **pendiente** | API pública del SIATA |

Para pasar a tiempo real:

1. Implementar `LiveSiataSource.fetch()` pidiendo una ventana móvil (48 h basta para sostener el
   ICA de 24 h) y devolviendo el esquema normalizado. Es lo único que falta.
2. Programar el mismo comando cada N minutos (cron, Task Scheduler o un contenedor):
   ```bash
   python -m etl.run --source live --base-url https://siata.gov.co/<endpoint>
   ```
3. No hay que tocar nada más: el backend detecta los artefactos nuevos y los sirve, y
   `runs.json` deja el historial para vigilar el pipeline desde la propia app.

Mientras tanto, `backend/services/replay.js` ya ejerce ese camino: interpola **en línea**
(IDW + vecino más cercano) sin malla precalculada, que es como tendrá que responder el sistema
si algún día se quiere consultar a demanda en lugar de por lotes. `linear` y `cubic` se quedan
en el ETL a propósito: necesitan triangulación de Delaunay y es ahí donde además ocurren la
limpieza y la imputación serias.

---

## 7 · Configuración

Todo por variables de entorno (ver `.env.example`).

| Variable | Defecto | Para qué |
|---|---|---|
| `PORT` / `HOST` | 8787 / 127.0.0.1 | API |
| `PROCESSED_DIR` | `./data/processed` | dónde busca los artefactos |
| `RAW_FILE` | `./data/raw/Datos_SIATA_Aire_pm25.json` | archivo crudo (modo replay) |
| `DEFAULT_METHOD` | `linear` | método de `/api/air` |
| `REPLAY_ENABLED` | `true` | activa el modo tiempo real simulado |
| `REPLAY_AT` | última hora | qué hora se hace pasar por «ahora» |
| `RELOAD_INTERVAL_MS` | 15000 | cada cuánto revisa artefactos nuevos |

El ETL lee sus propias variables con prefijo `SIATA_` (p. ej. `SIATA_RAW_FILE`), pero lo normal
es ajustar `etl/config.py`, donde están los umbrales con su justificación.

---

## Advertencia

Esta aplicación es una **estimación interpolada** a partir de datos abiertos y no sustituye los
boletines oficiales del AMVA ni del SIATA. Fuera del casco convexo de las estaciones el valor es
una extrapolación y la interfaz lo señala.
