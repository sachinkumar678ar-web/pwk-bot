const { Telegraf } = require("telegraf");
const axios = require("axios");
const express = require("express");
const admin = require("firebase-admin");

// --- CONFIG ---
const BOT_TOKEN = "8796373933:AAEfLT-5Jtcy8zSHDGC1TTh0tBlX5ME9fBk";
const PREDICTION_CHANNEL = "-1003802854489"; // Main Channel
const HISTORY_LOG_CHANNEL = "-1003716885272"; // Log Channel
const API_URL = "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json?pageSize=150";
const SELF_URL = "https://pwk-bot-1.onrender.com";

// Stickers
const WIN_STICKER = "CAACAgUAAxkBAAFE9FtpuAQsz_OSJEL23Mxjo-Ox-VJD9AACnRUAAjCBqVTN3Vho3FjTQjoE";
const LOSS_STICKER = "CAACAgIAAxkBAAFE9GtpuAS8nPYwxKSN3ixuq4a3PKyOCgACNAADWbv8JWBOiTxAs-8HOgQ";
const JACKPOT_STICKER = "CAACAgUAAxkBAAFE9GFpuASaSlQC_acxHog5Xh5PcEMivQACkRIAApIlqVQtesPFGBnFNToE";

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();
const bot = new Telegraf(BOT_TOKEN);

let historyData = [], historyMsgIds = [], lastIssue = "", lastMsgId = null, lastPredictionData = null;

const getBS = (n) => (n >= 5 ? "BIG" : "SMALL");
const getColor = (n) => ([0, 2, 4, 6, 8].includes(n) ? "RED" : "GREEN");

// AI Prediction Logic
function getFinalPrediction(nextIssue) {
    const targetDigit = nextIssue.slice(-1); 
    let matches = historyData.filter(h => h.issue.slice(-1) === targetDigit).slice(0, 10);
    if (matches.length < 3) return null;

    let counts = { BIG: 0, SMALL: 0, RED: 0, GREEN: 0 };
    matches.forEach(m => { counts[getBS(m.number)]++; counts[getColor(m.number)]++; });

    let resBS = counts.BIG >= counts.SMALL ? "BIG" : "SMALL";
    let resColor = counts.RED >= counts.GREEN ? "RED" : "GREEN";
    
    const sets = { RED: [0, 2, 4, 6, 8], GREEN: [1, 3, 5, 7, 9], BIG: [5, 6, 7, 8, 9], SMALL: [0, 1, 2, 3, 4] };
    let nums = sets[resColor].filter(n => sets[resBS].includes(n)).sort(() => 0.5 - Math.random()).slice(0, 2);
    
    return { prediction: counts[resBS] >= counts[resColor] ? resBS : resColor, nums, issue: nextIssue };
}

async function scan() {
    try {
        const res = await axios.get(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(API_URL)}`);
        const list = res.data.data.list;
        if (!list || list[0].issueNumber === lastIssue) return;

        historyData = list.map(item => ({ issue: item.issueNumber, number: parseInt(item.number) }));
        const latest = historyData[0];

        if (lastPredictionData && lastPredictionData.issue === latest.issue) {
            if (lastMsgId) await bot.telegram.deleteMessage(PREDICTION_CHANNEL, lastMsgId).catch(() => {});
            const isWin = (lastPredictionData.prediction === getBS(latest.number) || lastPredictionData.prediction === getColor(latest.number));
            const isJackpot = lastPredictionData.nums.includes(latest.number);
            
            await bot.telegram.sendMessage(PREDICTION_CHANNEL, `🎯 RESULT: ${latest.number}\n${isJackpot ? "🤩 JACKPOT" : (isWin ? "✅ WIN" : "❌ LOSS")}`);
            await bot.telegram.sendSticker(PREDICTION_CHANNEL, isJackpot ? JACKPOT_STICKER : (isWin ? WIN_STICKER : LOSS_STICKER)).catch(() => {});
        }

        const logTxt = `📜 LOG: ${latest.issue} -> ${latest.number} (${getBS(latest.number)})`;
        const hMsg = await bot.telegram.sendMessage(HISTORY_LOG_CHANNEL, logTxt);
        historyMsgIds.push(hMsg.message_id);
        if (historyMsgIds.length > 95) await bot.telegram.deleteMessage(HISTORY_LOG_CHANNEL, historyMsgIds.shift()).catch(() => {});

        lastIssue = latest.issue;
        const ai = getFinalPrediction((BigInt(latest.issue) + 1n).toString());
        if (ai) {
            const msg = await bot.telegram.sendMessage(PREDICTION_CHANNEL, `🎯 AI: ${ai.issue}\n🔥 RESULT: ${ai.prediction}\n🏁 NUMS: ${ai.nums.join(",")}`);
            lastMsgId = msg.message_id; lastPredictionData = ai;
        }
    } catch (e) {}
}

// Keep-Alive
setInterval(() => axios.get(SELF_URL).catch(() => {}), 600000);
setInterval(scan, 12000);
bot.launch();
const app = express();
app.get("/", (req, res) => res.send("Prediction Bot Online"));
app.listen(process.env.PORT || 3000);
