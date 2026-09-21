// Formato de visualización de matrículas, común a la app, los emails y el calendario.

/** 4821KLM → "4821 KLM" (formato actual). Otros formatos se muestran normalizados, sin más. */
export function displayPlate(plate) {
  const p = String(plate ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return /^\d{4}[A-Z]{3}$/.test(p) ? `${p.slice(0, 4)} ${p.slice(4)}` : p;
}
