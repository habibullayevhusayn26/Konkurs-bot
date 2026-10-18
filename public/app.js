const telegram = window.Telegram && window.Telegram.WebApp;
const elements = {
  count: document.getElementById('referral-count'),
  balance: document.getElementById('referral-balance'),
  status: document.getElementById('gift-status'),
  link: document.getElementById('invite-link'),
  copy: document.getElementById('copy-button'),
  share: document.getElementById('share-button'),
  notice: document.getElementById('notice'),
  availability: document.getElementById('gift-availability'),
  shopToggle: document.getElementById('gift-shop-toggle'),
  shopLabel: document.getElementById('gift-shop-label'),
  giftCount: document.getElementById('gift-count'),
  shop: document.getElementById('gift-shop'),
  giftGrid: document.getElementById('gift-grid'),
  selection: document.getElementById('gift-selection'),
  selectedName: document.getElementById('selected-gift-name'),
  selectedCost: document.getElementById('selected-gift-cost'),
  request: document.getElementById('request-button'),
  dialog: document.getElementById('gift-dialog'),
  dialogImage: document.getElementById('gift-dialog-image'),
  dialogPremium: document.getElementById('gift-dialog-premium'),
  dialogEdition: document.getElementById('gift-dialog-edition'),
  dialogName: document.getElementById('gift-dialog-name'),
  dialogModel: document.getElementById('gift-dialog-model'),
  dialogCost: document.getElementById('gift-dialog-cost'),
  dialogAvailability: document.getElementById('gift-dialog-availability'),
  dialogSelect: document.getElementById('gift-dialog-select'),
};

const formatter = new Intl.NumberFormat('uz-UZ');
let campaign;
let selectedPrize;
let requestPending = false;

function showError(message) {
  elements.notice.textContent = message;
  elements.notice.classList.add('visible');
}

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function formatPrizeName(name, isPremium, months) {
  if (!isPremium) return name;
  const duration = months || (/\b(\d+)\s*oy\b/i.exec(name) || [])[1];
  return duration
    ? `⭐️ ${duration} oylik Premium`
    : `⭐️ ${name.replace(/^(?:⭐️?\s*)+/u, '')}`;
}

function closeGiftDialog() {
  if (elements.dialog.open) elements.dialog.close();
}

function selectPrize(prize) {
  selectedPrize = prize;
  elements.selectedName.textContent = formatPrizeName(prize.display_name, prize.type === 'premium', prize.premium_months);
  elements.selectedCost.textContent = `${formatter.format(prize.referrals_cost)} referral ball`;
  elements.selection.hidden = false;
  elements.request.hidden = false;
  closeGiftDialog();
}

function openGiftDetails(prize) {
  const isPremium = prize.type === 'premium';
  elements.dialogImage.hidden = isPremium;
  elements.dialogPremium.hidden = !isPremium;
  elements.dialogEdition.textContent = isPremium ? '⭐️ TELEGRAM PREMIUM' : 'DIGITAL COLLECTIBLE';
  elements.dialogImage.src = prize.image_url || '';
  elements.dialogImage.alt = prize.display_name;
  elements.dialogName.textContent = formatPrizeName(prize.display_name, isPremium, prize.premium_months);
  elements.dialogModel.textContent = isPremium
    ? `⭐️ ${prize.premium_months} oylik Premium`
    : prize.model;
  elements.dialogCost.textContent = `${formatter.format(prize.referrals_cost)} referral ball`;
  const shortfall = prize.referrals_cost - campaign.referralBalance;
  elements.dialogAvailability.hidden = shortfall <= 0 && !campaign.giftRequest;
  elements.dialogAvailability.textContent = campaign.giftRequest
    ? 'Joriy so‘rovingiz admin tomonidan ko‘rib chiqilmoqda.'
    : `So‘rov yuborish uchun yana ${formatter.format(shortfall)} ball kerak.`;
  elements.dialogSelect.disabled = shortfall > 0 || Boolean(campaign.giftRequest);
  elements.dialogSelect.textContent = campaign.giftRequest
    ? 'So‘rov ko‘rib chiqilmoqda'
    : shortfall > 0
      ? `${formatter.format(shortfall)} ball yetishmaydi`
      : 'Shu sovg‘ani tanlash';
  elements.dialogSelect.onclick = () => selectPrize(prize);
  elements.dialog.showModal();
}

function renderGiftCatalog(prizes) {
  elements.giftGrid.replaceChildren();
  const hasPrizes = prizes.length > 0;
  elements.shopToggle.hidden = !hasPrizes;
  elements.shop.hidden = !hasPrizes;
  elements.shopToggle.setAttribute('aria-expanded', String(hasPrizes));
  elements.shopLabel.textContent = hasPrizes ? 'Sovg‘alarni yashirish' : 'Barcha sovg‘alarni ko‘rish';
  elements.availability.hidden = !hasPrizes;
  elements.giftCount.textContent = formatter.format(prizes.length).padStart(2, '0');
  elements.selection.hidden = true;
  elements.request.hidden = true;
  selectedPrize = null;

  if (campaign.giftRequest) {
    const isPremiumRequest = campaign.giftRequest.prizeType === 'premium';
    elements.availability.textContent =
      `${isPremiumRequest ? '⭐️ ' : ''}Sizning ${formatPrizeName(campaign.giftRequest.prizeDisplayName, isPremiumRequest)} sovg‘a so‘rovingiz admin ko‘rib chiqishida. Katalogni ko‘rishingiz mumkin.`;
  } else if (hasPrizes && !prizes.some((prize) => prize.referrals_cost <= campaign.referralBalance)) {
    elements.availability.textContent =
      'Barcha sovg‘alar va narxlari quyida ko‘rinadi. Balansingiz yetganda mos sovg‘ani tanlab so‘rov yuborishingiz mumkin.';
  } else if (hasPrizes) {
    elements.availability.textContent =
      'Narxlar referral ballarda ko‘rsatilgan. Balans yetmaydigan sovg‘alar ham katalogda qoladi.';
  } else {
    elements.availability.textContent = 'Hozircha sovg‘alar qo‘shilmagan.';
  }

  for (const prize of prizes) {
    const shortfall = prize.referrals_cost - campaign.referralBalance;
    const card = document.createElement('button');
    card.className = shortfall > 0 ? 'gift-card gift-card-locked' : 'gift-card';
    card.type = 'button';
    card.setAttribute(
      'aria-label',
      `${formatPrizeName(prize.display_name, prize.type === 'premium', prize.premium_months)}, ${formatter.format(prize.referrals_cost)} referral ball${shortfall > 0 ? `, yana ${formatter.format(shortfall)} ball kerak` : ''}. Tafsilotlarni ochish`,
    );
    card.addEventListener('click', () => openGiftDetails(prize));

    const artwork = document.createElement('span');
    artwork.className = 'gift-artwork';
    if (prize.type === 'premium') {
      artwork.append(createTextElement('span', 'gift-media-fallback premium-mark', '⭐️ PREMIUM'));
    } else {
      const image = document.createElement('img');
      image.src = prize.image_url;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => {
        image.replaceWith(createTextElement('span', 'gift-media-fallback', 'NFT'));
      }, { once: true });
      artwork.append(image);
    }
    if (prize.type !== 'premium' && prize.number) {
      artwork.append(createTextElement('span', 'gift-edition', `#${formatter.format(Number(prize.number))}`));
    }

    const details = document.createElement('span');
    details.className = 'gift-details';
    details.append(createTextElement('span', 'gift-name', formatPrizeName(prize.display_name, prize.type === 'premium', prize.premium_months)));
    details.append(createTextElement(
      'span',
      'gift-type',
      prize.type === 'premium'
        ? `⭐️ ${prize.premium_months} oylik Premium · ${formatter.format(prize.referrals_cost)} ball`
        : `${formatter.format(prize.referrals_cost)} referral ball`,
    ));
    if (shortfall > 0) {
      details.append(createTextElement(
        'span',
        'gift-availability',
        `Yana ${formatter.format(shortfall)} ball kerak`,
      ));
    } else if (campaign.giftRequest) {
      details.append(createTextElement('span', 'gift-availability', 'So‘rov ko‘rib chiqilmoqda'));
    } else {
      details.append(createTextElement('span', 'gift-availability gift-availability-ready', 'Balans yetadi'));
    }
    card.append(artwork, details);
    elements.giftGrid.append(card);
  }
}

function renderCampaign(result) {
  campaign = result;
  elements.count.textContent = formatter.format(result.referralCount);
  elements.balance.textContent = formatter.format(result.referralBalance);
  elements.link.textContent = result.botLink;
  elements.copy.disabled = false;
  elements.share.disabled = false;
  elements.status.classList.remove('success');

  if (result.giftRequest) {
    elements.status.textContent = 'So‘rov yuborildi';
    elements.status.classList.add('success');
  } else if (result.referralBalance > 0) {
    elements.status.textContent = 'Sovg‘a tanlash mumkin';
    elements.status.classList.add('success');
  } else {
    elements.status.textContent = 'Referral yig‘ing';
  }

  renderGiftCatalog(result.prizes || []);
}

async function loadCampaign() {
  if (!telegram || !telegram.initData) {
    showError('Mini App’ni Telegram ichidan oching.');
    elements.status.textContent = 'Telegram kerak';
    return;
  }
  telegram.ready();
  telegram.expand();
  if (typeof telegram.setHeaderColor === 'function') telegram.setHeaderColor('#000000');
  if (typeof telegram.setBackgroundColor === 'function') telegram.setBackgroundColor('#000000');
  try {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: telegram.initData }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Ma’lumotlarni yuklab bo‘lmadi.');
    renderCampaign(result);
  } catch (error) {
    showError(error.message);
    elements.status.textContent = 'Yuklanmadi';
  }
}

elements.shopToggle.addEventListener('click', () => {
  elements.shop.hidden = !elements.shop.hidden;
  const expanded = !elements.shop.hidden;
  elements.shopToggle.setAttribute('aria-expanded', String(expanded));
  elements.shopLabel.textContent = expanded ? 'Sovg‘alarni yashirish' : 'Barcha sovg‘alarni ko‘rish';
});

document.getElementById('gift-dialog-close').addEventListener('click', closeGiftDialog);
elements.dialog.addEventListener('click', (event) => {
  if (event.target === elements.dialog) closeGiftDialog();
});

elements.request.addEventListener('click', async () => {
  if (!selectedPrize || requestPending) return;
  requestPending = true;
  elements.request.disabled = true;
  elements.request.textContent = 'So‘rov yuborilmoqda…';
  elements.notice.classList.remove('visible');
  try {
    const response = await fetch('/api/gift-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: telegram.initData, prizeId: selectedPrize._id }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.requestSaved) await loadCampaign();
      throw new Error(result.error || 'So‘rov yuborilmadi.');
    }
    elements.notice.textContent = 'So‘rovingiz adminga yuborildi. Javob bot orqali keladi.';
    elements.notice.classList.add('visible');
    await loadCampaign();
  } catch (error) {
    showError(error.message);
  } finally {
    requestPending = false;
    elements.request.disabled = false;
    elements.request.textContent = 'Olish uchun so‘rov yuborish';
  }
});

elements.copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(elements.link.textContent);
    elements.notice.textContent = 'Taklif havolasi nusxalandi.';
    elements.notice.classList.add('visible');
  } catch {
    showError('Havolani nusxalab bo‘lmadi. Havolani bosib ushlab nusxalang.');
  }
});

elements.share.addEventListener('click', () => {
  const text = 'Botga qo‘shiling va referral kampaniyasida qatnashing.';
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(elements.link.textContent)}&text=${encodeURIComponent(text)}`;
  if (telegram && typeof telegram.openTelegramLink === 'function') {
    telegram.openTelegramLink(shareUrl);
  } else {
    window.location.href = shareUrl;
  }
});

loadCampaign();
