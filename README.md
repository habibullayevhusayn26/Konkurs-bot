# Telegram NFT Gift Referral Bot

Do‘stlarni taklif qilgan foydalanuvchining referral balansini kuzatadigan Telegram bot va Mini App. Foydalanuvchi balans yetadigan NFT giftni tanlab, admin’ga so‘rov yuboradi. Admin so‘rovni qabul qilgach sovg‘ani qo‘lda topshiradi. Guruh moderatsiyasi va guruh funksiyalari bu versiyada mavjud emas.

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
- Mini App balans yetadigan NFT sovg‘alarni ko‘rsatadi. Katalogdagi har bir sovg‘a cheksiz so‘ralishi mumkin; bir xil katalog sovg‘asiga bir necha marta buyurtma berish mumkin. Foydalanuvchi sovg‘ani tanlab so‘rov yuboradi va admin bot orqali xabar oladi.
- Admin so‘rovni qabul qilganda ball sarflanadi; rad qilganda ball sarflanmaydi. Har bir qabul qilingan so‘rov uchun admin sovg‘ani qo‘lda topshiradi.
- Mini App Telegram `initData` imzosini serverda tekshiradi va eskirgan imzolarni rad etadi.
- Mini App’da NFT’larning haqiqiy rasmi, modeli va seriya raqami ko‘rsatiladi. Sovg‘a tafsilotida egasining shaxsiy ma’lumoti oshkor qilinmaydi. NFT rasmi `nft.fragment.com` manzilidan yuklanadi; oddiy Stars gift katalogidan foydalanilmaydi.

## Haqiqiy NFT sovg‘alar

Admin panelidagi **NFT sovg‘alarini boshqarish** bo‘limidan `https://t.me/nft/Model-123` formatidagi haqiqiy collectible NFT havolasini qo‘shing. Fragment’dagi gift sahifasi havolasi ham qabul qilinadi. Keyin narxni referral ballarda kiriting. Bot Fragment’dan rasm mavjudligini tekshiradi, lekin havola NFT sizga tegishli ekanini tasdiqlamaydi. Faqat o‘zingiz egalik qiladigan va sovg‘a qila oladigan NFT’larni kiriting.

Katalogdagi sovg‘a uchun so‘rovlar soni cheklanmagan; bir xil katalog sovg‘asini bir nechta foydalanuvchi so‘rashi mumkin. Haqiqiy NFT’lar noyob bo‘lgani uchun admin har bir qabul qilingan so‘rovga mos alohida sovg‘ani qo‘lda topshirishi kerak. Bir foydalanuvchida admin ko‘rib chiqayotgan so‘rov bo‘lsa, admin qaroriga qadar yana bir so‘rov yubora olmaydi.

## Admin panel

Bot egasining shaxsiy chatida `/admin` yuboring:

- **Referral statistikasi** — foydalanuvchilar, tasdiqlangan takliflar va kutilayotgan so‘rovlar.
- **NFT sovg‘alarini boshqarish** — haqiqiy NFT havolasini va ball narxini qo‘shish yoki katalogdan olib tashlash.
- **NFT so‘rovlari** — foydalanuvchi so‘rovini qabul qilish yoki rad etish. So‘rov xabari admin’ga bot orqali ham yuboriladi.
- **Majburiy obuna kanallari** — kanal qo‘shish, tahrirlash yoki o‘chirish. Obunani tekshirish uchun bot kanal administratori bo‘lishi kerak.

`OWNER_ID` raqamli Telegram user ID bo‘lishi kerak. Ommaviy kanal username’ini (`@kanal`) yoki yopiq kanal uchun `-100... https://t.me/+invite` ko‘rinishida kiriting.

## Ma’lumotlar bazasi

Bot `required_channels`, `campaign_users`, `qualified_referrals`, `referral_rewards`, `gift_requests`, `campaign_prizes` va `bot_recipients` MongoDB collection’laridan foydalanadi. Mavjud botdan saqlangan kanal sozlamalari qayta ishlatiladi. Referral mukofotlari, NFT sovg‘a fondi va `campaign_users` yozuvlari kampaniyaga tegishli.

Bot tokeni va MongoDB parolini `.env` faylida saqlang va uni hech qachon ommaviy repository’ga joylamang.
# Konkurs-bot
