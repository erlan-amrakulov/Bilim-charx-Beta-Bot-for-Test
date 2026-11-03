# Bilim Charx 2.4 — Ma'lumotlarni ishonchli saqlash

- Lokal ma'lumotlar `data/quiz-data.json` ichida saqlanadi.
- Har bir saqlashdan oldin oldingi yaroqli baza `data/quiz-data.backup.json` ga zaxiralanadi.
- Har 30 soniyada avtomatik saqlash qo'shildi.
- `SIGINT`/`SIGTERM` kelganda yopilishdan oldin yakuniy saqlashga urinadi.
- Asosiy baza o'qilmasa, zaxira fayldan tiklashga harakat qiladi.
- Konsolda ma'lumotlar bazasi va zaxira faylining to'liq yo'li ko'rsatiladi.
- 5 000 savollik mavjud `test.json` o'zgartirilmadi.
