# Telegram NFT Gift Referral Bot

Do‘stlarni taklif qilgan foydalanuvchining referral balansini kuzatadigan Telegram bot va Mini App. Foydalanuvchi referral ballga NFT yoki Premium mukofot so‘rashi, shuningdek Telegram Stars orqali 3, 6 yoki 12 oylik Telegram Premium sotib olishi mumkin. Pulli Premium to‘lovi tasdiqlangach bot obunani avtomatik sovg‘a qiladi. Guruh moderatsiyasi va guruh funksiyalari bu versiyada mavjud emas.

## Talablar

- Node.js 22 yoki undan yangiroq
- BotFather orqali yaratilgan Telegram bot
- MongoDB Atlas yoki boshqa MongoDB server
- Mini App uchun ommaviy HTTPS manzil (masalan, VPS/reverse proxy yoki HTTPS hosting)

## O‘rnatish

```powershell
Copy-Item .env.example .env
notepad .env
npm.cmd install
npm.cmd start
```

`.env` faylida `BOT_TOKEN`, `OWNER_ID`, `MONGODB_URI`, `MONGODB_DB`, `PORT` va `WEB_APP_URL`-ni sozlang. `WEB_APP_URL` serverning `public` Mini App fayllarini HTTPS orqali ochadigan manzil bo‘lishi shart; u BotFather’da Mini App launch URL sifatida ham sozlanishi kerak. Node serveri HTTP’da `PORT` portini tinglaydi; internetga chiqarishda HTTPS reverse proxy yoki HTTPS hosting ishlating.

Bot va Mini App bir xil domen orqali xizmat qilishi kerak, chunki Mini App API so‘rovlari shu origin’ga yuboriladi. `WEB_APP_URL`-ni oxirida `/` bilan kiriting. Bot webhook emas, Telegram long polling ishlatadi.

## Referral qoidasi

- Har foydalanuvchi uchun taklif havolasi `https://t.me/<bot>?start=ref_<telegram_id>` ko‘rinishida yaratiladi.
- Taklif faqat botning shaxsiy chatida ilgari qayd etilmagan yangi foydalanuvchi `/start` bosib, barcha majburiy kanallarga obuna bo‘lgach hisoblanadi.
- Bir Telegram akkaunti faqat bir marta hisoblanadi; o‘zini taklif qilish hisoblanmaydi.
- Har bir tasdiqlangan referral foydalanuvchi balansiga 1 ball qo‘shadi.
- Referral kanal obunasini tasdiqlab hisoblangach, taklif qilgan foydalanuvchiga yangi foydalanuvchining Telegram profiliga ochiladigan ismтэй мэдэгдэл очно.
- Botdagi **Bonuslar** bo‘limida bonus kanaliga obunani tekshirtirib bir marta 3 ball, so‘ng har 24 soatda 2 ball kunlik bonus olish mumkin. Bonus ballari referral ballari bilan birga sarflanadi.
- Mini App va bot foydalanuvchiga balansni ko‘rish, referral havolasini ulashish hamda NFT yoki Telegram Premium sovg‘alariga so‘rov yuborish imkonini beradi. Bot buyruqlari: `/balance`, `/invite`, `/prizes` va `/bonus`.
- Botdagi **Sotib olish** bo‘limida 3 oylik Premium 1000 Stars, 6 oylik 1500 Stars va 12 oylik 2500 Stars turadi. To‘lov Telegram Stars (XTR) orqali olinadi va muvaffaqiyatli to‘lovdan keyin `giftPremiumSubscription` orqali avtomatik topshiriladi.
- Telegram Bot API avtomatik Premium sovg‘asini faqat 3, 6 yoki 12 oyga qo‘llaydi. Bot foydalanuvchining Stars balansiga haqiqiy Stars yubora olmaydi; shu sabab Stars sotish/yuborish va 1 yoki 2 oylik Premium xaridi mavjud emas.
- Katalogdagi sovg‘alar, jumladan Premium obunalari, referral ball narxi bilan ko‘rsatiladi. Admin so‘rovni qabul qilganda ball sarflanadi; rad qilganda ball sarflanmaydi. Har bir qabul qilingan sovg‘ani admin qo‘lda topshiradi.
- Botga yangi foydalanuvchi birinchi marta `/start` yuborganda barcha adminlarga xabar boradi.
- Mini App Telegram `initData` imzosini serverda tekshiradi va eskirgan imzolarni rad etadi.
- Mini App’da NFT’larning haqiqiy rasmi, modeli va seriya raqami ko‘rsatiladi. Sovg‘a tafsilotida egasining shaxsiy ma’lumoti oshkor qilinmaydi. NFT rasmi `nft.fragment.com` manzilidan yuklanadi; oddiy Stars gift katalogidan foydalanilmaydi.

## Haqiqiy NFT sovg‘alar

Admin panelidagi **NFT sovg‘alarini boshqarish** bo‘limidan `https://t.me/nft/Model-123` formatidagi haqiqiy collectible NFT havolasini qo‘shing. Fragment’dagi gift sahifasi havolasi ham qabul qilinadi. Keyin narxni referral ballarda kiriting. Bot Fragment’dan rasm mavjudligini tekshiradi, lekin havola NFT sizga tegishli ekanini tasdiqlamaydi. Faqat o‘zingiz egalik qiladigan va sovg‘a qila oladigan NFT’larni kiriting.

Katalogdagi sovg‘a uchun so‘rovlar soni cheklanmagan; bir xil katalog sovg‘asini bir nechta foydalanuvchi so‘rashi mumkin. Haqiqiy NFT’lar noyob bo‘lgani uchun admin har bir qabul qilingan so‘rovga mos alohida sovg‘ani qo‘lda topshirishi kerak. Bir foydalanuvchida admin ko‘rib chiqayotgan so‘rov bo‘lsa, admin qaroriga qadar yana bir so‘rov yubora olmaydi.

## Admin panel

Bot egasi yoki qo‘shimcha admin shaxsiy chatda `/admin` yuboradi:

- **Referral statistikasi** — foydalanuvchilar, tasdiqlangan takliflar va kutilayotgan so‘rovlar.
- **Ommaviy xabar** — avval media yoki fayl yuboring (`/skip` bilan mediasiz davom etish mumkin), keyin izoh matnini kiriting; media, Telegram formatlashi, premium emoji va inline tugmalar bitta xabar bo‘lib yuboriladi. Media bilan izoh 1024 belgigacha, mediasiz matn 4096 belgigacha bo‘lishi mumkin. Tugmaga havola, botning `/start`, `/help`, `/balance`, `/invite`, `/prizes`, `/bonus` buyruqlaridan biri yoki qalqib chiquvchi xabar biriktiriladi; har bir tugmaning ko‘k, yashil yoki qizil rangini tanlash va premium emoji belgisini qo‘shish mumkin. Bot xabar preview’ini ko‘rsatib, auditoriya sonini bildiradi; admin tasdiqlagandan keyin yuboradi.
- **NFT sovg‘alarini boshqarish** — haqiqiy NFT havolasini va ball narxini qo‘shish yoki katalogdan olib tashlash.
- **Sovg‘a so‘rovlari** — foydalanuvchi so‘rovini qabul qilish yoki rad etish. So‘rov xabari barcha adminlarga bot orqali yuboriladi.
- **Foydalanuvchini qidirish** — Telegram ID orqali foydalanuvchini topib, uning referral balansiga ball qo‘shish yoki yetarli balans bo‘lsa ayirish mumkin.
- **Telegram Premium sovg‘asi** — 1, 3, 6 yoki 12 oylik Premium mukofot qo‘shib, referral ball narxini belgilang. Tasdiqlangan Premium so‘rovini admin Telegram orqali qo‘lda sovg‘a qiladi.
- **Majburiy obuna kanallari** — kanal qo‘shish, tahrirlash yoki o‘chirish. Obunani tekshirish uchun bot kanal administratori bo‘lishi kerak.
- **Bonuslar va promokodlar** — bonus uchun alohida kanal ulash, promokod beradigan ball va foydalanish limitini belgilash. Kanal postida qolgan foydalanishlar soni ko‘rsatiladi va har bir muvaffaqiyatli ishlatilganda yangilanadi; limit tugaganda ishlatish tugmasi olib tashlanadi. Promokod havolasini ochgan foydalanuvchiga odatiy `/start` xabari o‘rniga promokod natijasi yuboriladi. Bot bonus kanalida administrator bo‘lishi kerak.
- **Adminlarni boshqarish** — faqat bot egasi qo‘shimcha adminlarni raqamli Telegram ID orqali qo‘shishi yoki olib tashlashi va har bir admin uchun statistika, xabar yuborish, sovg‘alar, foydalanuvchilar, kanallar hamda bonuslar bo‘limi huquqlarini alohida yoqib-o‘chirishi mumkin. Yangi admin barcha bo‘limlarga ruxsat bilan qo‘shiladi; eski admin yozuvlari ham avvalgi ishlash tartibini saqlash uchun barcha bo‘limlarga ruxsatli hisoblanadi. Huquqlar nafaqat panelda, amallar bajarilishida ham tekshiriladi. Bot egasining huquqlari o‘zgarmaydi.
`OWNER_ID` raqamli Telegram user ID bo‘lishi kerak. Ommaviy kanal username’ini (`@kanal`) yoki yopiq kanal uchun `-100... https://t.me/+invite` ko‘rinishida kiriting.
Qo‘shimcha adminlar bot egasining `/admin` panelidan boshqariladi; ular botni avval `/start` qilib ochishi kerak, aks holda Telegram ularga shaxsiy xabar yuborishga ruxsat bermaydi.

## Ma’lumotlar bazasi

Bot `bot_admins`, `blocked_users`, `required_channels`, `bonus_settings`, `bonus_promos`, `bonus_promo_redemptions`, `campaign_users`, `qualified_referrals`, `referral_rewards`, `gift_requests`, `campaign_prizes`, `purchase_orders` va `bot_recipients` MongoDB collection’laridan foydalanadi. `campaign_users` bonus ballari, admin tomonidan qo‘lda kiritilgan balans tuzatishi va bonus olish vaqtlarini saqlaydi; `bonus_promos` limitli promokodlarni, `bonus_promo_redemptions` esa foydalangan userlarni saqlaydi. `purchase_orders` pulli Premium xaridlarining to‘lov va topshirish holatini saqlaydi. Referral mukofotlari va `campaign_users` yozuvlari kampaniyaga tegishli.

Bot tokeni va MongoDB parolini `.env` faylida saqlang va uni hech qachon ommaviy repository’ga joylamang.
# Konkurs-bot
