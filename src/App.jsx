import { useState, useCallback, useEffect, useRef } from "react";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

const COLORS_DARK = {
  bg: "#080c10", panel: "#0d1117", border: "#1c2a3a", accent: "#00ff88", accentDim: "#00cc6a",
  red: "#ff4466", yellow: "#ffd700", blue: "#00aaff", text: "#c9d1d9", textDim: "#6e7681",
  textBright: "#f0f6fc", purple: "#a78bfa",
};
const COLORS_LIGHT = {
  bg: "#f0f2f5", panel: "#ffffff", border: "#d0d7de", accent: "#00aa55", accentDim: "#008844",
  red: "#d1242f", yellow: "#bf8700", blue: "#0969da", text: "#1f2328", textDim: "#656d76",
  textBright: "#1f2328", purple: "#8250df",
};

const STRINGS = {
  en: {
    title: "POLYAI SCANNER", subtitle: "PREDICTION MARKET AI ANALYZER",
    bankroll: "BANKROLL", target: "TARGET", trades: "TRADES", markets: "MARKETS",
    progress: "Progress", current: "Current Bankroll", available: "Available to analyze",
    journey: "JOURNEY: $10 → $100", search: "🔍 Search markets...",
    activeMarkets: "⬡ Active Markets", aiAnalysis: "⬡ AI Analysis", activityLog: "⬡ Activity Log",
    selectMarket: "← Select a market to analyze", runAI: "▶ Run AI Analysis",
    analyzing: "⟳ Analyzing...", aiAgent: "AI AGENT", active: "ACTIVE", off: "OFF",
    refresh: "Refresh", favorites: "FAVS", exportCSV: "📥 Export CSV",
    betCalc: "⬡ Bet Calculator", simulateBet: "▶ SIMULATE BET (Demo)",
    tradeHist: "🤖 AI Agent Trade History", noActivity: "No activity yet.",
    winRate: "Win Rate", peak: "Peak", remaining: "remaining",
    starting: "Starting: $10.00", goal: "10x goal",
    statsWins: "Wins", statsLosses: "Losses", statsPnl: "Total PnL", statsAvgConf: "Avg Conf",
    close: "Close", volume: "Vol", description: "Description", endsAt: "Ends at",
    source: "Resolution Source", odds: "Odds",
  },
  id: {
    title: "POLYAI SCANNER", subtitle: "ANALISIS PASAR PREDIKSI AI",
    bankroll: "SALDO", target: "TARGET", trades: "TRADE", markets: "PASAR",
    progress: "Progres", current: "Saldo Saat Ini", available: "Tersedia untuk analisis",
    journey: "PERJALANAN: $10 → $100", search: "🔍 Cari pasar...",
    activeMarkets: "⬡ Pasar Aktif", aiAnalysis: "⬡ Analisis AI", activityLog: "⬡ Log Aktivitas",
    selectMarket: "← Pilih pasar untuk analisis", runAI: "▶ Jalankan Analisis AI",
    analyzing: "⟳ Menganalisis...", aiAgent: "AGEN AI", active: "AKTIF", off: "MATI",
    refresh: "Segarkan", favorites: "FAVORIT", exportCSV: "📥 Ekspor CSV",
    betCalc: "⬡ Kalkulator Taruhan", simulateBet: "▶ SIMULASI TARUHAN (Demo)",
    tradeHist: "🤖 Riwayat Trade Agen AI", noActivity: "Belum ada aktivitas.",
    winRate: "Win Rate", peak: "Puncak", remaining: "tersisa",
    starting: "Mulai: $10.00", goal: "Target 10x",
    statsWins: "Menang", statsLosses: "Kalah", statsPnl: "Total PnL", statsAvgConf: "Rata2 Konf",
    close: "Tutup", volume: "Vol", description: "Deskripsi", endsAt: "Berakhir",
    source: "Sumber Resolusi", odds: "Peluang",
  },
};

const POLYMARKET_API = import.meta.env.PROD
  ? "/api/markets"                                    // Vercel serverless proxy (no CORS issue)
  : "https://gamma-api.polymarket.com/markets";       // Direct API for local dev

const FALLBACK_MARKETS = [
  { id: "1", question: "Will Bitcoin exceed $100,000 before April 2026?", category: "Crypto", yesOdds: 0.62, noOdds: 0.38, volume: "4,200,000", live: false },
  { id: "2", question: "Will the US enter a recession in 2026?", category: "Economy", yesOdds: 0.35, noOdds: 0.65, volume: "2,100,000", live: false },
  { id: "3", question: "Will ETH exceed $4,000 before June 2026?", category: "Crypto", yesOdds: 0.48, noOdds: 0.52, volume: "1,800,000", live: false },
  { id: "4", question: "Will there be a major AI model released by OpenAI in Q2 2026?", category: "AI & Tech", yesOdds: 0.78, noOdds: 0.22, volume: "960,000", live: false },
];

function parsePolymarketData(raw) {
  return raw
    .filter(m => {
      if (!m.question || !m.outcomePrices || !m.active || m.closed) return false;
      const prices = JSON.parse(m.outcomePrices);
      const yesOdds = parseFloat(prices[0]);
      // Skip extremely one-sided markets (>99% or <1%)
      if (yesOdds > 0.99 || yesOdds < 0.01) return false;
      return true;
    })
    .map(m => {
      const prices = JSON.parse(m.outcomePrices);
      const yesOdds = parseFloat(prices[0]);
      const noOdds = parseFloat(prices[1]);
      const category = m.events?.[0]?.series?.[0]?.title || m.events?.[0]?.title?.split(" ")[0] || "General";
      const vol = m.volumeNum || 0;
      const now = Date.now();

      // Detect 5-minute crypto "Up or Down" markets (series slug has '5m' or 'updown')
      const seriesSlug = m.events?.[0]?.series?.[0]?.slug || "";
      const eventStart = m.events?.[0]?.startTime || m.eventStartTime;
      const is5mCrypto = /up-or-down-5m|updown-5m/.test(seriesSlug) || /Up or Down/.test(m.question);
      
      let daysLeft = m.endDate ? Math.max(0, Math.ceil((new Date(m.endDate) - now) / 86400000)) : null;
      let hoursLeft = m.endDate ? Math.max(0, Math.round((new Date(m.endDate) - now) / 3600000)) : null;

      // For 5m crypto markets, use eventStartTime for accurate time-to-resolve
      if (is5mCrypto && eventStart) {
        const startMs = new Date(eventStart).getTime();
        const minsToStart = Math.max(0, Math.round((startMs - now) / 60000));
        hoursLeft = minsToStart <= 60 ? 0 : Math.round(minsToStart / 60);
        daysLeft = hoursLeft <= 24 ? 0 : Math.ceil(hoursLeft / 24);
      }

      return {
        id: m.id,
        question: m.question,
        category: category.length > 20 ? category.slice(0, 20) : category,
        yesOdds,
        noOdds,
        volume: vol >= 1000000 ? `${(vol / 1000000).toFixed(1)}M` : vol >= 1000 ? `${(vol / 1000).toFixed(1)}K` : vol.toFixed(0),
        volumeNum: vol,
        live: true,
        slug: m.slug,
        endDate: m.endDate,
        description: m.description || "",
        clobTokenIds: m.clobTokenIds ? JSON.parse(m.clobTokenIds) : [],
        daysLeft,
        hoursLeft,
        is5mCrypto,
        timeLabel: is5mCrypto ? "5m" : hoursLeft != null && hoursLeft <= 1 ? "<1h" : daysLeft != null && daysLeft <= 1 ? `${hoursLeft}h` : daysLeft != null ? `${daysLeft}d` : "",
      };
    })
    .sort((a, b) => {
      // Prioritize 5m crypto markets at top
      if (a.is5mCrypto && !b.is5mCrypto) return -1;
      if (!a.is5mCrypto && b.is5mCrypto) return 1;
      return b.volumeNum - a.volumeNum;
    })
    .slice(0, 80);
}

/* ─── AI Auto-Trade Agent ─────────────────────────────────────────── */
const AUTO_TRADE_CONFIG = {
  minConfidence: 7,        // Only trade if AI confidence >= 7
  maxBetPct: 0.15,         // Max 15% of bankroll per trade
  minBetPct: 0.05,         // Min 5% of bankroll per trade
  intervalMs: 60000,       // Scan interval (60s) — hemat API credit
  cooldownMs: 120000,      // 2 min cooldown per market — hemat API credit
  maxOpenTrades: 3,        // Max simultaneous open positions
  kellyFraction: 0.25,     // Quarter-Kelly for conservative sizing
  stopLossPct: 0.30,       // Stop if bankroll drops 30% from peak
  takeProfitPct: 2.0,      // Take profit at 2x initial bankroll (double = $20)
};

export default function App() {
  const [markets, setMarkets] = useState(FALLBACK_MARKETS);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsSource, setMarketsSource] = useState("loading");

  const [selected, setSelected] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [betAmount, setBetAmount] = useState("3");
  const [bankroll, setBankroll] = useState(() => {
    const saved = localStorage.getItem("polyai_bankroll");
    return saved ? parseFloat(saved) : 10;
  });
  const [log, setLog] = useState([]);
  const [confidence, setConfidence] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [timeFilter, setTimeFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ── New Feature States ───────────────────────────────────────
  const [theme, setTheme] = useState(() => localStorage.getItem("polyai_theme") || "dark");
  const [lang, setLang] = useState(() => localStorage.getItem("polyai_lang") || "en");
  const [favorites, setFavorites] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("polyai_favs") || "[]")); } catch { return new Set(); }
  });
  const [modalMarket, setModalMarket] = useState(null);
  const [refreshCountdown, setRefreshCountdown] = useState(300);
  const prevOddsRef = useRef({});

  // ── Level 4: Advanced Feature States ────────────────────────
  const [bankrollHistory, setBankrollHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("polyai_bh") || "[]"); } catch { return []; }
  });
  const [sortMode, setSortMode] = useState("volume");
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("polyai_sound") !== "off");
  const [compareMarket, setCompareMarket] = useState(null);
  const [telegramConfig, setTelegramConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem("polyai_tg") || "{}"); } catch { return {}; }
  });
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [showRiskPanel, setShowRiskPanel] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showTgSettings, setShowTgSettings] = useState(false);

  // ── Auto-Trade Agent State ────────────────────────────────────
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [agentStatus, setAgentStatus] = useState("IDLE");
  const [agentScanning, setAgentScanning] = useState(null);
  const [tradeHistory, setTradeHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("polyai_trades") || "[]"); } catch { return []; }
  });
  const [openPositions, setOpenPositions] = useState([]);
  const [peakBankroll, setPeakBankroll] = useState(() => {
    const saved = localStorage.getItem("polyai_peak");
    return saved ? parseFloat(saved) : 10;
  });

  // ── Persist to localStorage ──────────────────────────────────
  useEffect(() => { localStorage.setItem("polyai_bankroll", bankroll.toString()); }, [bankroll]);

  // ── Fetch real USDC balance from Polymarket on load ─────────
  useEffect(() => {
    if (!import.meta.env.PROD) return; // Only on Vercel
    fetch("/api/trade")
      .then(r => r.json())
      .then(data => {
        if (data.success && parseFloat(data.balance) > 0) {
          const realBal = parseFloat(data.balance);
          setBankroll(realBal);
          addLog(`💰 Real USDC balance: $${realBal.toFixed(2)} (${data.address?.slice(0, 8)}...)`);
        }
      })
      .catch(() => {}); // Silently fail — env vars might not be set
  }, []);
  useEffect(() => { localStorage.setItem("polyai_trades", JSON.stringify(tradeHistory.slice(0, 50))); }, [tradeHistory]);
  useEffect(() => { localStorage.setItem("polyai_peak", peakBankroll.toString()); }, [peakBankroll]);
  useEffect(() => { localStorage.setItem("polyai_theme", theme); }, [theme]);
  useEffect(() => { localStorage.setItem("polyai_lang", lang); }, [lang]);
  useEffect(() => { localStorage.setItem("polyai_favs", JSON.stringify([...favorites])); }, [favorites]);
  useEffect(() => { localStorage.setItem("polyai_bh", JSON.stringify(bankrollHistory.slice(-100))); }, [bankrollHistory]);
  useEffect(() => { localStorage.setItem("polyai_sound", soundEnabled ? "on" : "off"); }, [soundEnabled]);
  useEffect(() => { localStorage.setItem("polyai_tg", JSON.stringify(telegramConfig)); }, [telegramConfig]);
  const cooldownMap = useRef({});
  const autoTradeRef = useRef(false);
  const bankrollRef = useRef(10);
  const openPosRef = useRef([]);

  // Dynamic colors & translations
  const COLORS = theme === "dark" ? COLORS_DARK : COLORS_LIGHT;
  const t = STRINGS[lang] || STRINGS.en;

  // Keep refs in sync
  useEffect(() => { bankrollRef.current = bankroll; }, [bankroll]);
  useEffect(() => { openPosRef.current = openPositions; }, [openPositions]);
  useEffect(() => {
    if (bankroll > peakBankroll) setPeakBankroll(bankroll);
    // Track bankroll history
    setBankrollHistory(prev => [...prev, { time: Date.now(), value: bankroll }].slice(-100));
  }, [bankroll, peakBankroll]);

  // ── Sound Effect Helper ─────────────────────────────────────
  const playBeep = useCallback((freq = 800, dur = 150) => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; gain.gain.value = 0.1;
      osc.start(); osc.stop(ctx.currentTime + dur / 1000);
    } catch {}
  }, [soundEnabled]);

  // ── Telegram Alert Helper ───────────────────────────────────
  const sendTelegram = useCallback(async (text) => {
    if (!telegramConfig.token || !telegramConfig.chatId) return;
    try {
      await fetch(`https://api.telegram.org/bot${telegramConfig.token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: telegramConfig.chatId, text, parse_mode: "HTML" }),
      });
    } catch {}
  }, [telegramConfig]);

  // ── Social Share ────────────────────────────────────────────
  const shareResult = (text) => {
    if (navigator.share) { navigator.share({ title: "PolyAI Scanner", text }); }
    else { navigator.clipboard.writeText(text); addLog("📋 Copied to clipboard!"); }
  };
  const shareToTwitter = (text) => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");

  // ── Risk Analytics (computed) ───────────────────────────────
  const riskStats = (() => {
    if (tradeHistory.length < 2) return null;
    const pnls = tradeHistory.map(t => parseFloat(t.pnl));
    const wins = pnls.filter(p => p > 0);
    const losses = pnls.filter(p => p < 0);
    const totalPnl = pnls.reduce((a, b) => a + b, 0);
    const avgPnl = totalPnl / pnls.length;
    const stdDev = Math.sqrt(pnls.reduce((s, p) => s + (p - avgPnl) ** 2, 0) / pnls.length);
    const sharpe = stdDev > 0 ? (avgPnl / stdDev * Math.sqrt(252)).toFixed(2) : "N/A";
    // Max drawdown
    let peak = 10, maxDD = 0;
    bankrollHistory.forEach(bh => { if (bh.value > peak) peak = bh.value; const dd = (peak - bh.value) / peak; if (dd > maxDD) maxDD = dd; });
    const profitFactor = losses.length > 0 ? (wins.reduce((a, b) => a + b, 0) / Math.abs(losses.reduce((a, b) => a + b, 0))).toFixed(2) : "∞";
    const avgWin = wins.length > 0 ? (wins.reduce((a, b) => a + b, 0) / wins.length).toFixed(2) : "0";
    const avgLoss = losses.length > 0 ? (losses.reduce((a, b) => a + b, 0) / losses.length).toFixed(2) : "0";
    return { sharpe, maxDD: (maxDD * 100).toFixed(1), profitFactor, avgWin, avgLoss, totalPnl: totalPnl.toFixed(2), trades: pnls.length };
  })();

  // ── Keyboard Shortcuts ──────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.ctrlKey && e.key === "r") { e.preventDefault(); fetchMarkets(); }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const idx = markets.findIndex(m => m.id === selected?.id);
        if (idx < markets.length - 1) { setSelected(markets[idx + 1]); setAnalysis(null); setConfidence(null); setRecommendation(null); }
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const idx = markets.findIndex(m => m.id === selected?.id);
        if (idx > 0) { setSelected(markets[idx - 1]); setAnalysis(null); setConfidence(null); setRecommendation(null); }
      }
      if (e.key === "Enter" && selected && !loading) analyzeMarket();
      if (e.key === "Escape") { setModalMarket(null); setShowCompare(false); setShowRiskPanel(false); setShowPortfolio(false); setShowTgSettings(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // ── SVG Bankroll Chart Component ────────────────────────────
  const BankrollChart = () => {
    if (bankrollHistory.length < 2) return <div style={{ textAlign: "center", color: COLORS.textDim, fontSize: "11px", padding: "20px" }}>Start trading to see chart</div>;
    const vals = bankrollHistory.map(b => b.value);
    const min = Math.min(...vals) * 0.9, max = Math.max(...vals) * 1.1;
    const w = 400, h = 120;
    const points = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / (max - min)) * h}`).join(" ");
    const lastVal = vals[vals.length - 1];
    const color = lastVal >= 10 ? COLORS.accent : COLORS.red;
    return (
      <svg viewBox={`0 0 ${w} ${h + 20}`} style={{ width: "100%", height: "140px" }}>
        <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.3" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <polygon points={`0,${h} ${points} ${w},${h}`} fill="url(#cg)" />
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
        <text x="0" y={h + 14} fill={COLORS.textDim} fontSize="9">${min.toFixed(0)}</text>
        <text x={w - 30} y={h + 14} fill={COLORS.textDim} fontSize="9">${max.toFixed(0)}</text>
        <text x={w / 2 - 15} y={h + 14} fill={color} fontSize="10" fontWeight="bold">${lastVal.toFixed(2)}</text>
      </svg>
    );
  };

  // ── Auto-Refresh Countdown ──────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => setRefreshCountdown(c => c <= 1 ? 300 : c - 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Favorites Toggle ────────────────────────────────────────
  const toggleFav = (id) => setFavorites(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // ── Export CSV ──────────────────────────────────────────────
  const exportCSV = () => {
    const header = "Time,Market,Side,Bet,Odds,Confidence,Result,PnL,Bankroll\n";
    const rows = tradeHistory.map(t =>
      `"${t.time}","${t.market}","${t.side}",${t.bet},"${t.odds}",${t.confidence},${t.result},${t.pnl},${t.bankrollAfter}`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "polyai_trades.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Fetch Live Polymarket Data ───────────────────────────────
  const fetchMarkets = async () => {
    try {
      setMarketsLoading(true);
      const fetchUrl = import.meta.env.PROD
        ? POLYMARKET_API
        : `${POLYMARKET_API}?closed=false&limit=100&order=volume&ascending=false`;
      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const parsed = parsePolymarketData(data);
      if (parsed.length > 0) {
        // Track odds changes for price alerts
        parsed.forEach(m => {
          const prev = prevOddsRef.current[m.id];
          if (prev) {
            m.oddsChange = Math.abs(m.yesOdds - prev) * 100;
          }
          prevOddsRef.current[m.id] = m.yesOdds;
        });
        setMarkets(parsed);
        setMarketsSource("live");
        addLog(`📡 Loaded ${parsed.length} live markets from Polymarket`);
      } else {
        setMarketsSource("demo");
        addLog("⚠ No eligible markets found — using demo data");
      }
    } catch (err) {
      setMarketsSource("demo");
      addLog(`⚠ Polymarket API error: ${err.message} — using demo data`);
    }
    setMarketsLoading(false);
    setRefreshCountdown(300);
  };

  useEffect(() => {
    fetchMarkets();
    const interval = setInterval(fetchMarkets, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 50));
  };

  /* ─── Analyze a single market via Claude ────────────────────── */
  const analyzeMarketRaw = useCallback(async (market, useSmartModel = false) => {
    const prompt = useSmartModel
      ? `You are an expert prediction market analyst specializing in Polymarket.
Analyze: "${market.question}"
Category: ${market.category} | YES ${(market.yesOdds * 100).toFixed(0)}% / NO ${(market.noOdds * 100).toFixed(0)}% | Vol $${market.volume} | Date: ${new Date().toISOString().slice(0, 10)}

Provide:
1. MARKET ASSESSMENT: What do the current odds tell us?
2. KEY FACTORS: 3 most important factors
3. EDGE ANALYSIS: Is there a potential mispricing?
4. VERDICT: YES or NO — which side has better value?

End with exactly:
CONFIDENCE_SCORE: X
RECOMMENDATION: YES or NO
RISK_LEVEL: LOW or MEDIUM or HIGH
Max 200 words.`
      : `Prediction market analyst. Analyze:
"${market.question}" | ${market.category} | YES ${(market.yesOdds * 100).toFixed(0)}% / NO ${(market.noOdds * 100).toFixed(0)}% | Vol $${market.volume} | Date: ${new Date().toISOString().slice(0, 10)}

Give: 1) Assessment 2) Key factors (3 max) 3) Edge? 4) Verdict: YES or NO
End with exactly:
CONFIDENCE_SCORE: X
RECOMMENDATION: YES or NO
RISK_LEVEL: LOW or MEDIUM or HIGH
Max 150 words.`;

    const response = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: useSmartModel ? "claude-sonnet-4-20250514" : "claude-3-5-haiku-20241022",
        max_tokens: useSmartModel ? 600 : 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const fullText = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "";

    const confMatch = fullText.match(/CONFIDENCE_SCORE:\s*(\d+)/);
    const recMatch = fullText.match(/RECOMMENDATION:\s*(YES|NO)/);
    const riskMatch = fullText.match(/RISK_LEVEL:\s*(LOW|MEDIUM|HIGH)/);

    const confScore = confMatch ? parseInt(confMatch[1]) : 5;
    const rec = recMatch ? recMatch[1] : null;
    const risk = riskMatch ? riskMatch[1] : "MEDIUM";

    const cleanText = fullText
      .replace(/CONFIDENCE_SCORE:\s*\d+/g, "")
      .replace(/RECOMMENDATION:\s*(YES|NO)/g, "")
      .replace(/RISK_LEVEL:\s*(LOW|MEDIUM|HIGH)/g, "")
      .trim();

    return { cleanText, confScore, rec, risk };
  }, []);

  /* ─── Manual Analysis (button click) ─────────────────────────── */
  const analyzeMarket = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    setAnalysis(null);
    setConfidence(null);
    setRecommendation(null);
    addLog(`Analyzing: "${selected.question.slice(0, 50)}..."`);

    try {
      const { cleanText, confScore, rec, risk } = await analyzeMarketRaw(selected, true);
      setAnalysis(cleanText);
      setConfidence({ score: confScore, risk });
      setRecommendation(rec);
      addLog(`Done. Confidence: ${confScore}/10 | Rec: ${rec} | Risk: ${risk}`);
      if (confScore >= 8) {
        sendNotification("🎯 High Confidence Market!", `${selected.question.slice(0, 60)}... → ${rec} (${confScore}/10)`);
      }
    } catch (err) {
      setAnalysis("⚠ Error: " + err.message);
      addLog("ERROR: " + err.message);
    }
    setLoading(false);
  }, [selected, analyzeMarketRaw]);

  /* ─── Kelly Criterion Bet Sizing ─────────────────────────────── */
  const kellyBetSize = (confScore, odds, currentBankroll) => {
    const p = Math.min(0.95, Math.max(0.1, confScore / 10));
    const b = (1 / odds) - 1;
    const kellyPct = (p * b - (1 - p)) / b;
    const adjustedPct = Math.max(
      AUTO_TRADE_CONFIG.minBetPct,
      Math.min(AUTO_TRADE_CONFIG.maxBetPct, kellyPct * AUTO_TRADE_CONFIG.kellyFraction)
    );
    return Math.max(0.5, +(currentBankroll * adjustedPct).toFixed(2));
  };

  /* ─── AI Auto-Trade Agent Loop ──────────────────────────────── */
  useEffect(() => {
    autoTradeRef.current = autoTradeEnabled;
    if (!autoTradeEnabled) {
      setAgentStatus("IDLE");
      return;
    }

    setAgentStatus("RUNNING");
    addLog("🤖 AUTO-TRADE AGENT activated");

    const runCycle = async () => {
      if (!autoTradeRef.current) return;

      // Stop-loss check
      if (bankrollRef.current < peakBankroll * (1 - AUTO_TRADE_CONFIG.stopLossPct)) {
        addLog("🛑 STOP-LOSS triggered — agent paused");
        setAutoTradeEnabled(false);
        setAgentStatus("STOPPED (stop-loss)");
        return;
      }

      // Take-profit check
      if (bankrollRef.current >= 10 * AUTO_TRADE_CONFIG.takeProfitPct) {
        addLog("🎯 TAKE-PROFIT target reached — agent paused");
        setAutoTradeEnabled(false);
        setAgentStatus("STOPPED (take-profit)");
        return;
      }

      // Max open positions check
      if (openPosRef.current.length >= AUTO_TRADE_CONFIG.maxOpenTrades) {
        setAgentStatus("WAITING (max positions)");
        return;
      }

      // Pick a random market not on cooldown
      const now = Date.now();
      const eligible = markets.filter(m => {
        const cd = cooldownMap.current[m.id];
        return !cd || now - cd > AUTO_TRADE_CONFIG.cooldownMs;
      });

      if (eligible.length === 0) {
        setAgentStatus("WAITING (cooldown)");
        return;
      }

      const market = eligible[Math.floor(Math.random() * eligible.length)];
      setAgentScanning(market.id);
      setAgentStatus(`SCANNING: ${market.question.slice(0, 40)}...`);
      addLog(`🤖 Scanning: "${market.question.slice(0, 45)}..."`);

      try {
        const { confScore, rec, risk } = await analyzeMarketRaw(market);

        if (!autoTradeRef.current) return;

        if (confScore >= AUTO_TRADE_CONFIG.minConfidence && rec) {
          const odds = rec === "YES" ? market.yesOdds : market.noOdds;
          const betSize = kellyBetSize(confScore, odds, bankrollRef.current);

          if (betSize > bankrollRef.current) {
            addLog(`🤖 Skip ${market.question.slice(0, 30)}... — insufficient bankroll`);
            return;
          }

          // Execute trade — REAL if API configured, else demo
          const tokenId = market.clobTokenIds ? market.clobTokenIds[rec === "YES" ? 0 : 1] : null;

          let tradeResult;
          if (tokenId) {
            // ── REAL TRADE via Polymarket CLOB API ──
            try {
              const resp = await fetch("/api/trade", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "trade",
                  tokenId,
                  side: rec,
                  size: betSize.toFixed(2),
                  price: odds.toFixed(2),
                  confidence: confScore,
                  marketQuestion: market.question,
                }),
              });
              const data = await resp.json();
              if (data.success) {
                tradeResult = { success: true, orderId: data.orderId };
                playBeep(1200, 200); // Success beep
                addLog(`🤖 REAL ORDER PLACED: ${data.message}`);
              } else {
                tradeResult = { success: false, error: data.error };
                addLog(`🤖 Trade rejected: ${data.error}`);
                setAgentStatus("SKIPPED (" + data.error?.slice(0, 30) + ")");
                return;
              }
            } catch (err) {
              tradeResult = { success: false, error: err.message };
              addLog(`🤖 API Error: ${err.message}`);
              return;
            }
          } else {
            // ── DEMO TRADE (no tokenId = fallback) ──
            tradeResult = { success: true, demo: true };
          }

          // Result tracking (for demo: simulate, for real: pending)
          const win = tokenId ? true : (Math.random() < odds); // Real trades: assume pending, demo: simulate
          const payout = (betSize / odds) - betSize;
          const pnl = win ? payout : -betSize;
          const newBankroll = Math.max(0, bankrollRef.current + pnl);

          setBankroll(newBankroll);
          cooldownMap.current[market.id] = Date.now();

          const trade = {
            id: Date.now(),
            market: market.question.slice(0, 50),
            side: rec,
            bet: betSize,
            odds: (odds * 100).toFixed(0) + "%",
            confidence: confScore,
            risk,
            result: tokenId ? "PENDING" : (win ? "WIN" : "LOSS"),
            pnl: tokenId ? "0.00" : pnl.toFixed(2),
            bankrollAfter: newBankroll.toFixed(2),
            time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
            real: !!tokenId,
            orderId: tradeResult.orderId,
          };

          setTradeHistory(prev => [trade, ...prev].slice(0, 50));
          const modeLabel = tokenId ? "💰 REAL" : "🎮 DEMO";
          addLog(`🤖 ${modeLabel}: ${rec} $${betSize.toFixed(2)} on "${market.question.slice(0, 30)}..." | Conf: ${confScore}/10`);
          setAgentStatus(`TRADED (${modeLabel}): $${betSize.toFixed(2)}`);
        } else {
          addLog(`🤖 Skip: Confidence ${confScore}/10 < ${AUTO_TRADE_CONFIG.minConfidence} threshold`);
          setAgentStatus("SCANNING (no edge found)");
        }
      } catch (err) {
        addLog(`🤖 ERROR: ${err.message}`);
        setAgentStatus("ERROR");
      }

      setAgentScanning(null);
    };

    runCycle();
    const interval = setInterval(runCycle, AUTO_TRADE_CONFIG.intervalMs);
    return () => clearInterval(interval);
  }, [autoTradeEnabled, markets, analyzeMarketRaw, peakBankroll]);

  /* ─── Derived values ─────────────────────────────────────────── */
  const getColor = (score) => score >= 7 ? COLORS.accent : score >= 4 ? COLORS.yellow : COLORS.red;
  const getRiskColor = (r) => r === "LOW" ? COLORS.accent : r === "MEDIUM" ? COLORS.yellow : COLORS.red;
  const progressPct = Math.min(((bankroll - 10) / 90) * 100, 100);

  const betCalc = (() => {
    const amt = parseFloat(betAmount) || 0;
    if (!selected || !recommendation) return null;
    const odds = recommendation === "YES" ? selected.yesOdds : selected.noOdds;
    const payout = (amt / odds) - amt;
    return { bet: amt, odds: (odds * 100).toFixed(0), payout: payout.toFixed(2), total: (amt + payout).toFixed(2) };
  })();

  const agentStats = (() => {
    const wins = tradeHistory.filter(t => t.result === "WIN").length;
    const losses = tradeHistory.filter(t => t.result === "LOSS").length;
    const totalPnl = tradeHistory.reduce((s, t) => s + parseFloat(t.pnl), 0);
    return { wins, losses, total: tradeHistory.length, winRate: tradeHistory.length > 0 ? ((wins / tradeHistory.length) * 100).toFixed(1) : "0.0", totalPnl: totalPnl.toFixed(2) };
  })();

  // ── Browser Notification helper ──────────────────────────────
  const sendNotification = useCallback((title, body) => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='28' font-size='28'>🤖</text></svg>" });
    }
  }, []);

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  /* ─── Styles ─────────────────────────────────────────────────── */
  const s = {
    app: { background: COLORS.bg, minHeight: "100vh", fontFamily: "'Courier New', monospace", color: COLORS.text },
    grid: { position: "fixed", inset: 0, backgroundImage: `linear-gradient(${COLORS.border}33 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border}33 1px, transparent 1px)`, backgroundSize: "40px 40px", pointerEvents: "none", zIndex: 0 },
    header: { borderBottom: `1px solid ${COLORS.border}`, padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative", zIndex: 1, background: `${COLORS.panel}ee`, backdropFilter: "blur(10px)", flexWrap: "wrap", gap: "12px" },
    main: { padding: "24px", position: "relative", zIndex: 1, maxWidth: "1400px", margin: "0 auto" },
    card: { background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: "4px", padding: "16px", marginBottom: "2px" },
    grid4: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px", marginBottom: "16px" },
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" },
    label: { fontSize: "10px", color: COLORS.textDim, letterSpacing: "2px", textTransform: "uppercase", marginBottom: "6px" },
    btn: (disabled) => ({ background: disabled ? `${COLORS.accent}44` : COLORS.accent, color: COLORS.bg, border: "none", padding: "8px 16px", borderRadius: "3px", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "'Courier New', monospace", fontSize: "12px", fontWeight: "bold", letterSpacing: "1px", width: "100%" }),
    panelH: { padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" },
    panelT: { fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", color: COLORS.textDim },
    searchInput: { background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, padding: "8px 12px", borderRadius: "3px", width: "100%", fontFamily: "inherit", fontSize: "12px", outline: "none" },
  };

  return (
    <div style={s.app}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes glow { 0%,100%{box-shadow:0 0 4px ${COLORS.accent}44} 50%{box-shadow:0 0 16px ${COLORS.accent}66} }
        @keyframes scan { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .mi:hover { border-color: ${COLORS.accent}88 !important; background: ${COLORS.accent}08 !important; }
        .fi { animation: fadeIn 0.3s ease; }
        .agent-glow { animation: glow 2s ease-in-out infinite; }
        .scan-bar { background: linear-gradient(90deg, transparent, ${COLORS.purple}44, transparent); background-size: 200% 100%; animation: scan 2s linear infinite; }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-thumb{background:${COLORS.border}; border-radius:2px;}
        .search-input:focus { border-color: ${COLORS.accent} !important; box-shadow: 0 0 8px ${COLORS.accent}33; }
        @media (max-width: 900px) {
          .responsive-grid2 { grid-template-columns: 1fr !important; }
          .responsive-grid4 { grid-template-columns: repeat(2, 1fr) !important; }
          .responsive-header { flex-direction: column !important; text-align: center !important; gap: 12px !important; }
          .responsive-header > div { justify-content: center !important; }
          .responsive-stats { flex-wrap: wrap !important; justify-content: center !important; }
        }
        @media (max-width: 500px) {
          .responsive-grid4 { grid-template-columns: 1fr !important; }
          .responsive-main { padding: 12px !important; }
        }
      `}</style>

      <div style={s.grid} />

      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={s.header} className="responsive-header">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.accent, boxShadow: `0 0 8px ${COLORS.accent}` }} />
          <div>
            <div style={{ fontSize: "18px", fontWeight: "bold", color: COLORS.accent, letterSpacing: "4px" }}>{t.title}</div>
            <div style={{ fontSize: "10px", color: COLORS.textDim, letterSpacing: "3px" }}>{t.subtitle}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }} className="responsive-stats">
          {/* Theme Toggle */}
          <button onClick={() => setTheme(th => th === "dark" ? "light" : "dark")} title="Toggle Theme" style={{ background: "none", border: `1px solid ${COLORS.border}`, borderRadius: "4px", padding: "6px 10px", cursor: "pointer", fontSize: "16px", color: COLORS.text }}>{theme === "dark" ? "☀️" : "🌙"}</button>
          {/* Language Toggle */}
          <button onClick={() => setLang(l => l === "en" ? "id" : "en")} title="Toggle Language" style={{ background: "none", border: `1px solid ${COLORS.border}`, borderRadius: "4px", padding: "4px 8px", cursor: "pointer", fontSize: "11px", fontWeight: "bold", fontFamily: "inherit", color: COLORS.text, letterSpacing: "1px" }}>{lang === "en" ? "🇮🇩 ID" : "🇬🇧 EN"}</button>
          {/* Sound Toggle */}
          <button onClick={() => setSoundEnabled(s => !s)} title="Sound" style={{ background: "none", border: `1px solid ${COLORS.border}`, borderRadius: "4px", padding: "6px 10px", cursor: "pointer", fontSize: "14px", color: COLORS.text }}>{soundEnabled ? "🔊" : "🔇"}</button>
          {/* Quick Action Buttons */}
          <button onClick={() => setShowPortfolio(p => !p)} title="Portfolio" style={{ background: "none", border: `1px solid ${showPortfolio ? COLORS.accent : COLORS.border}`, borderRadius: "4px", padding: "4px 8px", cursor: "pointer", fontSize: "12px", color: showPortfolio ? COLORS.accent : COLORS.text }}>💼</button>
          <button onClick={() => setShowRiskPanel(p => !p)} title="Risk Analytics" style={{ background: "none", border: `1px solid ${showRiskPanel ? COLORS.yellow : COLORS.border}`, borderRadius: "4px", padding: "4px 8px", cursor: "pointer", fontSize: "12px", color: showRiskPanel ? COLORS.yellow : COLORS.text }}>📊</button>
          <button onClick={() => setShowTgSettings(p => !p)} title="Telegram" style={{ background: "none", border: `1px solid ${showTgSettings ? COLORS.blue : COLORS.border}`, borderRadius: "4px", padding: "4px 8px", cursor: "pointer", fontSize: "12px", color: showTgSettings ? COLORS.blue : COLORS.text }}>📨</button>
          <div
            onClick={() => setAutoTradeEnabled(!autoTradeEnabled)}
            className={autoTradeEnabled ? "agent-glow" : ""}
            style={{
              display: "flex", alignItems: "center", gap: "8px", padding: "6px 14px",
              borderRadius: "4px", cursor: "pointer", transition: "all 0.3s",
              border: `1px solid ${autoTradeEnabled ? COLORS.purple : COLORS.border}`,
              background: autoTradeEnabled ? `${COLORS.purple}18` : "transparent",
            }}
          >
            <span style={{ fontSize: "14px" }}>{autoTradeEnabled ? "🤖" : "⚡"}</span>
            <div>
              <div style={{ fontSize: "10px", color: COLORS.textDim, letterSpacing: "2px" }}>{t.aiAgent}</div>
              <div style={{ fontSize: "13px", fontWeight: "bold", color: autoTradeEnabled ? COLORS.purple : COLORS.textDim }}>
                {autoTradeEnabled ? t.active : t.off}
              </div>
            </div>
          </div>
          {[
            [t.bankroll, bankroll, COLORS.accent, true],
            [t.target, 100, COLORS.yellow, false],
            [t.trades, agentStats.total, COLORS.blue, false],
          ].map(([l, v, c, editable]) => (
            <div key={l} style={{ textAlign: "right" }}>
              <div style={{ fontSize: "10px", color: COLORS.textDim, letterSpacing: "2px" }}>{l}</div>
              {editable ? (
                <div onClick={() => {
                  const val = prompt("Set bankroll ($):", bankroll.toFixed(2));
                  if (val && !isNaN(parseFloat(val))) setBankroll(parseFloat(val));
                }} style={{ fontSize: "20px", fontWeight: "bold", color: c, cursor: "pointer" }} title="Click to edit">
                  ${typeof v === "number" ? v.toFixed(2) : v}
                </div>
              ) : (
                <div style={{ fontSize: "20px", fontWeight: "bold", color: c }}>{typeof v === "number" && l !== t.trades ? `$${v.toFixed(2)}` : v}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={s.main}>
        {/* ── Agent Status Bar ──────────────────────────────────── */}
        {autoTradeEnabled && (
          <div className="fi" style={{ marginBottom: "16px", padding: "12px 16px", background: `${COLORS.purple}12`, border: `1px solid ${COLORS.purple}44`, borderRadius: "4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ animation: "pulse 1.5s ease-in-out infinite", fontSize: "14px" }}>🤖</span>
              <div>
                <div style={{ fontSize: "11px", color: COLORS.purple, letterSpacing: "2px", fontWeight: "bold" }}>AI AUTO-TRADE AGENT</div>
                <div style={{ fontSize: "11px", color: COLORS.textDim, marginTop: "2px" }}>{agentStatus}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "20px" }}>
              {[
                ["Win Rate", `${agentStats.winRate}%`],
                ["W/L", `${agentStats.wins}/${agentStats.losses}`],
                ["PnL", `$${agentStats.totalPnl}`],
                ["Peak", `$${peakBankroll.toFixed(2)}`],
              ].map(([l, v]) => (
                <div key={l} style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "9px", color: COLORS.textDim, letterSpacing: "1px" }}>{l}</div>
                  <div style={{ fontSize: "13px", color: COLORS.purple, fontWeight: "bold" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Stats Grid ───────────────────────────────────────── */}
        <div style={s.grid4} className="responsive-grid4">
          {[
            ["Current Bankroll", `$${bankroll.toFixed(2)}`, "Starting: $10.00"],
            ["Target", "$100.00", "10x goal"],
            ["Progress", `${Math.max(0, progressPct).toFixed(1)}%`, `$${Math.max(0, 100 - bankroll).toFixed(2)} remaining`],
            ["Markets", markets.length, "Available to analyze"],
          ].map(([l, v, sub]) => (
            <div key={l} style={s.card}>
              <div style={s.label}>{l}</div>
              <div style={{ fontSize: "22px", fontWeight: "bold", color: COLORS.accent, fontFamily: "'Courier New', monospace" }}>{v}</div>
              <div style={{ fontSize: "11px", color: COLORS.textDim, marginTop: "4px" }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* ── Progress Bar ─────────────────────────────────────── */}
        <div style={{ ...s.card, marginBottom: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span style={s.label}>JOURNEY: $10 → $100</span>
            <span style={{ fontSize: "10px", color: COLORS.accent }}>{Math.max(0, progressPct).toFixed(1)}%</span>
          </div>
          <div style={{ background: COLORS.border, borderRadius: "2px", height: "16px", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(0, progressPct)}%`, height: "100%", background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.accentDim})`, transition: "width 0.5s ease", borderRadius: "2px" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", fontSize: "10px", color: COLORS.textDim }}>
            {["$10", "$25", "$50", "$75", "$100"].map(v => <span key={v}>{v}</span>)}
          </div>
        </div>

        {/* ── Bankroll Chart ─────────────────────────────────────── */}
        <div style={{ ...s.card, marginBottom: "16px" }}>
          <div style={s.label}>📈 Bankroll Chart</div>
          <BankrollChart />
        </div>

        {/* ── Toggleable Panels ─────────────────────────────────── */}
        {showPortfolio && (
          <div className="fi" style={{ ...s.card, marginBottom: "16px", border: `1px solid ${COLORS.accent}44` }}>
            <div style={s.label}>💼 Portfolio / Open Positions</div>
            {openPositions.length === 0 ? (
              <div style={{ color: COLORS.textDim, fontSize: "11px", padding: "12px 0" }}>No open positions. Enable AI Agent to start trading.</div>
            ) : openPositions.map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${COLORS.border}22`, fontSize: "11px" }}>
                <span style={{ color: COLORS.textBright }}>{p.market?.slice(0, 40)}</span>
                <span style={{ color: p.side === "YES" ? COLORS.accent : COLORS.red, fontWeight: "bold" }}>{p.side} ${p.bet?.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {showRiskPanel && riskStats && (
          <div className="fi" style={{ ...s.card, marginBottom: "16px", border: `1px solid ${COLORS.yellow}44` }}>
            <div style={s.label}>📊 Risk Analytics</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginTop: "8px" }}>
              {[
                ["Sharpe Ratio", riskStats.sharpe, COLORS.accent],
                ["Max Drawdown", `${riskStats.maxDD}%`, COLORS.red],
                ["Profit Factor", riskStats.profitFactor, COLORS.blue],
                ["Total PnL", `$${riskStats.totalPnl}`, parseFloat(riskStats.totalPnl) >= 0 ? COLORS.accent : COLORS.red],
                ["Avg Win", `$${riskStats.avgWin}`, COLORS.accent],
                ["Avg Loss", `$${riskStats.avgLoss}`, COLORS.red],
                ["Total Trades", riskStats.trades, COLORS.blue],
              ].map(([l, v, c]) => (
                <div key={l} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "9px", color: COLORS.textDim, letterSpacing: "1px", textTransform: "uppercase" }}>{l}</div>
                  <div style={{ fontSize: "16px", fontWeight: "bold", color: c }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showTgSettings && (
          <div className="fi" style={{ ...s.card, marginBottom: "16px", border: `1px solid ${COLORS.blue}44` }}>
            <div style={s.label}>📨 Telegram Alerts</div>
            <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
              <input placeholder="Bot Token" value={telegramConfig.token || ""} onChange={e => setTelegramConfig(p => ({ ...p, token: e.target.value }))}
                style={{ flex: 1, minWidth: "200px", background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, padding: "6px 10px", borderRadius: "3px", fontFamily: "inherit", fontSize: "11px" }} />
              <input placeholder="Chat ID" value={telegramConfig.chatId || ""} onChange={e => setTelegramConfig(p => ({ ...p, chatId: e.target.value }))}
                style={{ width: "120px", background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, padding: "6px 10px", borderRadius: "3px", fontFamily: "inherit", fontSize: "11px" }} />
              <button onClick={() => sendTelegram("🧪 Test alert from PolyAI Scanner!")}
                style={{ background: COLORS.blue, color: "#fff", border: "none", padding: "6px 14px", borderRadius: "3px", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: "bold" }}>Test</button>
            </div>
            <div style={{ fontSize: "10px", color: COLORS.textDim, marginTop: "6px" }}>Alerts will be sent for high-confidence trades (≥8/10)</div>
          </div>
        )}

        {/* ── Main 2-Column Grid ───────────────────────────────── */}
        <div style={s.grid2} className="responsive-grid2">
          {/* ── Market List Panel ──────────────────────────────── */}
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: "4px", overflow: "hidden" }}>
            <div style={s.panelH}>
              <span style={s.panelT}>{t.activeMarkets}</span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button onClick={fetchMarkets} title={t.refresh} style={{ background: "none", border: `1px solid ${COLORS.border}`, borderRadius: "3px", padding: "3px 8px", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", color: COLORS.accent }}>🔄 {Math.floor(refreshCountdown / 60)}:{String(refreshCountdown % 60).padStart(2, "0")}</button>
                <span style={{ fontSize: "10px", color: marketsSource === "live" ? COLORS.accent : COLORS.yellow }}>
                  {marketsLoading ? "⟳ LOADING..." : marketsSource === "live" ? `LIVE 📡` : `DEMO`}
                </span>
              </div>
            </div>
            {/* Time Filter Buttons */}
            <div style={{ display: "flex", gap: "6px", padding: "8px 16px", borderBottom: `1px solid ${COLORS.border}`, flexWrap: "wrap" }}>
              <span style={{ fontSize: "9px", color: COLORS.textDim, alignSelf: "center", marginRight: "4px" }}>⏱</span>
              {[
                { key: "all", label: "ALL" },
                { key: "1h", label: "≤1H" },
                { key: "3d", label: "≤3D" },
                { key: "7d", label: "≤7D" },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setTimeFilter(f.key)}
                  style={{
                    padding: "4px 10px", fontSize: "10px", fontWeight: 700, fontFamily: "inherit",
                    border: `1px solid ${timeFilter === f.key ? COLORS.accent : COLORS.border}`,
                    background: timeFilter === f.key ? COLORS.accent + "22" : "transparent",
                    color: timeFilter === f.key ? COLORS.accent : COLORS.textDim,
                    borderRadius: "3px", cursor: "pointer", letterSpacing: "0.5px",
                  }}
                >
                  {f.label}
                </button>
              ))}
              <span style={{ fontSize: "9px", color: COLORS.textDim, alignSelf: "center", margin: "0 4px" }}>|</span>
              <span style={{ fontSize: "9px", color: COLORS.textDim, alignSelf: "center", marginRight: "4px" }}>🎯</span>
              {[
                { key: "all", label: "ALL" },
                { key: "favs", label: `⭐ ${t.favorites}` },
                { key: "crypto", label: "CRYPTO" },
                { key: "sports", label: "SPORTS" },
                { key: "ai", label: "AI" },
                { key: "politics", label: "POLITICS" },
                { key: "ipos", label: "IPOs" },
              ].map(f => (
                <button
                  key={"cat-" + f.key}
                  onClick={() => setCatFilter(f.key)}
                  style={{
                    padding: "4px 10px", fontSize: "10px", fontWeight: 700, fontFamily: "inherit",
                    border: `1px solid ${catFilter === f.key ? COLORS.blue : COLORS.border}`,
                    background: catFilter === f.key ? COLORS.blue + "22" : "transparent",
                    color: catFilter === f.key ? COLORS.blue : COLORS.textDim,
                    borderRadius: "3px", cursor: "pointer", letterSpacing: "0.5px",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {/* Search + Sort Bar */}
            <div style={{ padding: "8px 16px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                className="search-input"
                type="text"
                placeholder={t.search}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ ...s.searchInput, flex: 1 }}
              />
              <select value={sortMode} onChange={e => setSortMode(e.target.value)}
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, padding: "6px 8px", borderRadius: "3px", fontSize: "10px", fontFamily: "inherit", cursor: "pointer" }}>
                <option value="volume">📊 Volume</option>
                <option value="odds">🎯 Odds</option>
                <option value="time">⏱ Time</option>
                <option value="alpha">🔤 A-Z</option>
              </select>
            </div>
            <div style={{ padding: "16px", maxHeight: "520px", overflowY: "auto" }}>
              {markets
                .filter(m => {
                  // Search filter
                  if (searchQuery.trim()) {
                    const q = searchQuery.toLowerCase();
                    if (!m.question.toLowerCase().includes(q) && !m.category.toLowerCase().includes(q)) return false;
                  }
                  // Time filter
                  if (timeFilter === "1h") { if (!m.is5mCrypto && (m.hoursLeft == null || m.hoursLeft > 1)) return false; }
                  else if (timeFilter === "3d") { if (m.daysLeft == null || m.daysLeft > 3) return false; }
                  else if (timeFilter === "7d") { if (m.daysLeft == null || m.daysLeft > 7) return false; }
                  // Category filter
                  if (catFilter === "favs") { if (!favorites.has(m.id)) return false; }
                  else if (catFilter !== "all") {
                    const q = (m.question + " " + m.category).toLowerCase();
                    if (catFilter === "crypto" && !/bitcoin|btc|eth|crypto|token|solana|airdrop|defi|nft|coin|pump|up or down|dogecoin|doge|bnb|xrp|hyperliquid/i.test(q)) return false;
                    if (catFilter === "sports" && !/nba|atp|nfl|mlb|nhl|soccer|football|tennis|boxing|ufc|game|match|winner|serie|league|overwatch/i.test(q)) return false;
                    if (catFilter === "ai" && !/\bai\b|openai|artificial|gpt|llm|deepmind|anthropic|model|data center/i.test(q)) return false;
                    if (catFilter === "politics" && !/president|election|senate|governor|congress|trump|democrat|republican|vote|iran|ukraine|war|tariff|inflation/i.test(q)) return false;
                    if (catFilter === "ipos" && !/ipo|stock|share|nyse|nasdaq|listing|s&p|dow|equity|etf|index/i.test(q)) return false;
                  }
                  return true;
                })
                .sort((a, b) => {
                  if (sortMode === "odds") return Math.max(b.yesOdds, b.noOdds) - Math.max(a.yesOdds, a.noOdds);
                  if (sortMode === "time") return (a.hoursLeft ?? 9999) - (b.hoursLeft ?? 9999);
                  if (sortMode === "alpha") return a.question.localeCompare(b.question);
                  return b.volumeNum - a.volumeNum; // default: volume
                })
                .map(m => (
                <div
                  key={m.id}
                  className="mi"
                  onClick={() => { setSelected(m); setAnalysis(null); setConfidence(null); setRecommendation(null); }}
                  style={{
                    padding: "12px", borderRadius: "3px", marginBottom: "8px", cursor: "pointer",
                    border: `1px solid ${selected?.id === m.id ? COLORS.accent : COLORS.border}`,
                    background: selected?.id === m.id ? `${COLORS.accent}08` : "transparent",
                    position: "relative",
                  }}
                >
                  {/* Agent scanning indicator */}
                  {agentScanning === m.id && (
                    <div className="scan-bar" style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px", borderRadius: "3px 3px 0 0" }} />
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                    <div style={{ fontSize: "13px", color: COLORS.textBright, lineHeight: "1.4", flex: 1, cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); setModalMarket(m); }}
                    >{m.question}</div>
                    <div style={{ display: "flex", gap: "4px", alignItems: "center", marginLeft: "8px", flexShrink: 0 }}>
                      {m.oddsChange >= 5 && <span title={`Odds changed ${m.oddsChange.toFixed(0)}%`} style={{ fontSize: "12px", cursor: "help" }}>🔔</span>}
                      <span onClick={(e) => { e.stopPropagation(); setCompareMarket(compareMarket?.id === m.id ? null : m); setShowCompare(true); }} title="Compare" style={{ cursor: "pointer", fontSize: "11px", color: compareMarket?.id === m.id ? COLORS.yellow : COLORS.textDim }}>⚖️</span>
                      <span onClick={(e) => { e.stopPropagation(); toggleFav(m.id); }} style={{ cursor: "pointer", fontSize: "14px" }}>{favorites.has(m.id) ? "⭐" : "☆"}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "2px", background: `${COLORS.blue}22`, color: COLORS.blue, border: `1px solid ${COLORS.blue}44` }}>{m.category}</span>
                    <span style={{ fontSize: "13px", fontWeight: "bold", color: COLORS.accent }}>Y {(m.yesOdds * 100).toFixed(0)}%</span>
                    <span style={{ fontSize: "13px", fontWeight: "bold", color: COLORS.red }}>N {(m.noOdds * 100).toFixed(0)}%</span>
                    <span style={{ fontSize: "12px", color: COLORS.textDim, marginLeft: "auto" }}>
                      {t.volume}: ${m.volume}{m.hoursLeft != null ? (m.hoursLeft < 24 ? ` · ${m.hoursLeft}h` : ` · ${m.daysLeft}d`) : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Analysis Panel ─────────────────────────────────── */}
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: "4px", overflow: "hidden" }}>
            <div style={s.panelH}>
              <span style={s.panelT}>⬡ AI Analysis</span>
              {loading && <span style={{ fontSize: "10px", color: COLORS.yellow }}>● SCANNING...</span>}
              {!loading && analysis && <span style={{ fontSize: "10px", color: COLORS.accent }}>● COMPLETE</span>}
            </div>
            <div style={{ padding: "16px" }}>
              {!selected ? (
                <div style={{ textAlign: "center", color: COLORS.textDim, padding: "60px 0", fontSize: "12px" }}>
                  ← Select a market to analyze
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: "13px", color: COLORS.textBright, marginBottom: "12px", lineHeight: "1.4" }}>{selected.question}</div>
                  <button style={s.btn(loading)} onClick={analyzeMarket} disabled={loading}>
                    {loading ? "⟳ Analyzing..." : "▶ Run AI Analysis"}
                  </button>

                  {confidence && (
                    <div className="fi">
                      <div style={{ marginTop: "12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                          <span>AI Confidence</span>
                          <span style={{ color: getColor(confidence.score) }}>{confidence.score}/10</span>
                        </div>
                        <div style={{ background: COLORS.border, borderRadius: "2px", height: "8px", overflow: "hidden" }}>
                          <div style={{ width: `${confidence.score * 10}%`, height: "100%", background: getColor(confidence.score), transition: "width 0.5s", borderRadius: "2px" }} />
                        </div>
                      </div>

                      {recommendation && (
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px", marginTop: "10px", border: `1px solid ${COLORS.border}`, borderRadius: "3px", background: COLORS.bg }}>
                          <span style={{ fontSize: "20px" }}>{recommendation === "YES" ? "▲" : "▼"}</span>
                          <div>
                            <div style={{ fontSize: "13px", fontWeight: "bold", color: recommendation === "YES" ? COLORS.accent : COLORS.red }}>
                              BET {recommendation} → {recommendation === "YES" ? (selected.yesOdds * 100).toFixed(0) : (selected.noOdds * 100).toFixed(0)}% odds
                            </div>
                            <div style={{ fontSize: "10px", color: COLORS.textDim }}>Risk: <span style={{ color: getRiskColor(confidence.risk) }}>{confidence.risk}</span></div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {analysis && (
                    <div className="fi">
                      <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: "3px", padding: "12px", marginTop: "12px", fontSize: "12px", lineHeight: "1.6", color: COLORS.text, whiteSpace: "pre-wrap" }}>
                        {analysis}
                      </div>
                      {/* Share Buttons */}
                      <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                        <button onClick={() => shareResult(`🤖 PolyAI: ${selected.question}\n${recommendation} (${confidence.score}/10)\n${analysis.slice(0, 100)}...`)} style={{ background: "none", border: `1px solid ${COLORS.border}`, borderRadius: "3px", padding: "4px 10px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", color: COLORS.accent }}>📋 Copy</button>
                        <button onClick={() => shareToTwitter(`🤖 PolyAI Analysis: ${selected.question}\n\n${recommendation} (${confidence.score}/10 confidence)\n\n#Polymarket #PredictionMarkets`)} style={{ background: "none", border: `1px solid ${COLORS.border}`, borderRadius: "3px", padding: "4px 10px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", color: COLORS.blue }}>🐦 Tweet</button>
                      </div>
                    </div>
                  )}

                  {recommendation && betCalc && (
                    <div className="fi" style={{ marginTop: "12px", padding: "12px", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: "3px" }}>
                      <div style={{ ...s.label, marginBottom: "8px" }}>⬡ Bet Calculator</div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                        <span style={{ fontSize: "12px", color: COLORS.textDim }}>Amount: $</span>
                        <input
                          type="number" value={betAmount} min="1" max={bankroll}
                          onChange={e => setBetAmount(e.target.value)}
                          style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.accent, padding: "6px 10px", borderRadius: "3px", width: "80px", fontFamily: "'Courier New', monospace", fontSize: "14px" }}
                        />
                        <span style={{ fontSize: "11px", color: COLORS.textDim }}>of ${bankroll.toFixed(2)}</span>
                      </div>
                      {[["Bet amount", `$${betCalc.bet}`], ["Odds", `${betCalc.odds}%`], ["Potential profit", `$${betCalc.payout}`]].map(([l, v]) => (
                        <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "4px 0", borderBottom: `1px solid ${COLORS.border}22` }}>
                          <span style={{ color: COLORS.textDim }}>{l}</span>
                          <span style={{ color: COLORS.textBright }}>{v}</span>
                        </div>
                      ))}
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: "bold", padding: "8px 0 4px", color: COLORS.accent }}>
                        <span>If WIN → Total</span><span>${betCalc.total}</span>
                      </div>
                      <button
                        onClick={() => {
                          const amt = parseFloat(betAmount) || 0;
                          if (amt > 0 && amt <= bankroll) {
                            const win = Math.random() < (recommendation === "YES" ? selected.yesOdds : selected.noOdds);
                            const nb = bankroll + (win ? parseFloat(betCalc.payout) : -amt);
                            setBankroll(Math.max(0, nb));
                            addLog(`${win ? "✅ WIN" : "❌ LOSS"}: ${recommendation} | ${win ? `+$${betCalc.payout}` : `-$${amt}`} → $${Math.max(0, nb).toFixed(2)}`);
                          }
                        }}
                        style={{ ...s.btn(false), background: "transparent", color: COLORS.accent, border: `1px solid ${COLORS.accent}`, marginTop: "8px" }}
                      >
                        ▶ SIMULATE BET (Demo)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Win/Loss Stats + Trade History ───────────────────── */}
        {tradeHistory.length > 0 && (
          <div className="fi" style={{ ...s.card, marginBottom: "16px" }}>
            {/* Stats Bar */}
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "12px", padding: "10px", background: COLORS.bg, borderRadius: "3px", border: `1px solid ${COLORS.border}` }}>
              {(() => {
                const wins = tradeHistory.filter(tr => tr.result === "WIN").length;
                const losses = tradeHistory.filter(tr => tr.result === "LOSS").length;
                const totalPnl = tradeHistory.reduce((s, tr) => s + parseFloat(tr.pnl), 0);
                const avgConf = tradeHistory.length > 0 ? (tradeHistory.reduce((s, tr) => s + tr.confidence, 0) / tradeHistory.length).toFixed(1) : "0";
                return [[t.statsWins, wins, COLORS.accent], [t.statsLosses, losses, COLORS.red], [t.winRate, tradeHistory.length > 0 ? ((wins / tradeHistory.length) * 100).toFixed(1) + "%" : "0%", COLORS.blue], [t.statsPnl, `$${totalPnl.toFixed(2)}`, totalPnl >= 0 ? COLORS.accent : COLORS.red], [t.statsAvgConf, avgConf, COLORS.yellow]].map(([l, v, c]) => (
                  <div key={l} style={{ textAlign: "center", flex: 1, minWidth: "60px" }}>
                    <div style={{ fontSize: "9px", color: COLORS.textDim, letterSpacing: "1px", textTransform: "uppercase" }}>{l}</div>
                    <div style={{ fontSize: "16px", fontWeight: "bold", color: c }}>{v}</div>
                  </div>
                ));
              })()}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <div style={s.label}>{t.tradeHist}</div>
              <button onClick={exportCSV} style={{ background: "none", border: `1px solid ${COLORS.border}`, borderRadius: "3px", padding: "4px 10px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", color: COLORS.accent }}>{t.exportCSV}</button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    {["Time", "Market", "Side", "Bet", t.odds, "Conf", "Result", "PnL", t.bankroll].map(h => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: COLORS.textDim, letterSpacing: "1px", fontSize: "9px", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tradeHistory.slice(0, 15).map(tr => (
                    <tr key={tr.id} style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                      <td style={{ padding: "5px 8px", color: COLORS.textDim }}>{tr.time}</td>
                      <td style={{ padding: "5px 8px", color: COLORS.textBright, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tr.market}</td>
                      <td style={{ padding: "5px 8px", color: tr.side === "YES" ? COLORS.accent : COLORS.red, fontWeight: "bold" }}>{tr.side}</td>
                      <td style={{ padding: "5px 8px", color: COLORS.textBright }}>${tr.bet.toFixed(2)}</td>
                      <td style={{ padding: "5px 8px", color: COLORS.textDim }}>{tr.odds}</td>
                      <td style={{ padding: "5px 8px", color: getColor(tr.confidence) }}>{tr.confidence}/10</td>
                      <td style={{ padding: "5px 8px", color: tr.result === "WIN" ? COLORS.accent : COLORS.red, fontWeight: "bold" }}>{tr.result}</td>
                      <td style={{ padding: "5px 8px", color: parseFloat(tr.pnl) >= 0 ? COLORS.accent : COLORS.red, fontWeight: "bold" }}>${tr.pnl}</td>
                      <td style={{ padding: "5px 8px", color: COLORS.textBright }}>${tr.bankrollAfter}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Activity Log ──────────────────────────────────────── */}
        <div style={s.card}>
          <div style={s.label}>{t.activityLog}</div>
          <div style={{ fontSize: "11px", color: COLORS.textDim, maxHeight: "160px", overflowY: "auto", marginTop: "8px" }}>
            {log.length === 0 ? <div>{t.noActivity}</div> : log.map((e, i) => (
              <div key={i} style={{ borderBottom: `1px solid ${COLORS.border}22`, padding: "3px 0", lineHeight: "1.5" }}>{e}</div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Market Detail Modal ──────────────────────────────────── */}
      {modalMarket && (
        <div className="fi" onClick={() => setModalMarket(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center", padding: "24px",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: "6px",
            padding: "24px", maxWidth: "600px", width: "100%", maxHeight: "80vh", overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div style={{ fontSize: "16px", fontWeight: "bold", color: COLORS.textBright, lineHeight: "1.4", flex: 1, marginRight: "16px" }}>{modalMarket.question}</div>
              <button onClick={() => setModalMarket(null)} style={{ background: "none", border: `1px solid ${COLORS.border}`, borderRadius: "3px", padding: "4px 10px", cursor: "pointer", fontSize: "14px", color: COLORS.textDim }}>✕</button>
            </div>
            <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
              <span style={{ padding: "4px 12px", borderRadius: "3px", background: `${COLORS.blue}22`, color: COLORS.blue, fontSize: "11px", border: `1px solid ${COLORS.blue}44` }}>{modalMarket.category}</span>
              <span style={{ fontSize: "14px", fontWeight: "bold", color: COLORS.accent }}>Y {(modalMarket.yesOdds * 100).toFixed(1)}%</span>
              <span style={{ fontSize: "14px", fontWeight: "bold", color: COLORS.red }}>N {(modalMarket.noOdds * 100).toFixed(1)}%</span>
            </div>
            {/* Odds bar */}
            <div style={{ background: COLORS.border, borderRadius: "4px", height: "20px", overflow: "hidden", marginBottom: "16px", display: "flex" }}>
              <div style={{ width: `${modalMarket.yesOdds * 100}%`, background: COLORS.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: "bold", color: COLORS.bg }}>YES</div>
              <div style={{ flex: 1, background: COLORS.red, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: "bold", color: "#fff" }}>NO</div>
            </div>
            {[
              [t.volume, `$${modalMarket.volume}`],
              [t.endsAt, modalMarket.endDate || "N/A"],
              [t.description, modalMarket.description || modalMarket.question],
            ].map(([label, val]) => (
              <div key={label} style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "10px", color: COLORS.textDim, letterSpacing: "1px", textTransform: "uppercase", marginBottom: "4px" }}>{label}</div>
                <div style={{ fontSize: "12px", color: COLORS.text, lineHeight: "1.5", whiteSpace: "pre-wrap" }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* ── Compare Modal ────────────────────────────────────────── */}
      {showCompare && selected && compareMarket && selected.id !== compareMarket.id && (
        <div className="fi" onClick={() => setShowCompare(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center", padding: "24px",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: "6px",
            padding: "24px", maxWidth: "700px", width: "100%",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
              <div style={s.label}>⚖️ Market Comparison</div>
              <button onClick={() => setShowCompare(false)} style={{ background: "none", border: `1px solid ${COLORS.border}`, borderRadius: "3px", padding: "4px 10px", cursor: "pointer", fontSize: "14px", color: COLORS.textDim }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              {[selected, compareMarket].map((m, i) => (
                <div key={i} style={{ padding: "12px", border: `1px solid ${COLORS.border}`, borderRadius: "4px", background: COLORS.bg }}>
                  <div style={{ fontSize: "12px", color: COLORS.textBright, marginBottom: "10px", lineHeight: "1.4", fontWeight: "bold" }}>{m.question}</div>
                  <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                    <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "2px", background: `${COLORS.blue}22`, color: COLORS.blue }}>{m.category}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", fontWeight: "bold" }}>
                    <span style={{ color: COLORS.accent }}>Y {(m.yesOdds * 100).toFixed(0)}%</span>
                    <span style={{ color: COLORS.red }}>N {(m.noOdds * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ background: COLORS.border, borderRadius: "3px", height: "12px", overflow: "hidden", marginTop: "6px", display: "flex" }}>
                    <div style={{ width: `${m.yesOdds * 100}%`, background: COLORS.accent, height: "100%" }} />
                    <div style={{ flex: 1, background: COLORS.red, height: "100%" }} />
                  </div>
                  <div style={{ fontSize: "10px", color: COLORS.textDim, marginTop: "6px" }}>{t.volume}: ${m.volume}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
