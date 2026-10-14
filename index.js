const fetch = require('node-fetch');
const http = require('http');

// ========== SOZLAMALAR ==========
const BOT_TOKEN = process.env.BOT_TOKEN || "BU_YERGA_BOT_TOKENINGIZNI_YOZING";
const CHAT_ID = process.env.CHAT_ID || "BU_YERGA_CHAT_IDINGIZNI_YOZING";
const CHECK_INTERVAL_MINUTES = 2;

const CRYPTO_SYMBOLS = [
  { name: "BTC/USDT", binance: "BTCUSDT" },
  { name: "ETH/USDT", binance: "ETHUSDT" },
  { name: "SOL/USDT", binance: "SOLUSDT" },
  { name: "BNB/USDT", binance: "BNBUSDT" }
];

let states = {};
[...CRYPTO_SYMBOLS.map(s => s.name), "XAU/USD"].forEach(sym => {
  states[sym] = {
    currentStableSignal: "WAIT",
    signalHoldCounter: 0,
    oppositeCount: 0,
    lastSentSignal: null,
    lastSentTime: 0
  };
});

const HOLD_TIME = 3;
const OPPOSITE_NEEDED = 2;

// ========== TELEGRAM ==========
async function sendToTelegram(message) {
  if (!BOT_TOKEN || BOT_TOKEN.includes("BU_YERGA") || !CHAT_ID) {
    console.log("Token yoki Chat ID kiritilmagan");
    return false;
  }
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: "HTML"
      })
    });
    const data = await res.json();
    if (!data.ok) console.log("Telegram xatosi:", data.description);
    return data.ok;
  } catch (err) {
    console.log("Telegram xatosi:", err.message);
    return false;
  }
}

// ========== BINANCE (tuzatilgan) ==========
async function getBinanceKlines(symbol, interval = "15m", limit = 100) {
  try {
    // data-api.binance.vision ba'zan serverlarda yaxshiroq ishlaydi
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json"
      },
      timeout: 10000
    });

    if (!res.ok) {
      console.log(`Binance HTTP xato (${symbol}): ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      console.log(`Binance bo'sh javob (${symbol})`);
      return null;
    }

    return data.map(k => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      time: k[0]
    }));
  } catch (e) {
    console.log(`Binance xatosi (${symbol}):`, e.message);
    return null;
  }
}

// ========== GOLD (yangi manba) ==========
async function getGoldData() {
  try {
    // Ishlaydigan bepul manba
    const res = await fetch("https://api.gold-api.com/price/XAU", {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      },
      timeout: 8000
    });

    if (!res.ok) {
      console.log("Gold HTTP xato:", res.status);
      return null;
    }

    const data = await res.json();
    const price = data?.price || data?.price_usd || data?.ask;

    if (!price) {
      console.log("Gold narxi topilmadi:", JSON.stringify(data).slice(0, 200));
      return null;
    }

    return {
      price: parseFloat(price),
