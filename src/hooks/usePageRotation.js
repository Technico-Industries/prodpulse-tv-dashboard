import { useEffect, useState } from 'react';
import { nextPage } from '../utils/pagination';

// Cycles through `pageCount` pages every `intervalMs`. With one page (or an
// interval of 0) it stays on page 0. The index is clamped if the page count
// shrinks, e.g. when lines are removed.
export function usePageRotation(pageCount, intervalMs) {
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (pageCount <= 1 || !intervalMs) return undefined;
    const id = setInterval(() => setPage((p) => nextPage(p, pageCount)), intervalMs);
    return () => clearInterval(id);
  }, [pageCount, intervalMs]);

  return Math.min(page, Math.max(0, pageCount - 1));
}
