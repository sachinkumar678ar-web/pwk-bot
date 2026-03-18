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

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();
const bot = new Telegraf(BOT_TOKEN);

// State Management
let historyData = []; 
let historyMsgIds = []; // History messages ki IDs store karne ke liye
let lastIssue = "", lastMsgId = null, lastPredictionData = null;

const getBS = (n) => (n >= 5 ? "BIG" : "SMALL");
const getColor = (n) => ([0, 2, 4, 6, 8].includes(n) ? "RED" : "GREEN");

// --- SMART PREDICTION (95 LIMIT LOGIC) ---
function getSmartPrediction(nextIssue) {
    const targetDigit = nextIssue.slice(-1); 
    // Sirf pichle 95 records mein se matching patterns dhundna
    let matches = historyData.slice(0, 95).filter(h => h.issue.slice(-1) === targetDigit);
    
    if (matches.length < 3) return null;

    let weightBS = { BIG: 0, SMALL: 0 };
    matches.forEach((m, index) => {
        let multiplier = (95 - index); 
        weightBS[getBS(m.number)] += multiplier;
    });

    let finalBS = weightBS.BIG >= weightBS.SMALL ? "BIG" : "SMALL";
    const sets = { BIG: [5, 6, 7, 8, 9], SMALL: [0, 1, 2, 3, 4] };
    let nums = sets[finalBS].sort(() => 0.5 - Math.random()).slice(0, 2);

    return { prediction: finalBS, nums, issue: nextIssue };
}

async function scan() {
    try {
        const res = await axios.get(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(API_URL)}`, { timeout: 8000 });
        const list = res.data.data.list;
        if (!list || list[0].issueNumber === lastIssue) return;

        // Sirf latest 95 records database mein rakhna
        historyData = list.map(item => ({ 
            issue: item.issueNumber, 
            number: parseInt(item.number) 
        })).slice(0, 95);

        const latest = historyData[0];

        // 1. Result Update
        if (lastPredictionData && lastPredictionData.issue === latest.issue) {
            if (lastMsgId) await bot.telegram.deleteMessage(PREDICTION_CHANNEL, lastMsgId).catch(() => {});
            const isWin = lastPredictionData.prediction === getBS(latest.number);
            await bot.telegram.sendMessage(PREDICTION_CHANNEL, `🎯 **RESULT: ${latest.number} (${getBS(latest.number)})**\n${isWin ? "✅ WIN" : "❌ LOSS"}`, { parse_mode: "Markdown" });
        }

        // 2. History Log (AUTO-DELETE AFTER 95)
        const logTxt = `📜 **LOG:** ${latest.issue} ➔ ${latest.number} (${getBS(latest.number)})`;
        const hMsg = await bot.telegram.sendMessage(HISTORY_LOG_CHANNEL, logTxt, { parse_mode: "Markdown" });
        
        // Message ID ko list mein add karein
        historyMsgIds.push(hMsg.message_id);

        // Agar 95 se zyada messages ho gaye hain, toh sabse purana delete karein
        if (historyMsgIds.length > 95) {
            const oldMsgId = historyMsgIds.shift();
            await bot.telegram.deleteMessage(HISTORY_LOG_CHANNEL, oldMsgId).catch(() => {});
        }

        // 3. New Prediction
        lastIssue = latest.issue;
        const ai = getSmartPrediction((BigInt(latest.issue) + 1n).toString());
        if (ai) {
            const msg = await bot.telegram.sendMessage(PREDICTION_CHANNEL, 
                `🎯 **AI PREDICTION**\n━━━━━━━━━━━━━━\n🌺 PERIOD : ${ai.issue}\n🔥 RESULT : ${ai.prediction}\n🏁 NUMS : ${ai.nums.join(" , ")}`, 
                { parse_mode: "Markdown" }
            );
            lastMsgId = msg.message_id; 
            lastPredictionData = ai;
        }
    } catch (e) { console.log("Scan Error"); }
}

// Keep-Alive & Intervals
setInterval(() => axios.get(SELF_URL).catch(() => {}), 300000);
setInterval(scan, 15000); // 15 seconds gap for stability

bot.launch();
const app = express();
app.get("/", (req, res) => res.send("95-Limit Bot Online"));
app.listen(process.env.PORT || 3000);
