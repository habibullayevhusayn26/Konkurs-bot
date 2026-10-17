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
const GIFT_CATALOG_CACHE_MS = 15 * 60 * 1000;
const GIFT_STICKER_CACHE_LIMIT = 32 * 1024 * 1024;
const MAX_GIFT_STICKER_SIZE = 10 * 1024 * 1024;
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
let giftCatalogCache = { expiresAt: 0, gifts: [], error: null };
let giftCatalogRequest;
const giftStickerCache = new Map();
const giftStickerRequests = new Map();
let giftStickerCacheSize = 0;

async function initializeDatabase() {
  await mongoClient.connect();
  const database = mongoClient.db(process.env.MONGODB_DB || 'telegram_moderation');
  collections = {
    config: database.collection('bot_config'),
    channels: database.collection('required_channels'),
    campaignUsers: database.collection('campaign_users'),
    referrals: database.collection('qualified_referrals'),
    rewards: database.collection('referral_rewards'),
    previousRecipients: database.collection('bot_recipients'),
  };
  await collections.referrals.createIndex({ inviter_id: 1 });
  await collections.rewards.createIndex({ status: 1, created_at: 1 });
}

function isOwner(ctx) {
  return Boolean(OWNER_ID) && ctx.from && String(ctx.from.id) === OWNER_ID;
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
          username: user.username || null,
          last_seen_at: new Date(),
        },
      },
    );
    return existing;
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
    username: user.username || null,
    referred_by: oldRecipient ? null : inviterId,
    campaign_new: !oldRecipient,
    created_at: new Date(),
    last_seen_at: new Date(),
  };
  await collections.campaignUsers.updateOne(
    { _id: userId },
    { $setOnInsert: account },
    { upsert: true },
  );
  return collections.campaignUsers.findOne({ _id: userId });
}

async function getReferralThreshold() {
  const setting = await collections.config.findOne({ _id: 'referral_threshold' });
  return setting ? setting.value : null;
}

async function getCollectibleGiftCatalog() {
  if (giftCatalogCache.expiresAt > Date.now()) {
    if (giftCatalogCache.error) throw new Error(giftCatalogCache.error);
    return giftCatalogCache.gifts;
  }
  if (giftCatalogRequest) return giftCatalogRequest;

  giftCatalogRequest = (async () => {
    try {
      const result = await bot.telegram.callApi('getAvailableGifts', {});
      if (!result || !Array.isArray(result.gifts)) {
        throw new Error('Telegram returned an invalid available-gifts response.');
      }

      const gifts = result.gifts
        .filter((gift) => gift
          && typeof gift.id === 'string'
          && gift.sticker
          && typeof gift.sticker.file_id === 'string'
          && (!Number.isInteger(gift.remaining_count) || gift.remaining_count > 0))
        .map((gift) => ({
          id: gift.id,
          name: typeof gift.name === 'string' && gift.name
            ? gift.name
            : `Telegram sovg‘asi #${gift.id.slice(-5)}`,
          starCount: gift.star_count,
          upgradeStarCount: Number.isInteger(gift.upgrade_star_count) && gift.upgrade_star_count > 0
            ? gift.upgrade_star_count
            : null,
          totalCount: Number.isInteger(gift.total_count) ? gift.total_count : null,
          remainingCount: Number.isInteger(gift.remaining_count) ? gift.remaining_count : null,
          emoji: gift.sticker.emoji || '🎁',
          stickerFileId: gift.sticker.file_id,
          stickerIsVideo: Boolean(gift.sticker.is_video),
          stickerIsAnimated: Boolean(gift.sticker.is_animated),
        }));

      giftCatalogCache = { expiresAt: Date.now() + GIFT_CATALOG_CACHE_MS, gifts, error: null };
      return gifts;
    } catch (error) {
      giftCatalogCache = {
        expiresAt: Date.now() + 60 * 1000,
        gifts: [],
        error: error.message,
      };
      throw error;
    }
  })();
  try {
    return await giftCatalogRequest;
  } finally {
    giftCatalogRequest = null;
  }
}

async function getGiftSticker(gift) {
  const cached = giftStickerCache.get(gift.id);
  if (cached && cached.expiresAt > Date.now()) {
    giftStickerCache.delete(gift.id);
    giftStickerCache.set(gift.id, cached);
    return cached;
  }
  if (cached) {
    giftStickerCache.delete(gift.id);
    giftStickerCacheSize -= cached.sticker.length;
  }
  if (giftStickerRequests.has(gift.id)) return giftStickerRequests.get(gift.id);

  const request = (async () => {
    const file = await bot.telegram.getFile(gift.stickerFileId);
    if (!file.file_path) throw new Error(`Telegram did not return a file path for gift ${gift.id}.`);
    const extension = path.extname(file.file_path).toLowerCase();
    const contentTypes = {
      '.webp': 'image/webp',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.tgs': 'application/x-tgsticker',
      '.webm': 'video/webm',
    };
    const contentType = contentTypes[extension];
    if (!contentType) throw new Error(`Telegram returned an unsupported sticker type for gift ${gift.id}.`);

    const fileUrl = await bot.telegram.getFileLink(file);
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Could not download the Telegram gift sticker (${response.status}).`);
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_GIFT_STICKER_SIZE) {
      throw new Error(`Telegram gift sticker is unexpectedly large (${gift.id}).`);
    }
    const sticker = Buffer.from(await response.arrayBuffer());
    if (sticker.length > MAX_GIFT_STICKER_SIZE) {
      throw new Error(`Telegram gift sticker is unexpectedly large (${gift.id}).`);
    }

    const result = { sticker, contentType, expiresAt: Date.now() + 60 * 60 * 1000 };
    if (sticker.length <= GIFT_STICKER_CACHE_LIMIT) {
      while (giftStickerCache.size && giftStickerCacheSize + sticker.length > GIFT_STICKER_CACHE_LIMIT) {
        const [oldestId, oldest] = giftStickerCache.entries().next().value;
        giftStickerCache.delete(oldestId);
        giftStickerCacheSize -= oldest.sticker.length;
      }
      giftStickerCache.set(gift.id, result);
      giftStickerCacheSize += sticker.length;
    }
    return result;
  })();
  giftStickerRequests.set(gift.id, request);
  try {
    return await request;
  } finally {
    giftStickerRequests.delete(gift.id);
  }
}

async function createRewardIfEligible(userId) {
  const threshold = await getReferralThreshold();
  if (!threshold) return false;
  const referrals = await collections.referrals.countDocuments({ inviter_id: userId });
  if (referrals < threshold) return false;
  const user = await collections.campaignUsers.findOne({ _id: userId });
  if (!user) return false;
  const result = await collections.rewards.updateOne(
    { _id: userId },
    {
      $setOnInsert: {
        user_id: userId,
        first_name: user.first_name || '',
        username: user.username || null,
        status: 'pending',
        threshold_at_award: threshold,
        referrals_at_award: referrals,
        created_at: new Date(),
      },
    },
    { upsert: true },
  );
  return result.upsertedCount > 0;
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

  const rewardCreated = await createRewardIfEligible(user.referred_by);
  if (rewardCreated) {
    try {
      await bot.telegram.sendMessage(
        Number(user.referred_by),
        '🎉 Tabriklaymiz! Referral sharti bajarildi. NFT gift’ingizni admin qo‘lda topshiradi.',
      );
    } catch (error) {
      console.error(`Could not notify referrer ${user.referred_by} about the earned gift:`, error);
    }
  }
}

function startReferralPayload(ctx) {
  const text = ctx.message && ctx.message.text || '';
  const match = /^\/start(?:@\w+)?(?:\s+(\S+))?/i.exec(text);
  return match ? match[1] || '' : '';
}

function callbackButton(text, data, style = 'primary') {
  return { ...Markup.button.callback(text, data), style };
}

function urlButton(text, url) {
  return Markup.button.url(text, url);
}

function subscriptionKeyboard(channels) {
  const rows = channels.map((channel) => [
    urlButton(`📢 ${channel.title || channel.channel_id}`, channel.invite_url),
  ]);
  rows.push([callbackButton('✅ Obunani tekshirish', 'subscription:check', 'success')]);
  return Markup.inlineKeyboard(rows);
}

async function showSubscriptionPrompt(ctx) {
  await ctx.reply(
    '🔒 Referral hisoblanishi va Mini App’dan foydalanish uchun quyidagi kanal(lar)ga obuna bo‘ling, so‘ng tekshiring.',
    subscriptionKeyboard(await getRequiredChannels()),
  );
}

function miniAppKeyboard() {
  if (!WEB_APP_URL) return undefined;
  return Markup.inlineKeyboard([
    [Markup.button.webApp('🎁 Mini Appni ochish', WEB_APP_URL)],
  ]);
}

async function showWelcome(ctx) {
  const keyboard = miniAppKeyboard();
  const message = WEB_APP_URL
    ? '👋 Salom! Do‘stlaringizni taklif qiling, referral shartini bajaring va NFT gift yutib oling. Holatingiz Mini App’da.'
    : '👋 Salom! Bot ishlayapti, ammo Mini App tugmasi uchun .env faylida HTTPS WEB_APP_URL manzilini sozlash kerak.';
  await ctx.reply(message, keyboard);
}

async function getCampaignStats(userId) {
  await createRewardIfEligible(userId);
  const [profile, referralCount, threshold, reward] = await Promise.all([
    collections.campaignUsers.findOne({ _id: userId }),
    collections.referrals.countDocuments({ inviter_id: userId }),
    getReferralThreshold(),
    collections.rewards.findOne({ _id: userId }),
  ]);
  const botLink = `https://t.me/${botUsername}?start=ref_${userId}`;
  return {
    firstName: profile ? profile.first_name : '',
    referralCount,
    threshold,
    giftStatus: reward ? reward.status : null,
    giftReferrals: reward ? reward.referrals_at_award : null,
    botLink,
  };
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
  '/lottie.min.js': [
    path.join(__dirname, 'node_modules', 'lottie-web', 'build', 'player', 'lottie.min.js'),
    'text/javascript; charset=utf-8',
  ],
};

async function handleHttpRequest(req, res) {
  const requestUrl = new URL(req.url, 'http://localhost');
  const giftStickerMatch = /^\/api\/gifts\/([^/]+)\/sticker$/.exec(requestUrl.pathname);
  if (giftStickerMatch && req.method === 'GET') {
    const giftId = decodeURIComponent(giftStickerMatch[1]);
    const gift = (await getCollectibleGiftCatalog()).find((entry) => entry.id === giftId);
    if (!gift) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Gift not found');
      return;
    }
    const { sticker, contentType } = await getGiftSticker(gift);
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'public, max-age=86400, immutable',
      'x-content-type-options': 'nosniff',
    });
    res.end(sticker);
    return;
  }
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
    await ensureCampaignUser(telegramUser);
    const subscribed = await isSubscribedToRequiredChannels(telegramUser.id);
    if (!subscribed) {
      sendJson(res, 403, { error: 'Majburiy kanallarga obuna bo‘ling, so‘ng Mini App’ni qayta oching.' });
      return;
    }
    await qualifyReferral(String(telegramUser.id));
    const campaignStats = await getCampaignStats(String(telegramUser.id));
    let gifts;
    let giftCatalogError = null;
    try {
      gifts = await getCollectibleGiftCatalog();
    } catch (error) {
      console.error('Failed to load Telegram collectible gift catalog:', error);
      giftCatalogError = 'Haqiqiy Telegram sovg‘alarini yuklab bo‘lmadi. Keyinroq qayta urinib ko‘ring.';
    }
    sendJson(res, 200, { ...campaignStats, gifts: gifts || [], giftCatalogError });
    return;
  }
  const file = staticFiles[requestUrl.pathname];
  if (!file || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const filePath = requestUrl.pathname === '/lottie.min.js'
    ? file[0]
    : path.join(__dirname, 'public', file[0]);
  const content = await fs.promises.readFile(filePath);
  res.writeHead(200, {
    'content-type': file[1],
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self' https://telegram.org; script-src 'self' https://telegram.org; style-src 'self'; connect-src 'self'; img-src 'self' data:",
  });
  res.end(req.method === 'HEAD' ? undefined : content);
}

function ownerPanelKeyboard() {
  return Markup.inlineKeyboard([
    [callbackButton('📊 Referral statistikasi', 'admin:stats')],
    [callbackButton('🎯 Referral chegarasini sozlash', 'admin:threshold', 'success')],
    [callbackButton('🎁 Kutilayotgan giftlar', 'admin:rewards')],
    [callbackButton('📢 Majburiy obuna kanallari', 'admin:channels')],
  ]);
}

async function showOwnerPanel(ctx, edit = false) {
  const text = '🛠️ Referral bot boshqaruvi\n\nBo‘limni tanlang:';
  if (edit && ctx.callbackQuery && ctx.callbackQuery.message) {
    await ctx.editMessageText(text, ownerPanelKeyboard());
  } else {
    await ctx.reply(text, ownerPanelKeyboard());
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
    await ctx.editMessageText(text, Markup.inlineKeyboard(rows));
  } else {
    await ctx.reply(text, Markup.inlineKeyboard(rows));
  }
}

async function showPendingRewards(ctx, edit = false) {
  const [rewards, total] = await Promise.all([
    collections.rewards.find({ status: 'pending' }).sort({ created_at: 1 }).limit(20).toArray(),
    collections.rewards.countDocuments({ status: 'pending' }),
  ]);
  const text = total
    ? `🎁 NFT giftni qo‘lda topshirib, “Topshirildi” tugmasini bosing. Kutilayotgan: ${total}${total > rewards.length ? ` (birinchi ${rewards.length} tasi)` : ''}.\n\n${rewards.map((reward, index) => `${index + 1}. ${reward.first_name || 'Foydalanuvchi'}${reward.username ? ` (@${reward.username})` : ''} — ID: ${reward.user_id}`).join('\n')}`
    : '🎁 Hozircha topshirilishi kutilayotgan gift yo‘q.';
  const rows = rewards.map((reward) => [
    callbackButton(
      `✅ ID: ${reward.user_id}`,
      `admin:reward_done:${reward.user_id}`,
      'success',
    ),
  ]);
  rows.push([callbackButton('⬅️ Panelga qaytish', 'admin:panel')]);
  if (edit && ctx.callbackQuery && ctx.callbackQuery.message) {
    await ctx.editMessageText(text, Markup.inlineKeyboard(rows));
  } else {
    await ctx.reply(text, Markup.inlineKeyboard(rows));
  }
}

async function handleOwnerInput(ctx) {
  const session = ownerSessions.get(OWNER_ID);
  if (!session) return false;
  const text = ctx.message.text || '';
  if (/^\/cancel(?:@\w+)?(?:\s|$)/i.test(text.trim())) {
    ownerSessions.delete(OWNER_ID);
    await ctx.reply('❎ Amal bekor qilindi.');
    await showOwnerPanel(ctx);
    return true;
  }
  if (session.action === 'threshold') {
    const threshold = Number(text.trim());
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 1000000) {
      await ctx.reply('⚠️ Chegara 1 dan 1 000 000 gacha bo‘lgan butun son bo‘lishi kerak. Qayta kiriting yoki /cancel yozing.');
      return true;
    }
    await collections.config.updateOne(
      { _id: 'referral_threshold' },
      { $set: { value: threshold, updated_at: new Date() } },
      { upsert: true },
    );
    ownerSessions.delete(OWNER_ID);
    await ctx.reply(`✅ Yangi foydalanuvchi taklif qilish chegarasi ${threshold} qilib saqlandi.`);
    await showOwnerPanel(ctx);
    return true;
  }
  if (session.action === 'channel_add' || session.action === 'channel_edit') {
    try {
      await saveChannelFromOwner(ctx, text, session.channelId);
      ownerSessions.delete(OWNER_ID);
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
  if (!ctx.chat || ctx.chat.type !== 'private' || !ctx.from) return;
  const owner = isOwner(ctx);
  if (owner && ctx.message && ctx.message.text && ownerSessions.has(OWNER_ID)) {
    if (await handleOwnerInput(ctx)) return;
  }

  const referralPayload = ctx.message && /^\/start(?:@\w+)?(?:\s|$)/i.test(ctx.message.text || '')
    ? startReferralPayload(ctx)
    : '';
  await ensureCampaignUser(ctx.from, referralPayload);
  if (owner || (ctx.callbackQuery && ctx.callbackQuery.data === 'subscription:check')) {
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
    ctx.reply('⚠️ Xatolik yuz berdi. Birozdan keyin qayta urinib ko‘ring.').catch((replyError) => {
      console.error(`Failed to send error response to ${ctx.chat.id}:`, replyError);
    });
  }
});

bot.start(async (ctx) => {
  await showWelcome(ctx);
});

bot.command('help', async (ctx) => {
  await ctx.reply('🎁 Do‘stlaringizni botga taklif qiling. Taklif qilgan foydalanuvchi botni ishga tushirib, majburiy kanallarga obuna bo‘lgach hisobga qo‘shiladi. Referral soni va gift holatini Mini App’da ko‘ring.');
});

bot.command('admin', async (ctx) => {
  if (!isOwner(ctx)) {
    await ctx.reply('⛔ Bu buyruq faqat bot egasi uchun.');
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
  if (!isOwner(ctx)) {
    await ctx.answerCbQuery('⛔ Bu boshqaruv tugmasi bot egasi uchun.', { show_alert: true });
    return;
  }
  const action = ctx.match[1];
  await ctx.answerCbQuery();
  if (action === 'panel') {
    await showOwnerPanel(ctx, true);
  } else if (action === 'stats') {
    const [users, referrals, pending, delivered, threshold] = await Promise.all([
      collections.campaignUsers.countDocuments({}),
      collections.referrals.countDocuments({}),
      collections.rewards.countDocuments({ status: 'pending' }),
      collections.rewards.countDocuments({ status: 'delivered' }),
      getReferralThreshold(),
    ]);
    const text = [
      '📊 Referral statistikasi:',
      `👤 Botni ishga tushirganlar: ${users}`,
      `✅ Shartni bajargan takliflar: ${referrals}`,
      `🎯 Yutuq chegarasi: ${threshold || 'sozlanmagan'}`,
      `🎁 Kutilayotgan giftlar: ${pending}`,
      `📦 Topshirilgan giftlar: ${delivered}`,
    ].join('\n');
    await ctx.editMessageText(text, Markup.inlineKeyboard([
      [callbackButton('🔄 Yangilash', 'admin:stats')],
      [callbackButton('⬅️ Panelga qaytish', 'admin:panel')],
    ]));
  } else if (action === 'threshold') {
    const threshold = await getReferralThreshold();
    ownerSessions.set(OWNER_ID, { action: 'threshold' });
    await ctx.reply(`🎯 Hozirgi chegara: ${threshold || 'sozlanmagan'}.\nNechta tasdiqlangan taklifdan keyin bitta NFT gift yutish mumkin? Yuboring yoki /cancel yozing.`);
  } else if (action === 'rewards') {
    await showPendingRewards(ctx, true);
  } else if (action.startsWith('reward_done:')) {
    const userId = action.slice('reward_done:'.length);
    if (!/^\d{1,20}$/.test(userId)) {
      await ctx.reply('⚠️ Foydalanuvchi ID formati noto‘g‘ri.');
      return;
    }
    const result = await collections.rewards.updateOne(
      { _id: userId, status: 'pending' },
      { $set: { status: 'delivered', delivered_at: new Date(), delivered_by: OWNER_ID } },
    );
    await ctx.reply(result.modifiedCount ? '✅ Sovg‘a topshirildi deb qayd qilindi.' : 'ℹ️ Kutilayotgan sovg‘a topilmadi yoki avval topshirilgan.');
    await showPendingRewards(ctx);
  } else if (action === 'channels') {
    await renderChannels(ctx, true);
  } else if (action === 'channel_add') {
    ownerSessions.set(OWNER_ID, { action: 'channel_add' });
    await ctx.reply('➕ Kanal username’ini (@kanal) yoki ID’sini yuboring. Yopiq kanal uchun ID va taklif havolasini yuboring. Bot kanalda admin bo‘lishi kerak. Bekor qilish: /cancel');
  } else if (action.startsWith('channel_edit:')) {
    const channelId = Buffer.from(action.slice('channel_edit:'.length), 'base64url').toString();
    ownerSessions.set(OWNER_ID, { action: 'channel_edit', channelId });
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

launch().catch((error) => {
  console.error('Bot startup failed:', error);
  process.exitCode = 1;
});
