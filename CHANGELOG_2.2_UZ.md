# Bilim Charx 2.2 — o‘zgarishlar

- Doimiy pastki menyu qo‘shildi: O‘yin, Jang, Do‘stlar, Reyting, Profil, Turnirlar, Yordam va Asosiy menyu.
- Menyu orqali yangi bo‘limga o‘tilganda oldingi matn-kiritish holati bekor qilinadi.
- Xona kodi kiritish va turnir nomi yozish jarayonlariga aniq bekor qilish tugmasi qo‘shildi.
- Xona lobbi tugmalari foydalanuvchi bo‘yicha ajratildi: boshlash faqat xona egasiga ko‘rinadi; boshqa o‘yinchilar tayyorlik va chiqish tugmalaridan foydalanadi.
- Render konfiguratsiyasida auto-deploy yoqildi.
- `test.json` dagi mavjud 5 000 savol saqlandi.

## Tekshiruv
- `node --check bot.js` — muvaffaqiyatli.
- `node validate-questions.js` — 5 000 savol tekshiruvdan o‘tdi.
- Tarmoq/install cheklovi sabab real Telegram tokeni bilan jonli sinov bu muhitda bajarilmadi.
