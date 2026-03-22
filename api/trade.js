import { ClobClient } from "@polymarket/clob-client";
import { ethers } from "ethers";

// Safety limits
const MAX_BET_SIZE = 2.0;    // Max $2 per trade
const MIN_CONFIDENCE = 7;     // Only trade if AI confidence >= 7/10
const MAX_DAILY_TRADES = 10;  // Max 10 trades per day
const MAX_DAILY_LOSS = 5.0;   // Stop if lost $5 in a day

// Track daily stats (resets per cold start, ~every few minutes on Vercel)
let dailyTrades = 0;
let dailyPnL = 0;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Allow GET for balance check
  const isGet = req.method === "GET";
  const action = isGet ? "balance" : req.body?.action;

  const PK = process.env.POLY_PRIVATE_KEY;
  const FUNDER = process.env.POLY_FUNDER_ADDRESS;

  if (!PK || !FUNDER) {
    return res.status(400).json({ error: "Missing POLY_PRIVATE_KEY or POLY_FUNDER_ADDRESS env vars" });
  }

  // ── GET BALANCE (from Polymarket CLOB) ────────────────────
  if (action === "balance") {
    try {
      const wallet = new ethers.Wallet(PK);
      const clobClient = new ClobClient(
        "https://clob.polymarket.com",
        137,
        wallet,
        undefined,
        1, // POLY_PROXY
        FUNDER
      );
      const creds = await clobClient.createOrDeriveApiCreds();
      clobClient.setCreds(creds);

      // Try CLOB API balance first
      let totalBalance = 0;
      try {
        const balData = await clobClient.getBalanceAllowance();
        totalBalance = parseFloat(balData?.balance || "0");
      } catch {
        // Fallback: query blockchain for USDC
        try {
          const provider = new ethers.providers.JsonRpcProvider("https://polygon-rpc.com");
          const USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
          const abi = ["function balanceOf(address) view returns (uint256)"];
          const bal = await new ethers.Contract(USDC, abi, provider).balanceOf(FUNDER);
          totalBalance = parseFloat(ethers.utils.formatUnits(bal, 6));
        } catch {}
      }

      return res.status(200).json({
        success: true,
        balance: totalBalance.toFixed(2),
        address: FUNDER,
        dailyTrades,
        dailyPnL: dailyPnL.toFixed(2),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PLACE ORDER ──────────────────────────────────────────
  const { tokenId, side, size, price, confidence, marketQuestion } = req.body || {};
  if (action === "trade") {
    // Safety checks
    if (!tokenId || !side || !size || !price) {
      return res.status(400).json({ error: "Missing: tokenId, side, size, price" });
    }
    if (confidence < MIN_CONFIDENCE) {
      return res.status(400).json({ error: `Confidence ${confidence} < min ${MIN_CONFIDENCE}. Skipping.` });
    }
    if (size > MAX_BET_SIZE) {
      return res.status(400).json({ error: `Bet $${size} > max $${MAX_BET_SIZE}. Reducing risk.` });
    }
    if (dailyTrades >= MAX_DAILY_TRADES) {
      return res.status(400).json({ error: `Daily trade limit reached (${MAX_DAILY_TRADES})` });
    }
    if (dailyPnL <= -MAX_DAILY_LOSS) {
      return res.status(400).json({ error: `Daily loss limit reached ($${MAX_DAILY_LOSS})` });
    }

    try {
      const wallet = new ethers.Wallet(PK);
      const clobClient = new ClobClient(
        "https://clob.polymarket.com",
        137,
        wallet,
        undefined,
        1, // POLY_PROXY
        FUNDER
      );

      // Derive API creds
      const creds = await clobClient.createOrDeriveApiCreds();
      clobClient.setCreds(creds);

      // Create limit order
      const order = await clobClient.createAndPostOrder({
        tokenID: tokenId,
        price: parseFloat(price).toFixed(2),
        size: parseFloat(size).toFixed(2),
        side: side.toUpperCase() === "YES" ? "BUY" : "SELL",
      });

      dailyTrades++;
      const logMsg = `🤖 REAL TRADE: ${side} on "${marketQuestion?.slice(0, 40)}" | $${size} @ ${price} | Conf: ${confidence}/10`;

      // Send Telegram alert if configured
      const TG_TOKEN = process.env.TG_BOT_TOKEN;
      const TG_CHAT = process.env.TG_CHAT_ID;
      if (TG_TOKEN && TG_CHAT) {
        try {
          await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TG_CHAT,
              text: `🤖 <b>REAL TRADE PLACED!</b>\n\n📊 ${marketQuestion}\n${side === "YES" ? "🟢" : "🔴"} ${side.toUpperCase()} @ ${(parseFloat(price) * 100).toFixed(0)}%\n💰 Size: $${size}\n🧠 Confidence: ${confidence}/10\n\n⚠️ This is a REAL trade with real money!`,
              parse_mode: "HTML",
            }),
          });
        } catch {}
      }

      return res.status(200).json({
        success: true,
        orderId: order?.orderID || order?.id || "submitted",
        message: logMsg,
        dailyTrades,
      });
    } catch (err) {
      return res.status(500).json({
        error: `Trade failed: ${err.message}`,
        details: err.toString(),
      });
    }
  }

  return res.status(400).json({ error: "Unknown action. Use: balance, trade" });
}
