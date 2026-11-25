// Times, closures and cancellations rink staff posted since the last site build (/plays-api/rinks/live),
// applied over the schedules on the page. Shared by the main page and My Rink.
window.mergePostedLive = (data, sessions, live) => {
  if (!live) return sessions; // couldn't be reached: what the last build had
  for (const r of data.rinks) {
    const p = live[r.id];
    if (p) { r.posted = { updated: p.updated, stale: p.stale }; if (p.sessions.length) r.live = true; }
    else if (r.posted) { delete r.posted; if (!r.sourceTypes?.length && !sessions.some(s => s.rinkId === r.id && !s.posted)) r.live = false; }
  }
  const out = sessions.filter(s => !s.posted).map(s => {
    const start = Date.parse(s.start), own = s.cancelled && !s.offPosted;
    const off = !own && !!live[s.rinkId]?.off.some(o => start >= o.from && start < o.to);
    return off === !!s.offPosted ? s : { ...s, cancelled: own || off, offPosted: off };
  });
  const byRink = new Map();
  for (const s of out) if (live[s.rinkId]) { if (!byRink.has(s.rinkId)) byRink.set(s.rinkId, []); byRink.get(s.rinkId).push(s); }
  const known = new Set(data.rinks.map(r => r.id));
  for (const [id, p] of Object.entries(live)) {
    if (!known.has(id)) continue;
    for (const s of p.sessions) {
      if (Date.parse(s.end) < Date.now() - 6 * 3600e3) continue;
      // The rink's own calendar has it too: its copy shows.
      if (!(byRink.get(id) || []).some(c => !c.cancelled && c.category === s.category && Math.abs(Date.parse(c.start) - Date.parse(s.start)) <= 15 * 60e3)) out.push({ ...s });
    }
  }
  const seen = new Map();
  for (const s of out) if (s.posted) { const n = (seen.get(s.id) || 0) + 1; seen.set(s.id, n); if (n > 1) s.id += `-${n}`; }
  return out.sort((a, b) => a.start.localeCompare(b.start));
};
