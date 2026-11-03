require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Telegraf, Markup, session } = require("telegraf");

// ==================== SOZLAMALAR ====================

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean)
  .map(Number);

const REQUIRE_SUBSCRIPTION =
  (process.env.REQUIRE_SUBSCRIPTION || "false").toLowerCase() === "true";

const CHANNEL_ID = process.env.CHANNEL_ID || "";
const CHANNEL_URL =
  process.env.CHANNEL_URL ||
  (CHANNEL_ID ? `https://t.me/${CHANNEL_ID.replace("@", "")}` : "");

const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID || "";
const ANNOUNCEMENT_CHANNEL_ID = process.env.ANNOUNCEMENT_CHANNEL_ID || "";

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN .env faylida topilmadi!");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, "quiz-data.json");
const DB_BACKUP_FILE = path.join(DATA_DIR, "quiz-data.backup.json");
const QUESTIONS_FILE = path.join(__dirname, "test.json");

// ==================== MA'LUMOTLAR BAZASI ====================

function emptyDB() {
  return {
    users: {},
    questionStats: {},
    tournaments: {},
    massBattles: {},
    dailyScores: {},
    weeklyScores: {},
    reportsSent: {},
    totalGames: 0,
    completedGames: 0,
    dailyStats: {},
    errors: [],
  };
}

function readDBFile(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ma'lumotlar bazasi formati noto'g'ri.");
  }
  const defaults = emptyDB();
  const merged = { ...defaults, ...parsed };
  for (const key of ["users", "questionStats", "tournaments", "massBattles", "dailyScores", "weeklyScores", "reportsSent", "dailyStats"]) {
    if (!merged[key] || typeof merged[key] !== "object" || Array.isArray(merged[key])) merged[key] = {};
  }
  if (!Array.isArray(merged.errors)) merged.errors = [];
  merged.totalGames = Number(merged.totalGames) || 0;
  merged.completedGames = Number(merged.completedGames) || 0;
  return merged;
}

function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    try {
      return readDBFile(DB_FILE);
    } catch (error) {
      console.error("Asosiy bazani o'qib bo'lmadi:", error.message);
    }
  }

  // Asosiy fayl buzilgan yoki yo'q bo'lsa, oxirgi zaxira nusxasini tiklashga urinadi.
  if (fs.existsSync(DB_BACKUP_FILE)) {
    try {
      const recovered = readDBFile(DB_BACKUP_FILE);
      fs.writeFileSync(DB_FILE, JSON.stringify(recovered, null, 2), "utf8");
      console.warn("⚠️ Ma'lumotlar zaxira nusxasidan tiklandi.");
      return recovered;
    } catch (error) {
      console.error("Zaxira nusxasini ham o'qib bo'lmadi:", error.message);
    }
  }

  const initial = emptyDB();
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
  } catch (error) {
    console.error("Yangi ma'lumotlar bazasini yaratib bo'lmadi:", error.message);
  }
  return initial;
}

let db = loadDB();
let rooms = {};
const pendingActions = new Map();
const broadcastDrafts = new Map();

function saveDB() {
  try {
    const serialized = JSON.stringify(db);
    const tempFile = `${DB_FILE}.tmp`;

    // Avval amaldagi, yaroqli bazani zaxiralaymiz. Yangi fayl to'liq yozilgachgina almashtiramiz.
    if (fs.existsSync(DB_FILE)) {
      try {
        JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        const backupTemp = `${DB_BACKUP_FILE}.tmp`;
        fs.copyFileSync(DB_FILE, backupTemp);
        fs.renameSync(backupTemp, DB_BACKUP_FILE);
      } catch (backupError) {
        console.error("Zaxira nusxasini yaratishda ogohlantirish:", backupError.message);
      }
    }

    fs.writeFileSync(tempFile, serialized, "utf8");
    fs.renameSync(tempFile, DB_FILE);
  } catch (error) {
    console.error("Bazani saqlashda xato:", error.message);
  }
}

// ==================== YORDAMCHI FUNKSIYALAR ====================

function isAdmin(userId) {
  return ADMIN_IDS.includes(Number(userId));
}

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getName(user) {
  return (
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    user.username ||
    `Foydalanuvchi ${user.id}`
  );
}

function getUser(user) {
  const id = String(user.id);

  if (!db.users[id]) {
    db.users[id] = {
      id: Number(user.id),
      name: getName(user),
      username: user.username || "",
      points: 0,
      games: 0,
      wins: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      soloGames: 0,
      bestSoloScore: 0,
      joinedAt: new Date().toISOString(),
    };
  } else {
    db.users[id].name = getName(user);
    db.users[id].username = user.username || "";
  }

  const profile = db.users[id];
  for (const field of ["points", "games", "wins", "correctAnswers", "totalAnswers", "soloGames", "bestSoloScore"]) {
    profile[field] = Number(profile[field]) || 0;
  }
  return profile;
}

function dateKey(date = new Date()) {
  return tashkentDayKey(date);
}

function getDailyStats(day = dateKey()) {
  const defaults = {
    users: {},
    gamesStarted: 0,
    gamesCompleted: 0,
    participants: 0,
    answers: 0,
    correct: 0,
    points: 0,
    errors: 0,
  };
  const current = db.dailyStats[day] || {};
  db.dailyStats[day] = {
    ...defaults,
    ...current,
    users: current.users && typeof current.users === "object" ? current.users : {},
  };
  return db.dailyStats[day];
}

function recordDailyUser(userId, day = dateKey()) {
  getDailyStats(day).users[String(userId)] = true;
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;

  do {
    code = Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms[code]);

  return code;
}

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

// ==================== SAVOLLAR BAZASI ====================

function loadQuestions() {
  try {
    if (!fs.existsSync(QUESTIONS_FILE)) return [];

    const parsed = JSON.parse(
      fs.readFileSync(QUESTIONS_FILE, "utf8")
    );

    const questions = Array.isArray(parsed)
      ? parsed
      : parsed.questions;

    if (!Array.isArray(questions)) return [];

    return questions.filter(
      (q) =>
        q &&
        typeof q.question === "string" &&
        q.question.trim().length > 0 &&
        Array.isArray(q.options) &&
        q.options.length >= 2 &&
        q.options.every((option) => typeof option === "string" && option.trim().length > 0) &&
        Number.isInteger(Number(q.answer)) &&
        Number(q.answer) >= 0 &&
        Number(q.answer) < q.options.length
    );
  } catch (error) {
    console.error("Savollar faylida xato:", error.message);
    return [];
  }
}

// test.json ichidagi mavjud fanlarni avtomatik aniqlaydi.
function getCategories() {
  const categories = loadQuestions()
    .map((q) => String(q.category || "").trim())
    .filter(Boolean);

  return [...new Set(categories)].sort((a, b) =>
    a.localeCompare(b, "uz")
  );
}

function getCategoryName(subject) {
  return subject === "all" ? "Barcha fanlar" : subject;
}

// Fan va qiyinlik bo'yicha savollar tanlash.
// Agar tanlangan qiyinlikda savol kam bo'lsa, boshqa fanlarga o'tmaydi.
function getQuestions(subject, difficulty, amount) {
  const all = loadQuestions();

  let subjectQuestions = all;

  if (subject && subject !== "all") {
    subjectQuestions = all.filter(
      (q) => String(q.category || "").trim() === subject
    );
  }

  let filtered = subjectQuestions;

  if (difficulty !== "all") {
    filtered = subjectQuestions.filter(
      (q) => String(q.difficulty || "easy").toLowerCase() === difficulty
    );
  }

  // Tanlangan fan ichidagi barcha qiyinliklardan foydalanish.
  if (filtered.length < amount) {
    filtered = subjectQuestions;
  }

  return shuffle(filtered).slice(
    0,
    Math.min(amount, filtered.length)
  );
}

function getActiveRoom(userId) {
  return Object.values(rooms).find(
    (room) =>
      room.status !== "finished" &&
      room.players.some((player) => player.id === Number(userId))
  );
}

function isHost(room, userId) {
  return room.hostId === Number(userId);
}

const MAX_LEVEL = 100;
const POINTS_PER_LEVEL = 500;
const LEVEL_RANKS = [
  { min: 1, max: 10, title: "Yangi boshlovchi", badge: "🌱" },
  { min: 11, max: 20, title: "Bilim izlovchi", badge: "📘" },
  { min: 21, max: 30, title: "Zukko", badge: "🧠" },
  { min: 31, max: 40, title: "Bilimdon", badge: "🎓" },
  { min: 41, max: 50, title: "Usta", badge: "⚔️" },
  { min: 51, max: 60, title: "Ekspert", badge: "💎" },
  { min: 61, max: 70, title: "Elita", badge: "👑" },
  { min: 71, max: 80, title: "Afsona", badge: "🔥" },
  { min: 81, max: 90, title: "Daho", badge: "🌟" },
  { min: 91, max: 100, title: "Bilim afsonasi", badge: "🏆" },
];

function getLevel(points = 0) {
  const totalPoints = Math.max(0, Number(points) || 0);
  const level = Math.min(MAX_LEVEL, Math.floor(totalPoints / POINTS_PER_LEVEL) + 1);
  const currentFloor = (level - 1) * POINTS_PER_LEVEL;
  const nextFloor = level * POINTS_PER_LEVEL;
  const rank = LEVEL_RANKS.find((item) => level >= item.min && level <= item.max) || LEVEL_RANKS[LEVEL_RANKS.length - 1];
  const isMax = level >= MAX_LEVEL;
  return {
    level,
    rank,
    current: isMax ? 0 : Math.max(0, totalPoints - currentFloor),
    needed: POINTS_PER_LEVEL,
    remaining: isMax ? 0 : Math.max(0, nextFloor - totalPoints),
    isMax,
  };
}

function getAchievements(user) {
  const badges = [];
  if ((user.games || 0) >= 1) badges.push('🎯 Birinchi o‘yin');
  if ((user.correctAnswers || 0) >= 10) badges.push('🧠 Bilimdon');
  if ((user.wins || 0) >= 5) badges.push('🏆 G‘olib');
  if ((user.soloGames || 0) >= 10) badges.push('⚡ Solo ustasi');
  if ((user.points || 0) >= 1000) badges.push('💎 1000 ochko');
  return badges;
}

function getProfileText(user) {
  const total = Math.max(0, Number(user.totalAnswers) || 0);
  const correct = Math.max(0, Number(user.correctAnswers) || 0);
  const accuracy = total ? Math.round((correct / total) * 100) : 0;
  const level = getLevel(user.points || 0);
  const achievements = getAchievements(user);
  const username = user.username ? `@${escapeHTML(user.username)}` : "Ko‘rsatilmagan";
  const progressLine = level.isMax
    ? "🏆 Daraja: maksimal — 100/100"
    : `📈 Keyingi darajaga: ${level.remaining} XP qoldi`;

  return [
    "👤 <b>SHAXSIY PROFIL</b>",
    "",
    "<b>ASOSIY MA’LUMOTLAR</b>",
    `Ism: <b>${escapeHTML(user.name || "Foydalanuvchi")}</b>`,
    `Telegram: ${username}`,
    `ID: <code>${user.id}</code>`,
    "",
    "<b>RIVOJLANISH</b>",
    `⭐ Tajriba (XP): <b>${Number(user.points) || 0}</b>`,
    `🆙 Daraja: <b>${level.level}/${MAX_LEVEL}</b>`,
    `${level.rank.badge} Unvon: <b>${escapeHTML(level.rank.title)}</b>`,
    progressLine,
    "",
    "<b>O‘YIN NATIJALARI</b>",
    `🎮 Jami o‘yinlar: <b>${Number(user.games) || 0}</b>`,
    `⚡ Solo o‘yinlar: <b>${Number(user.soloGames) || 0}</b>`,
    `🥇 Solo rekord: <b>${Number(user.bestSoloScore) || 0}</b>`,
    `🏆 G‘alabalar: <b>${Number(user.wins) || 0}</b>`,
    "",
    "<b>JAVOBLAR STATISTIKASI</b>",
    `✅ To‘g‘ri javoblar: <b>${correct}</b>`,
    `📝 Jami javoblar: <b>${total}</b>`,
    `🎯 Aniqlik: <b>${accuracy}%</b>`,
    "",
    "<b>YUTUQLAR</b>",
    achievements.length ? achievements.map((item) => `• ${escapeHTML(item)}`).join("\n") : "Hozircha yutuq yo‘q. O‘yinlarda qatnashib, yutuqlarni oching.",
  ].join("\n");
}

// ==================== MENYULAR ====================

function mainMenu() {
  const rows = [
    [
      Markup.button.callback("🎮 O‘yin yaratish", "game:create"),
      Markup.button.callback("🔑 Xonaga kirish", "game:join"),
    ],
    [
      Markup.button.callback("🏆 Reytingim", "profile:rating"),
      Markup.button.callback("👤 Profilim", "profile:me"),
    ],
    [
      Markup.button.callback("🏆 Turnirlar", "tournament:list"),
      Markup.button.callback("📖 Qoidalar", "info:rules"),
    ],
  ];
  return Markup.inlineKeyboard(rows);
}

// Pastki doimiy menyu. Inline tugmalar o'yin ichidagi aniq harakatlar uchun qoladi.
function replyMainMenu() {
  return Markup.keyboard([
    ["⚡ Solo", "🎮 O‘yin", "⚔️ Jang"],
    ["👥 Do‘stlar", "🏆 Reyting"],
    ["👤 Profil", "🏆 Turnirlar"],
    ["📖 Yordam", "🏠 Asosiy menyu"],
  ]).resize().persistent().placeholder("Bilim Charx — bo‘limni tanlang");
}

function gameOptionsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("⚡ Solo — yolg‘iz o‘ynash", "game:solo")],
    [Markup.button.callback("🎮 Do‘stlar bilan xona", "game:create")],
    [Markup.button.callback("🔑 Xona kodini kiritish", "game:join")],
    [Markup.button.callback("⬅️ Asosiy menyu", "menu:home")],
  ]);
}

function resetPendingForMenu(ctx) {
  // Menyu tanlanganda eski matn-kiritish holatini bekor qiladi.
  // Bu foydalanuvchining xona kodi/turnir nomi kiritish oynasida qolib ketishini oldini oladi.
  if (pendingActions.has(ctx.from.id)) pendingActions.delete(ctx.from.id);
  if (ctx.session) ctx.session = {};
}

function adminMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📊 Umumiy statistika", "admin:stats"),
      Markup.button.callback("📅 Kunlik statistika", "admin:daily"),
    ],
    [Markup.button.callback("🗓 Haftalik statistika", "admin:weekly")],
    [
      Markup.button.callback("🏆 Reyting", "admin:top"),
      Markup.button.callback("❓ Savollar", "admin:questions"),
    ],
    [
      Markup.button.callback("🎯 Turnirlar", "admin:tournaments"),
      Markup.button.callback("⚔️ Ommaviy Battle", "admin:massbattle"),
    ],
    [Markup.button.callback("📨 Xabar yuborish", "admin:broadcast")],
    [Markup.button.callback("⚠️ Xatolar", "admin:errors")],
    [Markup.button.callback("🔄 Yangilash", "admin:refresh")],
  ]);
}

function backToAdmin() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Admin paneli", "admin:home")],
  ]);
}

async function safeEdit(ctx, text, extra = {}) {
  try {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      ...extra,
    });
  } catch (error) {
    if (
      !String(error.description || error.message).includes(
        "message is not modified"
      )
    ) {
      throw error;
    }
  }
}

async function checkSubscription(ctx) {
  if (!REQUIRE_SUBSCRIPTION || !CHANNEL_ID || isAdmin(ctx.from.id)) {
    return true;
  }

  try {
    const member = await ctx.telegram.getChatMember(
      CHANNEL_ID,
      ctx.from.id
    );

    if (["creator", "administrator", "member"].includes(member.status)) {
      return true;
    }
  } catch (error) {
    console.error("Obuna tekshirishda xato:", error.message);
  }

  await ctx.reply(
    "Botdan foydalanish uchun avval kanalga obuna bo‘ling.",
    Markup.inlineKeyboard([
      ...(CHANNEL_URL
        ? [[Markup.button.url("📢 Kanalga obuna bo‘lish", CHANNEL_URL)]]
        : []),
      [
        Markup.button.callback(
          "✅ Obunani tekshirish",
          "subscription:check"
        ),
      ],
    ])
  );

  return false;
}

// ==================== STATISTIKA ====================


const ADMIN_RANKING_PAGE_SIZE = 15;

function getAdminRankingPage(page = 0) {
  const users = Object.entries(db.users || {})
    .map(([id, user]) => ({ id, ...(user || {}) }))
    .sort((a, b) => {
      const byPoints = (Number(b.points) || 0) - (Number(a.points) || 0);
      return byPoints || String(a.name || "").localeCompare(String(b.name || ""), "uz");
    });

  const totalPages = Math.max(1, Math.ceil(users.length / ADMIN_RANKING_PAGE_SIZE));
  const currentPage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const startIndex = currentPage * ADMIN_RANKING_PAGE_SIZE;
  const visible = users.slice(startIndex, startIndex + ADMIN_RANKING_PAGE_SIZE);

  const lines = [
    "🏆 <b>BILIM CHARX — REYTING</b>",
    `Sahifa: <b>${currentPage + 1}/${totalPages}</b>`,
    ""
  ];

  if (!visible.length) {
    lines.push("Hozircha reyting uchun foydalanuvchilar yo‘q.");
  } else {
    visible.forEach((user, index) => {
      const place = startIndex + index + 1;
      const name = escapeHTML(
        user.name || user.username || `Foydalanuvchi ${user.id}`
      );
      const points = Number(user.points) || 0;
      lines.push(`<b>${place}.</b> ${name} — <b>${points}</b> ochko`);
    });
  }

  const nav = [];
  if (currentPage > 0) {
    nav.push(Markup.button.callback("⬅️ Oldingi", `admin:ranking:${currentPage - 1}`));
  }
  if (currentPage < totalPages - 1) {
    nav.push(Markup.button.callback("Keyingi ➡️", `admin:ranking:${currentPage + 1}`));
  }

  const rows = [];
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback("⬅️ Admin paneli", "admin:home")]);

  return {
    text: lines.join("\n"),
    keyboard: Markup.inlineKeyboard(rows)
  };
}

function getAdminStatsText() {
  const users = Object.values(db.users);

  const activeRooms = Object.values(rooms).filter(
    (room) => room.status !== "finished"
  ).length;

  const totalAnswers = users.reduce(
    (sum, user) => sum + (user.totalAnswers || 0),
    0
  );

  const correctAnswers = users.reduce(
    (sum, user) => sum + (user.correctAnswers || 0),
    0
  );

  const accuracy = totalAnswers
    ? Math.round((correctAnswers / totalAnswers) * 100)
    : 0;

  return [
    "📊 <b>BILIM CHARX — UMUMIY STATISTIKA</b>",
    "",
    `👥 Ro‘yxatdan o‘tganlar: <b>${users.length}</b>`,
    `🎮 Boshlangan o‘yinlar: <b>${db.totalGames}</b>`,
    `✅ Tugallangan o‘yinlar: <b>${db.completedGames}</b>`,
    `🟢 Faol xonalar: <b>${activeRooms}</b>`,
    `❓ Javoblar soni: <b>${totalAnswers}</b>`,
    `✅ To‘g‘ri javoblar: <b>${correctAnswers}</b>`,
    `🎯 To‘g‘rilik foizi: <b>${accuracy}%</b>`,
    `🏆 Turnirlar: <b>${Object.keys(db.tournaments).length}</b>`,
    `⚠️ Saqlangan xatolar: <b>${db.errors.length}</b>`,
  ].join("\n");
}

function getDailyStatsText(day = dateKey()) {
  const stats = getDailyStats(day);

  return [
    `📅 <b>KUNLIK HISOBOT — ${day}</b>`,
    "",
    `👥 Faol foydalanuvchilar: <b>${Object.keys(stats.users).length}</b>`,
    `🎮 Boshlangan o‘yinlar: <b>${stats.gamesStarted}</b>`,
    `✅ Tugallangan o‘yinlar: <b>${stats.gamesCompleted}</b>`,
    `🧑‍🤝‍🧑 Ishtiroklar: <b>${stats.participants}</b>`,
    `❓ Berilgan javoblar: <b>${stats.answers}</b>`,
    `✔️ To‘g‘ri javoblar: <b>${stats.correct}</b>`,
    `⭐ Berilgan ochkolar: <b>${stats.points}</b>`,
    `⚠️ Xatolar: <b>${stats.errors}</b>`,
  ].join("\n");
}

function getWeeklyStatsText(now = new Date()) {
  const parts = tashkentDateParts(now);
  const localDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const weekday = (localDate.getUTCDay() + 6) % 7; // Monday = 0
  localDate.setUTCDate(localDate.getUTCDate() - weekday);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(localDate);
    d.setUTCDate(localDate.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  const totals = { users: new Set(), gamesStarted: 0, gamesCompleted: 0, participants: 0, answers: 0, correct: 0, points: 0, errors: 0 };
  for (const day of days) {
    const stats = db.dailyStats[day];
    if (!stats) continue;
    Object.keys(stats.users || {}).forEach((id) => totals.users.add(id));
    for (const key of ["gamesStarted", "gamesCompleted", "participants", "answers", "correct", "points", "errors"]) {
      totals[key] += Number(stats[key]) || 0;
    }
  }
  const accuracy = totals.answers ? Math.round((totals.correct / totals.answers) * 100) : 0;
  return [
    `🗓 <b>HAFTALIK HISOBOT — ${days[0]} dan ${days[6]} gacha</b>`,
    "",
    `👥 Faol foydalanuvchilar: <b>${totals.users.size}</b>`,
    `🎮 Boshlangan o‘yinlar: <b>${totals.gamesStarted}</b>`,
    `✅ Tugallangan o‘yinlar: <b>${totals.gamesCompleted}</b>`,
    `🧑‍🤝‍🧑 Ishtiroklar: <b>${totals.participants}</b>`,
    `❓ Javoblar: <b>${totals.answers}</b>`,
    `✔️ To‘g‘ri javoblar: <b>${totals.correct} (${accuracy}%)</b>`,
    `⭐ Berilgan ochkolar: <b>${totals.points}</b>`,
    `⚠️ Xatolar: <b>${totals.errors}</b>`,
  ].join("\n");
}

function getTopText(limit = 10) {
  const users = Object.values(db.users)
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .slice(0, limit);

  if (!users.length) {
    return "Hozircha reyting uchun ma’lumot yo‘q.";
  }

  return [
    "🏆 <b>BILIM CHARX — REYTING</b>",
    "",
    ...users.map(
      (user, index) =>
        `${index + 1}. ${escapeHTML(user.name)} — <b>${user.points || 0}</b> ochko`
    ),
  ].join("\n");
}

function getQuestionStatsText() {
  const stats = Object.values(db.questionStats);

  if (!stats.length) {
    return "❓ Hozircha savollar bo‘yicha statistika yo‘q.";
  }

  const sorted = stats
    .sort((a, b) => (b.asked || 0) - (a.asked || 0))
    .slice(0, 10);

  return [
    "❓ <b>SAVOLLAR STATISTIKASI</b>",
    "",
    ...sorted.map((item, i) => {
      const percent = item.asked
        ? Math.round((item.correct / item.asked) * 100)
        : 0;

      return `${i + 1}. ${escapeHTML(item.question)}\n   Ko‘rsatilgan: ${item.asked} | To‘g‘ri: ${item.correct} (${percent}%)`;
    }),
  ].join("\n\n");
}

function getTournamentText() {
  const tournaments = Object.values(db.tournaments);

  if (!tournaments.length) {
    return "Hozircha turnirlar yaratilmagan.";
  }

  return [
    "🎯 <b>TURNIRLAR</b>",
    "",
    ...tournaments.map((tournament) => {
      const players = tournament.players || [];

      return [
        `<b>${escapeHTML(tournament.name)}</b>`,
        `Holati: ${escapeHTML(tournament.status)}`,
        `Ishtirokchilar: ${players.length}`,
        `ID: <code>${escapeHTML(tournament.id)}</code>`,
      ].join("\n");
    }),
  ].join("\n\n");
}

// ==================== O'YIN LOBBYSI ====================

function lobbyText(room) {
  const players = room.players
    .map((player, index) => {
      const ready = player.ready ? "✅" : "⏳";

      return `${index + 1}. ${ready} ${escapeHTML(player.name)}${
        player.id === room.hostId ? " 👑" : ""
      }`;
    })
    .join("\n");

  return [
    "🎮 <b>O‘YIN XONASI</b>",
    "",
    `🔑 Xona kodi: <code>${room.code}</code>`,
    `👥 O‘yinchilar: ${room.players.length}/${room.maxPlayers}`,
    `❓ Savollar: ${room.questionCount}`,
    `📚 Daraja: ${escapeHTML(room.difficulty)}`,
    ...(room.solo ? ["⚡ Rejim: SOLO — shaxsiy natija uchun"] : []),
    `🧠 Fan: ${escapeHTML(getCategoryName(room.subject || "all"))}`,
    "",
    players || "Hali o‘yinchi yo‘q.",
    "",
    ...(room.solo ? ["Bu shaxsiy mashg‘ulot. Tayyor bo‘lsangiz, boshlang."] : ["Do‘stlaringizga xona kodini yuboring."]),
  ].join("\n");
}

function lobbyKeyboard(room, viewerId) {
  const rows = room.solo ? [] : [
    [Markup.button.callback("✅ Tayyor", `room:ready:${room.code}`)],
    [Markup.button.callback("🚪 Xonadan chiqish", `room:leave:${room.code}`)],
  ];
  if (room.solo) rows.push([Markup.button.callback("❌ Solo’dan chiqish", `room:leave:${room.code}`)]);

  if (Number(viewerId) === Number(room.hostId)) {
    rows.unshift([
      Markup.button.callback(
        "▶️ O‘yinni boshlash",
        `room:start:${room.code}`
      ),
    ]);
  }

  return Markup.inlineKeyboard(rows);
}

async function refreshLobby(room) {
  if (!room || !room.lobbyMessages) return;

  for (const item of room.lobbyMessages) {
    try {
      await bot.telegram.editMessageText(
        item.chatId,
        item.messageId,
        undefined,
        lobbyText(room),
        {
          parse_mode: "HTML",
          ...lobbyKeyboard(room, item.userId),
        }
      );
    } catch {
      // Xabar o'chirilgan yoki o'zgarmagan bo'lishi mumkin.
    }
  }
}

async function sendLobby(ctx, room) {
  const message = await ctx.reply(lobbyText(room), {
    parse_mode: "HTML",
    ...lobbyKeyboard(room, ctx.from.id),
  });

  room.lobbyMessages.push({
    chatId: message.chat.id,
    messageId: message.message_id,
    userId: ctx.from.id,
  });
}

function removePlayer(room, userId) {
  room.players = room.players.filter(
    (player) => player.id !== Number(userId)
  );

  if (room.hostId === Number(userId) && room.players.length) {
    room.hostId = room.players[0].id;
  }

  if (!room.players.length) {
    delete rooms[room.code];
    return;
  }

  refreshLobby(room);
}

// ==================== O'YIN MEXANIKASI ====================

async function startGame(ctx, room) {
  if (!isHost(room, ctx.from.id)) {
    return ctx.answerCbQuery(
      "Faqat xona egasi o‘yinni boshlashi mumkin.",
      { show_alert: true }
    );
  }

  if (room.status !== "lobby") {
    return ctx.answerCbQuery("O‘yin allaqachon boshlangan.");
  }

  if (!room.solo && room.players.length < 2) {
    return ctx.answerCbQuery(
      "Boshlash uchun kamida 2 o‘yinchi kerak.",
      { show_alert: true }
    );
  }

  const questions = getQuestions(
    room.subject || "all",
    room.difficulty,
    room.questionCount
  );

  if (!questions.length) {
    return ctx.answerCbQuery(
      "Tanlangan fan uchun savollar topilmadi. test.json faylini tekshiring.",
      { show_alert: true }
    );
  }

  room.questions = questions;
  room.questionCount = questions.length;
  room.status = "playing";
  room.questionIndex = 0;
  room.startedDay = dateKey();
  room.answers = {};
  room.scores = {};

  room.players.forEach((player) => {
    room.scores[player.id] = 0;
    getUser({
      id: player.id,
      first_name: player.name,
    });
  });

  db.totalGames++;

  const daily = getDailyStats(room.startedDay);
  daily.gamesStarted++;
  daily.participants += room.players.length;

  room.players.forEach((player) =>
    recordDailyUser(player.id, room.startedDay)
  );

  saveDB();

  await ctx.answerCbQuery("O‘yin boshlandi!");
  await refreshLobby(room);

  for (const player of room.players) {
    try {
      await bot.telegram.sendMessage(
        player.id,
        `🎮 O‘yin boshlandi!\n` +
          `Xona: ${room.code}\n` +
          `Fan: ${getCategoryName(room.subject || "all")}\n` +
          `Savollar: ${room.questions.length}`
      );
    } catch {
      // Botga shaxsiy xabar yuborish cheklangan bo'lishi mumkin.
    }
  }

  await sendQuestion(room);
}

async function sendQuestion(room) {
  if (!room || room.status !== "playing") return;

  const q = room.questions[room.questionIndex];

  if (!q) return finishGame(room);

  room.answers[room.questionIndex] = {};
  room.questionEnding = false;
  room.questionStartedAt = Date.now();

  const answerRows = q.options.map((option, index) => [
    Markup.button.callback(
      `${String.fromCharCode(65 + index)}. ${String(option).slice(0, 50)}`,
      `answer:${room.code}:${room.questionIndex}:${index}`
    ),
  ]);
  answerRows.push([Markup.button.callback("⏹ O‘yinni tark etish", `room:exit:${room.code}`)]);
  const keyboard = Markup.inlineKeyboard(answerRows);

  const text = [
    `❓ <b>Savol ${room.questionIndex + 1}/${room.questions.length}</b>`,
    "",
    escapeHTML(q.question),
    "",
    `📚 Fan: ${escapeHTML(q.category || "Umumiy")}`,
  ].join("\n");

  for (const player of room.players) {
    try {
      await bot.telegram.sendMessage(player.id, text, {
        parse_mode: "HTML",
        ...keyboard,
      });
    } catch (error) {
      console.error(
        `Savol yuborilmadi (${player.id}):`,
        error.message
      );
    }
  }

  const questionTimeSeconds = Math.max(5, Number(process.env.QUESTION_TIME || 15));
  room.questionTimer = setTimeout(() => {
    endQuestion(room);
  }, questionTimeSeconds * 1000);
}

async function endQuestion(room) {
  if (!room || room.status !== "playing" || room.questionEnding) return;
  room.questionEnding = true;
  clearTimeout(room.questionTimer);

  const q = room.questions[room.questionIndex];
  if (!q) return finishGame(room);

  const answers = room.answers[room.questionIndex] || {};
  const correctIndex = Number(q.answer);

  const statKey = `${q.id ?? q.question}:${q.question}`;

  if (!db.questionStats[statKey]) {
    db.questionStats[statKey] = {
      question: q.question,
      asked: 0,
      correct: 0,
    };
  }

  db.questionStats[statKey].asked++;

  for (const player of room.players) {
    const answer = answers[player.id];
    let feedback;

    if (answer && answer.option === correctIndex) {
      const user = db.users[String(player.id)];

      if (user) {
        user.correctAnswers++;
      }

      const points = Math.max(
        10,
        100 - Math.floor((answer.timeMs || 0) / 300)
      );

      if (user) user.points += points;

      room.scores[player.id] =
        (room.scores[player.id] || 0) + points;

      db.questionStats[statKey].correct++;

      const daily = getDailyStats(room.startedDay || dateKey());
      daily.points += points;

      feedback = `✅ To‘g‘ri javob! +${points} ochko`;
    } else {
      feedback =
        `❌ Noto‘g‘ri yoki vaqt tugadi.\n` +
        `To‘g‘ri javob: ${escapeHTML(q.options[correctIndex])}`;
    }

    try {
      await bot.telegram.sendMessage(player.id, feedback, {
        parse_mode: "HTML",
      });
    } catch {
      // Foydalanuvchi xabarlari uchun xato o'yinni to'xtatmaydi.
    }
  }

  const daily = getDailyStats(room.startedDay || dateKey());

  daily.answers += room.players.length;
  daily.correct += Object.values(answers).filter(
    (answer) => answer.option === correctIndex
  ).length;

  saveDB();

  room.questionIndex++;

  if (room.questionIndex >= room.questions.length) {
    return finishGame(room);
  }

  setTimeout(() => sendQuestion(room), 1500);
}

async function finishGame(room) {
  if (!room || room.status === "finished") return;
  room.questionEnding = true;
  clearTimeout(room.questionTimer);
  room.status = "finished";

  db.completedGames++;

  const daily = getDailyStats(room.startedDay || dateKey());
  daily.gamesCompleted++;

  for (const player of room.players) {
    const user = db.users[String(player.id)];
    if (user) user.games++;
  }

  const ranking = [...room.players].sort(
    (a, b) => (room.scores[b.id] || 0) - (room.scores[a.id] || 0)
  );

  if (!room.solo && ranking.length && (room.scores[ranking[0].id] || 0) > 0) {
    const winner = db.users[String(ranking[0].id)];
    if (winner) winner.wins++;
  }

  if (room.solo && ranking.length) {
    const soloUser = db.users[String(ranking[0].id)];
    if (soloUser) {
      soloUser.soloGames = (soloUser.soloGames || 0) + 1;
      soloUser.bestSoloScore = Math.max(soloUser.bestSoloScore || 0, room.scores[ranking[0].id] || 0);
    }
  }

  const result = [
    room.solo ? "⚡ <b>SOLO MASHG‘ULOT YAKUNLANDI!</b>" : "🏁 <b>O‘YIN YAKUNLANDI!</b>",
    "",
    `🧠 Fan: ${escapeHTML(getCategoryName(room.subject || "all"))}`,
    "",
    ...ranking.map(
      (player, index) =>
        `${index + 1}. ${escapeHTML(player.name)} — <b>${room.scores[player.id] || 0}</b> ochko`
    ),
    "",
    ...(room.solo ? [`🏅 Eng yaxshi Solo natijangiz: <b>${db.users[String(room.hostId)]?.bestSoloScore || 0}</b> ochko`, "Natijangiz umumiy ochkolaringizga qo‘shildi."] : []),
    "Yana o‘ynash uchun quyidagi tugmadan foydalaning yoki /start yuboring.",
  ].join("\n");

  for (const player of room.players) {
    try {
      await bot.telegram.sendMessage(player.id, result, {
        parse_mode: "HTML",
        ...(room.solo ? { ...Markup.inlineKeyboard([[Markup.button.callback("🔁 Yana Solo o‘ynash", "game:solo")], [Markup.button.callback("🏠 Menyu", "menu:home")]]) } : {}),
      });
    } catch {
      // Natija bazada saqlanadi.
    }
  }

  saveDB();
  setTimeout(() => delete rooms[room.code], 60000);
}

function clearRoomTimers(room) {
  if (room?.questionTimer) clearTimeout(room.questionTimer);
}

// ==================== XATOLAR HISOBOTI ====================

async function reportError(error, ctx) {
  const message = String(
    error?.stack || error?.message || error
  ).slice(0, 3000);

  db.errors.push({
    time: new Date().toISOString(),
    message,
    userId: ctx?.from?.id || null,
    updateType: ctx?.updateType || "unknown",
  });

  db.errors = db.errors.slice(-100);

  const day = getDailyStats();
  day.errors++;

  saveDB();

  console.error("BOT XATOSI:", message);

  const report = [
    "⚠️ <b>BILIM CHARX — BOT XATOSI</b>",
    "",
    `<b>Vaqt:</b> ${new Date().toLocaleString("uz-UZ", {
      timeZone: "Asia/Tashkent",
    })}`,
    `<b>Foydalanuvchi ID:</b> ${ctx?.from?.id || "Noma’lum"}`,
    "",
    `<pre>${escapeHTML(message.slice(0, 2500))}</pre>`,
  ].join("\n");

  for (const adminId of ADMIN_IDS) {
    try {
      await bot.telegram.sendMessage(adminId, report, {
        parse_mode: "HTML",
      });
    } catch (sendError) {
      console.error(
        "Adminga xato yuborilmadi:",
        sendError.message
      );
    }
  }

  if (REPORT_CHANNEL_ID) {
    try {
      await bot.telegram.sendMessage(REPORT_CHANNEL_ID, report, {
        parse_mode: "HTML",
      });
    } catch (sendError) {
      console.error(
        "Hisobot kanaliga yuborilmadi:",
        sendError.message
      );
    }
  }
}

// ==================== ASOSIY BUYRUQLAR ====================

bot.start(async (ctx) => {
  getUser(ctx.from);
  recordDailyUser(ctx.from.id);
  saveDB();

  if (!(await checkSubscription(ctx))) return;

  await ctx.reply(
    `Assalomu alaykum, ${getName(ctx.from)}!\n\n` +
      "🧠 <b>Bilim Charx</b> botiga xush kelibsiz!\n" +
      "Do‘stlaringiz bilan bilim bellashuvida qatnashing.",
    {
      parse_mode: "HTML",
      ...replyMainMenu(),
    }
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "📖 <b>Yordam</b>\n\n" +
      "/start — asosiy menyu\n" +
      "/cancel — joriy amalni bekor qilish\n" +
      "/admin — administrator paneli (faqat adminlar)",
    { parse_mode: "HTML", ...replyMainMenu() }
  );
});

bot.command("cancel", async (ctx) => {
  pendingActions.delete(ctx.from.id);
  broadcastDrafts.delete(ctx.from.id);
  ctx.session = {};
  await ctx.reply("Joriy amal bekor qilindi. Asosiy menyu tiklandi.", {
    ...replyMainMenu(),
  });
  await ctx.reply("Kerakli bo‘limni tanlang:", mainMenu());
});

bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("⛔ Bu buyruq faqat administratorlar uchun.");
  }

  await ctx.reply(
    "🛠 <b>BILIM CHARX — ADMIN PANELI</b>\nKerakli bo‘limni tanlang:",
    {
      parse_mode: "HTML",
      ...adminMenu(),
    }
  );
});

bot.command("stats", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("⛔ Ruxsat yo‘q.");
  }

  await ctx.reply(getAdminStatsText(), {
    parse_mode: "HTML",
    ...backToAdmin(),
  });
});

// ==================== MENYU CALLBACKLARI ====================

bot.action("subscription:check", async (ctx) => {
  await ctx.answerCbQuery();

  if (await checkSubscription(ctx)) {
    await ctx.reply("✅ Obuna tasdiqlandi! Pastki menyudan foydalanishingiz mumkin.", replyMainMenu());
    await ctx.reply("Kerakli bo‘limni tanlang:", mainMenu());
  }
});

bot.action("info:rules", async (ctx) => {
  await ctx.answerCbQuery();

  await safeEdit(
    ctx,
    "📖 <b>O‘YIN QOIDALARI</b>\n\n" +
      "1. Xona yarating yoki xona kodiga qo‘shiling.\n" +
      "2. O‘yinchilar yig‘ilgach, xona egasi o‘yinni boshlaydi.\n" +
      "3. Har savolga javob berish uchun 20 soniya beriladi.\n" +
      "4. To‘g‘ri va tez javoblar ko‘proq ochko beradi.\n" +
      "5. O‘yin yakunida natijalar ko‘rsatiladi.",
    { ...mainMenu() }
  );
});

bot.action("profile:me", async (ctx) => {
  await ctx.answerCbQuery();
  const user = getUser(ctx.from);
  await safeEdit(ctx, getProfileText(user), {
    ...Markup.inlineKeyboard([
      [Markup.button.callback("🏆 Reyting", "profile:rating")],
      [Markup.button.callback("⬅️ Menyu", "menu:home")],
    ]),
  });
  saveDB();
});

bot.action("profile:rating", async (ctx) => {
  await ctx.answerCbQuery();

  const user = getUser(ctx.from);

  const ranking = Object.values(db.users).sort(
    (a, b) => (b.points || 0) - (a.points || 0)
  );

  const place =
    ranking.findIndex((item) => item.id === user.id) + 1;

  await safeEdit(
    ctx,
    `🏆 <b>REYTINGIM</b>\n\n` +
      `Sizning o‘rningiz: <b>${place || "—"}</b>\n` +
      `Ochkolaringiz: <b>${user.points}</b>`,
    {
      ...Markup.inlineKeyboard([
        [Markup.button.callback("⬅️ Menyu", "menu:home")],
      ]),
    }
  );
});

bot.action("menu:home", async (ctx) => {
  await ctx.answerCbQuery();

  await safeEdit(
    ctx,
    "🧠 <b>BILIM CHARX</b>\nKerakli bo‘limni tanlang:",
    { ...mainMenu() }
  );
});

// ==================== XONA YARATISH ====================

bot.action("game:solo", async (ctx) => {
  await ctx.answerCbQuery();
  if (!(await checkSubscription(ctx))) return;
  if (getActiveRoom(ctx.from.id)) {
    return ctx.reply("Sizda faol o‘yin bor. Avval uni yakunlang yoki xonadan chiqing.", replyMainMenu());
  }
  pendingActions.set(ctx.from.id, { type: "create_questions", maxPlayers: 1, solo: true });
  await ctx.reply("⚡ <b>SOLO REJIMI</b>\n\nYolg‘iz mashq qiling, ochko to‘plang va shaxsiy rekordingizni yangilang.\n\n❓ Nechta savol ishlamoqchisiz?", {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [5, 10, 15].map((n) => Markup.button.callback(`${n} ta savol`, `create:questions:${n}`)),
      [Markup.button.callback("❌ Bekor qilish", "game:cancel")],
    ]),
  });
});

bot.action("game:create", async (ctx) => {
  await ctx.answerCbQuery();

  if (!(await checkSubscription(ctx))) return;

  if (getActiveRoom(ctx.from.id)) {
    return ctx.reply("Siz allaqachon faol o‘yin xonasidasiz.");
  }

  pendingActions.set(ctx.from.id, {
    type: "create_players",
    solo: false,
  });

  await ctx.reply(
    "👥 Xonada jami nechta o‘yinchi bo‘lsin? (2–10)",
    Markup.inlineKeyboard([
      [2, 3, 4, 5, 6].map((n) =>
        Markup.button.callback(String(n), `create:players:${n}`)
      ),
      [7, 8, 9, 10].map((n) =>
        Markup.button.callback(String(n), `create:players:${n}`)
      ),
      [Markup.button.callback("❌ Bekor qilish", "game:cancel")],
    ])
  );
});

bot.action(/^create:players:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const maxPlayers = Number(ctx.match[1]);

  if (maxPlayers < 2 || maxPlayers > 10) return;

  pendingActions.set(ctx.from.id, {
    type: "create_questions",
    maxPlayers,
  });

  await ctx.reply(
    "❓ Nechta savol bo‘lsin?",
    Markup.inlineKeyboard([
      [5, 10, 15].map((n) =>
        Markup.button.callback(String(n), `create:questions:${n}`)
      ),
      [Markup.button.callback("⬅️ Bekor qilish", "game:cancel")],
    ])
  );
});

bot.action(/^create:questions:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const action = pendingActions.get(ctx.from.id);

  if (!action || action.type !== "create_questions") {
    return ctx.reply("Bu amal muddati tugagan. /start bosing.");
  }

  const questionCount = Number(ctx.match[1]);

  pendingActions.set(ctx.from.id, {
    ...action,
    type: "create_difficulty",
    questionCount,
  });

  await ctx.reply(
    "📚 Savollar qiyinligini tanlang:",
    Markup.inlineKeyboard([
      [
        Markup.button.callback("🟢 Oson", "create:difficulty:easy"),
        Markup.button.callback("🟡 O‘rta", "create:difficulty:medium"),
      ],
      [
        Markup.button.callback("🔴 Qiyin", "create:difficulty:hard"),
        Markup.button.callback("🎲 Aralash", "create:difficulty:all"),
      ],
      [Markup.button.callback("❌ Bekor qilish", "game:cancel")],
    ])
  );
});

// Qiyinlik tanlangach, endi fanlar menyusi ochiladi.
bot.action(
  /^create:difficulty:(easy|medium|hard|all)$/,
  async (ctx) => {
    await ctx.answerCbQuery();

    const action = pendingActions.get(ctx.from.id);

    if (!action || action.type !== "create_difficulty") {
      return ctx.reply("Bu amal muddati tugagan. /start bosing.");
    }

    const difficulty = ctx.match[1];
    const categories = getCategories();

    if (!loadQuestions().length) {
      pendingActions.delete(ctx.from.id);

      return ctx.reply(
        "❌ Savollar topilmadi. test.json faylini tekshiring."
      );
    }

    // Faqat kategoriyasi ko'rsatilgan fanlar ro'yxati.
    // Barcha fanlar varianti ham mavjud.
    const subjects = ["all", ...categories];

    pendingActions.set(ctx.from.id, {
      ...action,
      type: "create_subject",
      difficulty,
      subjects,
    });

    const rows = [
      [
        Markup.button.callback(
          "🌐 Barcha fanlar",
          "create:subject:0"
        ),
      ],
    ];

    // Har qatorda 2 tadan fan.
    for (let i = 1; i < subjects.length; i += 2) {
      const row = [
        Markup.button.callback(
          `📚 ${subjects[i].slice(0, 35)}`,
          `create:subject:${i}`
        ),
      ];

      if (subjects[i + 1]) {
        row.push(
          Markup.button.callback(
            `📚 ${subjects[i + 1].slice(0, 35)}`,
            `create:subject:${i + 1}`
          )
        );
      }

      rows.push(row);
    }

    rows.push([
      Markup.button.callback("❌ Bekor qilish", "game:cancel"),
    ]);

    await ctx.reply(
      "🧠 <b>Fanni tanlang</b>\n\n" +
        `Qiyinlik: <b>${escapeHTML(difficulty)}</b>\n` +
        "Quyidagi fanlardan birini tanlang:",
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(rows),
      }
    );
  }
);

// Fan tanlangach xona yaratiladi.
bot.action(/^create:subject:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const action = pendingActions.get(ctx.from.id);

  if (!action || action.type !== "create_subject") {
    return ctx.reply("Bu amal muddati tugagan. /start bosing.");
  }

  if (getActiveRoom(ctx.from.id)) {
    pendingActions.delete(ctx.from.id);
    return ctx.reply("Siz allaqachon faol o‘yin xonasidasiz.");
  }

  const subjectIndex = Number(ctx.match[1]);
  const subject = action.subjects?.[subjectIndex];

  if (subject === undefined) {
    return ctx.reply(
      "Fan tanlashda xato yuz berdi. /start orqali qayta urinib ko‘ring."
    );
  }

  const questions = getQuestions(
    subject,
    action.difficulty,
    action.questionCount
  );

  if (!questions.length) {
    pendingActions.delete(ctx.from.id);

    return ctx.reply(
      `❌ ${getCategoryName(subject)} fanida savollar topilmadi.`
    );
  }

  const code = makeCode();

  const room = {
    code,
    hostId: ctx.from.id,
    maxPlayers: action.maxPlayers,
    solo: Boolean(action.solo),
    questionCount: questions.length,
    difficulty: action.difficulty,
    subject,
    players: [
      {
        id: ctx.from.id,
        name: getName(ctx.from),
        ready: true,
      },
    ],
    status: "lobby",
    questions: [],
    questionIndex: 0,
    answers: {},
    scores: {},
    lobbyMessages: [],
    questionTimer: null,
    createdAt: new Date().toISOString(),
  };

  rooms[code] = room;
  pendingActions.delete(ctx.from.id);

  await sendLobby(ctx, room);
});

// ==================== XONAGA QO'SHILISH ====================

bot.action("game:join", async (ctx) => {
  await ctx.answerCbQuery();

  if (!(await checkSubscription(ctx))) return;

  pendingActions.set(ctx.from.id, {
    type: "join_room",
  });

  await ctx.reply(
    "🔑 Xona kodini yuboring.\n\nBekor qilish uchun quyidagi tugmani bosing yoki /cancel yuboring.",
    Markup.inlineKeyboard([[Markup.button.callback("❌ Bekor qilish", "game:cancel")]])
  );
});

bot.action("game:cancel", async (ctx) => {
  await ctx.answerCbQuery();

  pendingActions.delete(ctx.from.id);

  await ctx.reply("Amal bekor qilindi.", mainMenu());
});

bot.action(/^room:ready:([A-Z0-9]+)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const room = rooms[ctx.match[1]];

  if (!room || room.status !== "lobby") {
    return ctx.reply("Xona topilmadi yoki o‘yin boshlangan.");
  }

  const player = room.players.find(
    (p) => p.id === ctx.from.id
  );

  if (!player) {
    return ctx.reply("Siz bu xonada emassiz.");
  }

  player.ready = !player.ready;

  await refreshLobby(room);
});

bot.action(/^room:leave:([A-Z0-9]+)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const room = rooms[ctx.match[1]];

  if (!room || room.status !== "lobby") {
    return ctx.reply("Xona topilmadi yoki o‘yin boshlangan.");
  }

  removePlayer(room, ctx.from.id);

  await ctx.reply("Siz xonadan chiqdingiz.", mainMenu());
});

bot.action(/^room:start:([A-Z0-9]+)$/, async (ctx) => {
  const room = rooms[ctx.match[1]];

  if (!room) {
    return ctx.answerCbQuery("Xona topilmadi.", {
      show_alert: true,
    });
  }

  await startGame(ctx, room);
});

bot.action(/^room:exit:([A-Z0-9]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const room = rooms[ctx.match[1]];
  if (!room || room.status !== "playing") {
    return ctx.reply("Faol o‘yin topilmadi.", replyMainMenu());
  }
  const userId = Number(ctx.from.id);
  if (!room.players.some((player) => player.id === userId)) {
    return ctx.reply("Siz bu o‘yinda qatnashmayapsiz.", replyMainMenu());
  }
  room.players = room.players.filter((player) => player.id !== userId);
  delete room.scores[userId];
  for (const answers of Object.values(room.answers || {})) delete answers[userId];
  await ctx.reply("⏹ O‘yindan chiqdingiz. Menyu tayyor.", replyMainMenu());
  if (!room.players.length) {
    clearTimeout(room.questionTimer);
    room.status = "finished";
    setTimeout(() => delete rooms[room.code], 1000);
  }
});

// ==================== JAVOBLARNI QABUL QILISH ====================

bot.action(
  /^answer:([A-Z0-9]+):(\d+):(\d+)$/,
  async (ctx) => {
    const [, code, questionIndexRaw, optionRaw] = ctx.match;

    const room = rooms[code];
    const questionIndex = Number(questionIndexRaw);
    const option = Number(optionRaw);

    if (!room || room.status !== "playing") {
      return ctx.answerCbQuery("O‘yin faol emas.", {
        show_alert: true,
      });
    }

    if (questionIndex !== room.questionIndex) {
      return ctx.answerCbQuery("Bu savolning vaqti tugagan.", {
        show_alert: true,
      });
    }

    const player = room.players.find(
      (p) => p.id === ctx.from.id
    );

    if (!player) {
      return ctx.answerCbQuery(
        "Siz bu o‘yinda qatnashmayapsiz.",
        { show_alert: true }
      );
    }

    const answers =
      room.answers[questionIndex] ||
      (room.answers[questionIndex] = {});

    if (answers[ctx.from.id]) {
      return ctx.answerCbQuery(
        "Javobingiz allaqachon qabul qilingan.",
        { show_alert: true }
      );
    }

    const q = room.questions[questionIndex];

    if (!q || option < 0 || option >= q.options.length) {
      return ctx.answerCbQuery("Noto‘g‘ri javob varianti.");
    }

    answers[ctx.from.id] = {
      option,
      timeMs: Date.now() - room.questionStartedAt,
    };

    const user = getUser(ctx.from);
    user.totalAnswers++;

    recordDailyUser(
      ctx.from.id,
      room.startedDay || dateKey()
    );

    await ctx.answerCbQuery("Javobingiz qabul qilindi!");

    saveDB();

    const allAnswered = room.players.every(
      (p) => Boolean(answers[p.id])
    );

    if (allAnswered) {
      await endQuestion(room);
    }
  }
);

// ==================== KUNLIK OMMAVIY BATTLE ====================

const MASS_BATTLE_START_HOUR = 20;
const MASS_BATTLE_REMINDER_HOUR = 19;
const MASS_BATTLE_REMINDER_MINUTE = 50;
const MASS_BATTLE_QUESTION_SECONDS = Math.max(5, Number(process.env.QUESTION_TIME || 15));
const MASS_BATTLE_QUESTION_COUNT = Number(process.env.MASS_BATTLE_QUESTION_COUNT || 10);
let massBattleTimer = null;

function tashkentDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const out = {};
  for (const part of parts) if (part.type !== "literal") out[part.type] = part.value;
  return out;
}

function tashkentDayKey(date = new Date()) {
  const p = tashkentDateParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function getTodayMassBattle() {
  return db.massBattles[tashkentDayKey()] || null;
}

function massBattleAdminKeyboard(day) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Ha, ruxsat beraman", `massbattle:approve:${day}`)],
    [Markup.button.callback("❌ Bugun boshlanmasin", `massbattle:deny:${day}`)],
  ]);
}

function massBattleJoinKeyboard(day) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✍️ Battle’ga qo‘shilish", `massbattle:join:${day}`)],
  ]);
}

function massBattleStatusLabel(battle) {
  const labels = {
    waiting_approval: "Admin ruxsati kutilmoqda",
    approved: "Ruxsat berildi — boshlanmoqda",
    waiting_admin: "Ruxsat berilmagan — boshlanmadi",
    playing: "Jonli ravishda davom etmoqda",
    finished: "Yakunlangan",
    cancelled: "Admin bekor qildi",
  };
  return labels[battle.status] || battle.status || "Noma’lum";
}

function getMassBattleText(battle) {
  const players = battle.players || [];
  return [
    "⚔️ <b>KUNLIK OMMAVIY BATTLE</b>",
    "",
    `📅 Sana: <b>${escapeHTML(battle.day)}</b>`,
    "🕗 Boshlanishi: <b>admin tasdiqlagach darhol</b>",
    `📌 Holati: <b>${escapeHTML(massBattleStatusLabel(battle))}</b>`,
    `👥 Ishtirokchilar: <b>${players.length}</b>`,
    `❓ Savollar: <b>${battle.questions?.length || MASS_BATTLE_QUESTION_COUNT}</b>`,
  ].join("\n");
}

async function sendMassBattleReminder(battle) {
  const adminText = [
    "⚔️ <b>YANGI OMMAVIY BATTLE</b>",
    "",
    "Admin panelidan yangi ommaviy Battle yaratildi.",
    "Ruxsat berilsa, Battle darhol boshlanadi.",
    "",
    "✅ Boshlash uchun ruxsat bering.",
    "❌ Yoki Battle’ni bekor qiling.",
  ].join("\n");

  for (const adminId of ADMIN_IDS) {
    try {
      await bot.telegram.sendMessage(adminId, adminText, {
        parse_mode: "HTML",
        ...massBattleAdminKeyboard(battle.day),
      });
    } catch (error) {
      console.error(`Admin ${adminId} ga Battle ruxsat xabari yuborilmadi:`, error.message);
    }
  }

  // Privacy/anti-spam: never send unsolicited DMs to every registered user.
  // Users can discover and join Battle from the bot's Turnirlar menu.
  // An optional public channel announcement can be enabled via ANNOUNCEMENT_CHANNEL_ID.
  if (ANNOUNCEMENT_CHANNEL_ID) {
    const userText = [
      "⚔️ <b>YANGI OMMAVIY BATTLE!</b>",
      "",
      "🏆 Ishtirok etish uchun botni oching va Battle’ga qo‘shiling.",
      "Battle admin ruxsat bergach boshlanadi.",
    ].join("\n");
    try {
      await bot.telegram.sendMessage(ANNOUNCEMENT_CHANNEL_ID, userText, {
        parse_mode: "HTML",
        ...massBattleJoinKeyboard(battle.day),
      });
    } catch (error) {
      console.error("Ommaviy Battle kanal e’loni yuborilmadi:", error.message);
    }
  }
}

async function createDailyMassBattle(day) {
  if (db.massBattles[day]) return db.massBattles[day];
  const available = getQuestions("all", "all", MASS_BATTLE_QUESTION_COUNT);
  const battle = {
    id: `MB-${day}`,
    day,
    name: `Kunlik Ommaviy Battle — ${day}`,
    status: "waiting_approval",
    players: [],
    scores: {},
    activeFromQuestion: {},
    answers: {},
    questions: available,
    questionIndex: 0,
    createdAt: new Date().toISOString(),
    reminderSent: true,
    approvalBy: null,
    reportSent: false,
  };
  db.massBattles[day] = battle;
  saveDB();
  await sendMassBattleReminder(battle);
  return battle;
}

async function notifyMassBattleUsers(text) {
  for (const player of (getTodayMassBattle()?.players || [])) {
    try {
      await bot.telegram.sendMessage(player.id, text, { parse_mode: "HTML" });
    } catch {
      // Ayrim foydalanuvchilarga xabar yuborilmasligi mumkin.
    }
  }
}

async function startMassBattle(battle) {
  if (!battle || battle.status === "playing" || battle.status === "finished") return;
  if (battle.status !== "approved") return;
  if (!Array.isArray(battle.questions) || !battle.questions.length) {
    battle.status = "cancelled";
    saveDB();
    for (const adminId of ADMIN_IDS) {
      try { await bot.telegram.sendMessage(adminId, "❌ Ommaviy Battle boshlanmadi: test.json ichida savollar topilmadi."); } catch {}
    }
    return;
  }

  battle.status = "playing";
  battle.startedAt = new Date().toISOString();
  battle.questionIndex = 0;
  battle.answers = {};
  battle.scores = battle.scores || {};
  battle.players = battle.players || [];
  for (const player of battle.players) {
    battle.scores[player.id] = Number(battle.scores[player.id] || 0);
    battle.activeFromQuestion[player.id] = 0;
    getUser({ id: player.id, first_name: player.name, username: player.username });
  }
  db.totalGames++;
  const daily = getDailyStats(battle.day);
  daily.gamesStarted++;
  daily.participants += battle.players.length;
  for (const player of battle.players) recordDailyUser(player.id, battle.day);
  saveDB();

  await notifyMassBattleUsers(
    `🚀 <b>${escapeHTML(battle.name)}</b> boshlandi!\n\n` +
    `Ishtirokchilar: <b>${battle.players.length}</b>\nSavollar: <b>${battle.questions.length}</b>\n\n` +
    "Yangi ishtirokchilar Battle davomida ham Turnirlar bo‘limidan qo‘shilishi mumkin."
  );
  await sendMassBattleQuestion(battle);
}

async function sendMassBattleQuestion(battle) {
  if (!battle || battle.status !== "playing") return;
  battle.questionEnding = false;
  const q = battle.questions[battle.questionIndex];
  if (!q) return finishMassBattle(battle);

  battle.answers[battle.questionIndex] = battle.answers[battle.questionIndex] || {};
  battle.questionStartedAt = Date.now();
  battle.questionStartedAtISO = new Date().toISOString();
  saveDB();

  const keyboardFor = (playerId) => Markup.inlineKeyboard(
    q.options.map((option, index) => [
      Markup.button.callback(
        `${String.fromCharCode(65 + index)}. ${String(option).slice(0, 50)}`,
        `massanswer:${battle.day}:${battle.questionIndex}:${index}`
      ),
    ])
  );
  const text = [
    `⚔️ <b>OMMAVIY BATTLE — SAVOL ${battle.questionIndex + 1}/${battle.questions.length}</b>`,
    "",
    escapeHTML(q.question),
    "",
    `📚 Fan: ${escapeHTML(q.category || "Umumiy")}`,
    `⏱ Javob berish vaqti: ${MASS_BATTLE_QUESTION_SECONDS} soniya`,
  ].join("\n");

  for (const player of battle.players) {
    if (Number(battle.activeFromQuestion[player.id] ?? 0) > battle.questionIndex) continue;
    try {
      await bot.telegram.sendMessage(player.id, text, {
        parse_mode: "HTML",
        ...keyboardFor(player.id),
      });
    } catch (error) {
      console.error(`Ommaviy Battle savoli ${player.id} ga yuborilmadi:`, error.message);
    }
  }

  if (battle.questionTimer) clearTimeout(battle.questionTimer);
  battle.questionTimer = setTimeout(() => endMassBattleQuestion(battle), MASS_BATTLE_QUESTION_SECONDS * 1000);
}

async function endMassBattleQuestion(battle) {
  if (!battle || battle.status !== "playing" || battle.questionEnding) return;
  battle.questionEnding = true;
  if (battle.questionTimer) clearTimeout(battle.questionTimer);
  const q = battle.questions[battle.questionIndex];
  if (!q) return finishMassBattle(battle);
  const answers = battle.answers[battle.questionIndex] || {};
  const correctIndex = Number(q.answer);
  const eligible = battle.players.filter((player) => Number(battle.activeFromQuestion[player.id] ?? 0) <= battle.questionIndex);
  const statKey = `${q.id ?? q.question}:${q.question}`;
  if (!db.questionStats[statKey]) db.questionStats[statKey] = { question: q.question, asked: 0, correct: 0 };
  db.questionStats[statKey].asked++;

  for (const player of eligible) {
    const answer = answers[player.id];
    let feedback;
    if (answer && answer.option === correctIndex) {
      const points = Math.max(10, 100 - Math.floor((answer.timeMs || 0) / 300));
      battle.scores[player.id] = Number(battle.scores[player.id] || 0) + points;
      const user = db.users[String(player.id)];
      if (user) {
        user.correctAnswers++;
        user.points += points;
      }
      db.questionStats[statKey].correct++;
      getDailyStats(battle.day).points += points;
      feedback = `✅ To‘g‘ri javob! +${points} ochko`;
    } else {
      feedback = `❌ Noto‘g‘ri yoki vaqt tugadi.\nTo‘g‘ri javob: ${escapeHTML(q.options[correctIndex])}`;
    }
    try { await bot.telegram.sendMessage(player.id, feedback, { parse_mode: "HTML" }); } catch {}
  }

  const daily = getDailyStats(battle.day);
  daily.answers += eligible.length;
  daily.correct += eligible.filter((player) => answers[player.id]?.option === correctIndex).length;
  saveDB();
  battle.questionIndex++;
  if (battle.questionIndex >= battle.questions.length) return finishMassBattle(battle);
  setTimeout(() => sendMassBattleQuestion(battle), 1500);
}

function getMassBattleRanking(battle) {
  return [...(battle.players || [])].sort((a, b) =>
    (Number(battle.scores[b.id]) || 0) - (Number(battle.scores[a.id]) || 0)
  );
}

async function finishMassBattle(battle) {
  if (!battle || battle.status === "finished") return;
  battle.questionEnding = true;
  if (battle.questionTimer) clearTimeout(battle.questionTimer);
  battle.status = "finished";
  battle.finishedAt = new Date().toISOString();
  db.completedGames++;
  const daily = getDailyStats(battle.day);
  daily.gamesCompleted++;
  for (const player of battle.players) {
    const user = db.users[String(player.id)];
    if (user) user.games++;
  }
  const ranking = getMassBattleRanking(battle);
  if (ranking.length && Number(battle.scores[ranking[0].id] || 0) > 0) {
    const winner = db.users[String(ranking[0].id)];
    if (winner) winner.wins++;
  }
  const top = ranking.slice(0, 5).map((player, index) => {
    const score = Number(battle.scores[player.id] || 0);
    const user = db.users[String(player.id)] || {};
    const username = player.username || user.username;
    const identity = username ? `@${escapeHTML(String(username).replace(/^@/, ""))}` : escapeHTML(player.name || user.name || `ID ${player.id}`);
    const medal = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"][index];
    return `${medal} <b>${index + 1}-o‘rin</b> — ${identity} — <b>${score} ball</b>`;
  });
  const report = [
    "🏁 <b>OMMAVIY BATTLE YAKUNLANDI!</b>",
    `📅 Sana: ${escapeHTML(battle.day)}`,
    `👥 Ishtirokchilar: ${battle.players.length}`,
    "",
    "🏆 <b>TOP-5 NATIJA</b>",
    ...(top.length ? top : ["Ishtirokchilar bo‘lmadi."]),
    "",
    `Savollar: ${battle.questions.length}`,
  ].join("\n");
  for (const adminId of ADMIN_IDS) {
    try { await bot.telegram.sendMessage(adminId, report, { parse_mode: "HTML" }); } catch (error) { console.error(`TOP-5 hisobot admin ${adminId} ga yuborilmadi:`, error.message); }
  }
  await notifyMassBattleUsers(report);
  battle.reportSent = true;
  saveDB();
}

async function joinMassBattle(ctx, day) {
  const battle = db.massBattles[day];
  if (!battle || ["cancelled", "finished", "waiting_admin"].includes(battle.status)) {
    return ctx.reply("Bugungi Battle mavjud emas yoki yakunlangan.");
  }
  battle.players = battle.players || [];
  if (battle.players.some((player) => Number(player.id) === Number(ctx.from.id))) {
    return ctx.reply("✅ Siz allaqachon ushbu Battle ishtirokchisisiz.");
  }
  const user = getUser(ctx.from);
  const player = { id: Number(ctx.from.id), name: getName(ctx.from), username: ctx.from.username || "" };
  battle.players.push(player);
  battle.scores = battle.scores || {};
  battle.scores[player.id] = 0;
  battle.activeFromQuestion = battle.activeFromQuestion || {};
  if (battle.status === "playing") {
    // O‘yin davomida qo‘shilgan ishtirokchi keyingi savoldan boshlaydi.
    battle.activeFromQuestion[player.id] = battle.questionIndex + 1;
  } else {
    battle.activeFromQuestion[player.id] = 0;
  }
  recordDailyUser(ctx.from.id, battle.day);
  saveDB();
  await ctx.reply(
    `✅ Siz ${escapeHTML(battle.name)} turniriga yozildingiz!\n` +
    (battle.status === "playing" ? "Battle davom etmoqda. Siz keyingi savoldan qo‘shilasiz." : "Battle boshlanishi kutilmoqda."),
    { parse_mode: "HTML" }
  );
  if (battle.status === "playing") {
    try { await bot.telegram.sendMessage(ctx.from.id, "ℹ️ Siz Battle davomida qo‘shildingiz. Keyingi savolni kuting."); } catch {}
  }
}

async function runMassBattleScheduler() {
  const now = tashkentDateParts();
  const day = `${now.year}-${now.month}-${now.day}`;
  const hour = Number(now.hour);
  const minute = Number(now.minute);
  const minuteOfDay = hour * 60 + minute;
  const reminderMinute = MASS_BATTLE_REMINDER_HOUR * 60 + MASS_BATTLE_REMINDER_MINUTE;
  const startMinute = MASS_BATTLE_START_HOUR * 60;
  let battle = db.massBattles[day];

  if (!battle && minuteOfDay >= reminderMinute) {
    battle = await createDailyMassBattle(day);
  }
  if (!battle) return;

  if (battle.status === "approved" && minuteOfDay >= startMinute && !battle.startedAt) {
    await startMassBattle(battle);
  } else if (battle.status === "waiting_approval" && minuteOfDay >= startMinute) {
    battle.status = "waiting_admin";
    saveDB();
    for (const adminId of ADMIN_IDS) {
      try { await bot.telegram.sendMessage(adminId, "⚠️ Battle uchun admin ruxsati berilmadi. Battle boshlanmadi."); } catch {}
    }
  }
}

function startMassBattleScheduler() {
  if (massBattleTimer) clearInterval(massBattleTimer);
  runMassBattleScheduler().catch((error) => console.error("Mass Battle scheduler xatosi:", error.message));
  massBattleTimer = setInterval(() => {
    runMassBattleScheduler().catch((error) => console.error("Mass Battle scheduler xatosi:", error.message));
  }, 15000);
}

bot.action(/^massbattle:approve:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.", { show_alert: true });
  const battle = db.massBattles[ctx.match[1]];
  if (!battle || battle.status !== "waiting_approval") return ctx.answerCbQuery("Bu Battle uchun ruxsat so‘rovi faol emas.", { show_alert: true });
  if (!(battle.players || []).length) return ctx.answerCbQuery("Avval kamida bitta ishtirokchi qo‘shilsin.", { show_alert: true });
  battle.status = "approved";
  battle.approvalBy = ctx.from.id;
  battle.approvedAt = new Date().toISOString();
  saveDB();
  await ctx.answerCbQuery("Ruxsat qabul qilindi.");
  await safeEdit(ctx, `✅ <b>RUXSAT BERILDI</b>\n\n${getMassBattleText(battle)}\n\nBattle hozir boshlanadi.`, backToAdmin());
  await startMassBattle(battle);
});

bot.action(/^massbattle:deny:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.", { show_alert: true });
  const battle = db.massBattles[ctx.match[1]];
  if (!battle || battle.status !== "waiting_approval") return ctx.answerCbQuery("Bu Battle uchun so‘rov faol emas.", { show_alert: true });
  battle.status = "cancelled";
  battle.deniedBy = ctx.from.id;
  saveDB();
  await ctx.answerCbQuery("Bugungi Battle bekor qilindi.");
  await safeEdit(ctx, `❌ <b>BUGUNGI BATTLE BEKOR QILINDI</b>\n\n${getMassBattleText(battle)}`, backToAdmin());
  await notifyMassBattleUsers("❌ Bugungi ommaviy Battle admin tomonidan bekor qilindi.");
});

bot.action(/^massbattle:join:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  await ctx.answerCbQuery();
  await joinMassBattle(ctx, ctx.match[1]);
});

bot.action("admin:massbattle", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.", { show_alert: true });
  await ctx.answerCbQuery();
  const battle = getTodayMassBattle();
  if (!battle) return safeEdit(ctx, "Bugun uchun ommaviy Battle yaratilmagan. Uni admin panelidan qo‘lda yaratishingiz mumkin.", Markup.inlineKeyboard([
    [Markup.button.callback("➕ Yangi Battle yaratish", "admin:massbattle:create")],
    [Markup.button.callback("⬅️ Admin paneli", "admin:home")],
  ]));
  const rows = [];
  if (battle.status === "waiting_approval") rows.push([Markup.button.callback("✅ Ruxsat berish", `massbattle:approve:${battle.day}`), Markup.button.callback("❌ Bekor qilish", `massbattle:deny:${battle.day}`)]);
  if (battle.status === "approved") rows.push([Markup.button.callback("🔄 Holatni yangilash", "admin:massbattle")]);
  rows.push([Markup.button.callback("⬅️ Admin paneli", "admin:home")]);
  return safeEdit(ctx, getMassBattleText(battle), Markup.inlineKeyboard(rows));
});

bot.action("admin:massbattle:create", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.", { show_alert: true });
  const day = tashkentDayKey();
  if (db.massBattles[day]) return ctx.answerCbQuery("Bugungi Battle allaqachon yaratilgan.", { show_alert: true });
  await ctx.answerCbQuery("Battle yaratildi.");
  const battle = await createDailyMassBattle(day);
  await safeEdit(ctx, getMassBattleText(battle), Markup.inlineKeyboard([
    [Markup.button.callback("✅ Ruxsat berish va boshlash", `massbattle:approve:${day}`)],
    [Markup.button.callback("❌ Bekor qilish", `massbattle:deny:${day}`)],
    [Markup.button.callback("⬅️ Admin paneli", "admin:home")],
  ]));
});

bot.action(/^massanswer:(\d{4}-\d{2}-\d{2}):(\d+):(\d+)$/, async (ctx) => {
  const [, day, indexRaw, optionRaw] = ctx.match;
  const battle = db.massBattles[day];
  const index = Number(indexRaw);
  const option = Number(optionRaw);
  if (!battle || battle.status !== "playing") return ctx.answerCbQuery("Battle faol emas.", { show_alert: true });
  if (index !== battle.questionIndex) return ctx.answerCbQuery("Bu savolning vaqti tugagan.", { show_alert: true });
  const player = battle.players.find((item) => Number(item.id) === Number(ctx.from.id));
  if (!player || Number(battle.activeFromQuestion[player.id] ?? 0) > index) return ctx.answerCbQuery("Siz keyingi savoldan qo‘shilasiz.", { show_alert: true });
  const q = battle.questions[index];
  if (!q || option < 0 || option >= q.options.length) return ctx.answerCbQuery("Javob varianti noto‘g‘ri.");
  battle.answers[index] = battle.answers[index] || {};
  if (battle.answers[index][ctx.from.id]) return ctx.answerCbQuery("Javobingiz qabul qilingan.", { show_alert: true });
  battle.answers[index][ctx.from.id] = { option, timeMs: Date.now() - Number(battle.questionStartedAt || Date.now()) };
  const user = getUser(ctx.from);
  user.totalAnswers++;
  recordDailyUser(ctx.from.id, day);
  saveDB();
  await ctx.answerCbQuery("Javobingiz qabul qilindi!");
  const eligible = battle.players.filter((item) => Number(battle.activeFromQuestion[item.id] ?? 0) <= index);
  if (eligible.length && eligible.every((item) => Boolean(battle.answers[index][item.id]))) await endMassBattleQuestion(battle);
});

// ==================== TURNIRLAR =================

bot.action("tournament:list", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("⏸ Hozirda turnir bo‘limi vaqtincha ishlamayapti. Keyinroq qayta urinib ko‘ring.");
});

bot.action(/^tournament:join:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const tournament = db.tournaments[ctx.match[1]];

  if (!tournament || !["open", "started"].includes(tournament.status)) {
    return ctx.reply(
      "Bu turnir mavjud emas yoki ro‘yxatdan o‘tish yopilgan."
    );
  }

  tournament.players = tournament.players || [];
  if (!tournament.players.includes(ctx.from.id)) {
    tournament.players.push(ctx.from.id);
    saveDB();
  }

  await ctx.reply(
    "✅ Siz turnir ishtirokchilari ro‘yxatiga qo‘shildingiz!"
  );
});

// ==================== ADMIN PANELI ====================

bot.action("admin:home", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("Ruxsat yo‘q.", {
      show_alert: true,
    });
  }

  await ctx.answerCbQuery();

  await safeEdit(
    ctx,
    "🛠 <b>BILIM CHARX — ADMIN PANELI</b>\nKerakli bo‘limni tanlang:",
    adminMenu()
  );
});

bot.action("admin:stats", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("Ruxsat yo‘q.", {
      show_alert: true,
    });
  }

  await ctx.answerCbQuery();

  await safeEdit(
    ctx,
    getAdminStatsText(),
    backToAdmin()
  );
});

bot.action(/^admin:ranking:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("Ruxsat yo‘q.", { show_alert: true });
  }

  await ctx.answerCbQuery();
  const page = Number(ctx.match[1]) || 0;
  const result = getAdminRankingPage(page);
  await safeEdit(ctx, result.text, result.keyboard);
});

bot.action("admin:daily", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("Ruxsat yo‘q.", {
      show_alert: true,
    });
  }

  await ctx.answerCbQuery();

  await safeEdit(ctx, getDailyStatsText(), backToAdmin());
});

bot.action("admin:weekly", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.", { show_alert: true });
  await ctx.answerCbQuery();
  await safeEdit(ctx, getWeeklyStatsText(), backToAdmin());
});

bot.action("admin:top", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("Ruxsat yo‘q.", {
      show_alert: true,
    });
  }

  await ctx.answerCbQuery();

  const result = getAdminRankingPage(0);
  await safeEdit(ctx, result.text, result.keyboard);
});

bot.action("admin:questions", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("Ruxsat yo‘q.", {
      show_alert: true,
    });
  }

  await ctx.answerCbQuery();

  const text = [
    `📚 <b>Savollar faylidagi savollar:</b> ${loadQuestions().length}`,
    "",
    getQuestionStatsText(),
  ].join("\n");

  await safeEdit(ctx, text, backToAdmin());
});

bot.action("admin:tournaments", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("Ruxsat yo‘q.", {
      show_alert: true,
    });
  }

  await ctx.answerCbQuery();

  await safeEdit(
    ctx,
    getTournamentText(),
    Markup.inlineKeyboard([
      [
        Markup.button.callback(
          "➕ Turnir yaratish",
          "admin:tournament:create"
        ),
      ],
      [
        Markup.button.callback(
          "⬅️ Admin paneli",
          "admin:home"
        ),
      ],
    ])
  );
});

bot.action("admin:errors", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("Ruxsat yo‘q.", {
      show_alert: true,
    });
  }

  await ctx.answerCbQuery();

  const errors = db.errors.slice(-10).reverse();

  const text = errors.length
    ? [
        "⚠️ <b>OXIRGI XATOLAR</b>",
        "",
        ...errors.map(
          (error, index) =>
            `${index + 1}. ${escapeHTML(error.time)}\n` +
            `${escapeHTML(error.message).slice(0, 700)}`
        ),
      ].join("\n\n")
    : "✅ Hozircha saqlangan xatolar yo‘q.";

  await safeEdit(ctx, text, backToAdmin());
});

bot.action("admin:refresh", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("Ruxsat yo‘q.", {
      show_alert: true,
    });
  }

  await ctx.answerCbQuery("Statistika yangilandi.");

  await safeEdit(
    ctx,
    getAdminStatsText(),
    Markup.inlineKeyboard([
      [
        Markup.button.callback("📅 Kunlik statistika", "admin:daily"),
        Markup.button.callback("🗓 Haftalik statistika", "admin:weekly"),
      ],
      [
        Markup.button.callback(
          "⬅️ Admin paneli",
          "admin:home"
        ),
      ],
    ])
  );
});

// ==================== ADMIN BROADCAST ====================

function broadcastConfirmKeyboard(stage) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Davom etish", `admin:broadcast:confirm:${stage}`)],
    [Markup.button.callback("❌ Bekor qilish", "admin:broadcast:cancel")],
  ]);
}

bot.action("admin:broadcast", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.", { show_alert: true });
  await ctx.answerCbQuery();
  await safeEdit(ctx,
    "📨 <b>OMMAVIY XABAR YUBORISH</b>\n\nBu amal botdagi barcha ro‘yxatdan o‘tgan foydalanuvchilarga xabar yuboradi. Davom etishdan oldin ikki marta tasdiqlashingiz kerak.\n\n<b>1/2 tasdiq:</b> jarayonni boshlaysizmi?",
    broadcastConfirmKeyboard(1)
  );
});

bot.action("admin:broadcast:confirm:1", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.", { show_alert: true });
  await ctx.answerCbQuery();
  await safeEdit(ctx,
    "⚠️ <b>IKKINCHI TASDIQ</b>\n\nXabar barcha ro‘yxatdan o‘tgan foydalanuvchilarga yuboriladi. Yuborilgandan keyin uni qaytarib bo‘lmaydi.\n\n<b>2/2 tasdiq:</b> matn kiritish bosqichiga o‘tasizmi?",
    broadcastConfirmKeyboard(2)
  );
});

bot.action("admin:broadcast:confirm:2", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.", { show_alert: true });
  await ctx.answerCbQuery();
  pendingActions.set(ctx.from.id, { type: "admin_broadcast_text" });
  await safeEdit(ctx, "✍️ <b>XABAR MATNINI YUBORING</b>\n\nOddiy matn yuboring (HTML formatlash qo‘llanmaydi). Maksimal uzunlik: 4 000 belgi. Bekor qilish: /cancel.", backToAdmin());
});

bot.action("admin:broadcast:cancel", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.", { show_alert: true });
  pendingActions.delete(ctx.from.id);
  broadcastDrafts.delete(ctx.from.id);
  await ctx.answerCbQuery("Bekor qilindi.");
  await safeEdit(ctx, "📨 Ommaviy xabar yuborish bekor qilindi.", backToAdmin());
});

bot.action("admin:broadcast:send", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("Ruxsat yo‘q.", { show_alert: true });
  const draft = broadcastDrafts.get(ctx.from.id);
  if (!draft) return ctx.answerCbQuery("Xabar loyihasi topilmadi. Qaytadan boshlang.", { show_alert: true });
  await ctx.answerCbQuery("Yuborish boshlandi.");
  await safeEdit(ctx, "⏳ <b>XABAR YUBORILMOQDA...</b>\n\nIltimos, kuting.", backToAdmin());
  const userIds = Object.keys(db.users);
  let sent = 0;
  let failed = 0;
  for (const id of userIds) {
    try {
      await bot.telegram.sendMessage(id, draft.text, { disable_web_page_preview: true });
      sent++;
    } catch (error) {
      failed++;
      console.error(`Broadcast ${id} ga yuborilmadi:`, error.message);
    }
    // Telegram flood limitlariga yaqinlashmaslik uchun kichik tanaffus.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  broadcastDrafts.delete(ctx.from.id);
  pendingActions.delete(ctx.from.id);
  saveDB();
  await safeEdit(ctx,
    `✅ <b>YUBORISH YAKUNLANDI</b>\n\n👥 Jami: <b>${userIds.length}</b>\n✅ Yuborildi: <b>${sent}</b>\n❌ Yuborilmadi: <b>${failed}</b>`,
    backToAdmin()
  );
});

bot.action("admin:tournament:create", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("Ruxsat yo‘q.", {
      show_alert: true,
    });
  }

  await ctx.answerCbQuery();

  pendingActions.set(ctx.from.id, {
    type: "admin_tournament_name",
  });

  await ctx.reply(
    "Turnir nomini yuboring.\nBekor qilish uchun tugmani bosing yoki /cancel yuboring.",
    Markup.inlineKeyboard([[Markup.button.callback("❌ Bekor qilish", "game:cancel")]])
  );
});

// ==================== PASTKI MENYU TUGMALARI ====================

bot.hears("⚡ Solo", async (ctx) => {
  resetPendingForMenu(ctx);
  if (!(await checkSubscription(ctx))) return;
  if (getActiveRoom(ctx.from.id)) {
    return ctx.reply("Sizda faol o‘yin bor. Avval uni yakunlang yoki xonadan chiqing.", replyMainMenu());
  }
  pendingActions.set(ctx.from.id, { type: "create_questions", maxPlayers: 1, solo: true });
  await ctx.reply("⚡ <b>SOLO REJIMI</b>\n\nYolg‘iz mashq qiling, ochko to‘plang va shaxsiy rekordingizni yangilang.\n\n❓ Nechta savol ishlamoqchisiz?", {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [5, 10, 15].map((n) => Markup.button.callback(`${n} ta savol`, `create:questions:${n}`)),
      [Markup.button.callback("❌ Bekor qilish", "game:cancel")],
    ]),
  });
});

bot.hears("🎮 O‘yin", async (ctx) => {
  resetPendingForMenu(ctx);
  if (!(await checkSubscription(ctx))) return;
  await ctx.reply("🎮 <b>O‘YIN MARKAZI</b>\n\n⚡ <b>Solo</b> — o‘zingiz mashq qiling va rekord o‘rnating.\n⚔️ <b>Jang</b> — do‘stlar bilan bellashing.\n\nRejimni tanlang:", {
    parse_mode: "HTML", ...gameOptionsKeyboard(),
  });
});

bot.hears("⚔️ Jang", async (ctx) => {
  resetPendingForMenu(ctx);
  if (!(await checkSubscription(ctx))) return;
  await ctx.reply("⚔️ <b>JANG MAYDONI</b>\n\n1. Xona yarating.\n2. Xona kodini do‘stlaringizga yuboring.\n3. O‘yinchilar tayyor bo‘lgach, xona egasi jangni boshlaydi.", {
    parse_mode: "HTML", ...gameOptionsKeyboard(),
  });
});

bot.hears("👥 Do‘stlar", async (ctx) => {
  resetPendingForMenu(ctx);
  const username = ctx.botInfo?.username;
  if (!username) return ctx.reply("Taklif havolasini hozir tayyorlab bo‘lmadi. /start ni qayta bosing.", replyMainMenu());
  const link = `https://t.me/${username}?start=ref_${ctx.from.id}`;
  await ctx.reply("👥 <b>DO‘STLARNI TAKLIF QILISH</b>\n\nHavolani do‘stlaringizga yuboring. Ular botga kirib, siz bilan bir xonada bilim bellashuvida qatnashishi mumkin.\n\n" + link, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([[Markup.button.url("📨 Havolani ulashish", `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Bilim Charx’da men bilan bilim bellashuviga qo‘shil!")}`)]]),
  });
});

bot.hears("🏆 Reyting", async (ctx) => {
  resetPendingForMenu(ctx);
  const user = getUser(ctx.from);
  const ranking = Object.values(db.users).sort((a, b) => (b.points || 0) - (a.points || 0));
  const place = ranking.findIndex((item) => Number(item.id) === Number(user.id)) + 1;
  await ctx.reply(`🏆 <b>REYTING</b>\n\nSizning o‘rningiz: <b>${place || "—"}</b> / ${ranking.length}\nOchkolaringiz: <b>${user.points || 0}</b>\n\nBatafsil reyting va profil uchun quyidagi tugmalardan foydalaning.`, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([[Markup.button.callback("📊 To‘liq reyting", "profile:rating"), Markup.button.callback("👤 Profil", "profile:me")]]),
  });
  saveDB();
});

bot.hears("👤 Profil", async (ctx) => {
  resetPendingForMenu(ctx);
  const user = getUser(ctx.from);
  await ctx.reply(getProfileText(user), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("🏆 Reyting", "profile:rating")],
      [Markup.button.callback("🏠 Menyu", "menu:home")],
    ]),
  });
  saveDB();
});

bot.hears("🏆 Turnirlar", async (ctx) => {
  resetPendingForMenu(ctx);
  await ctx.reply("🏆 <b>TURNIRLAR VA OMMAVIY BATTLE</b>\n\nBugungi ommaviy Battle va ochiq turnirlar ro‘yxatini ko‘rish uchun bosing.", {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([[Markup.button.callback("🔎 Turnirlarni ko‘rish", "tournament:list")]]),
  });
});

bot.hears("📖 Yordam", async (ctx) => {
  resetPendingForMenu(ctx);
  await ctx.reply("📖 <b>BILIM CHARX — YORDAM</b>\n\n🎮 O‘yin — xona yaratish yoki kod bilan qo‘shilish.\n⚔️ Jang — do‘stlar bilan bellashuv.\n👥 Do‘stlar — taklif havolasini ulashish.\n🏆 Reyting — ochkolar va o‘rningiz.\n👤 Profil — shaxsiy natijalar.\n🏆 Turnirlar — ommaviy Battle va turnirlar.\n\nBiror jarayonda qolib ketsangiz, /cancel buyrug‘i amalni bekor qiladi, /start esa menyuni qayta ko‘rsatadi.", {
    parse_mode: "HTML", ...replyMainMenu(),
  });
});

bot.hears("🏠 Asosiy menyu", async (ctx) => {
  pendingActions.delete(ctx.from.id);
  ctx.session = {};
  await ctx.reply("🧠 <b>BILIM CHARX</b>\n\nAsosiy menyu tiklandi. Kerakli bo‘limni pastki tugmalardan tanlang.", {
    parse_mode: "HTML", ...replyMainMenu(),
  });
  await ctx.reply("Tezkor amallar:", mainMenu());
});

// ==================== MATN XABARLARINI QAYTA ISHLASH ====================

bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;

  const action = pendingActions.get(ctx.from.id);

  if (action?.type === "join_room") {
    const code = ctx.message.text.trim().toUpperCase();
    const room = rooms[code];

    pendingActions.delete(ctx.from.id);

    if (!room || room.status !== "lobby") {
      return ctx.reply(
        "❌ Xona topilmadi yoki o‘yin allaqachon boshlangan."
      );
    }

    if (getActiveRoom(ctx.from.id)) {
      return ctx.reply("Siz allaqachon faol xonadasiz.");
    }

    if (room.players.length >= room.maxPlayers) {
      return ctx.reply("❌ Bu xona to‘lib bo‘lgan.");
    }

    room.players.push({
      id: ctx.from.id,
      name: getName(ctx.from),
      ready: false,
    });

    getUser(ctx.from);
    recordDailyUser(ctx.from.id);
    saveDB();

    await ctx.reply("✅ Xonaga muvaffaqiyatli qo‘shildingiz!");

    await sendLobby(ctx, room);
    await refreshLobby(room);

    return;
  }

  if (action?.type === "admin_broadcast_text") {
    if (!isAdmin(ctx.from.id)) {
      pendingActions.delete(ctx.from.id);
      return ctx.reply("Ruxsat yo‘q.");
    }
    const text = ctx.message.text.trim();
    if (!text) return ctx.reply("Xabar bo‘sh bo‘lmasligi kerak. Matnni qayta yuboring.");
    if (text.length > 4000) return ctx.reply("Xabar 4 000 belgidan oshmasligi kerak. Qisqartirib qayta yuboring.");
    broadcastDrafts.set(ctx.from.id, { text, createdAt: Date.now() });
    pendingActions.delete(ctx.from.id);
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🚀 Yuborishni tasdiqlash", "admin:broadcast:send")],
      [Markup.button.callback("❌ Bekor qilish", "admin:broadcast:cancel")],
    ]);
    return ctx.reply(
      `👁 <b>XABAR KO‘RINISHI</b>\n\n${escapeHTML(text)}\n\n👥 Qabul qiluvchilar: <b>${Object.keys(db.users).length}</b>\n\nYuborishni yakuniy tasdiqlaysizmi?`,
      { parse_mode: "HTML", ...keyboard }
    );
  }

  if (action?.type === "admin_tournament_name") {
    if (!isAdmin(ctx.from.id)) {
      pendingActions.delete(ctx.from.id);
      return ctx.reply("Ruxsat yo‘q.");
    }

    const name = ctx.message.text.trim().slice(0, 100);
    const id = `T${Date.now().toString(36).toUpperCase()}`;

    db.tournaments[id] = {
      id,
      name,
      status: "open",
      players: [],
      createdAt: new Date().toISOString(),
      createdBy: ctx.from.id,
    };

    pendingActions.delete(ctx.from.id);
    saveDB();

    return ctx.reply(
      `✅ Turnir yaratildi!\n\n🏆 ${escapeHTML(name)}\nID: ${id}`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "▶️ Turnirni boshlash",
              `admin:tournament:start:${id}`
            ),
          ],
          [
            Markup.button.callback(
              "⬅️ Admin paneli",
              "admin:home"
            ),
          ],
        ]),
      }
    );
  }

  if (action) {
    return ctx.reply(
      "Davom etish uchun tugmalardan foydalaning yoki /cancel bosing."
    );
  }
});

// ==================== TURNIRNI BOSHLASH ====================

bot.action(/^admin:tournament:start:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("Ruxsat yo‘q.", {
      show_alert: true,
    });
  }

  const tournament = db.tournaments[ctx.match[1]];

  if (!tournament) {
    return ctx.answerCbQuery("Turnir topilmadi.", {
      show_alert: true,
    });
  }

  tournament.status = "started";
  tournament.startedAt = new Date().toISOString();

  saveDB();

  await ctx.answerCbQuery("Turnir boshlandi.");

  await safeEdit(
    ctx,
    `🏆 <b>${escapeHTML(tournament.name)}</b>\n\n` +
      `Holati: <b>Boshlangan</b>\n` +
      `Ishtirokchilar: <b>${tournament.players.length}</b>`,
    backToAdmin()
  );

  for (const userId of tournament.players) {
    try {
      await bot.telegram.sendMessage(
        userId,
        `🏆 <b>${escapeHTML(tournament.name)}</b> turniri boshlandi!`,
        { parse_mode: "HTML" }
      );
    } catch {
      // Shaxsiy xabar yuborilmasa ham turnir holati saqlanadi.
    }
  }
});


bot.catch(async (error, ctx) => {
  await reportError(error, ctx);
});

// Zaxira xavfsizligi: har 30 soniyada bazani diskka yozib turadi.
const autosaveTimer = setInterval(() => saveDB(), 30_000);
autosaveTimer.unref();

bot.launch()
  .then(() => {
    console.log("🧠 Bilim Charx ishga tushdi.");
    console.log("📁 Ma'lumotlar papkasi:", DATA_DIR);
    console.log("💾 Asosiy baza:", DB_FILE);
    console.log("🛟 Zaxira baza:", DB_BACKUP_FILE);
    console.log("Admin ID'lar:", ADMIN_IDS);
    // Kunlik ommaviy Battle scheduleri vaqtincha o‘chirildi.
    // Turnirlar tugmasi faqat vaqtincha ishlamayotgani haqida xabar beradi.
  })
  .catch((error) => {
    console.error(
      "Botni ishga tushirishda xato:",
      error.message
    );
    process.exit(1);
  });

let isShuttingDown = false;
function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${signal} qabul qilindi. Ma'lumotlar saqlanmoqda...`);
  clearInterval(autosaveTimer);
  saveDB();
  bot.stop(signal);
}

process.once("SIGINT", () => gracefulShutdown("SIGINT"));
process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
