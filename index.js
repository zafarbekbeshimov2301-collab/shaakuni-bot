const fetch = require('node-fetch');

// ========== SOZLAMALAR ==========
const BOT_TOKEN = process.env.BOT_TOKEN || "BU_YERGA_BOT_TOKENINGIZNI_YOZING";
const CHAT_ID = process.env.CHAT_ID || "BU_YERGA_CHAT_IDINGIZNI_YOZING";

// Necha daqiqada bir marta tekshirsin (tavsiya: 2 yoki 3)
const CHECK_INTERVAL_MINUTES = 2;

// ========== BARQAROR SIGNAL O'ZGARUVCHILARI ==========
let currentStableSignal = "WAIT";
let signalHoldCounter = 0;
let oppositeCount = 0;
const HOLD_TIME = 4;
const OPPOSITE_NEEDED = 3;
let lastSentSignal = null;
let lastSentTime = 0;

// ========== TELEGRAM YUBORISH ==========
async function sendToTelegram(message) {
  if (!BOT_TOKEN || !CHAT_ID || BOT_TOKEN.includes("BU_YERGA")) {
    console.log("Bot Token yoki Chat ID kiritilmagan");
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
    if (data.ok) {
      console.log("Telegramga yuborildi");
      return true;
    } else {
      console.log("Telegram xatosi:", data.description);
      return false;
    }
  } catch (err) {
    console.log("Xatolik:", err.message);
    return false;
  }
}

// ========== SIGNAL HISOBLASH (demo) ==========
function generateData() {
  const rsi = +(Math.random() * 70 + 15).toFixed(1);
  const stoch = +(Math.random() * 100).toFixed(1);
  const atr = +(Math.random() * 2.5 + 0.5).toFixed(2);
  const bbWidth = +(Math.random() * 0.07 + 0.015).toFixed(3);
  const macdHist = +(Math.random() * 1.6 - 0.8).toFixed(3);
  const volumeRatio = +(Math.random() * 2.0 + 0.5).toFixed(2);

  let orderBlock = "Yo‘q";
  let liquidity = "Yo‘q";

  const isSqueeze = bbWidth < 0.028;
  const isLowVol = atr < 1.2;

  if (rsi < 30 && stoch < 22) {
    orderBlock = "Bullish OB";
    liquidity = "Likvidlik olingan";
  } else if (rsi > 70 && stoch > 78) {
    orderBlock = "Bearish OB";
    liquidity = "Likvidlik olingan";
  } else if (isSqueeze && (rsi < 36 || rsi > 64)) {
    orderBlock = "Potensial OB";
    liquidity = "Tayyorlanmoqda";
  }

  return { rsi, stoch, atr, bbWidth, macdHist, volumeRatio, orderBlock, liquidity, isSqueeze, isLowVol };
}

function calculateRawSignal(data) {
  let score = 0;
  let reasons = [];

  if (data.isSqueeze) { score += 2.5; reasons.push("Bollinger siqilishi"); }
  if (data.isLowVol) { score += 1.2; reasons.push("Past volatillik"); }

  if (data.rsi < 28) { score += 2.0; reasons.push("RSI past"); }
  else if (data.rsi > 72) { score -= 2.0; reasons.push("RSI yuqori"); }

  if (data.stoch < 18) { score += 1.4; reasons.push("Stoch oversold"); }
  else if (data.stoch > 82) { score -= 1.4; reasons.push("Stoch overbought"); }

  if (data.macdHist > 0.25) score += 1.0;
  else if (data.macdHist < -0.25) score -= 1.0;

  if (data.volumeRatio > 1.6) { score += 1.2; reasons.push("Hajm oshgan"); }

  if (data.orderBlock.includes("Bullish")) { score += 2.8; reasons.push("Bullish Order Block"); }
  else if (data.orderBlock.includes("Bearish")) { score -= 2.8; reasons.push("Bearish Order Block"); }

  if (data.liquidity.includes("olingan")) {
    score += data.orderBlock.includes("Bullish") ? 1.5 : -1.5;
    reasons.push("Likvidlik grab");
  }

  let signal = "WAIT";
  let strength = Math.min(Math.abs(score) * 11, 100);

  if (score >= 5.8) signal = "BUY";
  else if (score <= -5.8) signal = "SELL";
  else if (Math.abs(score) >= 4.2 && data.isSqueeze) {
    signal = score > 0 ? "BUY" : "SELL";
    strength = Math.max(strength, 68);
  }

  return { signal, score, strength, reasons };
}

// ========== ASOSIY TEKSHIRUV ==========
async function checkSignal() {
  const data = generateData();
  const raw = calculateRawSignal(data);
  const timeStr = new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });

  console.log(`[${timeStr}] Raw: ${raw.signal} | Kuch: ${raw.strength.toFixed(0)}% | Stable: ${currentStableSignal}`);

  // Barqaror signal mantig'i
  if (currentStableSignal === "WAIT") {
    if (raw.signal !== "WAIT") {
      currentStableSignal = raw.signal;
      signalHoldCounter = 1;
      oppositeCount = 0;
    }
  } else {
    if (raw.signal === currentStableSignal) {
      signalHoldCounter++;
      oppositeCount = 0;
    } else if (raw.signal === "WAIT") {
      oppositeCount = 0;
    } else {
      oppositeCount++;
      if (oppositeCount >= OPPOSITE_NEEDED && signalHoldCounter >= HOLD_TIME) {
        currentStableSignal = raw.signal;
        signalHoldCounter = 1;
        oppositeCount = 0;
      }
    }
  }

  // Faqat kuchli va yangi signalni yuboramiz
  const shouldSend = (
    (currentStableSignal === "BUY" || currentStableSignal === "SELL") &&
    raw.strength >= 72 &&
    (currentStableSignal !== lastSentSignal || Date.now() - lastSentTime > 15 * 60 * 1000) // 15 daqiqada bir xil signalni qayta yubormaslik
  );

  if (shouldSend) {
    const direction = currentStableSignal === "BUY" ? "SOTIB OL" : "SOTISH";
    const emoji = currentStableSignal === "BUY" ? "🟢" : "🔴";

    const message = `
${emoji} <b>SHAAKUNI 24/7 SIGNAL</b> ${emoji}

📌 <b>Juftlik:</b> BTC/USDT (demo)
📊 <b>Signal:</b> ${direction}
💪 <b>Kuch:</b> ${raw.strength.toFixed(0)}%
🔒 <b>Holat:</b> Barqaror
⏰ <b>Vaqt:</b> ${timeStr}

${raw.reasons.slice(0, 3).join(" | ")}

Keskin harakat ehtimoli yuqori.
    `.trim();

    const sent = await sendToTelegram(message);
    if (sent) {
      lastSentSignal = currentStableSignal;
      lastSentTime = Date.now();
    }
  }
}

// ========== ISHGA TUSHIRISH ==========
console.log("Shaakuni 24/7 Bot ishga tushdi...");
console.log(`Har ${CHECK_INTERVAL_MINUTES} daqiqada tekshiradi`);

// Darhol bir marta ishlatib ko‘ramiz
checkSignal();

// Keyin interval bilan
setInterval(checkSignal, CHECK_INTERVAL_MINUTES * 60 * 1000);

// Render free tier uxlamasligi uchun oddiy HTTP server
const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Shaakuni Bot ishlayapti');
}).listen(PORT, () => {
  console.log(`Server ${PORT} portda ishlayapti`);
});