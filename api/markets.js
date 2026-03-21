export default async function handler(req, res) {
  try {
    const headers = { "Accept": "application/json" };
    const base = "https://gamma-api.polymarket.com/markets?closed=false";
    // Fetch by volume (popular) and by startDate (newest — catches 5m crypto)
    const [r1, r2] = await Promise.all([
      fetch(`${base}&limit=200&order=volume&ascending=false`, { headers }),
      fetch(`${base}&limit=200&order=startDate&ascending=false`, { headers }),
    ]);
    if (!r1.ok) throw new Error(`Polymarket API: ${r1.status}`);
    const [d1, d2] = await Promise.all([r1.json(), r2.ok ? r2.json() : []]);
    // Merge and deduplicate by ID
    const seen = new Set();
    const all = [];
    for (const m of [...d1, ...d2]) {
      if (!seen.has(m.id)) { seen.add(m.id); all.push(m); }
    }
    // Separate crypto 5m markets and put them first so client doesn't cut them off
    const crypto5m = all.filter(m => /updown-5m/.test(m.slug));
    const rest = all.filter(m => !/updown-5m/.test(m.slug));
    const merged = [...crypto5m, ...rest];
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=30");
    res.status(200).json(merged);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
