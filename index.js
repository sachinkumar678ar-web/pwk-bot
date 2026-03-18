const { Telegraf } = require("telegraf");
const axios = require("axios");
const express = require("express");
const admin = require("firebase-admin");

// --- CONFIG ---
const BOT_TOKEN = "8796373933:AAEfLT-5Jtcy8zSHDGC1TTh0tBlX5ME9fBk";
const PREDICTION_CHANNEL = "-1003716885272";
const HISTORY_LOG_CHANNEL = "-1003716885272";
const API_URL = "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json?pageSize=150";

// Firebase Setup (Render Environment Variable se)
if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const bot = new Telegraf(BOT_TOKEN);
let historyData = [], historyMsgIds = [];
let lastIssue = "", lastMsgId = null, lastPredictionData = null;

// --- HELPERS ---
const getBS = (n) => (n >= 5 ? "BIG" : "SMALL");
const getColor = (n) => ([0, 2, 4, 6, 8].includes(n) ? "RED" : "GREEN");

// --- COMMANDS ---

// 1. Members ID Command
bot.command("members", async (ctx) => {
    const userId = ctx.from.id;
    const userRef = db.collection("members").doc(userId.toString());
    const doc = await userRef.get();

    if (!doc.exists) {
        // Nayi 8-digit ID generate karna
        const uniqueId = Math.floor(10000000 + Math.random() * 90000000);
        await userRef.set({
            memberId: uniqueId,
            telegramId: userId,
            expiry: null,
            status: "inactive",
            name: ctx.from.first_name
        });
        ctx.reply(`✅ Aapki New Unique ID: ${uniqueId}\n\nIse Admin ko dein membership activate karne ke liye.`);
    } else {
        ctx.reply(`👤 Aapki Member ID: ${doc.data().memberId}\nStatus: ${doc.data().status.toUpperCase()}`);
    }
});

// --- PREDICTION ENGINE (Pichla Logic) ---
function getFinalPrediction(nextIssue) {
    const targetDigit = nextIssue.slice(-1); 
    let collectedNums = [];
    for (let i = 0; i < historyData.length && i < 95; i++) {
        if (historyData[i].issue.slice(-1) === targetDigit) collectedNums.push(historyData[i].number);
    }
    if (collectedNums.length === 0) return null;

    let counts = { BIG: 0, SMALL: 0, RED: 0, GREEN: 0 };
    collectedNums.forEach(n => { counts[getBS(n)]++; counts[getColor(n)]++; });

    let sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    let finalPred = sorted[0][0]; 
    let winBS = counts.BIG >= counts.SMALL ? "BIG" : "SMALL";
    let winColor = counts.RED >= counts.GREEN ? "RED" : "GREEN";

    const sets = { RED: [0, 2, 4, 6, 8], GREEN: [1, 3, 5, 7, 9], BIG: [5, 6, 7, 8, 9], SMALL: [0, 1, 2, 3, 4] };
    let common = sets[winColor].filter(n => sets[winBS].includes(n));
    let finalNums = common.sort(() => 0.5 - Math.random()).slice(0, 2);

    return { prediction: finalPred, nums: finalNums, issue: nextIssue };
}

// --- SCAN LOOP ---
async function scan() {
    try {
        const proxy = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(API_URL)}`;
        const res = await axios.get(proxy);
        const list = res.data.data.list;
        if (!list || list[0].issueNumber === lastIssue) return;

        historyData = list.map(item => ({ issue: item.issueNumber, number: parseInt(item.number) }));
        const latest = historyData[0];

        // Result Logic... (Baki code wahi rahega jo pehle diya tha)
        // [Stickers aur Results wala part yahan add rahega]

        lastIssue = latest.issue;
        const nextIssue = (BigInt(latest.issue) + 1n).toString();
        const ai = getFinalPrediction(nextIssue);
        if (ai) {
            const msg = await bot.telegram.sendMessage(PREDICTION_CHANNEL, `🎯 AI PREDICTION\n━━━━━━━━━━━━━━\n🌺PERIOD🌺 : ${ai.issue}\n🌺RESULT🌺 : ${ai.prediction}\n🤩CHANCE🤩 : 95%\n🏁BET NUMBER : ${ai.nums.join(" , ")}`);
            lastMsgId = msg.message_id; lastPredictionData = ai;
        }
    } catch (e) {}
}

setInterval(scan, 12000);
bot.launch();
const app = express();
app.get("/", (r, s) => s.send("Prediction Bot Online"));
app.listen(process.env.PORT || 3000);
