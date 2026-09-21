// Alta y edición de vehículos. Baja lógica: nunca se borra.

import { VEHICLE_TYPES, usageUnitFor } from '@shared/constants.js';
import { saveVehicle, setVehicleActive, signedUrls } from '../lib/api.js';
import { loadFleet } from '../lib/fleet.js';
import { friendlyError } from '../lib/errors.js';
import { resizeImage } from '../lib/image.js';
import { lookupMatricula } from '../lib/lookupMatricula.js';
import { normalizeMatricula, validateMatricula } from '../lib/matricula.js';
import { navigate } from '../router.js';
import { areaField, button, checkField, icon, readForm, selectField, textField, toInt } from '../ui/components.js';
import { confirmDialog, h, toast } from '../ui/dom.js';

const TYPE_OPTIONS = Object.entries(VEHICLE_TYPES).map(([value, { label }]) => [value, label]);

export default async function vehicleForm({ params }) {
  const editing = Boolean(params.id);
  const fleet = await loadFleet();
  if (fleet.offline) throw new Error('Necesitas conexión para guardar vehículos.');
  let vehicle = null;
  if (editing) {
    vehicle = fleet.status.byVehicle.get(params.id)?.vehicle;
    if (!vehicle) throw new Error('Vehículo no encontrado.');
  }
  const v = vehicle ?? { vehicle_type: 'furgoneta', itv_enabled: true, active: true };

  // --- Foto ---
  let photoBlob = null;
  const preview = h('div', { class: 'thumb' }, icon('camera', 32));
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*', // sin "capture": en el móvil ofrece cámara o galería
    hidden: true,
    onchange: async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        photoBlob = await resizeImage(file, { maxSize: 1200, quality: 0.82 });
        preview.replaceChildren(h('img', { src: URL.createObjectURL(photoBlob), alt: 'Vista previa', style: 'width:100%;height:100%;object-fit:cover' }));
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
    },
  });
  if (v.photo_path) {
    signedUrls('vehicle-photos', [v.photo_path]).then((urls) => {
      if (urls[v.photo_path] && !photoBlob) preview.replaceChildren(h('img', { src: urls[v.photo_path], alt: '', style: 'width:100%;height:100%;object-fit:cover' }));
    });
  }

  // --- Matrícula: normaliza y avisa, sin bloquear ---
  const plateWarn = h('div', { class: 'field-warn', hidden: true });
  const plateInput = h('input', {
    type: 'text',
    name: 'plate',
    required: true,
    value: v.plate ?? '',
    maxlength: 14,
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: false,
    placeholder: '1234 BCD',
    class: 'plate',
  });

  const registration = textField('Fecha de primera matriculación', 'first_registration_date', {
    type: 'date',
    value: v.first_registration_date ?? '',
    hint: 'Con ella se calcula la ITV. Está en el permiso de circulación.',
  });
  const brand = textField('Marca', 'brand', { value: v.brand ?? '' });
  const model = textField('Modelo', 'model', { value: v.model ?? '' });

  const showPlateWarning = () => {
    const result = validateMatricula(plateInput.value);
    plateWarn.hidden = !result.message;
    plateWarn.textContent = result.message ?? '';
  };
  plateInput.addEventListener('input', showPlateWarning);
  plateInput.addEventListener('blur', async () => {
    plateInput.value = normalizeMatricula(plateInput.value);
    showPlateWarning();
    // Punto de extensión: hoy devuelve null y no hace nada (ver lookupMatricula.js).
    const info = plateInput.value ? await lookupMatricula(plateInput.value).catch(() => null) : null;
    if (!info) return;
    const fill = (label, value) => {
      const input = label.querySelector('input');
      if (value && !input.value) input.value = value;
    };
    fill(registration, info.firstRegistrationDate);
    fill(brand, info.brand);
    fill(model, info.model);
  });
  showPlateWarning();

  // --- Tipo → unidad del contador ---
  const usageLabel = h('span', { class: 'field-label' });
  const usageInput = h('input', { type: 'number', name: 'current_usage', inputmode: 'numeric', min: 0, step: 1, value: v.current_usage ?? '' });
  const typeField = selectField('Tipo de vehículo', 'vehicle_type', TYPE_OPTIONS, {
    value: v.vehicle_type,
    required: true,
    onChange: (event) => updateUsageLabel(event.target.value),
  });
  // Maquinaria: solo pasa ITV si por construcción puede circular a 25 km/h o más (RD 920/2017, art. 6.1).
  const machineryHint = h('p', { class: 'field-hint', hidden: v.vehicle_type !== 'maquinaria' }, 'La maquinaria de obra solo pasa ITV si por construcción puede circular a 25 km/h o más. Si la tuya es más lenta, desmarca esta casilla.');
  function updateUsageLabel(type) {
    usageLabel.textContent = usageUnitFor(type) === 'h' ? 'Horas de uso actuales' : 'Kilómetros actuales';
    machineryHint.hidden = type !== 'maquinaria';
  }
  updateUsageLabel(v.vehicle_type);

  const gvw = textField('MMA (kg), opcional', 'gvw_kg', {
    type: 'number',
    inputmode: 'numeric',
    min: 0,
    value: v.gvw_kg ?? '',
    hint: 'Masa máxima autorizada. Más de 3.500 kg = camión.',
  });

  const save = button('Guardar', { type: 'submit', block: true, iconName: 'check' });
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: async (event) => {
        event.preventDefault();
        const f = readForm(form);
        const plate = normalizeMatricula(f.plate);
        if (!plate) return toast('Escribe la matrícula.', 'error');
        const fields = {
          plate,
          vehicle_type: f.vehicle_type,
          brand: f.brand,
          model: f.model,
          alias: f.alias,
          first_registration_date: f.first_registration_date,
          gvw_kg: toInt(f.gvw_kg),
          current_usage: toInt(f.current_usage),
          usage_unit: usageUnitFor(f.vehicle_type),
          notes: f.notes,
          itv_enabled: f.itv_enabled,
        };
        save.disabled = true;
        try {
          const { vehicle: saved, photoFailed } = await saveVehicle(params.id ?? null, fields, photoBlob);
          toast(photoFailed ? 'Vehículo guardado, pero la foto no se pudo subir. Prueba a editarlo y subirla de nuevo.' : 'Vehículo guardado', photoFailed ? 'error' : 'success');
          navigate(`/vehiculos/${saved.id}`);
        } catch (err) {
          toast(friendlyError(err), 'error');
          save.disabled = false;
        }
      },
    },
    h(
      'div',
      { class: 'photo-picker' },
      preview,
      fileInput,
      button(v.photo_path ? 'Cambiar foto' : 'Hacer foto o elegir de la galería', { variant: 'ghost', onClick: () => fileInput.click() }),
    ),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Matrícula'), plateInput, plateWarn),
    typeField,
    h('div', { class: 'row2' }, brand, model),
    textField('Alias (opcional)', 'alias', { value: v.alias ?? '', placeholder: 'Ej.: La blanca de obra' }),
    registration,
    gvw,
    h('label', { class: 'field' }, usageLabel, usageInput),
    checkField('Controlar la ITV de este vehículo', 'itv_enabled', v.itv_enabled),
    machineryHint,
    areaField('Notas', 'notes', { value: v.notes ?? '' }),
    save,
  );

  const node = h('div', { class: 'stack' }, form);
  if (editing) {
    node.append(
      vehicle.active
        ? button('Dar de baja', {
            variant: 'danger',
            block: true,
            onClick: async () => {
              const ok = await confirmDialog({
                title: '¿Dar de baja este vehículo?',
                message: 'Dejará de aparecer en el panel y de generar avisos. No se borra nada: podrás reactivarlo cuando quieras.',
                confirmText: 'Dar de baja',
                danger: true,
              });
              if (!ok) return;
              try {
                await setVehicleActive(vehicle.id, false);
                toast('Vehículo dado de baja', 'success');
                navigate('/vehiculos');
              } catch (err) {
                toast(friendlyError(err), 'error');
              }
            },
          })
        : button('Reactivar vehículo', {
            block: true,
            onClick: async () => {
              try {
                await setVehicleActive(vehicle.id, true);
                toast('Vehículo reactivado', 'success');
                navigate(`/vehiculos/${vehicle.id}`);
              } catch (err) {
                toast(friendlyError(err), 'error');
              }
            },
          }),
    );
  }

  return {
    title: editing ? 'Editar vehículo' : 'Nuevo vehículo',
    back: editing ? `/vehiculos/${params.id}` : '/vehiculos',
    tab: 'vehiculos',
    node,
  };
}
