// 線條圖示（24x24, stroke=currentColor）
const s = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icons = {
  home: s('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  pin: s('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  bus: s('<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16"/><path d="M7 21v-3M17 21v-3"/><circle cx="8" cy="14.5" r=".8" fill="currentColor"/><circle cx="16" cy="14.5" r=".8" fill="currentColor"/>'),
  bike: s('<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7"/><path d="M10 9l2 7h-6"/><path d="M14 6h2.5"/>'),
  hsr: s('<path d="M4 15c0-5 4-9 10-9h3l3 4v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 13h16"/><path d="M7 21l2-2M17 21l-2-2"/>'),
  train: s('<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14"/><path d="M8 21l2-4M16 21l-2-4"/><circle cx="9" cy="13.5" r=".8" fill="currentColor"/><circle cx="15" cy="13.5" r=".8" fill="currentColor"/>'),
  metro: s('<circle cx="12" cy="12" r="9"/><path d="M8 16V8l4 5 4-5v8"/>'),
  sun: s('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  air: s('<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/>'),
  pharmacy: s('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>'),
  receipt: s('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  fuel: s('<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/><path d="M3 21h12"/><path d="M4 10h10"/><path d="M14 8l3 3v6a1.5 1.5 0 0 0 3 0V9l-3-3"/>'),
  trash: s('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/>'),
  quake: s('<path d="M2 12h4l2-5 3 10 3-14 3 9h5"/>'),
  star: s('<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'),
  starFill: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  back: s('<path d="M15 5l-7 7 7 7"/>'),
  chev: s('<path d="M9 5l7 7-7 7"/>'),
  search: s('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  swap: s('<path d="M7 4v16M3 8l4-4 4 4"/><path d="M17 20V4M21 16l-4 4-4-4"/>'),
  refresh: s('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  locate: s('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>'),
};
