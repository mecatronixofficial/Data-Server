// Allowed icon keys for fields/boxes. Keep in sync with the frontend's ICONS list
// in components/IconPicker.tsx.
export const ICON_KEYS = [
  'trending-up',
  'trending-down',
  'repeat',
  'dollar-sign',
  'credit-card',
  'briefcase',
  'clock',
  'alert-triangle',
  'pie-chart',
  'bar-chart',
  'activity',
  'layers',
  'tag',
  'shopping-bag',
  'percent',
  'database',
  'grid',
  'hash',
  'sliders',
  'home',
] as const;

export type IconKey = (typeof ICON_KEYS)[number];
