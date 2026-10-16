/**
 * Service Worker: offline básico.
 *
 * - App shell (HTML, JS, CSS, iconos): cache-first con revalidación en segundo
 *   plano. La app abre aunque no haya red.
 * - API: network-first con respaldo en caché. Sin conexión se devuelve la
 *   última respuesta conocida marcada con la cabecera `X-Desde-Cache`, para que
 *   la interfaz pueda advertir que el dato no es fresco.
 *
 * La calidad del aire caduca: nunca se sirve caché de la API habiendo red.
 */
const VERSION = 'v1';
const SHELL = `siata-shell-${VERSION}`;
const DATOS = `siata-datos-${VERSION}`;

const PRECARGA = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECARGA))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(claves.filter((k) => ![SHELL, DATOS].includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(redPrimero(request));
    return;
  }
  event.respondWith(cachePrimero(request));
});

/** Datos: la red manda; la caché es el plan B cuando no hay conexión. */
async function redPrimero(request) {
  const cache = await caches.open(DATOS);
  try {
    const respuesta = await fetch(request);
    if (respuesta.ok) cache.put(request, respuesta.clone());
    return respuesta;
  } catch (error) {
    const guardada = await cache.match(request);
    if (guardada) {
      const cabeceras = new Headers(guardada.headers);
      cabeceras.set('X-Desde-Cache', '1');
      return new Response(await guardada.blob(), {
        status: guardada.status,
        statusText: guardada.statusText,
        headers: cabeceras,
      });
    }
    return new Response(
      JSON.stringify({
        error: 'sin_conexion',
        mensaje: 'Sin conexión y sin datos guardados para esta consulta.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/** Shell: responde desde caché al instante y actualiza por detrás. */
async function cachePrimero(request) {
  const cache = await caches.open(SHELL);
  const guardada = await cache.match(request, { ignoreSearch: true });
  const red = fetch(request)
    .then((respuesta) => {
      if (respuesta.ok) cache.put(request, respuesta.clone());
      return respuesta;
    })
    .catch(() => null);

  if (guardada) {
    red.catch(() => {});
    return guardada;
  }
  const respuesta = await red;
  if (respuesta) return respuesta;
  // Navegación sin caché ni red: se entrega el shell para no mostrar el error del navegador.
  return (await cache.match('/index.html')) ?? Response.error();
}
