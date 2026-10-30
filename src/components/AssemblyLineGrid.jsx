import { LayoutGrid } from 'lucide-react';
import Panel from './Panel';
import LineStatusCard from './LineStatusCard';
import { LINE_STATUS, STATUS_ORDER } from './statusConfig';
import { usePageRotation } from '../hooks/usePageRotation';
import { pageCountFor, pageSlice } from '../utils/pagination';
import styles from './AssemblyLineGrid.module.css';

// Cards per page. Sized so a card stays readable from across the shop
// floor at 1920×1080; more lines than this rotate through pages.
export const GRID_COLUMNS = 5;
export const GRID_ROWS = 4;
const PAGE_SIZE = GRID_COLUMNS * GRID_ROWS;

const PAGE_SECONDS = Number(import.meta.env.VITE_LINE_PAGE_SECONDS) || 15;

// `lines` already carry their display status for this second.
export default function AssemblyLineGrid({ lines, status = 'ready', demo }) {
  const pageCount = pageCountFor(lines.length, PAGE_SIZE);
  const page = usePageRotation(pageCount, PAGE_SECONDS * 1000);
  const { start, items: visible } = pageSlice(lines, PAGE_SIZE, page);
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, lines.filter((l) => l.status === s).length]));

  const empty = status === 'error'
    ? 'Line status is unavailable right now — retrying.'
    : status === 'pending'
      ? 'Loading line status…'
      : 'No Assembly lines have been published yet.';

  return (
    <Panel
      title="Line status"
      icon={LayoutGrid}
      subtitle={`${lines.length} assembly line${lines.length === 1 ? '' : 's'} · current shift`}
      demo={demo}
      className={styles.panel}
      right={
        <div className={styles.counts}>
          {STATUS_ORDER.map((s) => {
            const meta = LINE_STATUS[s];
            const Icon = meta.icon;
            return (
              <span key={s} className={styles.count}>
                <Icon className={styles.countIcon} style={{ color: meta.color }} aria-hidden />
                {meta.label}
                <strong>{counts[s] ?? 0}</strong>
              </span>
            );
          })}
        </div>
      }
      bodyClassName={styles.body}
    >
      {lines.length === 0 ? (
        <div className={styles.empty}>{empty}</div>
      ) : (
        <div className={styles.grid} style={{ '--cols': GRID_COLUMNS, '--rows': GRID_ROWS }}>
          {visible.map((line) => (
            <LineStatusCard key={line.lineId} line={line} />
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <footer className={styles.pager}>
          <span>
            Page <strong>{page + 1}</strong> of {pageCount} · lines {start + 1}–{start + visible.length} of {lines.length}
          </span>
          <span className={styles.dots} aria-hidden>
            {Array.from({ length: pageCount }, (_, i) => (
              <span key={i} className={i === page ? styles.dotActive : styles.dot} />
            ))}
          </span>
          <span>Next page every {PAGE_SECONDS}s</span>
        </footer>
      )}
    </Panel>
  );
}
