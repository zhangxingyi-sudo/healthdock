/* HealthDock zero-tracker inline Waitlist form handler
 * Makes ZERO network requests until the user explicitly submits their email.
 * Never reads or accesses any health data parsed in health-worker.js.
 */
(() => {
  'use strict';

  const ENDPOINT = 'https://formsubmit.co/ajax/support@gethealthdock.com';

  const COPY = {
    en: {
      sending: 'Joining…',
      submit: 'Notify Me',
      ok: 'You’re on the list! We’ll send one email when HealthDock launches.',
      fallback: 'Couldn’t reach the form service right now — email support@gethealthdock.com directly.',
    },
    zh: {
      sending: '提交中…',
      submit: '上架通知我',
      ok: '已加入等待名单！客户端正式上架时我们会发送一封通知邮件。',
      fallback: '暂时无法连接表单服务，也可以直接发邮件至 support@gethealthdock.com。',
    },
  };

  function initForm(form) {
    const lang = form.dataset.lang === 'zh' ? 'zh' : 'en';
    const t = COPY[lang];
    const input = form.querySelector('input[type="email"]');
    const honey = form.querySelector('input[name="_honey"]');
    const btn = form.querySelector('button[type="submit"]');
    const note = form.querySelector('.waitlist-note');
    if (!input || !btn || !note) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (honey && honey.value) return;
      const email = input.value.trim();
      if (!email) return;

      btn.disabled = true;
      btn.textContent = t.sending;
      note.classList.remove('is-ok', 'is-err');

      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            email,
            source_page: window.location.pathname,
            language: lang,
            _subject: 'HealthDock Launch Waitlist Signup',
            _captcha: 'false',
            _template: 'table',
          }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        input.value = '';
        note.textContent = t.ok;
        note.classList.add('is-ok');
        btn.textContent = lang === 'zh' ? '已预约 ✓' : 'Joined ✓';
      } catch {
        note.textContent = t.fallback;
        note.classList.add('is-err');
        btn.disabled = false;
        btn.textContent = t.submit;
      }
    });
  }

  document.querySelectorAll('form[data-waitlist]').forEach(initForm);

  document.querySelectorAll('a[href="#waitlist"]').forEach((link) => {
    link.addEventListener('click', () => {
      const target = document.querySelector('#waitlist input[type="email"]');
      if (target) setTimeout(() => target.focus({ preventScroll: true }), 350);
    });
  });
})();
