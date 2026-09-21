// Lectura de todos los datos necesarios para calcular vencimientos.
// Recibe un cliente de supabase-js, así sirve igual para el navegador (con la sesión del usuario,
// sujeto a RLS) y para las Edge Functions (con la service role, sin RLS).
// La flota es pequeña (decenas de vehículos), por eso se carga entera y se calcula en memoria.

const must = ({ data, error }, what) => {
  if (error) throw new Error(`No se pudo leer ${what}: ${error.message}`);
  return data ?? [];
};

/** @returns {Promise<import('./fleet.js').Snapshot>} */
export async function fetchSnapshot(client) {
  const [vehicles, itvRules, inspections, maintRules, lastMaint, settings] = await Promise.all([
    client.from('vehicles').select('*').order('plate'),
    client.from('itv_rules').select('*'),
    client.from('itv_inspections').select('id, vehicle_id, inspection_date, result, valid_until, created_at'),
    client.from('maintenance_rules').select('*'),
    client.from('v_last_maintenance').select('*'),
    client.from('notification_settings').select('*').maybeSingle(),
  ]);
  if (settings.error) throw new Error(`No se pudo leer los ajustes: ${settings.error.message}`);
  return {
    vehicles: must(vehicles, 'vehículos'),
    itvRules: must(itvRules, 'reglas de ITV'),
    inspections: must(inspections, 'inspecciones'),
    maintRules: must(maintRules, 'reglas de mantenimiento'),
    lastMaint: must(lastMaint, 'último mantenimiento'),
    settings: settings.data ?? null,
  };
}
