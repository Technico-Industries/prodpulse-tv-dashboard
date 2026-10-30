import { CirclePause, Hourglass, OctagonX, Play } from 'lucide-react';

// Line status → colour, icon and label. Colour is always paired with the
// icon shape and the word, so status reads without colour vision.
// awaiting_entry = the line is running but an ended hourly slot has not been
// saved yet (published by the backend as awaitingEntryFromMs).
export const LINE_STATUS = {
  running: { label: 'Running', color: 'var(--status-running)', icon: Play },
  awaiting_entry: { label: 'Awaiting entry', color: 'var(--status-awaiting)', icon: Hourglass },
  stopped: { label: 'Stopped', color: 'var(--status-stopped)', icon: OctagonX },
  idle: { label: 'Idle', color: 'var(--status-idle)', icon: CirclePause },
};

export const STATUS_ORDER = ['running', 'awaiting_entry', 'stopped', 'idle'];

// Hex (not CSS vars) because Recharts writes these into SVG attributes.
// Same values as --series-* in index.css.
export const SERIES = {
  primary: '#3b82f6',
  secondary: '#c2569b',
  plan: '#9a9a9a',
  neutral: '#7d8590',
};
