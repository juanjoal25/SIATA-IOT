/** Registro del Service Worker y memoria del último diagnóstico (modo offline). */
import type { RespuestaAire } from './types';

const CLAVE_ULTIMO = 'siata-aire:ultimo-diagnostico';

export function registrarServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // En desarrollo el SW interfiere con el HMR de Vite.
  if (import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((error) => console.warn('[pwa] no se pudo registrar el service worker', error));
  });
}

export function guardarUltimo(respuesta: RespuestaAire): void {
  try {
    localStorage.setItem(CLAVE_ULTIMO, JSON.stringify({ respuesta, guardado_en: Date.now() }));
  } catch {
    /* almacenamiento lleno o bloqueado: el offline simplemente no tendrá respaldo */
  }
}

export function leerUltimo(): { respuesta: RespuestaAire; guardado_en: number } | null {
  try {
    const crudo = localStorage.getItem(CLAVE_ULTIMO);
    return crudo ? JSON.parse(crudo) : null;
  } catch {
    return null;
  }
}

/** Suscripción al estado de conexión, para avisar cuando se trabaja sin red. */
export function observarConexion(alCambiar: (enLinea: boolean) => void): () => void {
  const manejar = () => alCambiar(navigator.onLine);
  window.addEventListener('online', manejar);
  window.addEventListener('offline', manejar);
  return () => {
    window.removeEventListener('online', manejar);
    window.removeEventListener('offline', manejar);
  };
}
