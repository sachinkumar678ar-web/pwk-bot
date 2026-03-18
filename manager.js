const { Telegraf, Markup } = require("telegraf");
const admin = require("firebase-admin");
const express = require("express");

// --- CONFIG ---
const MANAGER_TOKEN = "8310237975:AAFXXmIcN0GpGo4apC_THtouUxSclz54A38"; 
const PREDICTION_CHANNEL = "-1003802854489";

const bot = new Telegraf(MANAGER_TOKEN);

// Firebase Initialization
if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// --- WELCOME & COMMANDS LIST ---
bot.start((ctx) => {
    const menu = `🤖 **MANAGER BOT MENU** 🤖\n\n` +
        `Niche diye gaye commands ka upyog karein:\n\n` +
        `1️⃣ /start - Sabhi commands ki list dekhne ke liye\n` +
        `2️⃣ /add - Naye members ko add karne ke liye\n` +
        `3️⃣ /old - Purane members ka plan edit karne ke liye\n` +
        `4️⃣ /members - Apni Unique ID janne ke liye\n\n` +
        `⚠️ **Note:** /add aur /old commands sirf Admin ke liye hain.`;
    ctx.reply(menu, { parse_mode: "Markdown" });
});

// --- GENERATE ID COMMAND ---
bot.command("members", async (ctx) => {
    const userId = ctx.from.id;
    const userRef = db.collection("members").doc(userId.toString());
    const doc = await userRef.get();

    if (!doc.exists) {
        const uniqueId = Math.floor(10000000 + Math.random() * 90000000);
        await userRef.set({ memberId: uniqueId, telegramId: userId, expiry: null, status: "inactive" });
        ctx.reply(`✅ Aapki Unique ID: \`${uniqueId}\`\nIse copy karke Admin ko bhejein.`, { parse_mode: "Markdown" });
    } else {
        ctx.reply(`👤 Aapki ID: \`${doc.data().memberId}\`\nStatus: ${doc.data().status.toUpperCase()}`, { parse_mode: "Markdown" });
    }
});

// --- ADD NEW MEMBER ---
bot.command("add", async (ctx) => {
    const args = ctx.message.text.split(" ");
    const pass = args[1];
    const targetId = args[2];

    if (pass !== process.env.ADMIN_PASSWORD) {
        return ctx.reply("❌ Galat Password! Sahi format: `/add PASSWORD ID`", { parse_mode: "Markdown" });
    }
    if (!targetId) return ctx.reply("🆔 Member ID dalna zaroori hai!");

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback("1 Min (Test)", `plan_${targetId}_1`), Markup.button.callback("1 Day", `plan_${targetId}_1440`)],
        [Markup.button.callback("30 Days", `plan_${targetId}_43200`), Markup.button.callback("Lifetime", `plan_${targetId}_52560000`)]
    ]);
    ctx.reply(`🆕 **NEW MEMBER ADD**\nID: ${targetId}\n\nPlan chunein:`, kb);
});

// --- EDIT OLD MEMBER ---
bot.command("old", async (ctx) => {
    const args = ctx.message.text.split(" ");
    const pass = args[1];
    const targetId = args[2];

    if (pass !== process.env.ADMIN_PASSWORD) {
        return ctx.reply("❌ Galat Password! Sahi format: `/old PASSWORD ID`", { parse_mode: "Markdown" });
    }
    if (!targetId) return ctx.reply("🆔 Purani Member ID dalein!");

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback("Update 1 Day", `plan_${targetId}_1440`), Markup.button.callback("Update 30 Days", `plan_${targetId}_43200`)],
        [Markup.button.callback("Set Lifetime", `plan_${targetId}_52560000`)]
    ]);
    ctx.reply(`🔄 **EDIT OLD MEMBER**\nID: ${targetId}\n\nNaya Plan chunein:`, kb);
});

// --- BUTTON LOGIC (PLAN SELECTION) ---
bot.action(/plan_(\d+)_(\d+)/, async (ctx) => {
    const mId = parseInt(ctx.match[1]), mins = parseInt(ctx.match[2]);
    const snap = await db.collection("members").where("memberId", "==", mId).get();

    if (snap.empty) return ctx.answerCbQuery("ID nahi mili!");

    const expiry = Date.now() + (mins * 60 * 1000);
    await snap.docs[0].ref.update({ expiry, status: "active" });

    // Single-use Invite Link generate karna
    const link = await ctx.telegram.createChatInviteLink(PREDICTION_CHANNEL, { member_limit: 1 });
    
    ctx.editMessageText(`✅ **SUCCESSFUL!**\n\n🆔 ID: ${mId}\n⏳ Time: ${mins} Mins\n\n🔗 **JOIN LINK:** ${link.invite_link}\n\n(Ye link sirf 1 member ke liye hai)`, { parse_mode: "Markdown" });
});

// --- AUTO KICK SYSTEM (Expiring Members) ---
setInterval(async () => {
    const now = Date.now();
    const snap = await db.collection("members").where("status", "==", "active").get();
    
    snap.forEach(async (doc) => {
        const d = doc.data();
        if (d.expiry && now > d.expiry) {
            try {
                await bot.telegram.banChatMember(PREDICTION_CHANNEL, d.telegramId);
                await bot.telegram.unbanChatMember(PREDICTION_CHANNEL, d.telegramId); // Taaki baad mein re-join kar sake
                await doc.ref.update({ status: "inactive", expiry: null });
                console.log(`Removed Expired Member: ${d.memberId}`);
            } catch (e) {
                console.error("Kick Error:", e.message);
            }
        }
    });
}, 60000);

bot.launch();
const app = express();
app.get("/", (r, s) => s.send("Manager Bot Active"));
app.listen(process.env.PORT || 3001);
