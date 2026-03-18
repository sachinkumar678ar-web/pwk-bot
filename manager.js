const { Telegraf, Markup } = require("telegraf");
const admin = require("firebase-admin");
const express = require("express");
const axios = require("axios");

const MANAGER_TOKEN = "8310237975:AAFXXmIcN0GpGo4apC_THtouUxSclz54A38"; 
const PREDICTION_CHANNEL = "-1003802854489";
const SELF_URL = "https://pwk-bot.onrender.com";

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();
const bot = new Telegraf(MANAGER_TOKEN);

// Welcome Menu
bot.start((ctx) => {
    ctx.reply("🤖 **MANAGER BOT**\n\n1️⃣ /add [PASS] [ID] - New Member\n2️⃣ /old [PASS] [ID] - Edit Plan\n3️⃣ /members - Get Your ID", { parse_mode: "Markdown" });
});

bot.command("members", async (ctx) => {
    const userId = ctx.from.id;
    const userRef = db.collection("members").doc(userId.toString());
    const doc = await userRef.get();
    if (!doc.exists) {
        const id = Math.floor(10000000 + Math.random() * 90000000);
        await userRef.set({ memberId: id, telegramId: userId, status: "inactive" });
        ctx.reply(`🆔 Your ID: \`${id}\``, { parse_mode: "Markdown" });
    } else {
        ctx.reply(`🆔 Your ID: \`${doc.data().memberId}\``, { parse_mode: "Markdown" });
    }
});

const planButtons = (id) => Markup.inlineKeyboard([
    [Markup.button.callback("1 Min", `p_${id}_1`), Markup.button.callback("1 Day", `p_${id}_1440`)],
    [Markup.button.callback("30 Days", `p_${id}_43200`), Markup.button.callback("Lifetime", `p_${id}_52560000`)]
]);

bot.command(["add", "old"], async (ctx) => {
    const args = ctx.message.text.split(" ");
    if (args[1] !== process.env.ADMIN_PASSWORD) return ctx.reply("❌ Wrong Password!");
    if (!args[2]) return ctx.reply("❌ ID Missing!");
    ctx.reply(`🆔 Target ID: ${args[2]}\nSelect Plan:`, planButtons(args[2]));
});

bot.action(/p_(\d+)_(\d+)/, async (ctx) => {
    const mId = parseInt(ctx.match[1]), mins = parseInt(ctx.match[2]);
    const snap = await db.collection("members").where("memberId", "==", mId).get();
    if (snap.empty) return ctx.answerCbQuery("ID Not Found!");

    const expiry = Date.now() + (mins * 60 * 1000);
    await snap.docs[0].ref.update({ expiry, status: "active" });
    const link = await ctx.telegram.createChatInviteLink(PREDICTION_CHANNEL, { member_limit: 1 });
    ctx.editMessageText(`✅ Activated!\n🔗 Link: ${link.invite_link}`);
});

// Auto-Kick & Keep-Alive
setInterval(async () => {
    const snap = await db.collection("members").where("status", "==", "active").get();
    snap.forEach(async (doc) => {
        if (doc.data().expiry && Date.now() > doc.data().expiry) {
            await bot.telegram.banChatMember(PREDICTION_CHANNEL, doc.data().telegramId).catch(() => {});
            await bot.telegram.unbanChatMember(PREDICTION_CHANNEL, doc.data().telegramId).catch(() => {});
            await doc.ref.update({ status: "inactive", expiry: null });
        }
    });
}, 60000);

setInterval(() => axios.get(SELF_URL).catch(() => {}), 600000);

bot.launch();
const app = express();
app.get("/", (req, res) => res.send("Manager Bot Online"));
app.listen(process.env.PORT || 3001);
