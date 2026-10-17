const telegram = window.Telegram && window.Telegram.WebApp;
const elements = {
  count: document.getElementById('referral-count'),
  target: document.getElementById('referral-target'),
  status: document.getElementById('gift-status'),
  fill: document.getElementById('progress-fill'),
  progress: document.querySelector('.progress-track'),
  caption: document.getElementById('progress-caption'),
  link: document.getElementById('invite-link'),
  copy: document.getElementById('copy-button'),
  share: document.getElementById('share-button'),
  notice: document.getElementById('notice'),
  giftGrid: document.getElementById('gift-grid'),
  giftCount: document.getElementById('gift-count'),
};

const formatter = new Intl.NumberFormat('uz-UZ');

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

function renderGiftCatalog(prizes) {
  elements.giftGrid.replaceChildren();
  elements.giftCount.textContent = formatter.format(prizes.length);
  if (!prizes.length) {
    elements.giftGrid.append(createTextElement(
      'p',
      'catalog-message',
      'Hozircha yutuq NFT’lari qo‘shilmagan. Admin tez orada haqiqiy sovg‘alarni joylaydi.',
    ));
    return;
  }

  for (const prize of prizes.sort((left, right) => Number(right.is_awarded) - Number(left.is_awarded))) {
    const card = document.createElement('a');
    card.className = prize.is_awarded ? 'gift-card gift-card-won' : 'gift-card';
    card.href = prize.telegram_url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.setAttribute('aria-label', `${prize.display_name} Telegram NFT`);
    card.addEventListener('click', (event) => {
      if (!telegram || typeof telegram.openTelegramLink !== 'function') return;
      event.preventDefault();
      telegram.openTelegramLink(prize.telegram_url);
    });

    const artwork = document.createElement('div');
    artwork.className = 'gift-artwork';
    const image = document.createElement('img');
    image.src = prize.image_url;
    image.alt = prize.display_name;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      image.replaceWith(createTextElement('span', 'gift-media-fallback', '💎'));
    }, { once: true });
    artwork.append(image);
    artwork.append(createTextElement('span', 'gift-edition', `#${formatter.format(Number(prize.number))}`));
    if (prize.is_awarded) {
      artwork.append(createTextElement('span', 'gift-won-badge', 'SIZ YUTDINGIZ'));
    }

    const details = document.createElement('div');
    details.className = 'gift-details';
    details.append(createTextElement('h3', 'gift-name', prize.model));
    details.append(createTextElement(
      'p',
      prize.is_awarded ? 'gift-type gift-collectible' : 'gift-type',
      prize.is_awarded ? 'Sizning sovg‘angiz 🎉' : 'Telegram NFT Gift',
    ));
    card.append(artwork, details);
    elements.giftGrid.append(card);
  }
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
    renderGiftCatalog(result.prizes || []);
    elements.count.textContent = String(result.referralCount);
    elements.target.textContent = result.threshold ? String(result.threshold) : '—';
    elements.link.textContent = result.botLink;
    elements.copy.disabled = false;
    elements.share.disabled = false;

    if (result.giftStatus === 'delivered') {
      elements.status.textContent = 'Gift topshirildi';
      elements.status.classList.add('success');
    } else if (result.giftStatus === 'pending') {
      elements.status.textContent = 'NFT yutdingiz!';
      elements.status.classList.add('success');
    } else if (result.eligibleForReward) {
      elements.status.textContent = 'Sovg‘a kutilmoqda';
    } else if (!result.threshold) {
      elements.status.textContent = 'Chegara kutilmoqda';
    } else {
      elements.status.textContent = 'Davom eting';
    }

    const progress = result.threshold
      ? Math.min(100, Math.round((result.referralCount / result.threshold) * 100))
      : 0;
    elements.fill.style.width = `${progress}%`;
    elements.progress.setAttribute('aria-valuenow', String(progress));
    elements.caption.textContent = result.threshold
      ? result.giftStatus
        ? result.rewardPrize
          ? `Siz ${result.rewardPrize.displayName} sovg‘asini yutdingiz. Admin topshiradi.`
          : 'NFT sovg‘angiz qayd etilgan. Admin topshiradi.'
        : result.eligibleForReward
          ? 'Shart bajarildi! Admin NFT sovg‘asini yutuqlar ro‘yxatiga qo‘shishi bilan sizga biriktiriladi.'
          : `Yana ${Math.max(0, result.threshold - result.referralCount)} ta tasdiqlangan taklif kerak.`
      : 'Gift yutish chegarasini bot admini sozlaydi.';
  } catch (error) {
    showError(error.message);
    elements.status.textContent = 'Yuklanmadi';
    renderGiftCatalog([], error.message);
  }
}

elements.copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(elements.link.textContent);
    elements.notice.textContent = 'Taklif havolasi nusxalandi.';
    elements.notice.classList.add('visible');
  } catch (error) {
    showError('Havolani nusxalab bo‘lmadi. Havolani bosib ushlab nusxalang.');
  }
});

elements.share.addEventListener('click', () => {
  const text = 'Botga qo‘shiling va NFT gift referral kampaniyasida qatnashing!';
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(elements.link.textContent)}&text=${encodeURIComponent(text)}`;
  if (telegram && typeof telegram.openTelegramLink === 'function') {
    telegram.openTelegramLink(shareUrl);
  } else {
    window.location.href = shareUrl;
  }
});

loadCampaign();
