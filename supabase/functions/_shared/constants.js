// Constantes de dominio compartidas entre el frontend y las Edge Functions.
// Los códigos van en inglés/ASCII (son los que se guardan en la BD); las etiquetas, en español.

/** Zona horaria de referencia para "hoy" (avisos y calendario). */
export const TIMEZONE = 'Europe/Madrid';

/** Tipos de vehículo. `unit` es la unidad del contador: km u horas de uso. */
export const VEHICLE_TYPES = {
  turismo: { label: 'Turismo', unit: 'km' },
  furgoneta: { label: 'Furgoneta / mercancías ≤ 3.500 kg', unit: 'km' },
  camion: { label: 'Camión > 3.500 kg', unit: 'km' },
  maquinaria: { label: 'Maquinaria', unit: 'h' },
  otro: { label: 'Otro', unit: 'km' },
};

/** Tipos de registro de mantenimiento. */
export const MAINTENANCE_KINDS = {
  aceite: 'Cambio de aceite',
  averia: 'Avería',
  revision: 'Revisión',
  neumaticos: 'Neumáticos',
  otro: 'Otro',
};

/** Tipos que admiten regla periódica (una avería no es periódica). */
export const RULE_KINDS = ['aceite', 'revision', 'neumaticos', 'otro'];

/** Financiación del vehículo (solo informativa, no genera avisos). */
export const FINANCING_TYPES = { prestamo: 'Préstamo', leasing: 'Leasing' };

export const ITV_RESULTS = {
  favorable: 'Favorable',
  desfavorable: 'Desfavorable',
  negativa: 'Negativa',
};

/** Estados de un vencimiento. */
export const STATUS = { OK: 'ok', SOON: 'soon', OVERDUE: 'overdue' };
export const STATUS_LABELS = { ok: 'OK', soon: 'Próximo', overdue: 'Vencido' };
/** Orden de urgencia: menor = más urgente. */
export const STATUS_RANK = { overdue: 0, soon: 1, ok: 2 };

/** Ajustes por defecto si aún no hay fila en notification_settings. */
export const DEFAULT_SETTINGS = {
  lead_days: [30, 15, 7],
  notify_on_due_day: true,
  weekly_overdue: true,
  notify_itv: true,
  notify_insurance: true,
  notify_maintenance: true,
  notify_usage: true,
  default_warn_usage: 500,
  usage_stale_days: 30,
};

export const usageUnitFor = (vehicleType) => VEHICLE_TYPES[vehicleType]?.unit ?? 'km';
