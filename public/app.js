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
};

function showError(message) {
  elements.notice.textContent = message;
  elements.notice.classList.add('visible');
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
