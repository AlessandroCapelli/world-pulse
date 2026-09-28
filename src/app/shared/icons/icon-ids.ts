import { ICONS } from './icons';

/** Icon ids that metric files may reference in `visual.icon` (validated by `npm run data:validate`). */
export const ICON_IDS: readonly string[] = Object.keys(ICONS);
