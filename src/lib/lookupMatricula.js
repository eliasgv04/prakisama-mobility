// Punto de extensión para consultar datos de un vehículo por su matrícula.
//
// HOY NO HAY NINGÚN SERVICIO CONECTADO: la función devuelve null y la fecha de primera
// matriculación se introduce a mano. Cuando se contrate un servicio externo (de pago), basta con
// implementar aquí la llamada y devolver el objeto descrito abajo; el resto de la app ya la
// invoca y rellena el formulario con lo que llegue, sin más cambios.
//
// Ojo: una API de pago no debe llamarse directamente desde el navegador con su clave. Lo correcto
// será hacerlo desde una Edge Function (con la clave como secreto) y llamar a esa función desde aquí.

/**
 * @param {string} matricula matrícula ya normalizada (mayúsculas, sin espacios ni guiones)
 * @returns {Promise<null | {firstRegistrationDate?: string, brand?: string, model?: string}>}
 *   `firstRegistrationDate` en formato YYYY-MM-DD. null si no hay datos o no hay servicio.
 */
// eslint-disable-next-line no-unused-vars
export async function lookupMatricula(matricula) {
  return null;
}
