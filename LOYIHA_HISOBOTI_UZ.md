# Bilim Charx 2.1 — loyiha holati

## Qaror
Telegram Mini App va unga bog'liq Express API olib tashlandi. Asosiy mahsulot — oddiy Telegram bot.

## Saqlangan qismlar
- `bot.js`: Telegram bot, o'yin xonalari, profil, reyting, turnirlar, admin boshqaruvi va ommaviy battle.
- `test.json`: 5 000 ta savol.
- `validate-questions.js`: savollar bazasini tekshirish.

## Olib tashlangan qismlar
- `social-miniapp.js`
- `public/index.html`, `public/style.css`, `public/app.js`
- Mini App tugmalari, `/app` buyrug'i va Web App menyu sozlamasi
- Express dependency va `WEBAPP_URL` sozlamasi

## Ishga tushirish
`npm install` va `npm start`, yoki `node bot.js`.

## Keyingi rivojlantirish taklifi
Botni shunchaki savol-javobdan ko'ra, do'stlar bilan tezkor duel, kundalik missiyalar, XP/level tizimi, ligalar va haftalik mavsumlardan iborat ijtimoiy quiz o'yiniga aylantirish. Bularning barchasi Telegram tugmalari va xabarlar orqali ishlashi mumkin — Mini App shart emas.
