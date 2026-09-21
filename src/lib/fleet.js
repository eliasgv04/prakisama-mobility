// Carga la flota y calcula estados (une api.js con la lógica pura de @shared).

import { todayISO } from '@shared/dates.js';
import { buildFleetStatus, vehicleDisplayName } from '@shared/fleet.js';
import { getSnapshot } from './api.js';

/** @returns {Promise<{snapshot:object, offline:boolean, cachedAt:string|null, today:string, status:ReturnType<typeof buildFleetStatus>}>} */
export async function loadFleet(opts) {
  const { snapshot, offline, cachedAt } = await getSnapshot(opts);
  const today = todayISO();
  return { snapshot, offline, cachedAt, today, status: buildFleetStatus(snapshot, today) };
}

export { vehicleDisplayName };

/** Etiqueta corta de dónde sale la fecha de ITV: manual, calculada, estimada o según tarjeta. */
export function itvSourceTag(itv) {
  if (itv.source === 'manual') return 'Manual';
  if (itv.source === 'inspection') return itv.retest ? 'Repetir ITV' : 'Según tarjeta ITV';
  if (itv.source === 'calculated') return itv.estimated ? 'Calculada (estimada)' : 'Calculada';
  return null;
}
