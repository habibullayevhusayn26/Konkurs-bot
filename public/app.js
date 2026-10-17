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
const giftMediaObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      giftMediaObserver.unobserve(entry.target);
      loadGiftMedia(entry.target);
    }
  }, { rootMargin: '120px' })
  : null;

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

async function loadGiftMedia(container) {
  const gift = container.gift;
  const url = `/api/gifts/${encodeURIComponent(gift.id)}/sticker`;
  try {
    if (gift.stickerIsVideo) {
      const video = document.createElement('video');
      video.src = url;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'none';
      video.setAttribute('aria-label', gift.name);
      video.addEventListener('error', () => {
        container.replaceChildren(createTextElement('span', 'gift-media-fallback', gift.emoji));
      }, { once: true });
      container.replaceChildren(video);
      return;
    }
    if (gift.stickerIsAnimated) {
      if (!window.lottie || !('DecompressionStream' in window)) {
        throw new Error('Animated gift preview is not supported in this Telegram app.');
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Gift preview request failed (${response.status}).`);
      const compressed = await response.arrayBuffer();
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
      const animationData = JSON.parse(await new Response(stream).text());
      window.lottie.loadAnimation({
        container,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData,
      });
      return;
    }
    const image = document.createElement('img');
    image.src = url;
    image.alt = gift.name;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      container.replaceChildren(createTextElement('span', 'gift-media-fallback', gift.emoji));
    }, { once: true });
    container.replaceChildren(image);
  } catch (error) {
    console.error(`Could not render Telegram gift ${gift.id}:`, error);
    container.replaceChildren(createTextElement('span', 'gift-media-fallback', '🎁'));
    container.title = 'Haqiqiy sovg‘a rasmi yuklanmadi.';
  }
}

function renderGiftCatalog(gifts, catalogError) {
  elements.giftGrid.replaceChildren();
  elements.giftCount.textContent = formatter.format(gifts.length);
  if (catalogError) {
    elements.giftGrid.append(createTextElement('p', 'catalog-message error', catalogError));
    return;
  }
  if (!gifts.length) {
    elements.giftGrid.append(createTextElement(
      'p',
      'catalog-message',
      'Telegram hozir katalogda ko‘rsatish uchun sovg‘a qaytarmadi. Keyinroq qayta oching.',
    ));
    return;
  }

  for (const gift of gifts) {
    const card = document.createElement('article');
    card.className = 'gift-card';
    const artwork = document.createElement('div');
    artwork.className = 'gift-artwork';
    artwork.append(createTextElement('span', 'gift-media-fallback', gift.emoji));
    const sticker = document.createElement('div');
    sticker.className = 'gift-sticker';
    sticker.gift = gift;
    artwork.append(sticker);
    if (gift.totalCount !== null) {
      artwork.append(createTextElement(
        'span',
        'gift-edition',
        gift.remainingCount === null
          ? `LIMITED · ${formatter.format(gift.totalCount)}`
          : `${formatter.format(gift.remainingCount)} / ${formatter.format(gift.totalCount)}`,
      ));
    }

    const details = document.createElement('div');
    details.className = 'gift-details';
    details.append(createTextElement('h3', 'gift-name', gift.name));
    details.append(createTextElement(
      'p',
      gift.upgradeStarCount === null ? 'gift-type' : 'gift-type gift-collectible',
      gift.upgradeStarCount === null ? 'Telegram sovg‘asi' : 'NFT upgrade mumkin',
    ));
    const price = document.createElement('p');
    price.className = 'gift-price';
    price.append(createTextElement('span', 'gift-star-price', `⭐ ${formatter.format(gift.starCount)}`));
    price.append(createTextElement(
      'span',
      gift.upgradeStarCount === null ? 'gift-upgrade-price gift-standard' : 'gift-upgrade-price',
      gift.upgradeStarCount === null
        ? 'NFT upgrade ma’lum emas'
        : `⬆ ${formatter.format(gift.upgradeStarCount)}`,
    ));
    details.append(price);
    card.append(artwork, details);
    elements.giftGrid.append(card);

    if (giftMediaObserver) giftMediaObserver.observe(sticker);
    else loadGiftMedia(sticker);
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
    renderGiftCatalog(result.gifts || [], result.giftCatalogError);
    elements.count.textContent = String(result.referralCount);
    elements.target.textContent = result.threshold ? String(result.threshold) : '—';
    elements.link.textContent = result.botLink;
    elements.copy.disabled = false;
    elements.share.disabled = false;

    if (result.giftStatus === 'delivered') {
      elements.status.textContent = 'Gift topshirildi';
      elements.status.classList.add('success');
    } else if (result.giftStatus === 'pending') {
      elements.status.textContent = 'Gift kutilmoqda';
      elements.status.classList.add('success');
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
        ? 'Sizning bitta NFT gift yutug‘ingiz qayd etilgan.'
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
