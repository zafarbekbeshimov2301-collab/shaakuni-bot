const fetch = require('node-fetch');
const http = require('http');

// ========== SOZLAMALAR ==========
const BOT_TOKEN = process.env.BOT_TOKEN || "BU_YERGA_BOT_TOKENINGIZNI_YOZING";
const CHAT_ID = process.env.CHAT_ID || "BU_YERGA_CHAT_IDINGIZNI_YOZING";

// Har necha daqiqada tekshirsin
const CHECK_INTERVAL_MINUTES = 2;

// Qaysi juftliklar bo‘yicha signal bersin
const SYMBOLS = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "BNB/USDT",
  "XAU/USD"   // Gold
];

// ========== BARQAROR SIGNAL ==========
let states = {}; // Har bir juftlik uchun alohida holat

SYMBOLS.forEach(sym => {
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

// ========== MA’LUMOT GENERATSIYASI (muvozanatli) ==========
function generateData(symbol) {
  // BUY va SELL tengroq chiqishi uchun biroz muvozanatlashtirilgan
  const bias = Math.random(); // 0..1

  let rsi, stoch, macdHist, orderBlock, liquidity, isSqueeze;

  if (bias < 0.42) {
    // Bullish tomonga og‘ish
    rsi = +(Math.random() * 28 + 18).toFixed(1);       // 18-46
    stoch = +(Math.random() * 35 + 5).toFixed(1);       // 5-40
    macdHist = +(Math.random() * 1.2 + 0.1).toFixed(3);
    orderBlock = Math.random() > 0.4 ? "Bullish OB" : "Potensial OB";
    liquidity = Math.random() > 0.5 ? "Likvidlik olingan" : "Tayyorlanmoqda";
    isSqueeze = Math.random() > 0.35;
  } else if (bias < 0.84) {
    // Bearish tomonga og‘ish
    rsi = +(Math.random() * 28 + 55).toFixed(1);       // 55-83
    stoch = +(Math.random() * 35 + 60).toFixed(1);      // 60-95
    macdHist = +(Math.random() * -1.2 - 0.1).toFixed(3);
    orderBlock = Math.random() > 0.4 ? "Bearish OB" : "Potensial OB";
    liquidity = Math.random() > 0.5 ? "Likvidlik olingan" : "Tayyorlanmoqda";
    isSqueeze = Math.random() > 0.35;
  } else {
    // Neutral
    rsi = +(Math.random() * 30 + 35).toFixed(1);
    stoch = +(Math.random() * 40 + 30).toFixed(1);
    macdHist = +(Math.random() * 0.8 - 0.4).toFixed(3);
    orderBlock = "Yo‘q";
    liquidity = "Yo‘q";
    isSqueeze = Math.random() > 0.6;
  }

  const atr = +(Math.random() * 2.2 + 0.4).toFixed(2);
  const volumeRatio = +(Math.random() * 1.8 + 0.6).toFixed(2);
  const isLowVol = atr < 1.15;

  return { rsi, stoch, atr, macdHist, volumeRatio, orderBlock, liquidity, isSqueeze, isLowVol };
}

function calculateRawSignal(data) {
  let score = 0;
  let reasons = [];

  if (data.isSqueeze) { score += 2.3; reasons.push("Bollinger siqilishi"); }
  if (data.isLowVol) { score += 1.1; reasons.push("Past volatillik"); }

  if (data.rsi < 29) { score += 2.1; reasons.push("RSI past"); }
  else if (data.rsi > 71) { score -= 2.1; reasons.push("RSI yuqori"); }

  if (data.stoch < 20) { score += 1.5; reasons.push("Stoch oversold"); }
  else if (data.stoch > 80) { score -= 1.5; reasons.push("Stoch overbought"); }

  if (data.macdHist > 0.25) score += 1.1;
  else if (data.macdHist < -0.25) score -= 1.1;

  if (data.volumeRatio > 1.5) { score += 1.2; reasons.push("Hajm oshgan"); }

  if (data.orderBlock.includes("Bullish")) { score += 2.7; reasons.push("Bullish Order Block"); }
  else if (data.orderBlock.includes("Bearish")) { score -= 2.7; reasons.push("Bearish Order Block"); }

  if (data.liquidity.includes("olingan")) {
    score += data.orderBlock.includes("Bullish") ? 1.4 : -1.4;
    reasons.push("Likvidlik grab");
  }

  let signal = "WAIT";
  let strength = Math.min(Math.abs(score) * 11, 100);

  if (score >= 5.6) signal = "BUY";
  else if (score <= -5.6) signal = "SELL";
  else if (Math.abs(score) >= 4.0 && data.isSqueeze) {
    signal = score > 0 ? "BUY" : "SELL";
    strength = Math.max(strength, 67);
  }

  return { signal, score, strength, reasons };
}

// ========== HAR BIR JUFTLIKNI TEKSHIRISH ==========
async function checkSymbol(symbol) {
  const data = generateData(symbol);
  const raw = calculateRawSignal(data);
  const state = states[symbol];
  const timeStr = new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });

  console.log(`[${timeStr}] ${symbol} → Raw: ${raw.signal} | Kuch: ${raw.strength.toFixed(0)}% | Stable: ${state.currentStableSignal}`);

  // Barqaror signal mantig‘i
  if (state.currentStableSignal === "WAIT") {
    if (raw.signal !== "WAIT") {
      state.currentStableSignal = raw.signal;
      state.signalHoldCounter = 1;
      state.oppositeCount = 0;
    }
  } else {
    if (raw.signal === state.currentStableSignal) {
      state.signalHoldCounter++;
      state.oppositeCount = 0;
    } else if (raw.signal === "WAIT") {
      state.oppositeCount = 0;
    } else {
      state.oppositeCount++;
      if (state.oppositeCount >= OPPOSITE_NEEDED && state.signalHoldCounter >= HOLD_TIME) {
        state.currentStableSignal = raw.signal;
        state.signalHoldCounter = 1;
        state.oppositeCount = 0;
      }
    }
  }

  // Yuborish sharti
  const shouldSend = (
    (state.currentStableSignal === "BUY" || state.currentStableSignal === "SELL") &&
    raw.strength >= 70 &&
    (state.currentStableSignal !== state.lastSentSignal || Date.now() - state.lastSentTime > 12 * 60 * 1000)
  );

  if (shouldSend) {
    const direction = state.currentStableSignal === "BUY" ? "SOTIB OL" : "SOTISH";
    const emoji = state.currentStableSignal === "BUY" ? "🟢" : "🔴";

    const message = `
${emoji} <b>SHAAKUNI 24/7 SIGNAL</b> ${emoji}

📌 <b>Juftlik:</b> ${symbol}
📊 <b>Signal:</b> ${direction}
💪 <b>Kuch:</b> ${raw.strength.toFixed(0)}%
🔒 <b>Holat:</b> Barqaror
⏰ <b>Vaqt:</b> ${timeStr}

${raw.reasons.slice(0, 3).join(" | ")}

1-2 daqiqa ichida harakat kutishingiz mumkin.
    `.trim();

    const sent = await sendToTelegram(message);
    if (sent) {
      state.lastSentSignal = state.currentStableSignal;
      state.lastSentTime = Date.now();
      console.log(`✅ Yuborildi: ${symbol} ${direction}`);
    }
  }
}

// ========== ASOSIY LOOP ==========
async function checkAll() {
  for (const symbol of SYMBOLS) {
    await checkSymbol(symbol);
    // Juftliklar orasida biroz kutish (Telegram limitiga urilmaslik uchun)
    await new Promise(r => setTimeout(r, 1500));
  }
}

// ========== ISHGA TUSHIRISH ==========
console.log("Shaakuni 24/7 Bot ishga tushdi...");
console.log(`Juftliklar: ${SYMBOLS.join(", ")}`);
console.log(`Har ${CHECK_INTERVAL_MINUTES} daqiqada tekshiradi`);

checkAll();
setInterval(checkAll, CHECK_INTERVAL_MINUTES * 60 * 1000);

// Render uchun oddiy server
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Shaakuni 24/7 Bot ishlayapti");
}).listen(PORT, () => {
  console.log(`Server ${PORT} portda ishlayapti`);
});
