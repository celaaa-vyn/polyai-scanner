export default async function handler(req, res) {
  // Verify this is called by Vercel Cron (security)
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow manual trigger without auth for testing
    if (req.query.test !== 'true') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const TG_TOKEN = process.env.TG_BOT_TOKEN;
  const TG_CHAT = process.env.TG_CHAT_ID;

  if (!TG_TOKEN || !TG_CHAT) {
    return res.status(400).json({ error: 'Missing TG_BOT_TOKEN or TG_CHAT_ID env vars' });
  }

  try {
    // 1. Fetch markets from Polymarket
    const base = "https://gamma-api.polymarket.com/markets?closed=false";
    const [r1, r2] = await Promise.all([
      fetch(`${base}&limit=100&order=volume&ascending=false`),
      fetch(`${base}&limit=100&order=startDate&ascending=false`),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.ok ? r2.json() : []]);
    
    // Merge & deduplicate
    const seen = new Set();
    const all = [];
    for (const m of [...d1, ...d2]) {
      if (!seen.has(m.id)) { seen.add(m.id); all.push(m); }
    }

    // 2. Parse markets
    const now = Date.now();
    const markets = all.map(m => {
      const outcomes = JSON.parse(m.outcomes || "[]");
      const prices = JSON.parse(m.outcomePrices || "[]");
      const yesOdds = parseFloat(prices[0]) || 0.5;
      const noOdds = parseFloat(prices[1]) || 0.5;
      const vol = parseFloat(m.volume) || 0;
      const endDate = m.endDate ? new Date(m.endDate) : null;
      const hoursLeft = endDate ? Math.max(0, (endDate - now) / 3600000) : null;
      const daysLeft = hoursLeft != null ? Math.round(hoursLeft / 24) : null;
      return { question: m.question, category: m.category || "General", yesOdds, noOdds, vol, hoursLeft, daysLeft, slug: m.slug };
    }).filter(m => m.vol > 0);

    // 3. Find top opportunities (high volume + extreme odds)
    const scored = markets.map(m => {
      const edgeScore = Math.abs(m.yesOdds - 0.5) * 100; // How far from 50/50
      const volScore = Math.min(m.vol / 1000000, 10); // Volume score 0-10
      const timeScore = m.hoursLeft != null && m.hoursLeft < 24 ? 3 : 0; // Bonus for soon-ending
      return { ...m, score: edgeScore + volScore + timeScore };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 10);

    // 4. Format Telegram message
    const timeStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour12: false });
    let msg = `🤖 <b>PolyAI Daily Scan</b>\n📅 ${timeStr} WIB\n━━━━━━━━━━━━━━━━━━\n\n`;
    
    // Categorize
    const crypto = top.filter(m => /bitcoin|btc|eth|crypto|solana|up or down/i.test(m.question));
    const politics = top.filter(m => /president|trump|election|war|tariff/i.test(m.question));
    const others = top.filter(m => !crypto.includes(m) && !politics.includes(m));

    if (crypto.length > 0) {
      msg += `💰 <b>CRYPTO</b>\n`;
      crypto.forEach(m => {
        const arrow = m.yesOdds > 0.6 ? '🟢' : m.yesOdds < 0.4 ? '🔴' : '🟡';
        msg += `${arrow} ${m.question.slice(0, 60)}\n   YES ${(m.yesOdds*100).toFixed(0)}% | NO ${(m.noOdds*100).toFixed(0)}% | Vol: $${(m.vol/1000).toFixed(0)}K\n`;
      });
      msg += `\n`;
    }

    if (politics.length > 0) {
      msg += `🏛 <b>POLITICS</b>\n`;
      politics.forEach(m => {
        const arrow = m.yesOdds > 0.6 ? '🟢' : m.yesOdds < 0.4 ? '🔴' : '🟡';
        msg += `${arrow} ${m.question.slice(0, 60)}\n   YES ${(m.yesOdds*100).toFixed(0)}% | NO ${(m.noOdds*100).toFixed(0)}% | Vol: $${(m.vol/1000).toFixed(0)}K\n`;
      });
      msg += `\n`;
    }

    if (others.length > 0) {
      msg += `📊 <b>OTHER</b>\n`;
      others.forEach(m => {
        const arrow = m.yesOdds > 0.6 ? '🟢' : m.yesOdds < 0.4 ? '🔴' : '🟡';
        msg += `${arrow} ${m.question.slice(0, 60)}\n   YES ${(m.yesOdds*100).toFixed(0)}% | NO ${(m.noOdds*100).toFixed(0)}% | Vol: $${(m.vol/1000).toFixed(0)}K\n`;
      });
    }

    msg += `\n━━━━━━━━━━━━━━━━━━\n🔗 polyai-scanner.vercel.app\n📊 Total markets scanned: ${markets.length}`;

    // 5. Send to Telegram
    const tgRes = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: "HTML" }),
    });
    const tgData = await tgRes.json();

    res.status(200).json({ success: true, marketCount: markets.length, topPicks: top.length, telegram: tgData.ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
