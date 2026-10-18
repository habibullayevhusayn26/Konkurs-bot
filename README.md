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
- Mini App va bot foydalanuvchiga balansni ko‘rish, referral havolasini ulashish hamda NFT yoki Telegram Premium sovg‘alariga so‘rov yuborish imkonini beradi. Bot buyruqlari: `/balance`, `/invite` va `/prizes`.
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
- **NFT sovg‘alarini boshqarish** — haqiqiy NFT havolasini va ball narxini qo‘shish yoki katalogdan olib tashlash.
- **Sovg‘a so‘rovlari** — foydalanuvchi so‘rovini qabul qilish yoki rad etish. So‘rov xabari barcha adminlarga bot orqali yuboriladi.
- **Telegram Premium sovg‘asi** — 1, 3, 6 yoki 12 oylik Premium mukofot qo‘shib, referral ball narxini belgilang. Tasdiqlangan Premium so‘rovini admin Telegram orqali qo‘lda sovg‘a qiladi.
- **Majburiy obuna kanallari** — kanal qo‘shish, tahrirlash yoki o‘chirish. Obunani tekshirish uchun bot kanal administratori bo‘lishi kerak.
- **Adminlarni boshqarish** — faqat bot egasi qo‘shimcha adminlarni raqamli Telegram ID orqali qo‘shishi yoki olib tashlashi mumkin. Qo‘shimcha adminlar so‘rovlarni ko‘rib chiqadi va boshqa admin bo‘limlaridan foydalanadi; bot egasining huquqi saqlanib qoladi.

`OWNER_ID` raqamli Telegram user ID bo‘lishi kerak. Ommaviy kanal username’ini (`@kanal`) yoki yopiq kanal uchun `-100... https://t.me/+invite` ko‘rinishida kiriting.
Qo‘shimcha adminlar bot egasining `/admin` panelidan boshqariladi; ular botni avval `/start` qilib ochishi kerak, aks holda Telegram ularga shaxsiy xabar yuborishga ruxsat bermaydi.

## Ma’lumotlar bazasi

Bot `bot_admins`, `blocked_users`, `required_channels`, `campaign_users`, `qualified_referrals`, `referral_rewards`, `gift_requests`, `campaign_prizes`, `purchase_orders` va `bot_recipients` MongoDB collection’laridan foydalanadi. `campaign_prizes` referral mukofotlarini, `purchase_orders` esa pulli Premium xaridlarining to‘lov va topshirish holatini saqlaydi. Mavjud botdan saqlangan kanal sozlamalari qayta ishlatiladi. Referral mukofotlari va `campaign_users` yozuvlari kampaniyaga tegishli.

Bot tokeni va MongoDB parolini `.env` faylida saqlang va uni hech qachon ommaviy repository’ga joylamang.
# Konkurs-bot
