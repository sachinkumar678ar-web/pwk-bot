const { Telegraf, Markup } = require("telegraf");
const admin = require("firebase-admin");
const express = require("express");

const MANAGER_TOKEN = "8796373933:AAEfLT-5Jtcy8zSHDGC1TTh0tBlX5ME9fBk"; 
const PREDICTION_CHANNEL = "-1003802854489";

const bot = new Telegraf(MANAGER_TOKEN);

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

bot.start((ctx) => ctx.reply("Welcome! Use /members to get your ID."));

bot.command("members", async (ctx) => {
    const userId = ctx.from.id;
    const userRef = db.collection("members").doc(userId.toString());
    const doc = await userRef.get();
    if (!doc.exists) {
        const uniqueId = Math.floor(10000000 + Math.random() * 90000000);
        await userRef.set({ memberId: uniqueId, telegramId: userId, expiry: null, status: "inactive" });
        ctx.reply(`✅ Your ID: ${uniqueId}`);
    } else {
        ctx.reply(`🆔 ID: ${doc.data().memberId}\nStatus: ${doc.data().status}`);
    }
});

bot.command("add", async (ctx) => {
    const args = ctx.message.text.split(" ");
    if (args[1] !== process.env.ADMIN_PASSWORD) return ctx.reply("❌ Wrong Password!");
    const targetId = args[2];
    if (!targetId) return ctx.reply("Format: /add [pass] [ID]");
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback("1 Min", `t_${targetId}_1`), Markup.button.callback("1 Day", `t_${targetId}_1440`)],
        [Markup.button.callback("30 Days", `t_${targetId}_43200`), Markup.button.callback("Lifetime", `t_${targetId}_52560000`)]
    ]);
    ctx.reply(`Select Plan for ID ${targetId}:`, kb);
});

bot.action(/t_(\d+)_(\d+)/, async (ctx) => {
    const mId = parseInt(ctx.match[1]), mins = parseInt(ctx.match[2]);
    const snap = await db.collection("members").where("memberId", "==", mId).get();
    if (snap.empty) return ctx.answerCbQuery("ID Not Found!");
    const expiry = Date.now() + (mins * 60 * 1000);
    await snap.docs[0].ref.update({ expiry, status: "active" });
    const link = await ctx.telegram.createChatInviteLink(PREDICTION_CHANNEL, { member_limit: 1 });
    ctx.editMessageText(`✅ Activated!\nLink: ${link.invite_link}`);
});

setInterval(async () => {
    const now = Date.now();
    const snap = await db.collection("members").where("status", "==", "active").get();
    snap.forEach(async (doc) => {
        const d = doc.data();
        if (d.expiry && now > d.expiry) {
            try {
                await bot.telegram.banChatMember(PREDICTION_CHANNEL, d.telegramId);
                await bot.telegram.unbanChatMember(PREDICTION_CHANNEL, d.telegramId);
                await doc.ref.update({ status: "inactive", expiry: null });
            } catch (e) {}
        }
    });
}, 60000);

bot.launch();
const app = express();
app.get("/", (r, s) => s.send("Manager Online"));
app.listen(process.env.PORT || 3001);
