(() => {
  'use strict';

  const CARD_ID = 'browserSupraPocCard';
  const BUTTON_ID = 'browserSupraProbe';
  const MESSAGE_ID = 'browserSupraProbeMsg';
  const SUPRA_ORIGIN = 'https://api-supra.winmart.vn/';
  const TIMEOUT_MS = 12000;

  function setMessage(text, type = 'info') {
    const el = document.getElementById(MESSAGE_ID);
    if (!el) return;
    el.textContent = text;
    el.dataset.type = type;
    el.hidden = !text;
  }

  async function probeBrowserTransport() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.disabled = true;
    setMessage('Đang thử đường mạng trực tiếp từ trình duyệt tới Supra. Không gửi credential…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const started = performance.now();
    try {
      const target = `${SUPRA_ORIGIN}?bao_hang_1291_browser_poc=${Date.now()}`;
      const response = await fetch(target, {
        method: 'GET',
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      const elapsed = Math.max(1, Math.round(performance.now() - started));
      if (response.type !== 'opaque') {
        setMessage(`TRÌNH DUYỆT → SUPRA: Có phản hồi mạng (${elapsed} ms). POC chưa dùng credential.`, 'good');
        return;
      }
      setMessage(`TRÌNH DUYỆT → SUPRA: CÓ ĐƯỜNG MẠNG (${elapsed} ms). Browser chỉ cho response opaque do no-cors; chưa dùng credential và chưa đọc dữ liệu tồn.`, 'good');
    } catch (error) {
      const elapsed = Math.max(1, Math.round(performance.now() - started));
      if (error?.name === 'AbortError') {
        setMessage(`TRÌNH DUYỆT → SUPRA: TIMEOUT sau ${elapsed} ms. Không dùng credential; chưa có bằng chứng token sai.`, 'error');
      } else {
        setMessage(`TRÌNH DUYỆT → SUPRA: KHÔNG MỞ ĐƯỢC ĐƯỜNG MẠNG (${elapsed} ms). ${error?.message || 'NetworkError'}. Không dùng credential.`, 'error');
      }
    } finally {
      clearTimeout(timeout);
      button.disabled = false;
    }
  }

  function mount() {
    if (document.getElementById(CARD_ID)) return;
    const integrationStatus = document.getElementById('integrationStatus');
    if (!integrationStatus) return;
    const card = document.createElement('article');
    card.className = 'card';
    card.id = CARD_ID;
    card.innerHTML = `
      <h3>POC trình duyệt → Supra</h3>
      <p class="muted">Bước 1 chỉ kiểm tra đường mạng bằng chính trình duyệt đang mở Web Báo hàng. Không đọc credential đã lưu, không gửi token, không ghi database và không tạo snapshot.</p>
      <button id="${BUTTON_ID}" class="secondary" type="button">THỬ KẾT NỐI TỪ TRÌNH DUYỆT</button>
      <div id="${MESSAGE_ID}" class="message" hidden></div>
      <p class="muted"><small>Nếu bước này PASS, hệ thống mới chuyển sang thiết kế POC xác thực an toàn. Nếu FAIL, không cần nhập lại credential.</small></p>`;
    integrationStatus.insertAdjacentElement('afterend', card);
    document.getElementById(BUTTON_ID)?.addEventListener('click', probeBrowserTransport);
  }

  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => setTimeout(mount, 0));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(mount, 0); });
  setTimeout(mount, 0);
})();
