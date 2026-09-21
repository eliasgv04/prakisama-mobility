// Utilidades de red.

/**
 * Rechaza si `promise` tarda más de `ms`. El mensaje incluye "Failed to fetch" para que
 * isNetworkError() lo trate como falta de conexión y la app use los datos guardados.
 * (Con cobertura mala la librería reintenta durante varios segundos antes de rendirse.)
 */
export function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Failed to fetch (tiempo de espera agotado)')), ms);
  });
  promise.catch(() => {}); // si pierde la carrera, que no quede un rechazo sin atender
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
