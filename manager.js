const { Telegraf, Markup } = require("telegraf");
const admin = require("firebase-admin");
const express = require("express");
const axios = require("axios");

// --- CONFIG ---
const MANAGER_TOKEN = "8310237975:AAFXXmIcN0GpGo4apC_THtouUxSclz54A38"; 
const PREDICTION_CHANNEL = "-1003802854489";
const SELF_URL = "https://pwk-bot.onrender.com";

// Firebase Initialization
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
        console.error("Firebase Config Error: ", e.message);
    }
}
const db = admin.firestore();
const bot = new Telegraf(MANAGER_TOKEN);

// --- HELPER: Plan Buttons ---
const planButtons = (id) => Markup.inlineKeyboard([
    [Markup.button.callback("1 Min (Test)", `p_${id}_1`), Markup.button.callback("1 Day", `p_${id}_1440`)],
    [Markup.button.callback("30 Days", `p_${id}_43200`), Markup.button.callback("Lifetime", `p_${id}_52560000`)]
]);

// --- COMMANDS ---

// 1. Start Menu
bot.start((ctx) => {
    const menu = `🤖 **MANAGER BOT PRO v2.0**\n\n` +
        `Sahi command ka upyog karein:\n\n` +
        `🔹 /members - Apni Unique 8-digit ID dekhein\n` +
        `🔹 /add [PASS] [ID] - Naya member add karein\n` +
        `🔹 /old [PASS] [ID] - Purana plan edit karein\n` +
        `🔹 /all [PASS] - Sabhi active users ki list\n\n` +
        `⚠️ **Note:** /add, /old aur /all sirf Admin ke liye hain.`;
    ctx.reply(menu, { parse_mode: "Markdown" });
});

// 2. Generate/Get Member ID
bot.command("members", async (ctx) => {
    try {
        const userId = ctx.from.id;
        const userRef = db.collection("members").doc(userId.toString());
        const doc = await userRef.get();
        if (!doc.exists) {
            const id = Math.floor(10000000 + Math.random() * 90000000);
            await userRef.set({ memberId: id, telegramId: userId, status: "inactive", expiry: null });
            ctx.reply(`✅ Aapki New Unique ID: \`${id}\``, { parse_mode: "Markdown" });
        } else {
            ctx.reply(`👤 Aapki ID: \`${doc.data().memberId}\`\n📊 Status: ${doc.data().status.toUpperCase()}`, { parse_mode: "Markdown" });
        }
    } catch (e) { console.error("ID Command Error"); }
});

// 3. Add & Old Member (Plan Selector)
bot.command(["add", "old"], async (ctx) => {
    const args = ctx.message.text.split(" ");
    if (args[1] !== process.env.ADMIN_PASSWORD) return ctx.reply("❌ Galat Password!");
    if (!args[2]) return ctx.reply("❌ ID Missing! Sahi Format: `/add PASS ID`", { parse_mode: "Markdown" });
    
    ctx.reply(`🆔 Target ID: ${args[2]}\nIs member ke liye plan chunein:`, planButtons(args[2]));
});

// 4. View All Members List
bot.command("all", async (ctx) => {
    const args = ctx.message.text.split(" ");
    if (args[1] !== process.env.ADMIN_PASSWORD) return ctx.reply("❌ Galat Password!");

    const snap = await db.collection("members").get();
    if (snap.empty) return ctx.reply("Database khali hai.");

    let report = "📊 **MEMBERS STATUS REPORT**\n━━━━━━━━━━━━━━\n";
    let activeCount = 0;

    snap.forEach(doc => {
        const d = doc.data();
        if (d.status === "active") {
            activeCount++;
            let exp = d.expiry ? new Date(d.expiry).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : "Infinity";
            report += `✅ ID: \`${d.memberId}\`\n📅 Exp: ${exp}\n\n`;
        }
    });

    report += `━━━━━━━━━━━━━━\n🔥 Total Active: ${activeCount}\n👥 Total Database: ${snap.size}`;
    ctx.reply(report, { parse_mode: "Markdown" });
});

// --- CALLBACK: Invite Link Generation ---
bot.action(/p_(\d+)_(\d+)/, async (ctx) => {
    try {
        const mId = parseInt(ctx.match[1]);
        const mins = parseInt(ctx.match[2]);
        await ctx.answerCbQuery("Generating Invite Link...");

        const snap = await db.collection("members").where("memberId", "==", mId).get();
        if (snap.empty) return ctx.reply("❌ ID not found in database.");

        const userDoc = snap.docs[0];
        const expiry = Date.now() + (mins * 60 * 1000);
        
        // Update Firebase
        await userDoc.ref.update({ expiry, status: "active" });

        // Generate Single-Use Invite Link
        const link = await ctx.telegram.createChatInviteLink(PREDICTION_CHANNEL, { 
            member_limit: 1,
            name: `ID_${mId}` 
        });

        await ctx.editMessageText(
            `✅ **MEMBER ACTIVATED**\n\n🆔 ID: ${mId}\n⏳ Time: ${mins} Mins\n\n🔗 **INVITE LINK:**\n${link.invite_link}\n\n⚠️ Ye link sirf 1 member ke liye hai aur ek baar hi kaam karega.`, 
            { parse_mode: "Markdown" }
        );

    } catch (e) {
        console.error("Link Error:", e.message);
        ctx.reply(`❌ **Link Error:** Bot ko channel admin banayein aur 'Invite Users' permission dein.\nDetail: ${e.message}`);
    }
});

// --- AUTO KICK SYSTEM (Every 1 Minute) ---
setInterval(async () => {
    try {
        const now = Date.now();
        const snap = await db.collection("members").where("status", "==", "active").get();
        
        snap.forEach(async (doc) => {
            const d = doc.data();
            if (d.expiry && now > d.expiry) {
                try {
                    await bot.telegram.banChatMember(PREDICTION_CHANNEL, d.telegramId);
                    await bot.telegram.unbanChatMember(PREDICTION_CHANNEL, d.telegramId);
                    await doc.ref.update({ status: "inactive", expiry: null });
                    console.log(`Member ${d.memberId} Expired and Removed.`);
                } catch (err) { console.log("Kick Error"); }
            }
        });
    } catch (e) { console.error("Auto-Kick Interval Error"); }
}, 60000);

// --- KEEP ALIVE ---
setInterval(() => axios.get(SELF_URL).catch(() => {}), 300000);

// --- LAUNCH ---
bot.launch();
const app = express();
app.get("/", (req, res) => res.send("Manager Bot is Online"));
app.listen(process.env.PORT || 3001);
