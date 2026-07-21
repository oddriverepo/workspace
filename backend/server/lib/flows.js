export const DRIVER_FLOW = [
  { id: 'odometer-photo', label: 'Fotografar odômetro', type: 'photo', required: true },
  { id: 'odometer-value', label: 'Informar quilometragem do odômetro', type: 'number', required: true },
  { id: 'photo-left', label: 'Foto lateral esquerda', type: 'photo', required: true },
  { id: 'photo-right', label: 'Foto lateral direita', type: 'photo', required: true },
  { id: 'photo-rear', label: 'Foto traseira', type: 'photo', required: true },
  { id: 'photo-front', label: 'Foto frontal', type: 'photo', required: true },
];

export const GRAPHIC_FLOW = [
  { id: 'odometer-photo', label: 'Fotografar odômetro do veículo', type: 'photo', required: true },
  { id: 'odometer-value', label: 'Informar quilometragem do odômetro', type: 'number', required: true },
  { id: 'photo-left', label: 'Foto lateral esquerda', type: 'photo', required: true },
  { id: 'photo-right', label: 'Foto lateral direita', type: 'photo', required: true },
  { id: 'photo-rear', label: 'Foto traseira', type: 'photo', required: true },
  { id: 'photo-front', label: 'Foto frontal', type: 'photo', required: true },
  { id: 'notes', label: 'Observações da gráfica', type: 'text', required: false },
];

export const DRIVER_REQUIRED_STEPS = DRIVER_FLOW.filter(step => step.required !== false).map(step => step.id);
export const GRAPHIC_REQUIRED_STEPS = GRAPHIC_FLOW.filter(step => step.required !== false).map(step => step.id);
