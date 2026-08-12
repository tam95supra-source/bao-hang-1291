(() => {
  'use strict';

  const CARD_ID = 'browserSupraPocCard';
  const BUTTON_ID = 'browserSupraProbe';
  const OPEN_BUTTON_ID = 'browserSupraOpen';
  const MESSAGE_ID = 'browserSupraProbeMsg';
  const NAV_MESSAGE_ID = 'browserSupraNavMsg';
  const SUPRA_ORIGIN = 'https://api-supra.winmart.vn/';
  const TIMEOUT_MS = 12000;

  let lastPolicyViolation = null;
  document.addEventListener('securitypolicyviolation', (event) => {
    if (!String(event.blockedURI || '').startsWith('https://api-supra.winmart.vn')) return;
    lastPolicyViolation = {
      directive: event.effectiveDirective || event.violatedDirective || 'unknown',
      blockedURI: event.blockedURI || '',
      at: performance.now(),
    };
  });

  function setMessage(id, text, type = 'info') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.dataset.type = type;
    el.hidden = !text;
  }

  async function probeBrowserTransport() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.disabled = true;
    lastPolicyViolation = null;
    setMessage(MESSAGE_ID, 'Đang thử fetch no-cors trực tiếp từ trình duyệt tới Supra. Không gửi credential…');
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
      if (response.type === 'opaque') {
        setMessage(MESSAGE_ID, `FETCH: PASS (${elapsed} ms). Trình duyệt đã mở được đường tới Supra; response opaque do no-cors. Chưa dùng credential.`, 'good');
      } else {
        setMessage(MESSAGE_ID, `FETCH: CÓ PHẢN HỒI (${elapsed} ms, type=${response.type}). Chưa dùng credential.`, 'good');
      }
    } catch (error) {
      const elapsed = Math.max(1, Math.round(performance.now() - started));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const violation = lastPolicyViolation && lastPolicyViolation.at >= started - 50 ? lastPolicyViolation : null;
      if (violation) {
        setMessage(MESSAGE_ID, `FETCH: BỊ TRÌNH DUYỆT CHẶN BỞI CSP (${violation.directive}). Không phải lỗi credential.`, 'error');
      } else if (error?.name === 'AbortError') {
        setMessage(MESSAGE_ID, `FETCH: TIMEOUT sau ${elapsed} ms. Không dùng credential; chưa có bằng chứng token sai.`, 'error');
      } else {
        setMessage(MESSAGE_ID, `FETCH: NETWORK ERROR sau ${elapsed} ms — ${error?.message || 'Failed to fetch'}. Không ghi nhận CSP violation; cần đối chiếu bằng phép thử mở host ở tab mới.`, 'error');
      }
    } finally {
      clearTimeout(timeout);
      button.disabled = false;
    }
  }

  function openSupraTopLevel() {
    const target = `${SUPRA_ORIGIN}?bao_hang_1291_browser_nav=${Date.now()}`;
    const opened = window.open(target, '_blank', 'noopener,noreferrer');
    if (opened === null) {
      setMessage(NAV_MESSAGE_ID, 'TAB MỚI: Browser đang chặn popup. Cho phép popup cho trang này rồi thử lại. Không dùng credential.', 'error');
      return;
    }
    setMessage(NAV_MESSAGE_ID, 'TAB MỚI ĐÃ MỞ. Đây là top-level navigation nên không phụ thuộc CORS/fetch. Nếu tab Supra hiện bất kỳ HTTP/page nào thì đường browser→Supra tồn tại; nếu hiện ERR_CONNECTION_RESET/không thể truy cập thì browser path cũng bị chặn. Không dùng credential.', 'info');
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
      <p class="muted">Chẩn đoán 2 lớp, không dùng credential: (1) fetch no-cors có bắt CSP violation; (2) top-level navigation ở tab mới để loại CORS hoàn toàn.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button id="${BUTTON_ID}" class="secondary" type="button">THỬ FETCH TỪ TRÌNH DUYỆT</button>
        <button id="${OPEN_BUTTON_ID}" class="secondary" type="button">MỞ SUPRA Ở TAB MỚI</button>
      </div>
      <div id="${MESSAGE_ID}" class="message" hidden></div>
      <div id="${NAV_MESSAGE_ID}" class="message" hidden></div>
      <p class="muted"><small>Không nhập lại credential ở bước này. Chỉ khi browser path được chứng minh PASS mới chuyển sang thiết kế POC xác thực an toàn.</small></p>`;
    integrationStatus.insertAdjacentElement('afterend', card);
    document.getElementById(BUTTON_ID)?.addEventListener('click', probeBrowserTransport);
    document.getElementById(OPEN_BUTTON_ID)?.addEventListener('click', openSupraTopLevel);
  }

  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => setTimeout(mount, 0));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(mount, 0); });
  setTimeout(mount, 0);
})();
