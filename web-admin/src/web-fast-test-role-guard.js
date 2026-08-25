const STYLE_ID = 'fast-test-role-guard-style';

function testRole() {
  const text = document.querySelector('.test-banner strong')?.textContent?.trim() || '';
  if (text.includes('Admin Event')) return 'ADMIN_INVENT';
  if (text.includes('Người báo hàng')) return 'INVENT';
  if (text.includes('Picker')) return 'PICKER';
  return '';
}

function apply() {
  const role = testRole();
  if (role) document.body.dataset.fastEffectiveRole = role;
  else delete document.body.dataset.fastEffectiveRole;
}

if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    body[data-fast-effective-role="INVENT"] .fast-actions [data-fast-action="reassign"] { display: none !important; }
    body[data-fast-effective-role="PICKER"] .fast-actions { display: none !important; }
  `;
  document.head.appendChild(style);
}

let queued = false;
const observer = new MutationObserver(() => {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; apply(); });
});
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
apply();
