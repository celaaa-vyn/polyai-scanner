import { useState, useCallback, useEffect, useRef } from "react";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

const COLORS = {
  bg: "#080c10",
  panel: "#0d1117",
  border: "#1c2a3a",
  accent: "#00ff88",
  accentDim: "#00cc6a",
  red: "#ff4466",
  yellow: "#ffd700",
  blue: "#00aaff",
  text: "#c9d1d9",
  textDim: "#6e7681",
  textBright: "#f0f6fc",
  purple: "#a78bfa",
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
      // Skip extremely one-sided markets (>97% or <3%)
      if (yesOdds > 0.97 || yesOdds < 0.03) return false;
      return true;
    })
    .map(m => {
      const prices = JSON.parse(m.outcomePrices);
      const yesOdds = parseFloat(prices[0]);
      const noOdds = parseFloat(prices[1]);
      const category = m.events?.[0]?.series?.[0]?.title || m.events?.[0]?.title?.split(" ")[0] || "General";
      const vol = m.volumeNum || 0;
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
        daysLeft: m.endDate ? Math.max(0, Math.ceil((new Date(m.endDate) - new Date()) / 86400000)) : null,
      };
    })
    .sort((a, b) => b.volumeNum - a.volumeNum)
    .slice(0, 20);
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
  const [bankroll, setBankroll] = useState(10);
  const [log, setLog] = useState([]);
  const [confidence, setConfidence] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [timeFilter, setTimeFilter] = useState("all"); // "all", "3d", "7d"

  // ── Auto-Trade Agent State ────────────────────────────────────
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [agentStatus, setAgentStatus] = useState("IDLE");
  const [agentScanning, setAgentScanning] = useState(null);
  const [tradeHistory, setTradeHistory] = useState([]);
  const [openPositions, setOpenPositions] = useState([]);
  const [peakBankroll, setPeakBankroll] = useState(10);
  const cooldownMap = useRef({});
  const autoTradeRef = useRef(false);
  const bankrollRef = useRef(10);
  const openPosRef = useRef([]);

  // Keep refs in sync
  useEffect(() => { bankrollRef.current = bankroll; }, [bankroll]);
  useEffect(() => { openPosRef.current = openPositions; }, [openPositions]);
  useEffect(() => { if (bankroll > peakBankroll) setPeakBankroll(bankroll); }, [bankroll, peakBankroll]);

  // ── Fetch Live Polymarket Data ───────────────────────────────
  useEffect(() => {
    const fetchMarkets = async () => {
      try {
        setMarketsLoading(true);
        const fetchUrl = import.meta.env.PROD
          ? POLYMARKET_API                                               // Proxy has params built-in
          : `${POLYMARKET_API}?closed=false&limit=100&order=volume&ascending=false`;
        const res = await fetch(fetchUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const parsed = parsePolymarketData(data);
        if (parsed.length > 0) {
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
    };
    fetchMarkets();
    const interval = setInterval(fetchMarkets, 5 * 60 * 1000); // Refresh every 5 min
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

          // Execute simulated trade
          const win = Math.random() < (rec === "YES" ? market.yesOdds : market.noOdds);
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
            result: win ? "WIN" : "LOSS",
            pnl: pnl.toFixed(2),
            bankrollAfter: newBankroll.toFixed(2),
            time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
          };

          setTradeHistory(prev => [trade, ...prev].slice(0, 50));
          addLog(`🤖 ${win ? "✅ WIN" : "❌ LOSS"}: ${rec} $${betSize.toFixed(2)} on "${market.question.slice(0, 30)}..." → PnL: $${pnl.toFixed(2)} | Bankroll: $${newBankroll.toFixed(2)}`);
          setAgentStatus(`TRADED: ${win ? "WIN" : "LOSS"} $${Math.abs(pnl).toFixed(2)}`);
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

  /* ─── Styles ─────────────────────────────────────────────────── */
  const s = {
    app: { background: COLORS.bg, minHeight: "100vh", fontFamily: "'Courier New', monospace", color: COLORS.text },
    grid: { position: "fixed", inset: 0, backgroundImage: `linear-gradient(${COLORS.border}33 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border}33 1px, transparent 1px)`, backgroundSize: "40px 40px", pointerEvents: "none", zIndex: 0 },
    header: { borderBottom: `1px solid ${COLORS.border}`, padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative", zIndex: 1, background: `${COLORS.panel}ee`, backdropFilter: "blur(10px)" },
    main: { padding: "24px", position: "relative", zIndex: 1, maxWidth: "1400px", margin: "0 auto" },
    card: { background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: "4px", padding: "16px", marginBottom: "2px" },
    grid4: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px", marginBottom: "16px" },
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" },
    label: { fontSize: "10px", color: COLORS.textDim, letterSpacing: "2px", textTransform: "uppercase", marginBottom: "6px" },
    btn: (disabled) => ({ background: disabled ? `${COLORS.accent}44` : COLORS.accent, color: COLORS.bg, border: "none", padding: "8px 16px", borderRadius: "3px", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "'Courier New', monospace", fontSize: "12px", fontWeight: "bold", letterSpacing: "1px", width: "100%" }),
    panelH: { padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" },
    panelT: { fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", color: COLORS.textDim },
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
      `}</style>

      <div style={s.grid} />

      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.accent, boxShadow: `0 0 8px ${COLORS.accent}` }} />
          <div>
            <div style={{ fontSize: "18px", fontWeight: "bold", color: COLORS.accent, letterSpacing: "4px" }}>POLYAI SCANNER</div>
            <div style={{ fontSize: "10px", color: COLORS.textDim, letterSpacing: "3px" }}>PREDICTION MARKET AI ANALYZER</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
          {/* Agent Toggle */}
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
              <div style={{ fontSize: "10px", color: COLORS.textDim, letterSpacing: "2px" }}>AI AGENT</div>
              <div style={{ fontSize: "13px", fontWeight: "bold", color: autoTradeEnabled ? COLORS.purple : COLORS.textDim }}>
                {autoTradeEnabled ? "ACTIVE" : "OFF"}
              </div>
            </div>
          </div>
          {[["BANKROLL", `$${bankroll.toFixed(2)}`, COLORS.accent], ["TARGET", "$100.00", COLORS.yellow], ["TRADES", `${agentStats.total}`, COLORS.blue]].map(([l, v, c]) => (
            <div key={l} style={{ textAlign: "right" }}>
              <div style={{ fontSize: "10px", color: COLORS.textDim, letterSpacing: "2px" }}>{l}</div>
              <div style={{ fontSize: "20px", fontWeight: "bold", color: c }}>{v}</div>
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
        <div style={s.grid4}>
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

        {/* ── Main 2-Column Grid ───────────────────────────────── */}
        <div style={s.grid2}>
          {/* ── Market List Panel ──────────────────────────────── */}
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: "4px", overflow: "hidden" }}>
            <div style={s.panelH}>
              <span style={s.panelT}>⬡ Active Markets</span>
              <span style={{ fontSize: "10px", color: marketsSource === "live" ? COLORS.accent : COLORS.yellow }}>
                {marketsLoading ? "⟳ LOADING..." : marketsSource === "live" ? `LIVE 📡` : `DEMO`}
              </span>
            </div>
            {/* Time Filter Buttons */}
            <div style={{ display: "flex", gap: "6px", padding: "8px 16px", borderBottom: `1px solid ${COLORS.border}` }}>
              {[
                { key: "all", label: "ALL" },
                { key: "3d", label: "≤3 DAYS" },
                { key: "7d", label: "≤7 DAYS" },
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
            </div>
            <div style={{ padding: "16px", maxHeight: "520px", overflowY: "auto" }}>
              {markets
                .filter(m => {
                  if (timeFilter === "all") return true;
                  if (m.daysLeft == null) return false;
                  if (timeFilter === "3d") return m.daysLeft <= 3;
                  if (timeFilter === "7d") return m.daysLeft <= 7;
                  return true;
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
                  <div style={{ fontSize: "13px", color: COLORS.textBright, marginBottom: "6px", lineHeight: "1.4" }}>{m.question}</div>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "2px", background: `${COLORS.blue}22`, color: COLORS.blue, border: `1px solid ${COLORS.blue}44` }}>{m.category}</span>
                    <span style={{ fontSize: "13px", fontWeight: "bold", color: COLORS.accent }}>Y {(m.yesOdds * 100).toFixed(0)}%</span>
                    <span style={{ fontSize: "13px", fontWeight: "bold", color: COLORS.red }}>N {(m.noOdds * 100).toFixed(0)}%</span>
                    <span style={{ fontSize: "10px", color: COLORS.textDim, marginLeft: "auto" }}>Vol: ${m.volume}</span>
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
                    <div className="fi" style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: "3px", padding: "12px", marginTop: "12px", fontSize: "12px", lineHeight: "1.6", color: COLORS.text, whiteSpace: "pre-wrap" }}>
                      {analysis}
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

        {/* ── Agent Trade History ───────────────────────────────── */}
        {tradeHistory.length > 0 && (
          <div className="fi" style={{ ...s.card, marginBottom: "16px" }}>
            <div style={{ ...s.label, marginBottom: "10px" }}>🤖 AI Agent Trade History</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    {["Time", "Market", "Side", "Bet", "Odds", "Conf", "Result", "PnL", "Bankroll"].map(h => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: COLORS.textDim, letterSpacing: "1px", fontSize: "9px", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tradeHistory.slice(0, 15).map(t => (
                    <tr key={t.id} style={{ borderBottom: `1px solid ${COLORS.border}22` }}>
                      <td style={{ padding: "5px 8px", color: COLORS.textDim }}>{t.time}</td>
                      <td style={{ padding: "5px 8px", color: COLORS.textBright, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.market}</td>
                      <td style={{ padding: "5px 8px", color: t.side === "YES" ? COLORS.accent : COLORS.red, fontWeight: "bold" }}>{t.side}</td>
                      <td style={{ padding: "5px 8px", color: COLORS.textBright }}>${t.bet.toFixed(2)}</td>
                      <td style={{ padding: "5px 8px", color: COLORS.textDim }}>{t.odds}</td>
                      <td style={{ padding: "5px 8px", color: getColor(t.confidence) }}>{t.confidence}/10</td>
                      <td style={{ padding: "5px 8px", color: t.result === "WIN" ? COLORS.accent : COLORS.red, fontWeight: "bold" }}>{t.result}</td>
                      <td style={{ padding: "5px 8px", color: parseFloat(t.pnl) >= 0 ? COLORS.accent : COLORS.red, fontWeight: "bold" }}>${t.pnl}</td>
                      <td style={{ padding: "5px 8px", color: COLORS.textBright }}>${t.bankrollAfter}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Activity Log ──────────────────────────────────────── */}
        <div style={s.card}>
          <div style={s.label}>⬡ Activity Log</div>
          <div style={{ fontSize: "11px", color: COLORS.textDim, maxHeight: "160px", overflowY: "auto", marginTop: "8px" }}>
            {log.length === 0 ? <div>No activity yet.</div> : log.map((e, i) => (
              <div key={i} style={{ borderBottom: `1px solid ${COLORS.border}22`, padding: "3px 0", lineHeight: "1.5" }}>{e}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
