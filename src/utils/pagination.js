// Line-grid paging (pure, shared by AssemblyLineGrid and usePageRotation).

export function pageCountFor(total, pageSize) {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function pageSlice(items, pageSize, page) {
  const count = pageCountFor(items.length, pageSize);
  const p = Math.min(Math.max(0, page), count - 1);
  const start = p * pageSize;
  return { page: p, start, items: items.slice(start, start + pageSize) };
}

export function nextPage(page, count) {
  return count <= 1 ? 0 : (page + 1) % count;
}
