// Une los datos de la BD (snapshot) con las reglas puras y produce la lista de vencimientos.
// La usan por igual el panel de la app, el email diario y el feed .ics, para que los tres
// coincidan siempre.

import { DEFAULT_SETTINGS, MAINTENANCE_KINDS, STATUS } from './constants.js';
import { diffDays, formatES, isoDateOf } from './dates.js';
import { resolveItv } from './itv.js';
import { evaluateRule } from './maintenance.js';
import { compareUrgency, statusFromDays, worstStatus } from './status.js';

/** @typedef {{vehicles:object[], itvRules:object[], inspections:object[], maintRules:object[], lastMaint:object[], settings:object|null}} Snapshot */

export const normalizeSettings = (settings) => ({ ...DEFAULT_SETTINGS, ...(settings ?? {}) });

export const vehicleDisplayName = (v) => v.alias?.trim() || [v.brand, v.model].filter(Boolean).join(' ').trim() || '';

function groupBy(list, key) {
  const map = new Map();
  for (const item of list) {
    const k = item[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

/**
 * Calcula el estado de toda la flota.
 * @param {Snapshot} snapshot
 * @param {string} today YYYY-MM-DD
 * @param {{tz?:string}} [opts]
 * @returns {{items:object[], byVehicle:Map<string,object>, counts:{overdue:number,soon:number,ok:number}, settings:object}}
 */
export function buildFleetStatus(snapshot, today, opts = {}) {
  const settings = normalizeSettings(snapshot.settings);
  const maxLead = Math.max(0, ...settings.lead_days);
  const itvRuleByType = new Map(snapshot.itvRules.map((r) => [r.vehicle_type, r]));
  const inspectionsByVehicle = groupBy(snapshot.inspections, 'vehicle_id');
  const rulesByVehicle = groupBy(
    snapshot.maintRules.filter((r) => r.active !== false),
    'vehicle_id',
  );
  const lastByKey = new Map(snapshot.lastMaint.map((m) => [`${m.vehicle_id}:${m.kind}`, m]));

  const items = [];
  const byVehicle = new Map();

  for (const vehicle of snapshot.vehicles) {
    const base = { vehicleId: vehicle.id, plate: vehicle.plate, vehicleName: vehicleDisplayName(vehicle), unit: vehicle.usage_unit };
    const vehicleItems = [];

    // --- ITV ---
    const itv = resolveItv({
      vehicle,
      rule: itvRuleByType.get(vehicle.vehicle_type) ?? null,
      inspections: inspectionsByVehicle.get(vehicle.id) ?? [],
      today,
    });
    let itvView = { ...itv, status: STATUS.OK, daysRemaining: null };
    if (itv.applies && itv.dueDate) {
      const daysRemaining = diffDays(today, itv.dueDate);
      const status = statusFromDays(daysRemaining, maxLead);
      itvView = { ...itv, status, daysRemaining };
      vehicleItems.push({
        ...base,
        id: `itv:${vehicle.id}`,
        type: 'itv',
        title: itv.retest ? 'ITV: repetir inspección' : 'ITV',
        status,
        trigger: 'date',
        dueDate: itv.dueDate,
        daysRemaining,
        dueUsage: null,
        usageRemaining: null,
        source: itv.source,
        estimated: itv.estimated,
        retest: itv.retest,
      });
    }

    // --- Seguro: sin cálculo, la fecha la pone la persona a mano ---
    if (vehicle.insurance_expiry) {
      const daysRemaining = diffDays(today, vehicle.insurance_expiry);
      vehicleItems.push({
        ...base,
        id: `insurance:${vehicle.id}`,
        type: 'insurance',
        title: 'Seguro',
        status: statusFromDays(daysRemaining, maxLead),
        trigger: 'date',
        dueDate: vehicle.insurance_expiry,
        daysRemaining,
        dueUsage: null,
        usageRemaining: null,
      });
    }

    // --- Mantenimiento periódico ---
    const usageUpdatedOn = vehicle.usage_updated_at ? isoDateOf(vehicle.usage_updated_at, opts.tz) : null;
    const ruleViews = [];
    for (const rule of rulesByVehicle.get(vehicle.id) ?? []) {
      const evaluation = evaluateRule({
        rule,
        lastRecord: lastByKey.get(`${vehicle.id}:${rule.kind}`) ?? null,
        currentUsage: vehicle.current_usage,
        usageUpdatedOn,
        today,
        maxLeadDays: maxLead,
        staleDays: settings.usage_stale_days,
      });
      const title = rule.name?.trim() || MAINTENANCE_KINDS[rule.kind] || 'Mantenimiento';
      ruleViews.push({ rule, title, ...evaluation });
      if (evaluation.trigger) {
        vehicleItems.push({
          ...base,
          id: `maint:${rule.id}`,
          type: 'maintenance',
          ruleId: rule.id,
          kind: rule.kind,
          title,
          status: evaluation.status,
          trigger: evaluation.trigger,
          dueDate: evaluation.dueDate,
          daysRemaining: evaluation.daysRemaining,
          dueUsage: evaluation.dueUsage,
          usageRemaining: evaluation.usageRemaining,
          usageIsStale: evaluation.usageIsStale,
        });
      }
    }

    vehicleItems.sort(compareUrgency);
    items.push(...vehicleItems);
    byVehicle.set(vehicle.id, {
      vehicle,
      itv: itvView,
      rules: ruleViews,
      items: vehicleItems,
      status: worstStatus(vehicleItems.map((i) => i.status)),
      usageUpdatedOn,
    });
  }

  // Los vehículos dados de baja no cuentan en el panel ni en los avisos, pero sí en byVehicle.
  const activeItems = items.filter((i) => byVehicle.get(i.vehicleId).vehicle.active !== false);
  activeItems.sort(compareUrgency);
  const counts = { overdue: 0, soon: 0, ok: 0 };
  for (const item of activeItems) counts[item.status]++;

  return { items: activeItems, byVehicle, counts, settings };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const nf = new Intl.NumberFormat('es-ES');
export const formatUsage = (value, unit) => `${nf.format(value)} ${unit === 'h' ? 'h' : 'km'}`;

/** Texto legible del vencimiento: "Vence el 12/10/2026 (en 21 días)", "Faltan 300 km"... */
export function describeDue(item) {
  if (item.trigger === 'date') {
    const d = item.daysRemaining;
    if (d < 0) return `Venció el ${formatES(item.dueDate)} (hace ${plural(-d, 'día', 'días')})`;
    if (d === 0) return `Vence hoy (${formatES(item.dueDate)})`;
    return `Vence el ${formatES(item.dueDate)} (en ${plural(d, 'día', 'días')})`;
  }
  const r = item.usageRemaining;
  if (r < 0) return `Pasado en ${formatUsage(-r, item.unit)} (límite ${formatUsage(item.dueUsage, item.unit)})`;
  if (r === 0) return `Toca ya (${formatUsage(item.dueUsage, item.unit)})`;
  return `Faltan ${formatUsage(r, item.unit)} (límite ${formatUsage(item.dueUsage, item.unit)})`;
}
