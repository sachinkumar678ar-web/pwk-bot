const { Telegraf, Markup } = require("telegraf");
const admin = require("firebase-admin");
const express = require("express");

// --- CONFIG ---
const MANAGER_TOKEN = "8310237975:AAFXXmIcN0GpGo4apC_THtouUxSclz54A38"; 
const PREDICTION_CHANNEL = "-1003716885272";

const bot = new Telegraf(MANAGER_TOKEN);

// Firebase Initialization
if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// --- COMMANDS ---

// 1. Start Command (User Guide)
bot.start((ctx) => {
    const welcomeMsg = `👋 Welcome to Prediction Manager!\n\n` +
        `Yahan aap apni Membership manage kar sakte hain.\n\n` +
        `🔹 /members - Apni unique 8-digit ID dekhne ke liye.\n` +
        `🔹 Admin ko apni ID bhejein access lene ke liye.\n\n` +
        `📢 Channel: https://t.me/+oZ0LwX7P8R0zYmRl`; // Apna channel link yahan dalein
    ctx.reply(welcomeMsg);
});

// 2. /members Command (ID generation)
bot.command("members", async (ctx) => {
    const userId = ctx.from.id;
    const userRef = db.collection("members").doc(userId.toString());
    const doc = await userRef.get();

    if (!doc.exists) {
        const uniqueId = Math.floor(10000000 + Math.random() * 90000000);
        await userRef.set({ 
            memberId: uniqueId, 
            telegramId: userId, 
            expiry: null, 
            status: "inactive",
            name: ctx.from.first_name 
        });
        ctx.reply(`✅ Aapki Permanent ID Generate ho gayi hai:\n\n🆔 ID: ${uniqueId}\n\nIse Admin ko dein membership activate karne ke liye.`);
    } else {
        const data = doc.data();
        let statusEmoji = data.status === "active" ? "✅ Active" : "❌ Inactive";
        ctx.reply(`👤 Aapka Profile:\n\n🆔 ID: ${data.memberId}\n📊 Status: ${statusEmoji}`);
    }
});

// 3. Admin Command: /add [password] [memberId]
bot.command("add", async (ctx) => {
    const args = ctx.message.text.split(" ");
    const pass = args[1];
    const targetId = args[2];

    // Render ke Environment Variable se password lega
    if (pass !== process.env.ADMIN_PASSWORD) return ctx.reply("❌ Password Galat Hai!");
    if (!targetId) return ctx.reply("Format: /add [password] [memberId]");

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback("1 Min", `t_${targetId}_1`), Markup.button.callback("10 Min", `t_${targetId}_10`)],
        [Markup.button.callback("1 Hour", `t_${targetId}_60`), Markup.button.callback("12 Hour", `t_${targetId}_720`)],
        [Markup.button.callback("1 Day", `t_${targetId}_1440`), Markup.button.callback("30 Days", `t_${targetId}_43200`)],
        [Markup.button.callback("1 Year", `t_${targetId}_525600`), Markup.button.callback("100 Year", `t_${targetId}_52560000`)]
    ]);
    ctx.reply(`🆔 ID: ${targetId}\n\nIs member ke liye kitna time dena chahte hain?`, kb);
});

// --- CALLBACK LOGIC ---
bot.action(/t_(\d+)_(\d+)/, async (ctx) => {
    const mId = parseInt(ctx.match[1]), mins = parseInt(ctx.match[2]);
    const snap = await db.collection("members").where("memberId", "==", mId).get();
    
    if (snap.empty) return ctx.answerCbQuery("ID nahi mili!");

    const userDoc = snap.docs[0];
    const expiry = Date.now() + (mins * 60 * 1000);
    
    await userDoc.ref.update({ expiry, status: "active" });
    
    // Naya Invite Link banana (1 person use)
    const link = await ctx.telegram.createChatInviteLink(PREDICTION_CHANNEL, { member_limit: 1 });
    
    ctx.editMessageText(`✅ Activated!\n🆔 ID: ${mId}\n⏳ Time: ${mins} Minutes\n\n🔗 Join Link: ${link.invite_link}\n\nNote: Link sirf ek baar kaam karega.`);
});

// --- AUTO KICK SYSTEM (Runs every 1 minute) ---
setInterval(async () => {
    const now = Date.now();
    const snap = await db.collection("members").where("status", "==", "active").get();
    
    snap.forEach(async (doc) => {
        const d = doc.data();
        if (d.expiry && now > d.expiry) {
            try {
                // Member ko kick karna
                await bot.telegram.banChatMember(PREDICTION_CHANNEL, d.telegramId);
                // Unban karna taaki agle baar join kar sake
                await bot.telegram.unbanChatMember(PREDICTION_CHANNEL, d.telegramId);
                
                await doc.ref.update({ status: "inactive", expiry: null });
                console.log(`User ${d.memberId} Expired and Removed.`);
            } catch (e) {
                console.log("Auto-Kick Error:", e.message);
            }
        }
    });
}, 60000);

// --- START ---
bot.launch();
const app = express();
app.get("/", (r, s) => s.send("Manager Bot is Running..."));
app.listen(process.env.PORT || 3001);
