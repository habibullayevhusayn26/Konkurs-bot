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
  giftCount: document.getElementById('gift-count'),
  shop: document.getElementById('gift-shop'),
  giftGrid: document.getElementById('gift-grid'),
  selection: document.getElementById('gift-selection'),
  selectedName: document.getElementById('selected-gift-name'),
  selectedCost: document.getElementById('selected-gift-cost'),
  request: document.getElementById('request-button'),
  dialog: document.getElementById('gift-dialog'),
  dialogImage: document.getElementById('gift-dialog-image'),
  dialogName: document.getElementById('gift-dialog-name'),
  dialogModel: document.getElementById('gift-dialog-model'),
  dialogCost: document.getElementById('gift-dialog-cost'),
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

function closeGiftDialog() {
  if (elements.dialog.open) elements.dialog.close();
}

function selectPrize(prize) {
  selectedPrize = prize;
  elements.selectedName.textContent = prize.display_name;
  elements.selectedCost.textContent = `${formatter.format(prize.referrals_cost)} referral ball`;
  elements.selection.hidden = false;
  elements.request.hidden = false;
  closeGiftDialog();
}

function openGiftDetails(prize) {
  elements.dialogImage.src = prize.image_url;
  elements.dialogImage.alt = prize.display_name;
  elements.dialogName.textContent = prize.display_name;
  elements.dialogModel.textContent = prize.model;
  elements.dialogCost.textContent = `${formatter.format(prize.referrals_cost)} referral ball`;
  elements.dialogSelect.disabled = prize.referrals_cost > campaign.referralBalance;
  elements.dialogSelect.textContent = prize.referrals_cost > campaign.referralBalance
    ? 'Balans yetarli emas'
    : 'Shu sovg‘ani tanlash';
  elements.dialogSelect.onclick = () => selectPrize(prize);
  elements.dialog.showModal();
}

function renderGiftCatalog(prizes) {
  elements.giftGrid.replaceChildren();
  const affordablePrizes = prizes.filter(
    (prize) => prize.referrals_cost <= campaign.referralBalance,
  );
  elements.shopToggle.hidden = affordablePrizes.length === 0 || Boolean(campaign.giftRequest);
  elements.shop.hidden = true;
  elements.availability.hidden = affordablePrizes.length > 0 && !campaign.giftRequest;
  elements.giftCount.textContent = formatter.format(affordablePrizes.length).padStart(2, '0');
  elements.selection.hidden = true;
  elements.request.hidden = true;
  selectedPrize = null;

  if (campaign.giftRequest) {
    elements.availability.textContent =
      `Sizning ${campaign.giftRequest.prizeDisplayName} sovg‘a so‘rovingiz admin ko‘rib chiqishida.`;
    return;
  }

  if (!affordablePrizes.length) {
    const message = prizes.length
      ? 'Balansingizga mos NFT sovg‘a hozircha yo‘q. Referral yig‘ishda davom eting.'
      : 'Hozircha tanlash uchun NFT sovg‘a mavjud emas.';
    elements.availability.textContent = message;
    return;
  }
  elements.availability.textContent = '';

  for (const prize of affordablePrizes) {
    const card = document.createElement('button');
    card.className = 'gift-card';
    card.type = 'button';
    card.setAttribute('aria-label', `${prize.display_name} tafsilotlarini ochish`);
    card.addEventListener('click', () => openGiftDetails(prize));

    const artwork = document.createElement('span');
    artwork.className = 'gift-artwork';
    const image = document.createElement('img');
    image.src = prize.image_url;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      image.replaceWith(createTextElement('span', 'gift-media-fallback', 'NFT'));
    }, { once: true });
    artwork.append(image);
    if (prize.number) {
      artwork.append(createTextElement('span', 'gift-edition', `#${formatter.format(Number(prize.number))}`));
    }

    const details = document.createElement('span');
    details.className = 'gift-details';
    details.append(createTextElement('span', 'gift-name', prize.display_name));
    details.append(createTextElement(
      'span',
      'gift-type',
      `${formatter.format(prize.referrals_cost)} referral ball`,
    ));
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
  elements.shopToggle.setAttribute('aria-expanded', String(!elements.shop.hidden));
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
