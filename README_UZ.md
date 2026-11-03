# Bilim Charx 2.2 — Telegram bot

Bilim Charx — Telegram ichida ishlaydigan savol-javob, xona orqali jamoaviy o‘yin, reyting va turnir boti. Mini App va Express web-server talab qilinmaydi.

## Nimalar bor?
- Telegram chatining pastida qoladigan doimiy Reply Keyboard menyusi
- Solo rejimi: 5/10/15 savol, fan va qiyinlikni tanlash; natija va rekordni saqlash
- O‘yin xonasi yaratish, xona kodi orqali qo‘shilish, tayyorlik va xonadan chiqish
- O‘yin davomida “O‘yinni tark etish” tugmasi
- Savollar soni, fan va qiyinlikni tanlash
- Profil, ochkolar, g‘alabalar, darajalar, yutuq nishonlari va reyting
- Solo o‘yinlar soni va shaxsiy rekord
- Do‘stlarni taklif qilish havolasi
- Ommaviy Battle rejalashtirgichi va turnirlar
- Admin paneli, statistika, savollar statistikasi va xatolar hisoboti
- `test.json` ichidagi mavjud 5 000 savol saqlangan
- Matn kiritish jarayonidan menyu orqali chiqish va /cancel bilan bekor qilish
- Xona egasi bo‘lmagan foydalanuvchiga “O‘yinni boshlash” tugmasi berilmaydi

## Windows’da ishga tushirish
1. Node.js 20 LTS yoki yangirog‘ini o‘rnating.
2. Ushbu papkada terminal oching.
3. `.env.example` nusxasini `.env` deb nomlang.
4. `.env` ichida `BOT_TOKEN` qiymatini BotFather’dan olingan token bilan to‘ldiring. `ADMIN_IDS` ga administratorning Telegram raqamli ID sini kiriting.
5. Ishga tushiring:

```powershell
npm install
npm start
```

Kod va savollar bazasini tekshirish:

```powershell
npm run check
npm run validate:questions
```

## Ma'lumotlar qayerda saqlanadi? (lokal kompyuter)

Botni hosting qilmasdan, Windows kompyuteringizda ishlatsangiz, foydalanuvchi profillari, ochkolar, Solo rekordlari, reyting va o'yin statistikasi loyiha ichidagi `data` papkasida saqlanadi:

- `data/quiz-data.json` — asosiy ma'lumotlar bazasi.
- `data/quiz-data.backup.json` — oldingi yaroqli holatning zaxira nusxasi.

Bot terminalida ishga tushganda aniq saqlash yo'li ham ko'rsatiladi. Ma'lumotlar o'zgarganida kod bazani saqlaydi, qo'shimcha ravishda har 30 soniyada avtomatik saqlash ishlaydi. Botni `Ctrl+C` bilan to'xtatsangiz, yopilishidan oldin ham saqlashga urinadi. Asosiy fayl buzilgan bo'lsa, ishga tushishda zaxira nusxasidan tiklashga harakat qiladi.

**Muhim:** ma'lumotlar saqlanishi uchun `data` papkasini o'chirmang. Kompyuterni almashtirsangiz yoki loyihani boshqa papkaga ko'chirsangiz, botni to'xtatib, butun `data` papkasini ham birga ko'chiring. Vaqti-vaqti bilan bu papkaning alohida nusxasini boshqa joyga olib qo'yish tavsiya etiladi. Zaxira nusxasi disk buzilishi yoki kompyuter yo'qolishidan to'liq himoya qilmaydi.

## Botni doimiy ishlatish
Kompyuteringiz o‘chiq bo‘lsa, `node bot.js` ishlamaydi. Botni 24/7 ishlatish uchun hosting kerak. Loyihada `render.yaml` tayyor:

1. Loyihani GitHub repository’ga yuklang.
2. Render’da **New + → Blueprint** orqali shu repository’ni ulang.
3. `BOT_TOKEN` va `ADMIN_IDS` environment qiymatlarini kiriting.
4. Deploy tugashini kuting. `autoDeploy: true` sabab `main` branch’ga yangi commit yuborilganda Render qayta deploy qiladi.
5. Background Worker ishga tushgach, bot hostingda ishlaydi va jarayon yiqilsa Render uni qayta ishga tushiradi.

`render.yaml` persistent diskdan foydalanadi (`/var/data`), shuning uchun `quiz-data.json` va uning zaxirasi shu joyda saqlanadi. Render’dagi doimiy disk va worker tanlangan tarifga qarab to‘lov talab qilishi mumkin; tarif va narxni deploy qilishdan oldin tekshiring.

## Muhim xavfsizlik
- `.env` va bot tokenini hech kimga yubormang va GitHub’ga yuklamang.
- Bitta token bilan bir vaqtning o‘zida faqat bitta polling nusxasi ishlasin. Lokal kompyuterda ham, Render’da ham bir vaqtda ishga tushirilsa, Telegram polling to‘qnashuvi yuz berishi mumkin.
- Kod sintaksisi va savollar validatsiyasi tekshirildi. Haqiqiy Telegram tokeni, hosting va bir nechta foydalanuvchi bilan to‘liq jonli sinov alohida bajarilishi kerak.

## 100 darajali tizim (2.5)

O‘yin darajasi foydalanuvchining mavjud ochko/XP qiymatidan hisoblanadi: har 500 XP yangi daraja beradi. Daraja 100 bilan cheklangan. Har 10 darajada maxsus unvon va belgi ko‘rsatiladi; profil va reyting sahifalarida joriy unvon hamda keyingi darajagacha qolgan XP aks etadi. Mavjud ochkolar o‘zgartirilmaydi.

## `.env` sozlash

ZIP ichida maxfiy token saqlanmaydi. `.env.example` faylidan nusxa olib, nusxasini `.env` deb nomlang va `BOT_TOKEN` hamda `ADMIN_IDS` qiymatlarini o‘zingiz kiriting.
