/**
 * Geolocalización HTML5 con mensajes de error en castellano.
 *
 * El navegador solo entrega la posición en contextos seguros: `localhost` o
 * HTTPS. Al probar desde el móvil contra `http://<ip-lan>:5173` el permiso se
 * deniega sin más explicación, así que ese caso se detecta y se avisa.
 */

export interface Posicion {
  latitud: number;
  longitud: number;
  precision_m: number | null;
  timestamp: number;
}

export class GeoError extends Error {
  constructor(
    message: string,
    readonly code: 'no_soportado' | 'contexto_inseguro' | 'permiso' | 'no_disponible' | 'timeout',
  ) {
    super(message);
    this.name = 'GeoError';
  }
}

const OPCIONES: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 12_000,
  maximumAge: 60_000,
};

export function obtenerPosicion(opciones: PositionOptions = OPCIONES): Promise<Posicion> {
  return new Promise((resolver, rechazar) => {
    if (!('geolocation' in navigator)) {
      rechazar(new GeoError('Este navegador no soporta geolocalización.', 'no_soportado'));
      return;
    }
    if (!window.isSecureContext) {
      rechazar(
        new GeoError(
          'El navegador solo entrega la ubicación por HTTPS o desde localhost. Abre la app en https:// o en http://localhost.',
          'contexto_inseguro',
        ),
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolver({
          latitud: pos.coords.latitude,
          longitud: pos.coords.longitude,
          precision_m: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
          timestamp: pos.timestamp,
        }),
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            rechazar(
              new GeoError(
                'Permiso de ubicación denegado. Actívalo en los ajustes del sitio y vuelve a intentar.',
                'permiso',
              ),
            );
            break;
          case error.POSITION_UNAVAILABLE:
            rechazar(new GeoError('No se pudo determinar tu ubicación en este momento.', 'no_disponible'));
            break;
          case error.TIMEOUT:
            rechazar(new GeoError('La ubicación tardó demasiado. Intenta de nuevo.', 'timeout'));
            break;
          default:
            rechazar(new GeoError(error.message || 'Error desconocido de geolocalización.', 'no_disponible'));
        }
      },
      opciones,
    );
  });
}

/** Estado del permiso sin pedirlo (si el navegador soporta Permissions API). */
export async function estadoPermiso(): Promise<PermissionState | 'desconocido'> {
  if (!('permissions' in navigator)) return 'desconocido';
  try {
    const estado = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return estado.state;
  } catch {
    return 'desconocido';
  }
}
