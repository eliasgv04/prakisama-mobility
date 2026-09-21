// Normalización y validación de matrículas españolas. Avisa, pero nunca bloquea:
// la app admite maquinaria, remolques y matrículas raras, así que un formato no
// reconocido solo genera una advertencia.

// Letras de las matrículas actuales: sin vocales, sin Ñ, sin Q.
const CONSONANTS = 'BCDFGHJKLMNPRSTVWXYZ';

const FORMATS = [
  { id: 'actual', label: 'formato actual', re: new RegExp(`^\\d{4}[${CONSONANTS}]{3}$`) },
  { id: 'especial', label: 'remolque o vehículo especial', re: new RegExp(`^[ER]\\d{4}[${CONSONANTS}]{3}$`) },
  // Provinciales antiguas: M1234AB, B1234C, y las anteriores de solo letras + números.
  { id: 'antiguo', label: 'formato provincial antiguo', re: /^[A-Z]{1,2}\d{4}[A-Z]{1,2}$/ },
  { id: 'antiguo', label: 'formato provincial antiguo', re: /^[A-Z]{1,2}\d{4,6}$/ },
];

/** Mayúsculas, sin espacios, guiones ni otros símbolos: "1234-bcd" → "1234BCD". */
export function normalizeMatricula(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * @returns {{plate:string, valid:boolean, format:string|null, message:string|null}}
 * `valid` es informativo: la interfaz muestra `message` como aviso y deja guardar igualmente.
 */
export function validateMatricula(input) {
  const plate = normalizeMatricula(input);
  if (!plate) return { plate, valid: false, format: null, message: null };
  const match = FORMATS.find((f) => f.re.test(plate));
  if (match) return { plate, valid: true, format: match.id, message: null };
  return {
    plate,
    valid: false,
    format: null,
    message: 'No reconozco este formato de matrícula (lo habitual es 4 números y 3 letras, como 1234 BCD). Revísala; puedes guardarla igualmente.',
  };
}

// Formato para mostrar ("1234 BCD"): compartido con los emails y el calendario.
export { displayPlate } from '@shared/plate.js';
