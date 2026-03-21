export default async function handler(req, res) {
  try {
    const headers = { "Accept": "application/json" };
    // Fetch both by volume (popular) and by startDate (newest — catches hourly crypto)
    const [r1, r2] = await Promise.all([
      fetch("https://gamma-api.polymarket.com/markets?closed=false&limit=200&order=volume&ascending=false", { headers }),
      fetch("https://gamma-api.polymarket.com/markets?closed=false&limit=100&order=startDate&ascending=false", { headers }),
    ]);
    if (!r1.ok) throw new Error(`Polymarket API: ${r1.status}`);
    const [d1, d2] = await Promise.all([r1.json(), r2.ok ? r2.json() : []]);
    // Merge and deduplicate by ID
    const seen = new Set();
    const merged = [];
    for (const m of [...d1, ...d2]) {
      if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");
    res.status(200).json(merged);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
