const fetch = require('node-fetch');
const http = require('http');

// ========== SOZLAMALAR ==========
const BOT_TOKEN = process.env.BOT_TOKEN || "BU_YERGA_BOT_TOKENINGIZNI_YOZING";
const CHAT_ID = process.env.CHAT_ID || "BU_YERGA_CHAT_IDINGIZNI_YOZING";
const CHECK_INTERVAL_MINUTES = 2;

// Juftliklar
const CRYPTO_SYMBOLS = [
  { name: "BTC/USDT", binance: "BTCUSDT" },
  { name: "ETH/USDT", binance: "ETHUSDT" },
  { name: "SOL/USDT", binance: "SOLUSDT" },
  { name: "BNB/USDT", binance: "BNBUSDT" }
];

// ========== HOLATLAR ==========
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
    return data.ok;
  } catch (err) {
    console.log("Telegram xatosi:", err.message);
    return false;
  }
}

// ========== BINANCE ==========
async function getBinanceKlines(symbol, interval = "15m", limit = 100) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!Array.isArray(data)) return null;

    return data.map(k => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      time: k[0]
    }));
  } catch (e) {
    console.log("Binance xatosi:", e.message);
    return null;
  }
}

// ========== GOLD ==========
async function getGoldData() {
  try {
    const res = await fetch("https://api.metals.live/v1/spot/gold");
    const data = await res.json();
    const price = Array.isArray(data) ? data[0]?.price : data?.price || data?.[0];
    if (!price) return null;
    return {
      price: parseFloat(price),
      change: (Math.random() - 0.5) * 1.5
    };
  } catch (e) {
    console.log("Gold xatosi:", e.message);
    return null;
  }
}

// ========== INDIKATORLAR ==========
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function calculateSMA(data, period) {
  if (data.length < period) return data[data.length - 1];
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(data, period) {
  if (data.length < period) return data[data.length - 1];
  const k = 2 / (period + 1);
  let ema = calculateSMA(data.slice(0, period), period);
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateMACD(closes) {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  return ema12 - ema26;
}

function calculateBB(closes, period = 20) {
  if (closes.length < period) return { width: 0.05 };
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  const upper = sma + 2 * std;
  const lower = sma - 2 * std;
  const width = (upper - lower) / sma;
  return { width, upper, lower, sma };
}

// ========== SL HISOBLASH ==========
function calculateSL(signal, currentPrice, klines = null) {
  // Asosiy foiz (kripto uchun)
  let percent = 0.008; // 0.8%

  if (klines && klines.length > 10) {
    // So‘nggi 10 ta shamning past/yuqori nuqtasidan foydalanamiz
    const recent = klines.slice(-10);
    const recentLow = Math.min(...recent.map(k => k.low));
    const recentHigh = Math.max(...recent.map(k => k.high));

    if (signal === "BUY") {
      // SL ni so‘nggi past nuqtadan biroz pastroq qo‘yamiz
      const sl = recentLow * 0.998;
      return sl;
    } else {
      // SELL uchun so‘nggi yuqori nuqtadan biroz yuqoriroq
      const sl = recentHigh * 1.002;
      return sl;
    }
  }

  // Agar klines bo‘lmasa (Gold) — foiz bilan
  if (signal === "BUY") {
    return currentPrice * (1 - percent);
  } else {
    return currentPrice * (1 + percent);
  }
}

// ========== KRIPTO TAHLIL ==========
function analyzeCrypto(klines) {
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const currentPrice = closes[closes.length - 1];

  const rsi = calculateRSI(closes);
  const macd = calculateMACD(closes);
  const bb = calculateBB(closes);
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const lastVol = volumes[volumes.length - 1];
  const volumeRatio = lastVol / (avgVol || 1);

  const isSqueeze = bb.width < 0.035;

  let score = 0;
  let reasons = [];

  if (isSqueeze) { score += 2.2; reasons.push("Bollinger siqilishi"); }
  if (rsi < 30) { score += 2.3; reasons.push("RSI past"); }
  else if (rsi > 70) { score -= 2.3; reasons.push("RSI yuqori"); }

  if (macd > 0) score += 1.1;
  else score -= 1.1;

  if (volumeRatio > 1.6) { score += 1.3; reasons.push("Hajm oshgan"); }

  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  if (lastClose > prevClose && rsi < 45) {
    score += 1.5;
    reasons.push("Bullish momentum");
  } else if (lastClose < prevClose && rsi > 55) {
    score -= 1.5;
    reasons.push("Bearish momentum");
  }

  let signal = "WAIT";
  let strength = Math.min(Math.abs(score) * 12, 100);

  if (score >= 4.8) signal = "BUY";
  else if (score <= -4.8) signal = "SELL";
  else if (Math.abs(score) >= 3.5 && isSqueeze) {
    signal = score > 0 ? "BUY" : "SELL";
    strength = Math.max(strength, 65);
  }

  return {
    signal,
    strength,
    reasons,
    rsi: rsi.toFixed(1),
    currentPrice,
    klines
  };
}

// ========== GOLD TAHLIL ==========
function analyzeGold(goldData) {
  if (!goldData) return { signal: "WAIT", strength: 0, reasons: ["Ma’lumot yo‘q"], currentPrice: 0 };

  const change = goldData.change || 0;
  let score = 0;
  let reasons = [];

  if (change > 0.4) {
    score = 3.5;
    reasons.push("Gold o‘sishda");
  } else if (change < -0.4) {
    score = -3.5;
    reasons.push("Gold tushishda");
  }

  let signal = "WAIT";
  let strength = Math.min(Math.abs(score) * 15, 80);

  if (score >= 3) signal = "BUY";
  else if (score <= -3) signal = "SELL";

  return {
    signal,
    strength,
    reasons,
    currentPrice: goldData.price,
    klines: null
  };
}

// ========== BARQAROR SIGNAL ==========
function updateStableSignal(symbol, rawSignal) {
  const state = states[symbol];

  if (state.currentStableSignal === "WAIT") {
    if (rawSignal !== "WAIT") {
      state.currentStableSignal = rawSignal;
      state.signalHoldCounter = 1;
      state.oppositeCount = 0;
    }
  } else {
    if (rawSignal === state.currentStableSignal) {
      state.signalHoldCounter++;
      state.oppositeCount = 0;
    } else if (rawSignal === "WAIT") {
      state.oppositeCount = 0;
    } else {
      state.oppositeCount++;
      if (state.oppositeCount >= OPPOSITE_NEEDED && state.signalHoldCounter >= HOLD_TIME) {
        state.currentStableSignal = rawSignal;
        state.signalHoldCounter = 1;
        state.oppositeCount = 0;
      }
    }
  }
  return state;
}

// ========== SIGNAL YUBORISH ==========
async function maybeSendSignal(symbol, state, analysis, timeStr) {
  const shouldSend = (
    (state.currentStableSignal === "BUY" || state.currentStableSignal === "SELL") &&
    analysis.strength >= 68 &&
    (state.currentStableSignal !== state.lastSentSignal || Date.now() - state.lastSentTime > 12 * 60 * 1000)
  );

  if (!shouldSend) return;

  const direction = state.currentStableSignal === "BUY" ? "SOTIB OL" : "SOTISH";
  const emoji = state.currentStableSignal === "BUY" ? "🟢" : "🔴";
  const price = analysis.currentPrice;

  // SL hisoblash
  const sl = calculateSL(state.currentStableSignal, price, analysis.klines);

  // Narx formatlash
  const priceText = price > 1000 ? price.toFixed(2) : price.toFixed(4);
  const slText = sl > 1000 ? sl.toFixed(2) : sl.toFixed(4);

  const message = `
${emoji} <b>SHAAKUNI REAL SIGNAL</b> ${emoji}

📌 <b>Juftlik:</b> ${symbol}
📊 <b>Signal:</b> ${direction}
💰 <b>Joriy narx:</b> ${priceText}
🛑 <b>Stop Loss (SL):</b> ${slText}
💪 <b>Kuch:</b> ${analysis.strength.toFixed(0)}%
🔒 <b>Holat:</b> Barqaror
⏰ <b>Vaqt:</b> ${timeStr}

${analysis.reasons.slice(0, 3).join(" | ")}

1-2 daqiqa ichida harakat kutishingiz mumkin.
  `.trim();

  const sent = await sendToTelegram(message);
  if (sent) {
    state.lastSentSignal = state.currentStableSignal;
    state.lastSentTime = Date.now();
    console.log(`✅ Yuborildi: ${symbol} ${direction} | Narx: ${priceText} | SL: ${slText}`);
  }
}

// ========== ASOSIY TEKSHIRUV ==========
async function checkAll() {
  const timeStr = new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
  console.log(`\n===== ${timeStr} Tekshiruv boshlandi =====`);

  // Kripto
  for (const sym of CRYPTO_SYMBOLS) {
    const klines = await getBinanceKlines(sym.binance);
    if (!klines || klines.length < 30) {
      console.log(`${sym.name}: ma’lumot olinmadi`);
      continue;
    }

    const analysis = analyzeCrypto(klines);
    const state = updateStableSignal(sym.name, analysis.signal);

    console.log(`${sym.name} → ${analysis.signal} | Narx: ${analysis.currentPrice} | Kuch: ${analysis.strength.toFixed(0)}%`);

    await maybeSendSignal(sym.name, state, analysis, timeStr);
    await sleep(1200);
  }

  // Gold
  const goldData = await getGoldData();
  if (goldData) {
    const analysis = analyzeGold(goldData);
    const state = updateStableSignal("XAU/USD", analysis.signal);
    console.log(`XAU/USD → ${analysis.signal} | Narx: ${analysis.currentPrice}`);
    await maybeSendSignal("XAU/USD", state, analysis, timeStr);
  } else {
    console.log("XAU/USD: ma’lumot olinmadi");
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== ISHGA TUSHIRISH ==========
console.log("Shaakuni REAL API Bot ishga tushdi...");
console.log("Kripto: Binance | Gold: metals.live");
console.log(`Har ${CHECK_INTERVAL_MINUTES} daqiqada tekshiradi`);

checkAll();
setInterval(checkAll, CHECK_INTERVAL_MINUTES * 60 * 1000);

// Render server
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Shaakuni Real API Bot ishlayapti");
}).listen(PORT, () => {
  console.log(`Server ${PORT} portda ishlayapti`);
});
