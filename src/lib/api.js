// Acceso a datos (Supabase). Todas las llamadas van con la sesión del usuario, así que la RLS de la
// base de datos decide qué puede leer y escribir cada rol: aquí no se "filtra por seguridad".

import { fetchSnapshot } from '@shared/snapshot.js';
import { isNetworkError } from './errors.js';
import { withTimeout } from './net.js';
import { readSnapshot, saveSnapshot } from './offline.js';
import { PROFILE_COLUMNS, SUPABASE_URL, supabase } from './supabase.js';

const orThrow = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// ---------------------------------------------------------------------------
// Instantánea de la flota (vehículos + reglas + inspecciones + último mantenimiento + ajustes)
// ---------------------------------------------------------------------------

const SNAPSHOT_TIMEOUT_MS = 8000;
let memo = null;
let generation = 0;
/** Descarta la caché en memoria; llamar tras cualquier escritura. */
export const invalidate = () => {
  memo = null;
  generation++; // una carga que estuviera en curso no debe volver a guardar datos ya antiguos
};

/**
 * Carga toda la flota. Si no hay conexión, devuelve la última consulta guardada (solo lectura).
 * @returns {Promise<{snapshot:object, offline:boolean, cachedAt:string|null}>}
 */
export async function getSnapshot({ force = false } = {}) {
  if (!force && memo && Date.now() - memo.at < 15_000) return memo.value;
  const startedAt = generation;
  const cached = readSnapshot();
  // Sin red conocida y con datos guardados: no se espera a que fallen las peticiones.
  if (!navigator.onLine && cached) return { snapshot: cached.snapshot, offline: true, cachedAt: cached.savedAt };
  try {
    // Con datos guardados no compensa esperar eternamente a una red que no responde.
    const loading = fetchSnapshot(supabase);
    const snapshot = cached ? await withTimeout(loading, SNAPSHOT_TIMEOUT_MS) : await loading;
    saveSnapshot(snapshot);
    const value = { snapshot, offline: false, cachedAt: null };
    if (startedAt === generation) memo = { at: Date.now(), value };
    return value;
  } catch (err) {
    if (isNetworkError(err) && cached) return { snapshot: cached.snapshot, offline: true, cachedAt: cached.savedAt };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Ficheros (URLs firmadas: los buckets son privados)
// ---------------------------------------------------------------------------

const urlCache = new Map();

/** Devuelve { ruta: urlFirmada|null } válidas ~1 h. Reutiliza las ya pedidas. */
export async function signedUrls(bucket, paths) {
  const wanted = [...new Set(paths.filter(Boolean))];
  const now = Date.now();
  const missing = wanted.filter((p) => !(urlCache.get(`${bucket}/${p}`)?.exp > now));
  if (missing.length) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(missing, 3600);
    if (!error) {
      for (const row of data) {
        if (row.signedUrl) urlCache.set(`${bucket}/${row.path}`, { url: row.signedUrl, exp: now + 55 * 60_000 });
      }
    }
  }
  return Object.fromEntries(wanted.map((p) => [p, urlCache.get(`${bucket}/${p}`)?.url ?? null]));
}

async function uploadAttachments({ vehicleId, maintenanceRecordId = null, itvInspectionId = null, files }) {
  const failed = [];
  for (const file of files) {
    const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
    const path = `${vehicleId}/${crypto.randomUUID()}-${safeName}`;
    const up = await supabase.storage.from('attachments').upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (up.error) {
      failed.push(file.name);
      continue;
    }
    const row = await supabase.from('attachments').insert({
      vehicle_id: vehicleId,
      maintenance_record_id: maintenanceRecordId,
      itv_inspection_id: itvInspectionId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
    });
    if (row.error) {
      await supabase.storage.from('attachments').remove([path]);
      failed.push(file.name);
    }
  }
  return failed;
}

// ---------------------------------------------------------------------------
// Vehículos
// ---------------------------------------------------------------------------

/**
 * Crea o actualiza un vehículo y, si se indica, sube su foto (ya redimensionada).
 * @returns {Promise<{vehicle:object, photoFailed:boolean}>}
 */
export async function saveVehicle(id, fields, photoBlob = null) {
  const query = id ? supabase.from('vehicles').update(fields).eq('id', id) : supabase.from('vehicles').insert(fields);
  const vehicle = orThrow(await query.select().single());
  invalidate();

  let photoFailed = false;
  if (photoBlob) {
    const path = `${vehicle.id}/photo-${Date.now()}.jpg`;
    const up = await supabase.storage.from('vehicle-photos').upload(path, photoBlob, { contentType: 'image/jpeg', cacheControl: '3600' });
    const upd = up.error ? null : await supabase.from('vehicles').update({ photo_path: path }).eq('id', vehicle.id);
    if (up.error || upd?.error) {
      photoFailed = true;
    } else {
      if (vehicle.photo_path) await supabase.storage.from('vehicle-photos').remove([vehicle.photo_path]);
      vehicle.photo_path = path;
    }
  }
  return { vehicle, photoFailed };
}

export async function setVehicleActive(id, active) {
  orThrow(await supabase.from('vehicles').update({ active }).eq('id', id).select().single());
  invalidate();
}

export async function setItvManualDate(id, date) {
  orThrow(await supabase.from('vehicles').update({ itv_manual_date: date }).eq('id', id).select().single());
  invalidate();
}

/** "Actualizar kilómetros": lo puede hacer cualquier miembro (función SQL con comprobación de rol). */
export async function updateUsage(vehicleId, usage) {
  orThrow(await supabase.rpc('set_vehicle_usage', { p_vehicle_id: vehicleId, p_usage: usage }));
  invalidate();
}

// ---------------------------------------------------------------------------
// Historial: mantenimientos, inspecciones de ITV y adjuntos
// ---------------------------------------------------------------------------

export async function getHistory(vehicleId) {
  const [records, inspections, attachments] = await Promise.all([
    supabase.from('maintenance_records').select('*').eq('vehicle_id', vehicleId).order('record_date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('itv_inspections').select('*').eq('vehicle_id', vehicleId).order('inspection_date', { ascending: false }),
    supabase.from('attachments').select('*').eq('vehicle_id', vehicleId),
  ]);
  const files = orThrow(attachments);
  const urls = await signedUrls('attachments', files.map((f) => f.storage_path));
  return {
    records: orThrow(records),
    inspections: orThrow(inspections),
    attachments: files.map((f) => ({ ...f, url: urls[f.storage_path] })),
  };
}

export async function addMaintenanceRecord(record, files = []) {
  const saved = orThrow(await supabase.from('maintenance_records').insert(record).select().single());
  const failed = await uploadAttachments({ vehicleId: record.vehicle_id, maintenanceRecordId: saved.id, files });
  invalidate();
  return { record: saved, failedUploads: failed };
}

export async function addInspection(inspection, files = []) {
  const saved = orThrow(await supabase.from('itv_inspections').insert(inspection).select().single());
  const failed = await uploadAttachments({ vehicleId: inspection.vehicle_id, itvInspectionId: saved.id, files });
  invalidate();
  return { inspection: saved, failedUploads: failed };
}

async function deleteWithFiles(table, column, id) {
  const files = orThrow(await supabase.from('attachments').select('storage_path').eq(column, id));
  const deleted = orThrow(await supabase.from(table).delete().eq('id', id).select());
  if (deleted.length === 0) throw new Error('No tienes permiso para borrar esto.'); // RLS: 0 filas, sin error
  if (files.length) await supabase.storage.from('attachments').remove(files.map((f) => f.storage_path));
  invalidate();
}
export const deleteMaintenanceRecord = (id) => deleteWithFiles('maintenance_records', 'maintenance_record_id', id);
export const deleteInspection = (id) => deleteWithFiles('itv_inspections', 'itv_inspection_id', id);

// ---------------------------------------------------------------------------
// Reglas de mantenimiento periódico
// ---------------------------------------------------------------------------

export async function saveRule(id, fields) {
  const query = id ? supabase.from('maintenance_rules').update(fields).eq('id', id) : supabase.from('maintenance_rules').insert(fields);
  const rule = orThrow(await query.select().single());
  invalidate();
  return rule;
}

export async function deleteRule(id) {
  const deleted = orThrow(await supabase.from('maintenance_rules').delete().eq('id', id).select());
  if (deleted.length === 0) throw new Error('No tienes permiso para borrar esto.');
  invalidate();
}

// ---------------------------------------------------------------------------
// Ajustes: avisos, reglas de ITV y usuarios
// ---------------------------------------------------------------------------

export async function saveSettings(patch, userId) {
  orThrow(await supabase.from('notification_settings').update({ ...patch, updated_by: userId }).eq('id', 1).select().single());
  invalidate();
}

export async function saveItvRule(vehicleType, patch) {
  orThrow(await supabase.from('itv_rules').update(patch).eq('vehicle_type', vehicleType).select().single());
  invalidate();
}

export async function listProfiles() {
  return orThrow(await supabase.from('profiles').select(PROFILE_COLUMNS).order('created_at'));
}

export async function updateProfile(id, patch) {
  orThrow(await supabase.from('profiles').update(patch).eq('id', id).select('id').single());
}

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

/** URL del feed .ics del usuario. El token es la credencial: tratar la URL como una contraseña. */
export const calendarFeedUrl = (token) => `${SUPABASE_URL}/functions/v1/calendar-feed/${token}.ics`;

export async function rotateCalendarToken() {
  return orThrow(await supabase.rpc('rotate_calendar_token'));
}
