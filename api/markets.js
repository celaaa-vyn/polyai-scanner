export default async function handler(req, res) {
  try {
    const url = "https://gamma-api.polymarket.com/markets?closed=false&limit=200&order=volume&ascending=false";
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
    });
    if (!response.ok) throw new Error(`Polymarket API: ${response.status}`);
    const data = await response.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=60");
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
