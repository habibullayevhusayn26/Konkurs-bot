require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN is required. Set it in your .env file.');
}
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error('MONGODB_URI is required. Set it in your .env file.');
}
const OWNER_ID = process.env.OWNER_ID || '';
if (OWNER_ID && !/^\d+$/.test(OWNER_ID)) {
  throw new Error('OWNER_ID must be the numeric Telegram user ID of the bot owner.');
}

const PORT = Number(process.env.PORT || 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const WEB_APP_URL = process.env.WEB_APP_URL || '';
if (WEB_APP_URL) {
  let parsedUrl;
  try {
    parsedUrl = new URL(WEB_APP_URL);
  } catch {
    throw new Error('WEB_APP_URL must be a valid HTTPS URL.');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('WEB_APP_URL must use HTTPS.');
  }
  if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash || parsedUrl.username || parsedUrl.password) {
    throw new Error('WEB_APP_URL must be the HTTPS root URL, for example https://your-domain.example/.');
  }
}

const mongoClient = new MongoClient(MONGODB_URI);
const bot = new Telegraf(BOT_TOKEN);
const ownerSessions = new Map();
let collections;
let botUsername;

async function initializeDatabase() {
  await mongoClient.connect();
  const database = mongoClient.db(process.env.MONGODB_DB || 'telegram_moderation');
  collections = {
    admins: database.collection('bot_admins'),
    blockedUsers: database.collection('blocked_users'),
    channels: database.collection('required_channels'),
    campaignUsers: database.collection('campaign_users'),
    referrals: database.collection('qualified_referrals'),
    rewards: database.collection('referral_rewards'),
    prizes: database.collection('campaign_prizes'),
    giftRequests: database.collection('gift_requests'),
    previousRecipients: database.collection('bot_recipients'),
  };
  await collections.referrals.createIndex({ inviter_id: 1 });
  await collections.rewards.createIndex({ status: 1, created_at: 1 });
  await collections.giftRequests.createIndex(
    { user_id: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' } },
  );
  await collections.giftRequests.createIndex({ status: 1, created_at: 1 });
}

function isOwner(ctx) {
  return Boolean(OWNER_ID) && ctx.from && String(ctx.from.id) === OWNER_ID;
}

async function isAdmin(ctx) {
  if (!ctx.from) return false;
  const userId = String(ctx.from.id);
  return userId === OWNER_ID || Boolean(await collections.admins.findOne({ _id: userId }));
}

async function getAdminIds() {
  const admins = await collections.admins.find().project({ _id: 1 }).toArray();
  return [...new Set([OWNER_ID, ...admins.map((admin) => admin._id)].filter(Boolean))];
}

async function notifyAdmins(text, keyboard, options = {}) {
  const adminIds = await getAdminIds();
  text = stripBotEmojis(text, options);
  const message = telegramMessage(text, options);
  const results = await Promise.all(adminIds.map(async (adminId) => {
    try {
      await bot.telegram.sendMessage(Number(adminId), message.text, { ...(keyboard || {}), ...message.options });
      return true;
    } catch (error) {
      console.error(`Could not notify admin ${adminId}:`, error);
      return false;
    }
  }));
  return results.some(Boolean);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

const PREMIUM_EMOJI_ID = '5393380387105827492';
const BOT_EMOJI_PATTERN = /(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?\p{Emoji_Modifier}?)*)|(?:\p{Regional_Indicator}{2})|(?:[#*0-9]\uFE0F?\u20E3)/gu;

function stripBotEmojis(value, options = {}) {
  if (typeof value !== 'string') return value;
  const premiumEmoji = options.entities
    && options.entities.some((entity) => entity.type === 'custom_emoji' && entity.offset === 0 && entity.length === 2);
  const prefix = premiumEmoji ? value.slice(0, 2) : '';
  let text = premiumEmoji ? value.slice(2) : value;
  const premiumTags = [];
  text = text.replace(/<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>/gi, (tag) => {
    const placeholder = `\u0000PREMIUM_EMOJI_${premiumTags.length}\u0000`;
    premiumTags.push(tag);
    return placeholder;
  });
  text = text
    .replace(BOT_EMOJI_PATTERN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;!?])/g, '$1');
  text = text.replace(/\u0000PREMIUM_EMOJI_(\d+)\u0000/g, (_, index) => premiumTags[Number(index)]);
  return prefix ? `${prefix}${text}` : text.trim();
}

function telegramMessage(text, options = {}) {
  text = stripBotEmojis(text, options);
  const hasPremiumEmojiPrefix = options.entities
    ? options.entities.some((entity) => entity.type === 'custom_emoji' && entity.offset === 0 && entity.length === 2)
    : options.parse_mode === 'HTML' && /^<tg-emoji\b[^>]*>/.test(text);
  if (!/premium/i.test(text) || hasPremiumEmojiPrefix) return { text, options };
  const existingEntities = options.entities || [];
  if (options.parse_mode === 'HTML') {
    return {
      text: `<tg-emoji emoji-id="${PREMIUM_EMOJI_ID}">⭐️</tg-emoji> ${text}`,
      options,
    };
  }
  if (options.parse_mode) return { text: `⭐️ ${text}`, options };
  return {
    text: `⭐️ ${text}`,
    options: {
      ...options,
      entities: [
        { type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: PREMIUM_EMOJI_ID },
        ...existingEntities.map((entity) => ({ ...entity, offset: entity.offset + 2 })),
      ],
    },
  };
}

async function replyText(ctx, text, extra) {
  text = stripBotEmojis(text, extra || {});
  const message = telegramMessage(text, extra || {});
  if (!/premium/i.test(text)) {
    return extra === undefined ? ctx.reply(text) : ctx.reply(text, extra);
  }
  return ctx.reply(message.text, message.options);
}

async function editText(ctx, text, extra) {
  text = stripBotEmojis(text, extra || {});
  const message = telegramMessage(text, extra || {});
  if (!/premium/i.test(text)) {
    return ctx.editMessageText(text, extra);
  }
  return ctx.editMessageText(message.text, message.options);
}

async function sendText(telegram, chatId, text, extra) {
  text = stripBotEmojis(text, extra || {});
  const message = telegramMessage(text, extra || {});
  if (!/premium/i.test(text)) {
    return extra === undefined
      ? telegram.sendMessage(chatId, text)
      : telegram.sendMessage(chatId, text, extra);
  }
  return telegram.sendMessage(chatId, message.text, message.options);
}

async function isUserBlocked(userId) {
  return Boolean(await collections.blockedUsers.findOne({ _id: String(userId) }));
}

function isSubscribedMember(member) {
  return ['creator', 'administrator', 'member'].includes(member.status)
    || (member.status === 'restricted' && member.is_member);
}

async function getRequiredChannels() {
  return collections.channels.find().sort({ created_at: 1 }).toArray();
}

async function isSubscribedToRequiredChannels(userId) {
  const channels = await getRequiredChannels();
  for (const channel of channels) {
    const member = await bot.telegram.getChatMember(channel.channel_id, userId);
    if (!isSubscribedMember(member)) return false;
  }
  return true;
}

async function saveRequiredChannel(channel) {
  await collections.channels.updateOne(
    { _id: channel.channel_id },
    {
      $set: {
        channel_id: channel.channel_id,
        invite_url: channel.invite_url,
        title: channel.title,
        updated_at: new Date(),
      },
      $setOnInsert: { created_at: new Date() },
    },
    { upsert: true },
  );
}

function parseChannelInput(text) {
  const [channelInput, inviteUrl, ...extra] = text.trim().split(/\s+/);
  if (!channelInput || extra.length) {
    throw new Error('Kanalni @username yoki -100... ID ko‘rinishida, kerak bo‘lsa taklif havolasi bilan yuboring.');
  }
  const channelId = channelInput.startsWith('@') || channelInput.startsWith('-')
    ? channelInput
    : `@${channelInput}`;
  if (!/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(channelId) && !/^-100\d+$/.test(channelId)) {
    throw new Error('Kanal username yoki ID formati noto‘g‘ri.');
  }
  if (inviteUrl && !/^https:\/\/(?:t\.me|telegram\.me)\/[A-Za-z0-9_+/-]+$/i.test(inviteUrl)) {
    throw new Error('Taklif havolasi https://t.me/... formatida bo‘lishi kerak.');
  }
  if (channelId.startsWith('-') && !inviteUrl) {
    throw new Error('Yopiq kanal ID’sidan keyin taklif havolasini ham yuboring.');
  }
  return { channel_id: channelId, invite_url: inviteUrl };
}

async function saveChannelFromOwner(ctx, rawText, oldChannelId) {
  const channel = parseChannelInput(rawText);
  const member = await ctx.telegram.getChatMember(channel.channel_id, ctx.botInfo.id);
  if (!['creator', 'administrator'].includes(member.status)) {
    throw new Error('Bot avval kanal administratori bo‘lishi kerak.');
  }
  const chat = await ctx.telegram.getChat(channel.channel_id);
  channel.title = chat.title || channel.channel_id;
  if (!channel.invite_url && chat.username) {
    channel.invite_url = `https://t.me/${chat.username}`;
  }
  if (!channel.invite_url) {
    throw new Error('Kanal uchun taklif havolasini aniqlab bo‘lmadi.');
  }
  if (oldChannelId && oldChannelId !== channel.channel_id) {
    await collections.channels.deleteOne({ _id: oldChannelId });
  }
  await saveRequiredChannel(channel);
}

async function ensureCampaignUser(user, referralPayload = '') {
  const userId = String(user.id);
  const existing = await collections.campaignUsers.findOne({ _id: userId });
  if (existing) {
    await collections.campaignUsers.updateOne(
      { _id: userId },
      {
        $set: {
          first_name: user.first_name || '',
          last_name: user.last_name || '',
          username: user.username || null,
          last_seen_at: new Date(),
        },
      },
    );
    return false;
  }

  const oldRecipient = await collections.previousRecipients.findOne({ _id: `user:${userId}` });
  const match = /^ref_(\d{1,20})$/.exec(referralPayload);
  const parsedInviterId = match ? Number(match[1]) : null;
  const inviterId = Number.isSafeInteger(parsedInviterId)
      && parsedInviterId > 0
      && String(parsedInviterId) !== userId
    ? String(parsedInviterId)
    : null;
  const account = {
    _id: userId,
    user_id: userId,
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    username: user.username || null,
    referred_by: oldRecipient ? null : inviterId,
    campaign_new: !oldRecipient,
    created_at: new Date(),
    last_seen_at: new Date(),
  };
  const result = await collections.campaignUsers.updateOne(
    { _id: userId },
    { $setOnInsert: account },
    { upsert: true },
  );
  return Boolean(result.upsertedCount);
}

function parsePrizeLink(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Gift havolasi noto‘g‘ri. t.me/nft/Model-123 ko‘rinishida yuboring.');
  }
  if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password) {
    throw new Error('Faqat parametrsiz HTTPS Telegram NFT yoki Fragment havolasini kiriting.');
  }

  const telegramHost = ['t.me', 'telegram.me'].includes(url.hostname.toLowerCase());
  const fragmentHost = ['fragment.com', 'www.fragment.com'].includes(url.hostname.toLowerCase());

  let match;
  let modelSlug;
  let number;
  let slug;
  let fragmentUrl;
  let telegramUrl;

  if (telegramHost) {
    match = /^\/nft\/([A-Za-z0-9-]+)\/?$/.exec(url.pathname);
    if (!match) {
      throw new Error('Havola formatini tushunmadim. Masalan: https://t.me/nft/LunarSnake-89030');
    }
    const giftMatch = /^([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)-(\d{1,12})$/.exec(match[1]);
    if (!giftMatch || !Number.isSafeInteger(Number(giftMatch[2])) || Number(giftMatch[2]) < 1) {
      throw new Error('Havola formatini tushunmadim. Masalan: https://t.me/nft/LunarSnake-89030');
    }
    modelSlug = giftMatch[1];
    number = giftMatch[2];
    slug = `${modelSlug.toLowerCase()}-${number}`;
    telegramUrl = `https://t.me/nft/${slug}`;
    fragmentUrl = `https://fragment.com/gift/${slug}`;
  } else if (fragmentHost) {
    match = /^\/(?:gift|gifts)\/([A-Za-z0-9-]+)\/?$/.exec(url.pathname);
    if (!match) {
      throw new Error('Havola formatini tushunmadim. Fragment gift havolasi /gifts/<slug> yoki /gift/<slug>-<raqam> ko‘rinishida bo‘lishi kerak.');
    }

    const rawSlug = match[1];
    const giftMatch = /^([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)-(\d{1,12})$/.exec(rawSlug);
    if (giftMatch) {
      modelSlug = giftMatch[1];
      number = giftMatch[2];
      slug = `${modelSlug.toLowerCase()}-${number}`;
    } else {
      modelSlug = rawSlug;
      slug = rawSlug.toLowerCase();
    }
    telegramUrl = `https://t.me/nft/${slug}`;
    fragmentUrl = `https://fragment.com${url.pathname.replace(/\/$/, '')}`;
  } else {
    throw new Error('Havola formatini tushunmadim. Masalan: https://t.me/nft/LunarSnake-89030');
  }

  const model = modelSlug
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const displayName = number
    ? `${model} #${Number(number).toLocaleString('en-US')}`
    : model;

  return {
    _id: slug,
    admin_code: crypto.randomBytes(8).toString('hex'),
    slug,
    model,
    number: number || null,
    display_name: displayName,
    telegram_url: telegramUrl,
    fragment_url: fragmentUrl,
    image_url: `https://nft.fragment.com/gift/${slug}.medium.jpg`,
  };
}

async function verifyPrizeImage(prize) {
  let response;
  try {
    response = await fetch(prize.image_url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw new Error(`NFT rasmini Fragment’dan tekshirib bo‘lmadi: ${error.message}`);
  }
  if (!response.ok || !/^image\/jpeg(?:;|$)/i.test(response.headers.get('content-type') || '')) {
    throw new Error('Bu NFT uchun haqiqiy Fragment rasmi topilmadi. Telegram NFT havolasini qayta tekshiring.');
  }
}

async function getCampaignPrizes(includeAdminCode = false) {
  const prizes = await collections.prizes.find({ active: true })
    .sort({ created_at: -1 })
    .project({
      _id: 1,
      model: 1,
      number: 1,
      display_name: 1,
      telegram_url: 1,
      fragment_url: 1,
      image_url: 1,
      type: 1,
      premium_months: 1,
      referrals_cost: 1,
      ...(includeAdminCode ? { admin_code: 1 } : {}),
    })
    .toArray();
  return prizes.map((prize) => ({
    ...prize,
    type: prize.type === 'premium' ? 'premium' : 'nft',
    referrals_cost: Number.isSafeInteger(prize.referrals_cost) ? prize.referrals_cost : 1,
  }));
}

async function qualifyReferral(userId) {
  const user = await collections.campaignUsers.findOne({ _id: userId });
  if (!user || !user.campaign_new || !user.referred_by || user.referred_by === userId) return;
  const result = await collections.referrals.updateOne(
    { _id: userId },
    {
      $setOnInsert: {
        inviter_id: user.referred_by,
        invitee_id: userId,
        created_at: new Date(),
      },
    },
    { upsert: true },
  );
  if (!result.upsertedCount) return;
}

function startReferralPayload(ctx) {
  const text = ctx.message && ctx.message.text || '';
  const match = /^\/start(?:@\w+)?(?:\s+(\S+))?/i.exec(text);
  return match ? match[1] || '' : '';
}

function addPremiumButtonIcon(button, isPremium) {
  if (!isPremium) return button;
  return {
    ...button,
    text: button.text.replace(/^(?:⭐️?\s*)+/u, ''),
    icon_custom_emoji_id: PREMIUM_EMOJI_ID,
  };
}

function callbackButton(text, data, style = 'primary') {
  const isPremium = /premium/i.test(text);
  const label = stripBotEmojis(text).replace(/^(?:⭐️?\s*)+/u, '');
  return {
    ...addPremiumButtonIcon(Markup.button.callback(label, data), isPremium),
    style,
  };
}

function urlButton(text, url) {
  const isPremium = /premium/i.test(text);
  const label = stripBotEmojis(text).replace(/^(?:⭐️?\s*)+/u, '');
  return {
    ...addPremiumButtonIcon(Markup.button.url(label, url), isPremium),
    style: 'primary',
  };
}

function twoColumnKeyboard(rows) {
  return Markup.inlineKeyboard(rows.flat(), { columns: 2 });
}

function subscriptionKeyboard(channels) {
  const rows = channels.map((channel) => [
    urlButton(`📢 ${channel.title || channel.channel_id}`, channel.invite_url),
  ]);
  rows.push([callbackButton('✅ Obunani tekshirish', 'subscription:check', 'success')]);
  return twoColumnKeyboard(rows);
}

async function showSubscriptionPrompt(ctx) {
  await ctx.reply(
    '🔒 Referral hisoblanishi va Mini App’dan foydalanish uchun quyidagi kanal(lar)ga obuna bo‘ling, so‘ng tekshiring.',
    subscriptionKeyboard(await getRequiredChannels()),
  );
}

function mainMenuKeyboard() {
  const rows = [];
  if (WEB_APP_URL) {
    rows.push([{ ...Markup.button.webApp(stripBotEmojis('🎁 Mini Appni ochish'), WEB_APP_URL), style: 'success' }]);
  }
  rows.push([callbackButton('Balansim', 'menu:balance', 'success')]);
  rows.push([callbackButton('Sovg‘alar va Premium', 'menu:prizes')]);
  rows.push([callbackButton('Do‘stni taklif qilish', 'menu:invite')]);
  return twoColumnKeyboard(rows);
}

async function showWelcome(ctx) {
  const message = WEB_APP_URL
    ? '👋 Salom! Referral ball to‘plang va NFT yoki Telegram Premium yutib oling. Barcha imkoniyatlar bot ichida ham mavjud:'
    : '👋 Salom! Referral ball to‘plang va NFT yoki Telegram Premium yutib oling. WEB_APP_URL sozlanmagan, lekin botdagi funksiyalardan foydalanishingiz mumkin:';
  await replyText(ctx, message, mainMenuKeyboard());
}

async function getCampaignStats(userId) {
  const [profile, referralCount, pendingRequest, acceptedRequests, prizes] = await Promise.all([
    collections.campaignUsers.findOne({ _id: userId }),
    collections.referrals.countDocuments({ inviter_id: userId }),
    collections.giftRequests.findOne({ user_id: userId, status: 'pending' }),
    collections.giftRequests.find({ user_id: userId, status: 'approved' })
      .project({ referrals_cost: 1 })
      .toArray(),
    getCampaignPrizes(),
  ]);
  const spentReferrals = acceptedRequests.reduce((total, request) => total + request.referrals_cost, 0)
    + (pendingRequest ? pendingRequest.referrals_cost : 0);
  const referralBalance = Math.max(0, referralCount - spentReferrals);
  const botLink = `https://t.me/${botUsername}?start=ref_${userId}`;
  return {
    firstName: profile ? profile.first_name : '',
    referralCount,
    referralBalance,
    giftRequest: pendingRequest ? {
      status: pendingRequest.status,
      prizeDisplayName: pendingRequest.prize_display_name,
      prizeType: pendingRequest.prize_type,
    } : null,
    prizes,
    botLink,
  };
}

function prizeCallbackCode(prizeId) {
  return crypto.createHash('sha256').update(prizeId).digest('hex').slice(0, 12);
}

function prizeTypeLabel(prize) {
  return prize.type === 'premium' ? `Telegram Premium (${prize.premium_months} oy)` : `NFT ${prize.display_name}`;
}

async function createGiftRequest(telegramUser, prizeId) {
  const userId = String(telegramUser.id);
  if (await isUserBlocked(userId)) {
    throw new HttpError(403, 'Admin sizning botdan foydalanishingizni cheklagan.');
  }
  if (!await isSubscribedToRequiredChannels(telegramUser.id)) {
    throw new HttpError(403, 'Majburiy kanallarga obuna bo‘ling, so‘ng qayta urinib ko‘ring.');
  }
  if (await collections.giftRequests.findOne({ user_id: userId, status: 'pending' })) {
    throw new HttpError(409, 'Sizda admin ko‘rib chiqayotgan sovg‘a so‘rovi bor.');
  }
  const [referralCount, previousRequests, profile] = await Promise.all([
    collections.referrals.countDocuments({ inviter_id: userId }),
    collections.giftRequests.find({ user_id: userId, status: 'approved' })
      .project({ referrals_cost: 1 })
      .toArray(),
    collections.campaignUsers.findOne({ _id: userId }),
  ]);
  const referralBalance = Math.max(
    0,
    referralCount - previousRequests.reduce((total, request) => total + request.referrals_cost, 0),
  );
  const prize = await collections.prizes.findOne({ _id: prizeId, active: true });
  if (!prize) {
    throw new HttpError(409, 'Bu sovg‘a katalogda topilmadi. Sovg‘alar ro‘yxatini yangilang.');
  }
  const referralsCost = Number.isSafeInteger(prize.referrals_cost) ? prize.referrals_cost : 1;
  if (referralBalance < referralsCost) {
    throw new HttpError(409, `Bu sovg‘a uchun ${referralsCost} ball kerak. Joriy balansingiz: ${referralBalance}.`);
  }
  if (!(await getAdminIds()).length) {
    throw new HttpError(503, 'Bot adminlari sozlanmagan. Keyinroq qayta urinib ko‘ring.');
  }
  const giftRequest = {
    _id: crypto.randomUUID(),
    user_id: userId,
    first_name: profile ? profile.first_name : telegramUser.first_name || '',
    username: profile ? profile.username : telegramUser.username || null,
    prize_id: prize._id,
    prize_type: prize.type === 'premium' ? 'premium' : 'nft',
    premium_months: prize.premium_months || null,
    prize_display_name: prize.display_name,
    prize_telegram_url: prize.telegram_url || null,
    referrals_cost: referralsCost,
    status: 'pending',
    created_at: new Date(),
  };
  try {
    await collections.giftRequests.insertOne(giftRequest);
  } catch (error) {
    if (error.code === 11000) {
      throw new HttpError(409, 'Sizda admin ko‘rib chiqayotgan sovg‘a so‘rovi bor.');
    }
    throw error;
  }

  const requester = `${giftRequest.first_name || 'Foydalanuvchi'}${giftRequest.username ? ` (@${giftRequest.username})` : ''}`;
  const keyboardRows = [[
    callbackButton('Qabul qilish', `admin:gift_request_approve:${giftRequest._id}`, 'success'),
    callbackButton('Rad etish', `admin:gift_request_reject:${giftRequest._id}`, 'danger'),
  ]];
  if (giftRequest.prize_telegram_url) {
    keyboardRows.push([urlButton('NFT havolasini ochish', giftRequest.prize_telegram_url)]);
  }
  const notified = await notifyAdmins(
    `Yangi ${giftRequest.prize_type === 'premium' ? 'Telegram Premium' : 'NFT'} sovg‘a so‘rovi\n\n`
      + `Foydalanuvchi: ${requester}\nTelegram ID: ${userId}\nSovg‘a: ${prizeTypeLabel(giftRequest)}\n`
      + `Narxi: ${referralsCost} referral ball\nTasdiqlangach sovg‘ani foydalanuvchiga qo‘lda topshiring.`,
    twoColumnKeyboard(keyboardRows),
  );
  return { giftRequest, referralBalance: referralBalance - referralsCost, notified };
}

async function showBalance(ctx) {
  const stats = await getCampaignStats(String(ctx.from.id));
  const pending = stats.giftRequest
    ? `\n\n⏳ Kutilayotgan so‘rov: ${stats.giftRequest.prizeDisplayName}`
    : '';
  await replyText(ctx,
    `💰 Referral balansingiz\n\n✅ Tasdiqlangan takliflar: ${stats.referralCount}\n🎟 Sarflashingiz mumkin: ${stats.referralBalance} ball${pending}`,
    mainMenuKeyboard(),
  );
}

async function showInviteLink(ctx) {
  const stats = await getCampaignStats(String(ctx.from.id));
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(stats.botLink)}&text=${encodeURIComponent('Botga qo‘shiling va referral kampaniyasida qatnashing.')}`;
  await ctx.reply(
    `🔗 Do‘stlaringizga ushbu taklif havolasini yuboring:\n\n${stats.botLink}\n\nDo‘stingiz botni ishga tushirib, majburiy kanallarga obuna bo‘lgach 1 ball olasiz.`,
    twoColumnKeyboard([
      [urlButton('📤 Do‘stga ulashish', shareUrl)],
      [callbackButton('⬅️ Bosh menyu', 'menu:home')],
    ]),
  );
}

async function showPrizeMenu(ctx) {
  const prizes = await getCampaignPrizes();
  const rows = prizes.map((prize) => [
    callbackButton(
      `${prize.type === 'premium' ? '⭐' : '💎'} ${prize.display_name} · ${prize.referrals_cost} ball`,
      `menu:request:${prizeCallbackCode(prize._id)}`,
      'success',
    ),
  ]);
  rows.push([callbackButton('⬅️ Bosh menyu', 'menu:home')]);
  const text = prizes.length
    ? '🎁 Yutish mumkin bo‘lgan sovg‘alar:\n\nHar bir sovg‘ani tanlab so‘rov yuboring. Admin tasdiqlagach NFT yoki Premium obunasini qo‘lda topshiradi.'
    : 'Hozircha sovg‘alar qo‘shilmagan. Keyinroq qayta tekshiring.';
  await replyText(ctx, text, twoColumnKeyboard(rows));
}

function formatUserDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toLocaleString('uz-UZ')
    : 'Ma’lumot yo‘q';
}

async function renderCampaignUser(ctx, userId, edit = false) {
  const [profile, referrals, requests, rewards, blockedRecord, admin] = await Promise.all([
    collections.campaignUsers.findOne({ _id: userId }),
    collections.referrals.countDocuments({ inviter_id: userId }),
    collections.giftRequests.find({ user_id: userId }).sort({ created_at: -1 }).toArray(),
    collections.rewards.find({ _id: userId }).toArray(),
    collections.blockedUsers.findOne({ _id: userId }),
    collections.admins.findOne({ _id: userId }),
  ]);
  const blocked = Boolean(blockedRecord);
  const owner = userId === OWNER_ID;
  const protectedAdmin = owner || Boolean(admin);
  const referralSpent = requests
    .filter((request) => request.status === 'approved' || request.status === 'pending')
    .reduce((total, request) => total + (Number.isSafeInteger(request.referrals_cost) ? request.referrals_cost : 0), 0);
  const referralBalance = Math.max(0, referrals - referralSpent);
  let referredByText = 'Yo‘q';
  if (profile && profile.referred_by) {
    const referrer = await collections.campaignUsers.findOne({ _id: profile.referred_by });
    const referrerName = referrer
      ? [referrer.first_name, referrer.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi'
      : 'Noma’lum foydalanuvchi';
    referredByText = `${referrerName} (ID: ${profile.referred_by})`;
  }
  const requestText = requests.length
    ? `${requests.length} ta so‘rov (kutilmoqda: ${requests.filter((request) => request.status === 'pending').length}, qabul: ${requests.filter((request) => request.status === 'approved').length}, rad: ${requests.filter((request) => request.status === 'rejected').length})\n`
      + requests.slice(0, 5).map((request) => `• ${prizeTypeLabel({
      type: request.prize_type,
      premium_months: request.premium_months,
      display_name: request.prize_display_name,
    })} — ${request.status}; ${request.referrals_cost} ball; ${formatUserDate(request.created_at)}`).join('\n')
    : 'So‘rovlar yo‘q';
  const rewardText = rewards.length
    ? rewards.map((reward) => `• ${reward.prize_display_name || 'Gift'} — ${reward.status}; ${formatUserDate(reward.created_at)}`).join('\n')
    : 'Eski giftlar yo‘q';
  const name = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Noma’lum'
    : 'Botda qayd etilmagan';
  const text = [
    `👤 Foydalanuvchi ma’lumoti`,
    `Ism: ${name}`,
    `Username: ${profile && profile.username ? `@${profile.username}` : 'Mavjud emas'}`,
    `Telegram ID: ${userId}`,
    `Admin: ${protectedAdmin ? (owner ? 'Bot egasi' : 'Ha') : 'Yo‘q'}`,
    `Holati: ${blocked ? `🚫 Bloklangan (${formatUserDate(blockedRecord.blocked_at)}, admin ID: ${blockedRecord.blocked_by})` : '✅ Faol'}`,
    `Birinchi qayd: ${formatUserDate(profile && profile.created_at)}`,
    `Oxirgi faollik: ${formatUserDate(profile && profile.last_seen_at)}`,
    `Taklif qilgan: ${referredByText}`,
    `Takliflari: ${referrals}`,
    `Referral balansi: ${referralBalance}`,
    `So‘nggi sovg‘a so‘rovlari:\n${requestText}`,
    `Eski mukofotlar:\n${rewardText}`,
  ].join('\n');
  const rows = [];
  if (!protectedAdmin) {
    rows.push([callbackButton(
      blocked ? '✅ Blokdan chiqarish' : '🚫 Foydalanuvchini bloklash',
      `admin:user_${blocked ? 'unblock' : 'block'}:${userId}`,
      blocked ? 'success' : 'danger',
    )]);
  }
  rows.push([
    callbackButton('🔄 Yangilash', `admin:user_view:${userId}`),
    callbackButton('🔎 Boshqa ID', 'admin:user_search'),
  ]);
  rows.push([callbackButton('⬅️ Admin panel', 'admin:panel')]);
  const keyboard = twoColumnKeyboard(rows);
  if (edit && ctx.callbackQuery && ctx.callbackQuery.message) {
    await editText(ctx, text, keyboard);
  } else {
    await replyText(ctx, text, keyboard);
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validateWebAppInitData(initData) {
  if (typeof initData !== 'string' || !initData || initData.length > 8192) {
    throw new HttpError(401, 'Telegram Mini App ma’lumoti yo‘q yoki noto‘g‘ri.');
  }
  const params = new URLSearchParams(initData);
  const entries = [...params.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new HttpError(401, 'Telegram Mini App ma’lumotida takroriy maydon bor.');
  }
  const suppliedHash = params.get('hash');
  if (!suppliedHash || !/^[a-f0-9]{64}$/i.test(suppliedHash)) {
    throw new HttpError(401, 'Telegram tasdiqlash kodi noto‘g‘ri.');
  }
  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(authDate) || authDate > now + 60 || now - authDate > 86400) {
    throw new HttpError(401, 'Mini App sessiyasi eskirgan. Ilovani qayta oching.');
  }
  const dataCheckString = entries
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest();
  const actualHash = Buffer.from(suppliedHash, 'hex');
  if (actualHash.length !== expectedHash.length || !crypto.timingSafeEqual(actualHash, expectedHash)) {
    throw new HttpError(401, 'Telegram Mini App imzosi tasdiqlanmadi.');
  }
  let user;
  try {
    user = JSON.parse(params.get('user') || '');
  } catch {
    throw new HttpError(401, 'Telegram foydalanuvchi ma’lumoti noto‘g‘ri.');
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id < 1) {
    throw new HttpError(401, 'Telegram foydalanuvchi ID’si noto‘g‘ri.');
  }
  return user;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > 10000) {
        tooLarge = true;
        chunks.length = 0;
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(new HttpError(413, 'So‘rov hajmi ruxsat etilganidan katta.'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'JSON so‘rovi noto‘g‘ri.'));
      }
    });
    req.on('error', reject);
  });
}

const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

async function handleHttpRequest(req, res) {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.pathname === '/api/session') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'POST so‘rovi talab qilinadi.' });
      return;
    }
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'JSON so‘rovi noto‘g‘ri.');
    }
    const telegramUser = validateWebAppInitData(body.initData);
    if (await isUserBlocked(telegramUser.id)) {
      throw new HttpError(403, 'Admin sizning botdan foydalanishingizni cheklagan.');
    }
    await ensureCampaignUser(telegramUser);
    const subscribed = await isSubscribedToRequiredChannels(telegramUser.id);
    if (!subscribed) {
      sendJson(res, 403, { error: 'Majburiy kanallarga obuna bo‘ling, so‘ng Mini App’ni qayta oching.' });
      return;
    }
    await qualifyReferral(String(telegramUser.id));
    const campaignStats = await getCampaignStats(String(telegramUser.id));
    sendJson(res, 200, campaignStats);
    return;
  }
  if (requestUrl.pathname === '/api/gift-requests') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'POST so‘rovi talab qilinadi.' });
      return;
    }
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'JSON so‘rovi noto‘g‘ri.');
    }
    const telegramUser = validateWebAppInitData(body.initData);
    if (await isUserBlocked(telegramUser.id)) {
      throw new HttpError(403, 'Admin sizning botdan foydalanishingizni cheklagan.');
    }
    if (typeof body.prizeId !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(body.prizeId)) {
      throw new HttpError(400, 'Tanlangan sovg‘a noto‘g‘ri.');
    }
    await ensureCampaignUser(telegramUser);
    const request = await createGiftRequest(telegramUser, body.prizeId);
    if (!request.notified) {
      sendJson(res, 502, {
        error: 'So‘rov saqlandi, lekin adminlardan hech biriga xabar yuborilmadi. Bot administratoriga murojaat qiling.',
        requestSaved: true,
      });
      return;
    }
    sendJson(res, 201, {
      status: 'pending',
      prizeDisplayName: request.giftRequest.prize_display_name,
      referralBalance: request.referralBalance,
    });
    return;
  }
  const file = staticFiles[requestUrl.pathname];
  if (!file || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const content = await fs.promises.readFile(path.join(__dirname, 'public', file[0]));
  res.writeHead(200, {
    'content-type': file[1],
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self' https://telegram.org; script-src 'self' https://telegram.org; style-src 'self'; connect-src 'self'; img-src 'self' data: https://nft.fragment.com;",
  });
  res.end(req.method === 'HEAD' ? undefined : content);
}

function ownerPanelKeyboard(includeAdminManagement = false) {
  const rows = [
    [callbackButton('📊 Referral statistikasi', 'admin:stats')],
    [callbackButton('💎 Sovg‘alar: NFT va Premium', 'admin:prizes')],
    [callbackButton('🎁 Sovg‘a so‘rovlari', 'admin:gift_requests')],
    [callbackButton('🎁 Kutilayotgan giftlar', 'admin:rewards')],
    [callbackButton('📢 Majburiy obuna kanallari', 'admin:channels')],
    [callbackButton('🔎 Foydalanuvchini qidirish', 'admin:user_search')],
  ];
  if (includeAdminManagement) rows.push([callbackButton('👥 Adminlarni boshqarish', 'admin:admins')]);
  return twoColumnKeyboard(rows);
}

async function showOwnerPanel(ctx, edit = false) {
  const keyboard = ownerPanelKeyboard(isOwner(ctx));
  const text = '🛠️ Bot boshqaruvi\n\nBo‘limni tanlang:';
  if (edit && ctx.callbackQuery && ctx.callbackQuery.message) {
    await ctx.editMessageText(text, keyboard);
  } else {
    await ctx.reply(text, keyboard);
  }
}

async function renderAdmins(ctx, edit = false) {
  const admins = await collections.admins.find().sort({ _id: 1 }).toArray();
  const rows = admins.map((admin) => [
    callbackButton(`🗑 Admin ${admin._id} ni o‘chirish`, `admin:admin_remove:${admin._id}`, 'danger'),
  ]);
  rows.push([callbackButton('➕ Admin qo‘shish', 'admin:admin_add', 'success')]);
  rows.push([callbackButton('⬅️ Panelga qaytish', 'admin:panel')]);
  const text = admins.length
    ? `👥 Qo‘shimcha adminlar (${admins.length}):\n${admins.map((admin) => `• ${admin._id}`).join('\n')}\n\nBot egasining huquqlari alohida va o‘zgarmaydi.`
    : '👥 Hozircha qo‘shimcha admin yo‘q. Bot egasi barcha admin huquqlarini saqlab qoladi.';
  if (edit && ctx.callbackQuery && ctx.callbackQuery.message) {
    await editText(ctx, text, twoColumnKeyboard(rows));
  } else {
    await replyText(ctx, text, twoColumnKeyboard(rows));
  }
}

async function renderChannels(ctx, edit = false) {
  const channels = await getRequiredChannels();
  const rows = channels.map((channel) => {
    const encodedId = Buffer.from(channel.channel_id).toString('base64url');
    return [
      callbackButton(`✏️ ${channel.title || channel.channel_id}`, `admin:channel_edit:${encodedId}`),
      callbackButton('🗑 O‘chirish', `admin:channel_delete:${encodedId}`, 'danger'),
    ];
  });
  rows.push([callbackButton('➕ Kanal qo‘shish', 'admin:channel_add', 'success')]);
  rows.push([callbackButton('⬅️ Panelga qaytish', 'admin:panel')]);
  const text = channels.length
    ? `📢 Majburiy obuna kanallari (${channels.length}):\n${channels.map((channel) => `• ${channel.title} — ${channel.channel_id}`).join('\n')}`
    : '📢 Majburiy obuna kanallari qo‘shilmagan.';
  if (edit && ctx.callbackQuery && ctx.callbackQuery.message) {
    await ctx.editMessageText(text, twoColumnKeyboard(rows));
  } else {
    await ctx.reply(text, twoColumnKeyboard(rows));
  }
}

async function renderPrizes(ctx, edit = false) {
  const prizes = await getCampaignPrizes(true);
  for (const prize of prizes) {
    if (!prize.admin_code) {
      prize.admin_code = crypto.randomBytes(8).toString('hex');
      await collections.prizes.updateOne(
        { _id: prize._id, admin_code: { $exists: false } },
        { $set: { admin_code: prize.admin_code } },
      );
    }
  }
  const rows = prizes.map((prize) => [
    callbackButton(`🗑 ${prize.display_name} · ${prize.referrals_cost || 1} ball`, `admin:prize_delete:${prize.admin_code}`, 'danger'),
  ]);
  rows.push([callbackButton('➕ NFT qo‘shish', 'admin:prize_add', 'success')]);
  rows.push([callbackButton('Premium sovg‘a qo‘shish', 'admin:premium_add', 'success')]);
  rows.push([callbackButton('⬅️ Panelga qaytish', 'admin:panel')]);
  const text = prizes.length
    ? `Sovg‘alar katalogi (${prizes.length}):\n\n${prizes.map((prize, index) => `${index + 1}. ${prizeTypeLabel(prize)} — ${prize.referrals_cost || 1} referral ball${prize.telegram_url ? `\n${prize.telegram_url}` : ''}`).join('\n\n')}\n\nNFT va Premium sovg‘alari admin tomonidan qo‘lda topshiriladi.`
    : '🎁 Hozircha sovg‘alar qo‘shilmagan. NFT havolasini yoki Telegram Premium obuna muddatini qo‘shing.';
  if (edit && ctx.callbackQuery && ctx.callbackQuery.message) {
    await editText(ctx, text, twoColumnKeyboard(rows));
  } else {
    await replyText(ctx, text, twoColumnKeyboard(rows));
  }
}

async function showPendingRewards(ctx, edit = false) {
  const [rewards, total] = await Promise.all([
    collections.rewards.find({ status: 'pending' }).sort({ created_at: 1 }).limit(20).toArray(),
    collections.rewards.countDocuments({ status: 'pending' }),
  ]);
  const text = total
    ? `🎁 NFT giftni qo‘lda topshirib, “Topshirildi” tugmasini bosing. Kutilayotgan: ${total}${total > rewards.length ? ` (birinchi ${rewards.length} tasi)` : ''}.\n\n${rewards.map((reward, index) => `${index + 1}. ${reward.first_name || 'Foydalanuvchi'}${reward.username ? ` (@${reward.username})` : ''} — ID: ${reward.user_id}\n   Sovg‘a: ${reward.prize_display_name || 'NFT hali biriktirilmagan'}`).join('\n')}`
    : '🎁 Hozircha topshirilishi kutilayotgan gift yo‘q.';
  const rows = rewards.map((reward) => [
    ...(reward.prize_telegram_url
      ? [urlButton(`💎 ${reward.prize_display_name}`, reward.prize_telegram_url)]
      : []),
    callbackButton(`✅ ID: ${reward.user_id}`, `admin:reward_done:${reward.user_id}`, 'success'),
  ]);
  rows.push([callbackButton('⬅️ Panelga qaytish', 'admin:panel')]);
  if (edit && ctx.callbackQuery && ctx.callbackQuery.message) {
    await editText(ctx, text, twoColumnKeyboard(rows));
  } else {
    await replyText(ctx, text, twoColumnKeyboard(rows));
  }
}

async function showGiftRequests(ctx, edit = false) {
  const requests = await collections.giftRequests.find({ status: 'pending' })
    .sort({ created_at: 1 })
    .limit(20)
    .toArray();
  const text = requests.length
    ? `Kutilayotgan sovg‘a so‘rovlari (${requests.length}${requests.length === 20 ? '+' : ''}):\n\n${requests.map((request, index) => `${index + 1}. ${request.first_name || 'Foydalanuvchi'}${request.username ? ` (@${request.username})` : ''} — ID: ${request.user_id}\n   ${request.prize_display_name} — ${request.referrals_cost} referral ball`).join('\n\n')}`
    : 'Hozircha sovg‘a so‘rovlari yo‘q.';
  const rows = requests.flatMap((request) => [
    [
      callbackButton(`Qabul: ${request.prize_display_name}`, `admin:gift_request_approve:${request._id}`, 'success'),
      callbackButton('Rad etish', `admin:gift_request_reject:${request._id}`, 'danger'),
    ],
    ...(request.prize_telegram_url ? [[urlButton('NFT havolasini ochish', request.prize_telegram_url)]] : []),
  ]);
  rows.push([callbackButton('Panelga qaytish', 'admin:panel')]);
  if (edit && ctx.callbackQuery && ctx.callbackQuery.message) {
    await editText(ctx, text, twoColumnKeyboard(rows));
  } else {
    await replyText(ctx, text, twoColumnKeyboard(rows));
  }
}

async function handleAdminInput(ctx) {
  const adminId = String(ctx.from.id);
  const session = ownerSessions.get(adminId);
  if (!session) return false;
  const text = ctx.message.text || '';
  if (/^\/cancel(?:@\w+)?(?:\s|$)/i.test(text.trim())) {
    ownerSessions.delete(adminId);
    await ctx.reply('❎ Amal bekor qilindi.');
    await showOwnerPanel(ctx);
    return true;
  }
  if (session.action === 'prize_add') {
    try {
      const prize = parsePrizeLink(text);
      await verifyPrizeImage(prize);
      ownerSessions.set(adminId, { action: 'prize_price', prize });
      await ctx.reply(`${prize.display_name} NFT uchun qancha referral ball belgilaysiz? 1 dan 1 000 000 gacha butun son yuboring. Bekor qilish: /cancel`);
    } catch (error) {
      await ctx.reply(`⚠️ ${error.message}\n\nMasalan: https://t.me/nft/LunarSnake-89030\nQayta yuboring yoki /cancel yozing.`);
    }
    return true;
  }
  if (session.action === 'prize_price') {
    const referralsCost = Number(text.trim());
    if (!Number.isSafeInteger(referralsCost) || referralsCost < 1 || referralsCost > 1000000) {
      await ctx.reply('Narx 1 dan 1 000 000 gacha bo‘lgan butun son bo‘lishi kerak. Qayta kiriting yoki /cancel yozing.');
      return true;
    }
    try {
      const prize = session.prize;
      const result = await collections.prizes.updateOne(
        { _id: prize._id },
        {
          $setOnInsert: {
            ...prize,
              created_at: new Date(),
            created_by: adminId,
          },
          $set: { active: true, referrals_cost: referralsCost },
        },
        { upsert: true },
      );
      ownerSessions.delete(adminId);
      await replyText(ctx, result.upsertedCount
        ? `${prize.display_name} NFT ${referralsCost} referral ball narxi bilan qo‘shildi.`
        : `${prize.display_name} NFT narxi ${referralsCost} referral ball qilib saqlandi.`);
      await renderPrizes(ctx);
    } catch (error) {
      await ctx.reply(`NFT narxini saqlab bo‘lmadi: ${error.message}. Qayta yuboring yoki /cancel yozing.`);
    }
    return true;
  }
  if (session.action === 'premium_months') {
    const months = Number(text.trim());
    if (![1, 3, 6, 12].includes(months)) {
      await replyText(ctx, 'Premium muddati 1, 3, 6 yoki 12 oy bo‘lishi mumkin. Qayta kiriting yoki /cancel yozing.');
      return true;
    }
    const prize = {
      _id: `premium-${months}-months`,
      type: 'premium',
      premium_months: months,
      model: `Telegram Premium — ${months} oy`,
      display_name: `Telegram Premium — ${months} oy`,
    };
    ownerSessions.set(adminId, { action: 'premium_price', prize });
    await replyText(ctx, `${months} oylik Telegram Premium uchun referral ball narxini yuboring (1–1 000 000). /cancel`);
    return true;
  }
  if (session.action === 'premium_price') {
    const referralsCost = Number(text.trim());
    if (!Number.isSafeInteger(referralsCost) || referralsCost < 1 || referralsCost > 1000000) {
      await ctx.reply('Narx 1 dan 1 000 000 gacha bo‘lgan butun son bo‘lishi kerak. Qayta kiriting yoki /cancel yozing.');
      return true;
    }
    try {
      const { prize } = session;
      const result = await collections.prizes.updateOne(
        { _id: prize._id },
        {
          $setOnInsert: { ...prize, created_at: new Date(), created_by: adminId },
          $set: { active: true, referrals_cost: referralsCost },
        },
        { upsert: true },
      );
      ownerSessions.delete(adminId);
      await ctx.reply(result.upsertedCount
        ? `${prize.display_name} ${referralsCost} referral ball narxi bilan qo‘shildi.`
        : `${prize.display_name} narxi ${referralsCost} referral ball qilib saqlandi.`);
      await renderPrizes(ctx);
    } catch (error) {
      await replyText(ctx, `Premium sovg‘ani saqlab bo‘lmadi: ${error.message}. Qayta yuboring yoki /cancel yozing.`);
    }
    return true;
  }
  if (session.action === 'admin_add') {
    const newAdminId = text.trim();
    if (!/^\d{1,20}$/.test(newAdminId)
      || !Number.isSafeInteger(Number(newAdminId))
      || newAdminId === OWNER_ID) {
      await ctx.reply('Adminning raqamli Telegram ID’sini yuboring. Bot egasi allaqachon doimiy admin.');
      return true;
    }
    await collections.admins.updateOne(
      { _id: newAdminId },
      { $setOnInsert: { _id: newAdminId, added_at: new Date(), added_by: adminId } },
      { upsert: true },
    );
    ownerSessions.delete(adminId);
    await ctx.reply(`✅ ${newAdminId} admin sifatida qo‘shildi.`);
    await renderAdmins(ctx);
    return true;
  }
  if (session.action === 'user_search') {
    const userId = text.trim();
    if (!/^\d{1,20}$/.test(userId) || !Number.isSafeInteger(Number(userId)) || Number(userId) < 1) {
      await ctx.reply('Telegram ID raqamli va to‘g‘ri bo‘lishi kerak. ID’ni qayta kiriting yoki /cancel yozing.');
      return true;
    }
    ownerSessions.delete(adminId);
    await renderCampaignUser(ctx, String(Number(userId)));
    return true;
  }
  if (session.action === 'channel_add' || session.action === 'channel_edit') {
    try {
      await saveChannelFromOwner(ctx, text, session.channelId);
      ownerSessions.delete(adminId);
      await ctx.reply('✅ Majburiy obuna kanali saqlandi.');
      await renderChannels(ctx);
    } catch (error) {
      await ctx.reply(`⚠️ ${error.message} Qayta yuboring yoki /cancel yozing.`);
    }
    return true;
  }
  return false;
}

bot.use(async (ctx, next) => {
  const reply = ctx.reply.bind(ctx);
  ctx.reply = (text, extra) => {
    if (typeof text !== 'string') return reply(text, extra);
    const message = telegramMessage(stripBotEmojis(text, extra || {}), extra || {});
    return reply(message.text, message.options);
  };
  const editMessageText = ctx.editMessageText.bind(ctx);
  ctx.editMessageText = (text, extra) => {
    if (typeof text !== 'string') return editMessageText(text, extra);
    const message = telegramMessage(stripBotEmojis(text, extra || {}), extra || {});
    return editMessageText(message.text, message.options);
  };
  const answerCbQuery = ctx.answerCbQuery.bind(ctx);
  ctx.answerCbQuery = (text, extra) => answerCbQuery(stripBotEmojis(text), extra);
  if (!ctx.chat || ctx.chat.type !== 'private' || !ctx.from) return;
  const adminId = String(ctx.from.id);
  const admin = await isAdmin(ctx);
  if (admin && ctx.message && ctx.message.text && ownerSessions.has(adminId)) {
    if (await handleAdminInput(ctx)) return;
  }

  const isStartCommand = Boolean(ctx.message && /^\/start(?:@\w+)?(?:\s|$)/i.test(ctx.message.text || ''));
  const referralPayload = isStartCommand
    ? startReferralPayload(ctx)
    : '';
  const newCampaignUser = await ensureCampaignUser(ctx.from, referralPayload);
  if (newCampaignUser && isStartCommand) {
    const displayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
    const userLink = `<a href="tg://user?id=${adminId}">${escapeHtml(displayName)}</a>`;
    const username = ctx.from.username ? `\nUsername: @${escapeHtml(ctx.from.username)}` : '';
    await notifyAdmins(
      `🆕 Yangi obunachi botni ishga tushirdi.\n\nFoydalanuvchi: ${userLink}${username}\nTelegram ID: ${adminId}`,
      undefined,
      { parse_mode: 'HTML' },
    );
  }
  if (!admin && await isUserBlocked(adminId)) {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('🚫 Admin sizning botdan foydalanishingizni cheklagan.', { show_alert: true });
    } else {
      await ctx.reply('🚫 Admin sizning botdan foydalanishingizni cheklagan.');
    }
    return;
  }
  if (admin || (ctx.callbackQuery && ctx.callbackQuery.data === 'subscription:check')) {
    await next();
    return;
  }

  let subscribed;
  try {
    subscribed = await isSubscribedToRequiredChannels(ctx.from.id);
  } catch (error) {
    console.error(`Failed to check required-channel subscription for ${ctx.from.id}:`, error);
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('⚠️ Obunani tekshirib bo‘lmadi. Keyinroq qayta urinib ko‘ring.', { show_alert: true });
    } else {
      await ctx.reply('⚠️ Obunani tekshirib bo‘lmadi. Bot kanallarda administrator ekanini tekshiring va qayta urinib ko‘ring.');
    }
    return;
  }
  if (!subscribed) {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('🔒 Avval majburiy kanallarga obuna bo‘ling.', { show_alert: true });
    } else {
      await showSubscriptionPrompt(ctx);
    }
    return;
  }
  await qualifyReferral(String(ctx.from.id));
  await next();
});

bot.catch((error, ctx) => {
  console.error(`Telegram update failed${ctx.update && ctx.update.update_id ? ` (${ctx.update.update_id})` : ''}:`, error);
  if (ctx.chat && ctx.chat.type === 'private' && ctx.message) {
    ctx.reply('Xatolik yuz berdi. Birozdan keyin qayta urinib ko‘ring.').catch((replyError) => {
      console.error(`Failed to send error response to ${ctx.chat.id}:`, replyError);
    });
  }
});

bot.start(async (ctx) => {
  await showWelcome(ctx);
});

bot.command('help', async (ctx) => {
  await replyText(ctx, 'Botda /balance orqali ballaringizni ko‘ring, /invite orqali taklif havolasini oling va /prizes orqali NFT yoki Telegram Premium so‘rang. Yoki quyidagi menyudan foydalaning:', mainMenuKeyboard());
});

bot.command('balance', showBalance);
bot.command('invite', showInviteLink);
bot.command('prizes', showPrizeMenu);

bot.action(/^menu:(.+)$/, async (ctx) => {
  const action = ctx.match[1];
  if (action === 'home') {
    await ctx.answerCbQuery();
    await showWelcome(ctx);
    return;
  }
  if (action === 'balance') {
    await ctx.answerCbQuery();
    await showBalance(ctx);
    return;
  }
  if (action === 'invite') {
    await ctx.answerCbQuery();
    await showInviteLink(ctx);
    return;
  }
  if (action === 'prizes') {
    await ctx.answerCbQuery();
    await showPrizeMenu(ctx);
    return;
  }
  if (action.startsWith('request:')) {
    const code = action.slice('request:'.length);
    if (!/^[a-f0-9]{12}$/.test(code)) {
      await ctx.answerCbQuery('Sovg‘a identifikatori noto‘g‘ri.', { show_alert: true });
      return;
    }
    const prizes = await getCampaignPrizes();
    const prize = prizes.find((entry) => prizeCallbackCode(entry._id) === code);
    if (!prize) {
      await ctx.answerCbQuery('Bu sovg‘a katalogda topilmadi.', { show_alert: true });
      return;
    }
    try {
      const request = await createGiftRequest(ctx.from, prize._id);
      await ctx.answerCbQuery(request.notified ? '✅ So‘rov adminga yuborildi.' : 'So‘rov saqlandi, ammo adminlarga xabar yetmadi.', { show_alert: true });
      await replyText(ctx, `${prizeTypeLabel(prize)} uchun so‘rovingiz qabul qilindi. Admin sovg‘ani sizga topshiradi.`, mainMenuKeyboard());
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      await ctx.answerCbQuery(error.message, { show_alert: true });
    }
    return;
  }
  await ctx.answerCbQuery('Noma’lum amal.', { show_alert: true });
});

bot.command('admin', async (ctx) => {
  if (!await isAdmin(ctx)) {
    await ctx.reply('⛔ Bu buyruq faqat bot adminlari uchun.');
    return;
  }
  await showOwnerPanel(ctx);
});

bot.action('subscription:check', async (ctx) => {
  try {
    const subscribed = await isSubscribedToRequiredChannels(ctx.from.id);
    if (!subscribed) {
      await ctx.answerCbQuery('🔒 Hali barcha kanallarga obuna bo‘lmagansiz.', { show_alert: true });
      return;
    }
    await qualifyReferral(String(ctx.from.id));
    await ctx.answerCbQuery('✅ Obuna tasdiqlandi.');
    await showWelcome(ctx);
  } catch (error) {
    console.error(`Failed to check required-channel subscription for ${ctx.from.id}:`, error);
    await ctx.answerCbQuery('⚠️ Obunani tekshirib bo‘lmadi. Keyinroq qayta urinib ko‘ring.', { show_alert: true });
  }
});

bot.action(/^admin:(.+)$/, async (ctx) => {
  if (!await isAdmin(ctx)) {
    await ctx.answerCbQuery('⛔ Bu boshqaruv tugmasi bot adminlari uchun.', { show_alert: true });
    return;
  }
  const action = ctx.match[1];
  const ownerOnly = action === 'admins'
    || action === 'admin_add'
    || action.startsWith('admin_remove:');
  if (ownerOnly && !isOwner(ctx)) {
    await ctx.answerCbQuery('⛔ Bu amal faqat bot egasi uchun.', { show_alert: true });
    return;
  }
  if (action === 'user_search') {
    await ctx.answerCbQuery();
    ownerSessions.set(String(ctx.from.id), { action: 'user_search' });
    await ctx.reply('Qidirmoqchi bo‘lgan foydalanuvchining raqamli Telegram ID’sini yuboring. Bekor qilish: /cancel');
    return;
  }
  if (action.startsWith('user_view:')) {
    const userId = action.slice('user_view:'.length);
    if (!/^\d{1,20}$/.test(userId) || !Number.isSafeInteger(Number(userId)) || Number(userId) < 1) {
      await ctx.answerCbQuery('Telegram ID noto‘g‘ri.', { show_alert: true });
      return;
    }
    const normalizedUserId = String(Number(userId));
    await ctx.answerCbQuery();
    await renderCampaignUser(ctx, normalizedUserId, true);
    return;
  }
  if (action.startsWith('user_block:') || action.startsWith('user_unblock:')) {
    const shouldBlock = action.startsWith('user_block:');
    const userId = action.slice(shouldBlock ? 'user_block:'.length : 'user_unblock:'.length);
    if (!/^\d{1,20}$/.test(userId) || !Number.isSafeInteger(Number(userId)) || Number(userId) < 1) {
      await ctx.answerCbQuery('Telegram ID noto‘g‘ri.', { show_alert: true });
      return;
    }
    const normalizedUserId = String(Number(userId));
    const protectedAdmin = normalizedUserId === OWNER_ID
      || Boolean(await collections.admins.findOne({ _id: normalizedUserId }));
    if (protectedAdmin) {
      await ctx.answerCbQuery('⛔ Bot egasi va adminlarni bloklab bo‘lmaydi.', { show_alert: true });
      return;
    }
    if (shouldBlock) {
      await collections.blockedUsers.updateOne(
        { _id: normalizedUserId },
        { $setOnInsert: { _id: normalizedUserId, blocked_at: new Date(), blocked_by: String(ctx.from.id) } },
        { upsert: true },
      );
    } else {
      await collections.blockedUsers.deleteOne({ _id: normalizedUserId });
    }
    await ctx.answerCbQuery(shouldBlock ? 'Foydalanuvchi bloklandi.' : 'Foydalanuvchi blokdan chiqarildi.');
    await renderCampaignUser(ctx, normalizedUserId, true);
    return;
  }
  await ctx.answerCbQuery();
  if (action === 'panel') {
    await showOwnerPanel(ctx, true);
  } else if (action === 'admins') {
    await renderAdmins(ctx, true);
  } else if (action === 'admin_add') {
    ownerSessions.set(String(ctx.from.id), { action: 'admin_add' });
    await ctx.reply('Qo‘shiladigan adminning raqamli Telegram ID’sini yuboring. Bekor qilish: /cancel');
  } else if (action.startsWith('admin_remove:')) {
    const adminId = action.slice('admin_remove:'.length);
    if (!/^\d{1,20}$/.test(adminId)) {
      await ctx.reply('Admin ID formati noto‘g‘ri.');
      return;
    }
    const result = await collections.admins.deleteOne({ _id: adminId });
    await ctx.reply(result.deletedCount ? `✅ ${adminId} adminlar ro‘yxatidan o‘chirildi.` : 'ℹ️ Admin topilmadi.');
    await renderAdmins(ctx, true);
  } else if (action === 'stats') {
    const [users, referrals, pending, delivered, pendingRequests] = await Promise.all([
      collections.campaignUsers.countDocuments({}),
      collections.referrals.countDocuments({}),
      collections.rewards.countDocuments({ status: 'pending' }),
      collections.rewards.countDocuments({ status: 'delivered' }),
      collections.giftRequests.countDocuments({ status: 'pending' }),
    ]);
    const text = [
      '📊 Referral statistikasi:',
      `👤 Botni ishga tushirganlar: ${users}`,
      `Tasdiqlangan takliflar: ${referrals}`,
      `Yangi so‘rovlar: ${pendingRequests}`,
      `Eski mukofot so‘rovlari: ${pending}`,
      `Eski topshirilgan mukofotlar: ${delivered}`,
    ].join('\n');
    await ctx.editMessageText(text, twoColumnKeyboard([
      [callbackButton('🔄 Yangilash', 'admin:stats')],
      [callbackButton('⬅️ Panelga qaytish', 'admin:panel')],
    ]));
  } else if (action === 'rewards') {
    await showPendingRewards(ctx, true);
  } else if (action === 'prizes') {
    await renderPrizes(ctx, true);
  } else if (action === 'gift_requests') {
    await showGiftRequests(ctx, true);
  } else if (action === 'prize_add') {
    ownerSessions.set(String(ctx.from.id), { action: 'prize_add' });
    await ctx.reply(
      'Sovg‘a qilmoqchi bo‘lgan haqiqiy Telegram NFT gift havolasini yuboring.\n\n'
        + 'Masalan: https://t.me/nft/LunarSnake-89030\n'
        + 'Telegram NFT havolasi yoki Fragment’dagi gift sahifasi qabul qilinadi. Rasm mavjudligi tekshiriladi. '
        + 'Havoladan so‘ng referral ball narxini kiritasiz. Bir katalog sovg‘asi cheksiz so‘ralishi mumkin; har bir qabul qilingan so‘rov uchun mos NFT’ni qo‘lda topshirishingiz kerak. Bekor qilish: /cancel',
    );
  } else if (action === 'premium_add') {
    ownerSessions.set(String(ctx.from.id), { action: 'premium_months' });
    await replyText(ctx, 'Telegram Premium obuna muddatini yuboring: 1, 3, 6 yoki 12 oy. Keyin referral ball narxini belgilaysiz. Admin tasdiqlagach Premium’ni qo‘lda sovg‘a qiladi. Bekor qilish: /cancel');
  } else if (action.startsWith('gift_request_approve:') || action.startsWith('gift_request_reject:')) {
    const approve = action.startsWith('gift_request_approve:');
    const requestId = action.slice(approve
      ? 'gift_request_approve:'.length
      : 'gift_request_reject:'.length);
    if (!/^[a-f0-9-]{36}$/i.test(requestId)) {
      await ctx.reply('So‘rov identifikatori noto‘g‘ri.');
      return;
    }
    const giftRequest = await collections.giftRequests.findOneAndUpdate(
      { _id: requestId, status: 'pending' },
      {
        $set: {
          status: approve ? 'approved' : 'rejected',
          reviewed_at: new Date(),
          reviewed_by: String(ctx.from.id),
        },
      },
      { returnDocument: 'after', includeResultMetadata: false },
    );
    if (!giftRequest) {
      await ctx.reply('Bu so‘rov avval ko‘rib chiqilgan yoki topilmadi.');
      return;
    }
    const itemName = prizeTypeLabel({
      type: giftRequest.prize_type,
      premium_months: giftRequest.premium_months,
      display_name: giftRequest.prize_display_name,
    });
    const userMessage = approve
      ? `${itemName} sovg‘a so‘rovingiz qabul qilindi. Admin sovg‘ani sizga topshiradi.`
      : `${itemName} sovg‘a so‘rovingiz rad etildi. Referral ballaringiz sarflanmadi.`;
    let userNotified = true;
    try {
      await sendText(bot.telegram, Number(giftRequest.user_id), userMessage);
    } catch (error) {
      userNotified = false;
      console.error(`Could not notify user ${giftRequest.user_id} about gift request ${requestId}:`, error);
    }
    await ctx.reply(
      `${approve ? 'Sovg‘a so‘rovi qabul qilindi.' : 'Sovg‘a so‘rovi rad etildi.'}${userNotified ? '' : ' Foydalanuvchiga bot orqali xabar yetkazilmadi.'}`,
    );
    await showGiftRequests(ctx);
  } else if (action.startsWith('prize_delete:')) {
    const adminCode = action.slice('prize_delete:'.length);
    if (!/^[a-f0-9]{16}$/.test(adminCode)) {
      await ctx.reply('⚠️ NFT identifikatori noto‘g‘ri.');
      return;
    }
    const result = await collections.prizes.deleteOne({
      admin_code: adminCode,
      active: true,
    });
    await ctx.reply(result.deletedCount ? '✅ NFT yutuqlar ro‘yxatidan olib tashlandi.' : 'ℹ️ NFT topilmadi yoki avval olib tashlangan.');
    await renderPrizes(ctx);
  } else if (action.startsWith('reward_done:')) {
    const userId = action.slice('reward_done:'.length);
    if (!/^\d{1,20}$/.test(userId)) {
      await ctx.reply('⚠️ Foydalanuvchi ID formati noto‘g‘ri.');
      return;
    }
    const result = await collections.rewards.updateOne(
      { _id: userId, status: 'pending' },
      { $set: { status: 'delivered', delivered_at: new Date(), delivered_by: String(ctx.from.id) } },
    );
    if (result.modifiedCount) {
      const reward = await collections.rewards.findOne({ _id: userId });
      if (reward && reward.prize_id) {
        await collections.prizes.updateOne(
          { _id: reward.prize_id, reserved_by: userId },
          { $set: { delivered_at: new Date(), delivered_by: String(ctx.from.id) } },
        );
      }
    }
    await ctx.reply(result.modifiedCount ? '✅ Sovg‘a topshirildi deb qayd qilindi.' : 'ℹ️ Kutilayotgan sovg‘a topilmadi yoki avval topshirilgan.');
    await showPendingRewards(ctx);
  } else if (action === 'channels') {
    await renderChannels(ctx, true);
  } else if (action === 'channel_add') {
    ownerSessions.set(String(ctx.from.id), { action: 'channel_add' });
    await ctx.reply('➕ Kanal username’ini (@kanal) yoki ID’sini yuboring. Yopiq kanal uchun ID va taklif havolasini yuboring. Bot kanalda admin bo‘lishi kerak. Bekor qilish: /cancel');
  } else if (action.startsWith('channel_edit:')) {
    const channelId = Buffer.from(action.slice('channel_edit:'.length), 'base64url').toString();
    ownerSessions.set(String(ctx.from.id), { action: 'channel_edit', channelId });
    await ctx.reply(`✏️ Yangi kanal username’i/ID’si va kerak bo‘lsa taklif havolasini yuboring. Eski kanal: ${channelId}. Bekor qilish: /cancel`);
  } else if (action.startsWith('channel_delete:')) {
    const channelId = Buffer.from(action.slice('channel_delete:'.length), 'base64url').toString();
    const result = await collections.channels.deleteOne({ _id: channelId });
    await ctx.reply(result.deletedCount ? '✅ Kanal o‘chirildi.' : 'ℹ️ Kanal topilmadi.');
    await renderChannels(ctx, true);
  }
});

async function launch() {
  await initializeDatabase();
  const me = await bot.telegram.getMe();
  botUsername = me.username;
  const server = http.createServer((req, res) => {
    handleHttpRequest(req, res).catch((error) => {
      if (res.headersSent || res.destroyed) return;
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
      } else {
        console.error('Mini App HTTP request failed:', error);
        sendJson(res, 500, { error: 'Server xatosi. Keyinroq qayta urinib ko‘ring.' });
      }
    });
  });
  server.requestTimeout = 15000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '0.0.0.0', resolve);
  });
  await bot.launch();
  console.log(`Referral bot @${botUsername} is running; Mini App server listens on port ${PORT}.`);

  const shutdown = async () => {
    bot.stop('SIGTERM');
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await mongoClient.close();
  };
  process.once('SIGINT', () => shutdown().catch((error) => {
    console.error('Shutdown failed:', error);
    process.exitCode = 1;
  }));
  process.once('SIGTERM', () => shutdown().catch((error) => {
    console.error('Shutdown failed:', error);
    process.exitCode = 1;
  }));
}

if (require.main === module) {
  launch().catch((error) => {
    console.error('Bot startup failed:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  parsePrizeLink,
  validateWebAppInitData,
  HttpError,
  readJsonBody,
};
