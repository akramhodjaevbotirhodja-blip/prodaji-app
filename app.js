(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  const VERSION = (String(document.currentScript && document.currentScript.src).match(/v=(\w+)/) || [])[1] || '—';
  const $app = document.getElementById('app');
  const $tabs = document.getElementById('tabs');
  const METHODS = { click: 'Click', card: 'Карта', cash: 'Наличные', transfer: 'Перечисление' };
  const DELIVERY = { 'Самовывоз': 'Самовывоз', 'Ташкент': 'По Ташкенту', 'Область': 'По области' };
  const REGIONS = ['Андижанская', 'Бухарская', 'Джизакская', 'Кашкадарьинская', 'Навоийская', 'Наманганская', 'Самаркандская',
    'Сурхандарьинская', 'Сырдарьинская', 'Ташкентская обл.', 'Ферганская', 'Хорезмская', 'Каракалпакстан'];
  const SERVICES = {
    'Ташкент': ['Наш курьер', 'Яндекс Доставка', 'Такси', 'Другое'],
    'Область': ['BTS', 'EMU', 'Узпочта', 'Такси / попутка', 'Другое'],
  };
  const S = { user: null, dicts: null, requests: [], tab: 'orders', stack: [], paste: { target: 'receipt' }, filters: { period: 'month', status: 'all', stage: 'all', q: '' }, dash: { period: 'month', from: '', to: '' } };

  // ---------- утилиты ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/,/g, ' ');
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const today = () => iso(new Date());
  const nowTime = () => new Date().toTimeString().slice(0, 5); // «14:35» — по умолчанию время оплаты
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  const fmtDate = (s) => (s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : '');
  const daysAgo = (s) => Math.round((new Date(today()) - new Date(s)) / 864e5);
  const isOwner = () => S.user && S.user.role === 'owner';
  // window.confirm в Telegram Desktop не показывается и сразу возвращает false, поэтому спрашиваем через Telegram
  const ask = (msg) => new Promise((res) => (tg && tg.initData && tg.isVersionAtLeast && tg.isVersionAtLeast('6.2')
    ? tg.showConfirm(msg, res) : res(window.confirm(msg))));
  const haptic = (t) => tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred(t);
  const periods = { today: 'Сегодня', week: '7 дней', month: 'Месяц', prev: 'Прошлый месяц', all: 'Всё время' };
  function range(p) {
    const t = today();
    if (p === 'today') return { from: t, to: t };
    if (p === 'week') return { from: addDays(t, -6), to: t };
    if (p === 'month') return { from: t.slice(0, 8) + '01', to: t };
    if (p === 'prev') { const end = addDays(t.slice(0, 8) + '01', -1); return { from: end.slice(0, 8) + '01', to: end }; }
    return {};
  }
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2600);
  }
  async function call(action, params, { quiet } = {}) {
    try {
      const res = await window.api(action, params);
      if (!READS.includes(action)) cache.clear(); // что-то изменили — списки перечитаем
      return res;
    }
    catch (e) { if (!quiet) { toast(e.message); haptic('error'); } throw e; }
  }
  // списки заказов держим минуту: фильтры и поиск переключаются без запроса к серверу
  const READS = ['me', 'orders', 'order', 'finance', 'stock', 'stock_item'];
  const cache = new Map();
  function cached(action, params) {
    const k = action + JSON.stringify(params), hit = cache.get(k);
    if (hit && Date.now() - hit.t < 60e3) return hit.p;
    const p = call(action, params, { quiet: true }).catch((e) => { cache.delete(k); throw e; });
    cache.set(k, { t: Date.now(), p });
    return p;
  }
  const payBadge = (o) => {
    if (o.stage === 'Отменён') return '<span class="badge b-grey">Отменён</span>';
    if (!(o.total > 0)) return '<span class="badge b-grey">Без суммы</span>'; // заказ из amoCRM, продукты ещё не внесены
    if (o.rest <= 0) return '<span class="badge b-green">Оплачено</span>';
    if (o.paid > 0) return `<span class="badge b-amber">−${money(o.rest)}</span>`;
    return `<span class="badge b-red">−${money(o.rest)}</span>`;
  };
  const AMO = 'https://gano2010.amocrm.ru/leads/detail/';
  const isInstagram = (source) => /^instagram/i.test(source || '');
  // «@nik» или «nik» → ссылка на профиль; готовую ссылку оставляем как есть
  const igUrl = (s) => (/^https?:\/\//i.test(s) ? s : 'https://instagram.com/' + String(s).replace(/^@/, '').trim());

  // Скриншот чека: уменьшаем на телефоне до 1600 px и JPEG, чтобы не гонять мегабайты
  // Ctrl+V в любом месте экрана тоже вставляет чек сюда (см. обработчик paste)
  // Поле выделено рамкой — туда и пойдёт Ctrl+V; нажатие на другое поле переключает.
  const receiptPicker = () => `<div class="drop" data-pz="receipt" style="margin:10px 0 0">
      <div class="drop-head"><b>🧾 Чек</b><label class="btn sm ghost">📎 Файл<input type="file" accept="image/*" hidden data-receipt-new></label></div>
      <img id="receiptPreview" alt="Чек" hidden>
      <div class="drop-empty hint" id="receiptEmpty">Скопируйте скриншот и нажмите Ctrl+V</div></div>`;
  // orderId — карточка заказа: дизайн сохраняется сразу; без него (форма) — после сохранения заказа
  const designPicker = (orderId) => `<div class="drop" data-pz="design" style="margin:10px 0 0">
      <div class="drop-head"><b>🎨 Дизайн</b><label class="btn sm ghost">📎 Файл<input type="file" accept="image/*" hidden
        ${orderId ? `data-design-for="${orderId}"` : 'data-design-new'}></label></div>
      <img id="designPreview" alt="Дизайн" hidden>
      <div class="drop-empty hint" id="designEmpty">Нажмите сюда, затем Ctrl+V — дизайн, который утвердил клиент</div></div>`;
  // дизайн сохраняем крупнее и чётче (max = 2400, quality = 0.9)
  function readReceipt(file, max = 1600, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // прозрачный PNG в JPEG иначе станет чёрным
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Не удалось открыть картинку'));
      img.src = URL.createObjectURL(file);
    });
  }
  // этапы: семь рабочих по порядку + «Отменён» отдельно
  const CANCEL = 'Отменён';
  const CLOSED = 'Сделка закрыта';
  // цвет краски печати / штампа (у продукта в справочнике ink = true)
  const INKS = { "Ko'k": '#1e5bd8', 'Qora': '#111', 'Qizil': '#d62828', 'Yashil': '#1f9d48', 'Pushti': '#e85aa8' };
  const hasInk = (name) => S.dicts.products.some((p) => p.name === name && p.ink);
  const inkDot = (ink) => (ink ? ` <span class="hint"><i class="dot" style="background:${INKS[ink] || '#999'}"></i>${esc(ink)}</span>` : '');
  const closeDebtMsg = (rest) => `Нельзя закрыть сделку: остаток долга ${money(rest)} сум. Сначала внесите оплату.`;
  const flow = () => S.dicts.stages.filter((s) => s !== CANCEL);
  const stageNo = (o) => flow().indexOf(o.stage) + 1;
  const pips = (o) => {
    const n = stageNo(o);
    return n ? `<div class="sub"><span class="pips">${flow().map((_, i) => `<i class="${i < n ? 'f' : ''}"></i>`).join('')}</span>${esc(o.stage)}</div>` : '';
  };
  // семь подписей в ширину телефона: переносим только в этих местах, а не посреди слога
  const HYPHENS = { Потребность: 'Потреб&shy;ность', выявлена: 'выяв&shy;лена', Производство: 'Произ&shy;водство',
    Оплачено: 'Опла&shy;чено', Доставка: 'Дос&shy;тавка' };
  const stepLabel = (s) => esc(s).replace(/[А-яЁё]+/g, (w) => HYPHENS[w] || w);

  function stepper(o) {
    if (o.stage === CANCEL) return `<div class="card"><span class="badge b-grey">Заказ отменён</span>
      <button class="btn ghost" data-act="stage" data-v="${esc(flow()[0])}">Вернуть в работу</button></div>`;
    const n = stageNo(o);
    return `<div class="card"><label style="margin-top:0">Этап заказа · ${n} из ${flow().length}. Нажмите на нужный этап</label>
      <div class="steps">${flow().map((s, i) => `<button class="step ${i < n - 1 ? 'done' : i === n - 1 ? 'on' : ''}" data-act="stage" data-v="${esc(s)}">
        <i>${i < n - 1 ? '✓' : i + 1}</i><span>${stepLabel(s)}</span></button>`).join('')}</div>
      <button class="btn sm danger" data-act="stage" data-v="${CANCEL}">Отменить заказ</button></div>`;
  }
  const products = (o) => (o.items || []).map((i) => i.product + (i.qty > 1 ? ' ×' + i.qty : '')).join(', ');
  const opts = (list, val, empty = '—') =>
    `<option value="">${empty}</option>` + list.map((v) => `<option ${v === val ? 'selected' : ''} value="${esc(v)}">${esc(v)}</option>`).join('');
  const chips = (name, items, cur) =>
    `<div class="chips">${Object.entries(items).map(([k, v]) => `<button class="chip ${k === cur ? 'on' : ''}" data-act="${name}" data-v="${k}">${v}</button>`).join('')}</div>`;

  // ответ me / staff_save / access_decide: справочники и заявки на доступ (число — на вкладке «Ещё»)
  function setMe(res) {
    S.dicts = res.dicts; S.requests = res.requests || [];
    const b = $tabs.querySelector('[data-tab=more]');
    let n = b.querySelector('.count');
    if (!n) { n = document.createElement('span'); n.className = 'count'; b.appendChild(n); }
    n.textContent = S.requests.length || ''; n.hidden = !S.requests.length;
  }

  // ---------- навигация ----------
  function push(view) { S.stack.push(view); render(); window.scrollTo(0, 0); }
  function pop() { S.stack.pop(); render(); }
  function setTab(t) { S.tab = t; S.stack = []; render(); window.scrollTo(0, 0); }
  $tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  if (tg) tg.BackButton.onClick(pop);

  async function render() {
    S.receipt = null; S.design = null; // выбранные картинки живут только на текущем экране
    const view = S.stack[S.stack.length - 1];
    S.pz = 'receipt'; // Ctrl+V идёт в чек; если поля чека нет (заказ оплачен) — paintPz переключит на дизайн
    $tabs.hidden = !!view && view.type === 'form';
    [...$tabs.children].forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    if (tg) S.stack.length ? tg.BackButton.show() : tg.BackButton.hide();
    const token = (render.token = {});
    let html;
    try {
      html = view ? await VIEWS[view.type](view) : await TABS[S.tab]();
    } catch (e) {
      html = `<div class="center"><p>${esc(e.message)}</p><button class="btn ghost" data-act="reload">Повторить</button></div>`;
    }
    if (token !== render.token) return;
    $app.innerHTML = demoBar() + html;
    paintPz();
    if (view && view.after) view.after();
  }

  // ---------- экраны-вкладки ----------
  const TABS = {
    async orders() {
      const f = S.filters;
      const list = await cached('orders', range(f.period));
      const q = f.q.trim().toLowerCase();
      // закрытые сделки живут в «Клиентах»: здесь — только если выбран их этап или ищем
      const rows = list.filter((o) => (o.stage !== CLOSED || f.stage === CLOSED || q) &&
        STATUS_FILTERS[f.status](o) && (f.stage === 'all' || o.stage === f.stage) &&
        (!q || [o.client, o.company, o.phone, String(o.id)].some((v) => String(v || '').toLowerCase().includes(q))));
      const sum = rows.filter((o) => o.stage !== 'Отменён').reduce((s, o) => s + o.total, 0);
      return `<h1>Заказы</h1>
        ${chips('period', periods, f.period)}
        ${chips('status', { all: 'Все', debt: 'С долгом', work: 'В работе', ship: 'На отправку' }, f.status)}
        ${chips('fstage', { all: 'Все этапы', ...Object.fromEntries(S.dicts.stages.map((s) => {
          const n = list.filter((o) => o.stage === s).length, no = stageNo({ stage: s });
          return [s, `${no ? no + '. ' : ''}${esc(s)} · ${n}`];
        })) }, f.stage)}
        <input class="search" type="search" placeholder="Поиск: клиент, компания, телефон, №" value="${esc(f.q)}" data-input="q">
        <div class="hint" style="margin:0 6px 8px">${rows.length} заказов · ${money(sum)} сум</div>
        <div class="list">${rows.map(orderRow).join('') || '<div class="center hint">Заказов нет</div>'}</div>
        <button class="fab" data-act="new" aria-label="Новый заказ">+</button>`;
    },

    // Чек и утверждённый дизайн: Ctrl+V (или файл) → выбрать заказ → сохранить
    async paste() {
      const P = S.paste;
      const zone = (k, title, hint) => `<div class="drop ${P.target === k ? 'on' : ''}" data-act="ptarget" data-v="${k}" data-zone="${k}">
        <div class="drop-head"><b>${title}</b><span class="drop-btns">
          <button class="btn sm ghost" data-act="pfile" data-v="${k}">📎 Файл</button>
          <button class="btn sm danger" data-act="pclear" data-v="${k}" ${P[k] ? '' : 'hidden'}>✕</button></span></div>
        <img alt="" ${P[k] ? `src="${P[k]}"` : 'hidden'}>
        <div class="drop-empty hint" ${P[k] ? 'hidden' : ''}>${hint}</div></div>`;
      let order;
      if (P.orderId) {
        const o = await cached('order', { id: P.orderId });
        const bare = o.payments.filter((p) => !p.receipt_path && !p.receipt_url); // оплаты, к которым ещё нет чека
        const to = P.payTo || 'new';
        order = `<div class="list">${orderRow(o)}</div>
          <div class="hint" style="margin:6px 6px 0">Оплачено ${money(o.paid)} из ${money(o.total)}${o.rest > 0 ? ` · <span class="red">остаток ${money(o.rest)}</span>` : ''}
            ${(o.designs || []).length ? ` · дизайнов уже ${o.designs.length}` : ''}</div>
          <button class="btn ghost" data-act="punpick">Выбрать другой заказ</button>
          <div class="card" id="payBox" style="margin-top:8px" ${P.receipt ? '' : 'hidden'}><b>Оплата по чеку</b>
            ${bare.length ? `<div class="chips wrap" style="margin-top:8px">${[['new', 'Новая оплата'],
              ...bare.map((p) => [p.id, `Без чека: ${fmtDate(p.paid_at)} · ${money(p.amount)} · ${METHODS[p.method]}`])]
              .map(([k, t]) => `<button class="chip ${String(k) === String(to) ? 'on' : ''}" data-act="payto" data-v="${k}">${esc(t)}</button>`).join('')}</div>` : ''}
            <div id="newPay" ${to === 'new' ? '' : 'hidden'}>
              ${segHtml('method', 'click')}
              <label>Сумма</label><input type="number" inputmode="numeric" placeholder="Сумма" value="${o.rest > 0 ? o.rest : ''}" id="payAmount">
              <div class="grid2"><div><label>Дата оплаты</label><input type="date" value="${today()}" id="payDate"></div>
              <div><label>Время оплаты</label><input type="time" value="${nowTime()}" id="payTime"></div></div></div></div>`;
      } else {
        const list = await cached('orders', {});
        const q = (P.q || '').trim().toLowerCase();
        // без поиска — свежие заказы в работе; поиском находится любой
        const rows = (q ? list.filter((o) => [o.client, o.company, o.phone, o.instagram, String(o.id)].some((v) => String(v || '').toLowerCase().includes(q)))
          : list.filter((o) => o.stage !== CLOSED && o.stage !== CANCEL)).slice(0, 30);
        order = `<input class="search" type="search" placeholder="Поиск: клиент, компания, телефон, №" value="${esc(P.q || '')}" data-input="pq">
          <div class="list">${rows.map((o) => orderRow(o).replace('data-act="open"', 'data-act="ppick"')).join('') || '<div class="center hint">Ничего не нашлось</div>'}</div>`;
      }
      return `<h1>Чек и дизайн</h1>
        <p class="hint" style="margin:0 6px 10px">Скопируйте скриншот (Win+Shift+S или «Копировать» в Telegram) и нажмите <b>Ctrl+V</b> —
          картинка встанет в выделенное поле. Нажмите на другое поле, чтобы вставлять туда. На телефоне — кнопка «📎 Файл».</p>
        ${zone('receipt', '🧾 Чек оплаты', 'Ctrl+V — вставить скриншот чека')}
        ${zone('design', '🎨 Дизайн, который утвердил клиент', 'Необязательно. Нажмите сюда, затем Ctrl+V')}
        <h2>Заказ</h2>${order}
        <button class="btn" data-act="psave">Сохранить в заказ</button>
        <input type="file" accept="image/*" hidden data-paste="receipt"><input type="file" accept="image/*" hidden data-paste="design">`;
    },

    // клиентская база: клиенты, у которых есть закрытая сделка (только руководитель)
    async clients() {
      const all = clientGroups(await cached('orders', {}));
      const q = (S.clientQ || '').trim().toLowerCase();
      const rows = all.filter((c) => !q || [c.name, c.phone, c.instagram].some((v) => String(v || '').toLowerCase().includes(q)));
      return `<h1>Клиенты</h1>
        <input class="search" type="search" placeholder="Поиск: имя, телефон, Instagram" value="${esc(S.clientQ || '')}" data-input="cq">
        <div class="hint" style="margin:0 6px 8px">${rows.length} клиентов · закрытые сделки на ${money(rows.reduce((s, c) => s + c.closedSum, 0))} сум</div>
        <div class="list">${rows.map((c) => `<div class="row tap" data-act="client" data-key="${esc(c.key)}">
          <div class="grow"><div class="title">${esc(c.name)}</div>
          <div class="sub">${esc(c.phone || c.instagram || '')}${c.phone || c.instagram ? ' · ' : ''}${c.orders.length} зак. · последний ${fmtDate(c.last)}</div></div>
          <div class="amt"><b>${money(c.total)}</b>${c.rest > 0 ? `<div class="red">−${money(c.rest)}</div>` : ''}</div></div>`).join('')
          || '<div class="center hint">Пока нет клиентов с закрытыми сделками</div>'}</div>`;
    },

    async debtors() {
      const list = [...(await cached('orders', { debt: true }))].sort((a, b) => a.order_date.localeCompare(b.order_date) || b.rest - a.rest);
      const total = list.reduce((s, o) => s + o.rest, 0);
      const old = list.filter((o) => daysAgo(o.order_date) > 7);
      return `<h1>Должники</h1>
        <div class="kpis">
          <div class="kpi alert"><div class="k">Всего должны</div><div class="v">${money(total)}</div></div>
          <div class="kpi"><div class="k">Заказов с долгом</div><div class="v">${list.length}</div><div class="hint">${old.length} дольше 7 дней</div></div>
        </div>
        <h2>По старшинству долга</h2>
        <div class="list">${list.map((o) => {
          const d = daysAgo(o.order_date);
          return `<div class="row tap" data-act="open" data-id="${o.id}">
            <div class="grow"><div class="title">${esc(o.company || o.client || o.phone || 'Без имени')}</div>
            <div class="sub">№${o.id} · ${esc(o.manager_code || '—')} · ${esc(o.phone || '')}</div></div>
            <div class="amt"><div class="red"><b>${money(o.rest)}</b></div>
            <span class="badge ${d > 7 ? 'b-red' : 'b-grey'}">${d === 0 ? 'сегодня' : d + ' дн.'}</span></div></div>`;
        }).join('') || '<div class="center hint">Должников нет 🎉</div>'}</div>`;
    },

    async dashboard() {
      const p = S.dash;
      const r = p.period === 'custom' ? { from: p.from, to: p.to } : range(p.period);
      const [list, debts, fin, stock] = await Promise.all([cached('orders', r), cached('orders', { debt: true }),
        isOwner() ? cached('finance', r) : null, cached('stock', {}).catch(() => null)]);
      return dashboardHtml(list.filter((o) => o.stage !== 'Отменён'), debts, r, fin, stock);
    },

    async more() {
      const u = S.user;
      let html = `<h1>Ещё</h1><div class="card"><b>${esc(u.name)}</b><div class="hint">${isOwner() ? 'Руководитель' : 'Менеджер ' + esc(u.code)} · Telegram ID ${u.telegram_id}</div>
        <div class="hint">Версия приложения ${esc(VERSION)}</div></div>`;
      if (!isOwner()) return html;
      const free = S.dicts.staff.filter((s) => s.active && !s.telegram_id).map((s) => s.code);
      if (S.requests.length) html += `<h2>Заявки на доступ</h2>${S.requests.map((r) => `
        <div class="card" data-req="${r.telegram_id}">
          <b>${esc(r.name || 'Без имени')}</b>${r.username ? ` <span class="hint">@${esc(r.username)}</span>` : ''}
          <div class="hint">Telegram ID ${r.telegram_id} · ${fmtDate(String(r.created_at).slice(0, 10))}</div>
          <div class="grid2" style="margin-top:8px"><select data-f="code">${opts(free, '', 'Код сотрудника')}</select>
            <input data-f="newcode" placeholder="или новый код" autocomplete="off"></div>
          <div class="grid2"><button class="btn" data-act="reqok">Одобрить</button><button class="btn ghost" data-act="reqno">Отклонить</button></div>
        </div>`).join('')}`;
      html += `<h2>Сотрудники</h2><div class="list">${S.dicts.staff.map((s) => `
        <div class="row tap" data-act="staff" data-code="${esc(s.code)}">
          <div class="grow"><div class="title">${esc(s.code)} · ${esc(s.name || '')}</div>
          <div class="sub">${s.telegram_id ? 'Telegram ID ' + s.telegram_id : 'не привязан к Telegram'}${s.active ? '' : ' · отключён'}</div></div>
          <span class="badge ${s.telegram_id && s.active ? 'b-green' : 'b-grey'}">${s.role === 'owner' ? 'руковод.' : 'менеджер'}</span></div>`).join('')}</div>
        <button class="btn ghost" data-act="staff" data-code="">+ Добавить сотрудника</button>
        <p class="hint" style="margin:8px 6px">Сотрудник открывает бота, видит свой Telegram ID и присылает его вам. Вы вписываете ID здесь.</p>
        <h2>Google-таблица дня</h2>
        <div class="card"><div class="hint" style="margin-bottom:8px">Новые заказы и оплаты попадают в файл дня автоматически (папка «Продажи по дням» в Google Drive). Здесь можно заново выгрузить все заказы за дату.</div>
          <div style="display:flex;gap:6px"><input type="date" id="syncDate" value="${today()}"><button class="btn sm" data-act="sheetsync">Выгрузить</button></div></div>
        <h2>Справочники</h2>
        ${[['products', 'Продукты', 'name'], ['designers', 'Дизайнеры', 'code'], ['sources', 'Источники', 'name'],
          ['expense_categories', 'Виды расходов', 'name']].map(([k, t, f]) => `
          <div class="card"><b>${t}</b><div class="hint" style="margin:4px 0 8px">${S.dicts[k].map((x) => esc(x[f])).join(' · ')}</div>
          <div style="display:flex;gap:6px"><input placeholder="Новое значение" data-dict="${k}"><button class="btn sm" data-act="dict" data-kind="${k}">Добавить</button></div></div>`).join('')}`;
      return html;
    },
  };

  // Один клиент = один телефон (последние 9 цифр); без телефона — Instagram, иначе имя.
  // В базу попадают клиенты, у которых есть хотя бы одна закрытая сделка; в карточке — все их заказы.
  function clientGroups(list) {
    const m = new Map();
    list.forEach((o) => {
      const digits = String(o.phone || '').replace(/\D/g, '').slice(-9);
      const key = digits.length === 9 ? 'p' + digits : o.instagram ? 'i' + o.instagram.toLowerCase()
        : 'n' + String(o.client || o.company || '').trim().toLowerCase();
      if (key === 'n') return;
      const c = m.get(key) || { key, orders: [] };
      c.orders.push(o); m.set(key, c);
    });
    return [...m.values()].filter((c) => c.orders.some((o) => o.stage === CLOSED)).map((c) => {
      const os = c.orders.sort((a, b) => b.order_date.localeCompare(a.order_date) || b.id - a.id);
      const live = os.filter((o) => o.stage !== CANCEL), pick = (f) => (os.find((o) => o[f]) || {})[f];
      // «(из Instagram)» из старого Excel — не имя; тогда показываем компанию / текст печати
      const realName = (os.find((o) => o.client && !/^\(.*\)$/.test(o.client.trim())) || {}).client;
      return { ...c, name: realName || pick('company') || pick('client') || 'Без имени', phone: pick('phone'), instagram: pick('instagram'),
        last: os[0].order_date, total: live.reduce((s, o) => s + o.total, 0), rest: live.reduce((s, o) => s + Math.max(0, o.rest), 0),
        closedSum: os.filter((o) => o.stage === CLOSED).reduce((s, o) => s + o.total, 0) };
    }).sort((a, b) => b.last.localeCompare(a.last));
  }

  const open = (o) => o.stage !== flow()[flow().length - 1] && o.stage !== CANCEL;
  const STATUS_FILTERS = {
    all: () => true,
    debt: (o) => o.rest > 0 && o.stage !== 'Отменён',
    work: open,
    ship: (o) => open(o) && (o.delivery_type === 'Ташкент' || o.delivery_type === 'Область'),
  };

  const orderRow = (o) => `<div class="row tap" data-act="open" data-id="${o.id}">
    <div class="grow"><div class="title">${esc(o.company || o.client || o.phone || 'Без имени')}</div>
    <div class="sub">№${o.id} · ${fmtDate(o.order_date)} · ${esc(o.manager_code || '—')} · ${esc(products(o))}</div>
    ${deliveryText(o) ? `<div class="sub">${esc(deliveryText(o))}${o.tracking ? ' · трек ' + esc(o.tracking) : ''}</div>` : ''}
    ${pips(o)}</div>
    <div class="amt"><div><b>${money(o.total)}</b></div>${payBadge(o)}</div></div>`;

  function group(list, key, val = (o) => o.total) {
    const m = new Map();
    list.forEach((o) => { const k = (typeof key === 'function' ? key(o) : o[key]) || 'Не указан'; const g = m.get(k) || { k, n: 0, sum: 0, paid: 0, rest: 0 };
      g.n++; g.sum += val(o); g.paid += o.paid; g.rest += o.rest; m.set(k, g); });
    return [...m.values()].sort((a, b) => b.sum - a.sum);
  }
  const bars = (rows, fmt) => {
    const max = Math.max(1, ...rows.map((r) => r.sum));
    return `<div class="list">${rows.map((r) => `<div class="row" style="display:block">
      <div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(r.k)}</span><span class="amt">${fmt(r)}</span></div>
      <div class="bar"><i style="width:${(r.sum / max) * 100}%"></i></div></div>`).join('') || '<div class="center hint">Нет данных</div>'}</div>`;
  };

  // Деньги за период: поступило (оплаты по дате оплаты) − расходы = прибыль. Только руководителю.
  function financeHtml(fin) {
    if (!fin) return '';
    const inc = fin.payments.reduce((s, x) => s + Number(x.amount), 0);
    const out = fin.expenses.reduce((s, x) => s + Number(x.amount), 0);
    const profit = inc - out;
    const byCat = group(fin.expenses.map((e) => ({ ...e, paid: 0, rest: 0 })), 'category', (e) => Number(e.amount));
    return `<h2>Деньги за период</h2>
      <div class="kpis">
        <div class="kpi"><div class="k">Поступило</div><div class="v green">${money(inc)}</div><div class="hint">${fin.payments.length} оплат</div></div>
        <div class="kpi tap" data-act="expenses"><div class="k">Расходы →</div><div class="v red">${money(out)}</div><div class="hint">${fin.expenses.length} записей</div></div>
        <div class="kpi wide"><div class="k">Прибыль (поступило − расходы)</div><div class="v ${profit < 0 ? 'red' : 'green'}">${money(profit)} сум</div></div>
      </div>
      ${byCat.length ? bars(byCat, (g) => `${money(g.sum)} · ${g.n}`) : ''}
      <button class="btn ghost" data-act="expense">+ Добавить расход</button>`;
  }

  // ---------- склад ----------
  const qtyFmt = (n) => String(Math.round(Number(n) * 100) / 100).replace('.', ',');
  const isLow = (r) => r.stock !== null && r.min_qty !== null && Number(r.stock) < Number(r.min_qty);
  // сначала то, что заканчивается, потом остальное со складом, в конце — где склад не ведётся
  const stockOrder = (a, b) => (isLow(b) - isLow(a)) || ((a.stock === null) - (b.stock === null))
    || (isLow(a) ? a.stock / a.min_qty - b.stock / b.min_qty : 0) || (a.sort - b.sort) || a.product.localeCompare(b.product);
  const stockRow = (r) => `<div class="row tap" data-act="stockitem" data-v="${esc(r.product)}">
    <div class="grow"><div class="title">${esc(r.product)}</div>
    <div class="sub">${r.stock === null ? 'склад не ведётся' : r.min_qty !== null ? 'минимум ' + qtyFmt(r.min_qty) : 'минимум не задан'}</div></div>
    <div class="amt"><b class="${isLow(r) ? 'red' : ''}">${r.stock === null ? '—' : qtyFmt(r.stock)}</b>${isLow(r) ? '<div><span class="badge b-red">мало</span></div>' : ''}</div></div>`;
  function stockHtml(rows) {
    if (!rows) return '';
    const kept = rows.filter((r) => r.stock !== null), low = kept.filter(isLow).sort(stockOrder);
    return `<h2>Склад${low.length ? ` · <span class="red">мало осталось: ${low.length}</span>` : ''}</h2>
      ${low.length ? `<div class="list">${low.map(stockRow).join('')}</div>`
        : `<div class="card hint">${kept.length ? `Всего хватает · на складе ${kept.length} товаров` : 'Склад ещё не заполнен — внесите остатки на начало месяца'}</div>`}
      <button class="btn ghost" data-act="stock">Склад: все товары →</button>`;
  }

  function dashboardHtml(list, debts, r, fin, stock) {
    const p = S.dash;
    const sum = list.reduce((s, o) => s + o.total, 0), paid = list.reduce((s, o) => s + o.paid, 0);
    const priced = list.filter((o) => o.total > 0).length; // заказы из amoCRM без суммы не портят средний чек
    const debtAll = debts.reduce((s, o) => s + o.rest, 0);
    const items = list.flatMap((o) => o.items.map((i) => ({ ...i, order_id: o.id })));
    const prod = new Map();
    items.forEach((i) => { const g = prod.get(i.product) || { k: i.product, orders: new Set(), qty: 0, sum: 0 }; g.orders.add(i.order_id); g.qty += Number(i.qty); g.sum += Number(i.amount); prod.set(i.product, g); });
    const pays = Object.entries(METHODS).map(([m, t]) => ({ k: t, sum: list.reduce((s, o) => s + (o['paid_' + m] || 0), 0) }));
    const payTotal = pays.reduce((s, x) => s + x.sum, 0) || 1;
    // по дням
    const byDay = new Map(); list.forEach((o) => byDay.set(o.order_date, (byDay.get(o.order_date) || 0) + o.total));
    const from = r.from || [...byDay.keys()].sort()[0] || today(), to = r.to || today();
    const days = []; for (let d = from; d <= to && days.length < 62; d = addDays(d, 1)) days.push([d, byDay.get(d) || 0]);
    const dmax = Math.max(1, ...days.map((d) => d[1]));
    const mgr = group(list, 'manager_code');

    return `<h1>Дашборд</h1>
      ${chips('dperiod', { ...periods, custom: 'Период…' }, p.period)}
      ${p.period === 'custom' ? `<div class="grid2" style="margin-bottom:10px"><input type="date" value="${p.from}" data-input="dfrom"><input type="date" value="${p.to}" data-input="dto"></div>` : ''}
      <div class="kpis">
        <div class="kpi"><div class="k">Заказов</div><div class="v">${list.length}</div></div>
        <div class="kpi"><div class="k">Средний чек</div><div class="v">${money(priced ? sum / priced : 0)}</div></div>
        <div class="kpi wide"><div class="k">Сумма заказов</div><div class="v">${money(sum)} сум</div>
          <div class="bar"><i class="paid" style="width:${sum ? (paid / sum) * 100 : 0}%"></i><i class="rest" style="width:${sum ? ((sum - paid) / sum) * 100 : 0}%"></i></div>
          <div class="hint" style="margin-top:4px"><span class="green">получено ${money(paid)}</span> · <span class="red">не получено ${money(sum - paid)}</span> · собрано ${sum ? Math.round((paid / sum) * 100) : 0}%</div></div>
        <div class="kpi wide alert tap" data-act="tab" data-v="debtors"><div class="k">Долг всего, за всё время →</div><div class="v">${money(debtAll)} сум</div><div class="hint">${debts.length} заказов</div></div>
      </div>
      ${stockHtml(stock)}
      ${financeHtml(fin)}
      ${isOwner() ? `<h2>Менеджеры</h2><div class="list">${mgr.map((g) => `<div class="row" style="display:block">
          <div style="display:flex;justify-content:space-between"><b>${esc(g.k)}</b><span class="amt"><b>${money(g.sum)}</b> · ${g.n} зак.</span></div>
          <div class="bar"><i class="paid" style="width:${g.sum ? (g.paid / g.sum) * 100 : 0}%"></i><i class="rest" style="width:${g.sum ? (g.rest / g.sum) * 100 : 0}%"></i></div>
          <div class="hint" style="margin-top:3px">собрано ${g.sum ? Math.round((g.paid / g.sum) * 100) : 0}% · <span class="red">не получено ${money(g.rest)}</span></div></div>`).join('') || '<div class="center hint">Нет данных</div>'}</div>` : ''}
      <h2>Этапы заказов</h2>${bars(flow().map((s) => { const g = list.filter((o) => o.stage === s); return { k: `${stageNo({ stage: s })}. ${s}`, sum: g.length, total: g.reduce((a, o) => a + o.total, 0) }; }),
        (g) => `${g.sum} зак. · ${money(g.total)}`)}
      <h2>Продажи по дням</h2>
      <div class="card"><div class="days">${days.map(([d, v]) => `<div title="${fmtDate(d)}: ${money(v)}" style="height:${(v / dmax) * 100}%"></div>`).join('')}</div>
        <div class="days-labels"><span>${fmtDate(from).slice(0, 5)}</span><span>${fmtDate(to).slice(0, 5)}</span></div></div>
      <h2>Продукты</h2>
      <div class="kpis" style="margin-bottom:8px">
        <div class="kpi"><div class="k">Продуктов в заказе, в среднем</div><div class="v">${list.length ? (items.length / list.length).toFixed(1).replace('.', ',') : 0}</div></div>
        <div class="kpi"><div class="k">Заказов с 2+ продуктами</div><div class="v">${list.filter((o) => o.items.length > 1).length}</div></div>
      </div>${bars([...prod.values()].sort((a, b) => b.sum - a.sum), (g) => `${money(g.sum)} · ${g.orders.size} зак. · ${g.qty} шт.`)}
      <h2>Источники клиентов</h2>${bars(group(list, 'source'), (g) => `${money(g.sum)} · ${g.n} зак.`)}
      <h2>Дизайнеры</h2>${bars(group(list, 'designer_code'), (g) => `${money(g.sum)} · ${g.n} зак.`)}
      <h2>Доставка</h2>${bars(group(list, (o) => DELIVERY[o.delivery_type] || 'Не указано'), (g) => `${g.n} зак. · ${money(g.sum)}`)}
      ${(() => { const reg = list.filter((o) => o.delivery_type === 'Область');
        return reg.length ? `<h2>Отправки по областям</h2>${bars(group(reg, 'delivery_region'), (g) => `${g.n} зак. · ${money(g.sum)}`)}
          <h2>Службы доставки</h2>${bars(group(list.filter((o) => o.delivery_service), 'delivery_service'), (g) => `${g.n} зак.`)}` : ''; })()}
      <h2>Способы оплаты</h2>${bars(pays.filter((x) => x.sum), (g) => `${money(g.sum)} · ${Math.round((g.sum / payTotal) * 100)}%`)}
      <p class="hint" style="margin:10px 6px">Отменённые заказы не учитываются. Период считается по дате заказа.</p>`;
  }

  // ---------- вложенные экраны ----------
  const VIEWS = {
    // выбор второго заказа того же клиента, который вольётся в этот
    async merge(v) {
      const list = await cached('orders', {});
      const me = list.find((o) => o.id === v.id);
      if (!me) return '<div class="center hint">Заказ не найден</div>';
      const phone9 = (o) => String(o.phone || '').replace(/\D/g, '').slice(-9);
      const nm = (s) => String(s || '').trim().toLowerCase();
      const same = (o) => (phone9(me).length === 9 && phone9(o) === phone9(me)) || (me.instagram && nm(o.instagram) === nm(me.instagram))
        || [me.client, me.company].some((x) => nm(x) && !/^\(.*\)$/.test(x.trim()) && [o.client, o.company].some((y) => nm(y) === nm(x)));
      const others = list.filter((o) => o.id !== me.id);
      const similar = others.filter(same);
      const q = (S.mergeQ || '').trim().toLowerCase();
      const found = q ? others.filter((o) => !similar.includes(o) &&
        [o.client, o.company, o.phone, o.instagram, String(o.id)].some((x) => String(x || '').toLowerCase().includes(q))).slice(0, 30) : [];
      const pickRow = (o) => orderRow(o).replace('data-act="open"', `data-act="mergepick"`);
      return `<h1>Объединить с №${me.id}</h1>
        <p class="hint" style="margin:0 6px 10px">Выберите второй заказ этого клиента. Его продукты и оплаты перейдут в №${me.id},
          а сам он исчезнет из списков. Сделки в amoCRM не меняются.</p>
        <h2>Похожие заказы</h2>
        <div class="list">${similar.map(pickRow).join('') || '<div class="row hint">Похожих заказов не нашлось — найдите через поиск</div>'}</div>
        <h2>Поиск</h2>
        <input class="search" type="search" placeholder="Клиент, телефон, Instagram или №" value="${esc(S.mergeQ || '')}" data-input="mq">
        <div class="list">${found.map(pickRow).join('')}</div>`;
    },

    // карточка клиента: контакты, итоги и все его заказы
    async client(v) {
      const c = clientGroups(await cached('orders', {})).find((x) => x.key === v.key);
      if (!c) return '<div class="center hint">Клиент не найден</div>';
      const info = [['Телефон', c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${esc(c.phone)}</a>` : ''],
        ['Instagram', c.instagram ? `<a href="${esc(igUrl(c.instagram))}" data-act="link">${esc(c.instagram)}</a>` : ''],
        ['Компания', (c.orders.find((o) => o.company) || {}).company ? esc(c.orders.find((o) => o.company).company) : '']]
        .filter(([, x]) => x).map(([k, x]) => `<div class="row"><span class="hint" style="width:96px;flex:none">${k}</span><span class="grow">${x}</span></div>`).join('');
      return `<h1>${esc(c.name)}</h1>
        ${info ? `<div class="list">${info}</div>` : ''}
        <div class="kpis" style="margin-top:8px">
          <div class="kpi"><div class="k">Заказов</div><div class="v">${c.orders.length}</div></div>
          <div class="kpi"><div class="k">На сумму</div><div class="v">${money(c.total)}</div>${c.rest > 0 ? `<div class="hint red">долг ${money(c.rest)}</div>` : ''}</div>
        </div>
        <h2>Заказы клиента</h2>
        <div class="list">${c.orders.map(orderRow).join('')}</div>`;
    },

    // склад: все товары, сначала то, что заканчивается
    async stock() {
      const rows = [...(await cached('stock', {}))].sort(stockOrder);
      const q = (S.stockQ || '').trim().toLowerCase();
      const shown = rows.filter((r) => !q || r.product.toLowerCase().includes(q));
      const low = rows.filter(isLow).length;
      return `<h1>Склад</h1>
        ${isOwner() ? `<div class="grid2"><button class="btn" style="margin:0" data-act="stockin" data-v="in">+ Приход товара</button>
          <button class="btn ghost" style="margin:0" data-act="stockin" data-v="out">− Списание</button></div>
          <button class="btn ghost" data-act="stockcount">Остатки на начало месяца и минимумы</button>` : ''}
        <h2>${rows.filter((r) => r.stock !== null).length} товаров на складе${low ? ` · <span class="red">мало осталось: ${low}</span>` : ''}</h2>
        <input class="search" type="search" placeholder="Поиск товара" value="${esc(S.stockQ || '')}" data-input="sq">
        <div class="list">${shown.map(stockRow).join('') || '<div class="center hint">Ничего не нашлось</div>'}</div>
        <p class="hint" style="margin:10px 6px">Остаток = на начало месяца + приход − списание − продано в заказах.
          Заказ уменьшает склад сразу при сохранении, отменённый заказ возвращает товар.
          Когда остаток опускается ниже минимума, бот пишет в группу «Pechat24 operator».</p>`;
    },

    // один товар: из чего сложился остаток, минимум, история
    async stockitem(v) {
      const r = await cached('stock_item', { product: v.product });
      const line = (t, n, cls = '') => `<div class="total-line"><span>${t}</span><span class="${cls}">${n}</span></div>`;
      return `<h1>${esc(r.product)}</h1>
        <div class="kpis"><div class="kpi ${isLow(r) ? 'alert' : ''} wide"><div class="k">Остаток сейчас</div>
          <div class="v">${r.stock === null ? '—' : qtyFmt(r.stock) + ' шт.'}</div>
          <div class="hint">${r.stock === null ? 'Склад по этому товару не ведётся — внесите остаток на начало месяца или приход'
            : r.min_qty !== null ? (isLow(r) ? 'меньше минимума ' : 'минимум ') + qtyFmt(r.min_qty) : 'минимум не задан'}</div></div></div>
        ${r.stock === null ? '' : `<div class="card" style="margin-top:8px">
          ${line(r.opening ? `На начало, ${fmtDate(r.base_date)}` : `С ${fmtDate(r.base_date)}`, qtyFmt(r.opening))}
          ${line('Приход', '+' + qtyFmt(r.incoming), 'green')}
          ${Number(r.outgoing) ? line('Списание', '−' + qtyFmt(r.outgoing), 'red') : ''}
          ${line('Продано в заказах', '−' + qtyFmt(r.sold), 'red')}
          <div class="total-line big"><span>Остаток</span><span>${qtyFmt(r.stock)}</span></div></div>`}
        ${isOwner() ? `<h2>Минимум</h2><div class="card"><div class="hint">Когда остаток станет меньше — сигнал на дашборде и в Telegram.
            Хорошо продаётся — 50, медленно — 10.</div>
          <div style="display:flex;gap:6px;margin-top:8px"><input type="number" inputmode="numeric" id="minQty" value="${r.min_qty ?? ''}" placeholder="не задан">
            <button class="btn sm ghost" data-act="minset" data-v="50">50</button><button class="btn sm ghost" data-act="minset" data-v="10">10</button>
            <button class="btn sm" data-act="minsave">Сохранить</button></div></div>` : ''}
        <h2>Приход и списание</h2>
        <div class="list">${r.moves.map((m) => `<div class="row"><div class="grow">${m.kind === 'in' ? 'Приход' : 'Списание'}
            <div class="sub">${fmtDate(m.moved_at)}${m.comment ? ' · ' + esc(m.comment) : ''}</div></div>
          <div class="amt ${m.kind === 'in' ? 'green' : 'red'}"><b>${m.kind === 'in' ? '+' : '−'}${qtyFmt(m.qty)}</b></div>
          ${isOwner() ? `<button class="btn sm danger" data-act="movedel" data-id="${m.id}">✕</button>` : ''}</div>`).join('')
          || '<div class="row hint">Пока не было</div>'}</div>
        ${r.counts.length ? `<h2>Остатки на начало месяца</h2><div class="list">${r.counts.map((c) => `<div class="row"><span class="grow">${fmtDate(c.month)}</span>
          <span class="amt">${qtyFmt(c.qty)}</span></div>`).join('')}</div>` : ''}`;
    },

    // приход нового товара или списание: несколько товаров за раз
    async stockin(v) {
      const out = v.kind === 'out';
      v.after = () => { if (!document.querySelector('#moveItems .mv')) ACTS.mvadd(); };
      return `<h1>${out ? 'Списание' : 'Приход товара'}</h1>
        <div class="card">
          <label style="margin-top:0">Дата</label><input type="date" id="mvDate" value="${today()}">
          <label>Товары</label><div id="moveItems"></div>
          <button class="btn sm ghost" style="margin-top:8px" data-act="mvadd">+ Ещё товар</button>
          <div class="hint" style="margin-top:6px">Нового товара нет в списке? Добавьте его на странице «Остатки на начало месяца и минимумы».</div>
          <label>Комментарий</label><input id="mvComment" placeholder="${out ? 'брак, образец…' : 'поставщик, накладная…'}" autocomplete="off">
        </div>
        <button class="btn" data-act="mvsave">${out ? 'Списать' : 'Сохранить приход'}</button>`;
    },

    // остатки на начало месяца и минимумы — одним списком по всем товарам
    async stockcount(v) {
      const month = v.month || today().slice(0, 7);
      const rows = [...(await cached('stock', {}))].sort((a, b) => (a.sort - b.sort) || a.product.localeCompare(b.product));
      const draft = v.draft || {}; // уже вписанное, пока добавляли новый товар
      const val = (r, f, def) => (draft[r.product] && draft[r.product][f] !== undefined ? draft[r.product][f] : def);
      return `<h1>Остатки на начало месяца</h1>
        <div class="card"><label style="margin-top:0">Месяц</label><input type="month" value="${month}" data-input="scmonth">
          <div class="hint" style="margin-top:8px">Пересчитайте товар и впишите, сколько было на 1-е число. Пустое поле не меняется.
            Минимум: когда остаток станет меньше, придёт сигнал (хорошо продаётся — 50, медленно — 10).</div></div>
        <div class="card"><div class="srow hint"><span>Товар</span><span>Остаток</span><span>Минимум</span></div>
          ${rows.map((r) => `<div class="srow" data-product="${esc(r.product)}"><span>${esc(r.product)}</span>
            <input type="number" inputmode="numeric" min="0" data-f="qty" value="${esc(val(r, 'qty', r.base_date === month + '-01' ? qtyFmt(r.opening).replace(',', '.') : ''))}"
              placeholder="${r.stock === null ? '' : qtyFmt(r.stock)}">
            <input type="number" inputmode="numeric" min="0" data-f="min" value="${esc(val(r, 'min', r.min_qty ?? ''))}" data-orig="${r.min_qty ?? ''}"></div>`).join('')}
          <label>Товара нет в списке? Добавьте его</label>
          <div style="display:flex;gap:6px"><input id="newProduct" placeholder="Название, например R45" autocomplete="off">
            <button class="btn sm" data-act="stockadd">Добавить</button></div></div>
        <button class="btn" data-act="scsave">Сохранить</button>`;
    },

    // все расходы за период дашборда
    async expenses() {
      const r = S.dash.period === 'custom' ? { from: S.dash.from, to: S.dash.to } : range(S.dash.period);
      const { expenses } = await cached('finance', r);
      S.expenses = expenses; // для открытия расхода на правку
      const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
      const label = S.dash.period === 'custom' ? `${fmtDate(r.from)} — ${fmtDate(r.to)}` : periods[S.dash.period];
      return `<h1>Расходы</h1>
        <div class="hint" style="margin:0 6px 8px">${esc(label)} · ${expenses.length} записей · ${money(total)} сум</div>
        <div class="list">${expenses.map((e) => `<div class="row tap" data-act="expense" data-id="${e.id}">
          <div class="grow"><div class="title">${esc(e.category)}</div>
          <div class="sub">${fmtDate(e.spent_at)} · ${METHODS[e.method] || ''}${e.comment ? ' · ' + esc(e.comment) : ''}</div></div>
          <div class="amt red"><b>${money(e.amount)}</b></div></div>`).join('') || '<div class="center hint">Расходов нет</div>'}</div>
        <button class="fab" data-act="expense" aria-label="Новый расход">+</button>`;
    },

    // новый расход или правка
    async expense(v) {
      const e = v.data || { spent_at: today(), method: 'cash' };
      const cats = S.dicts.expense_categories.map((c) => c.name);
      return `<h1>${e.id ? 'Расход' : 'Новый расход'}</h1>
        <div class="card">
          <label style="margin-top:0">Вид расхода</label><select id="exCat">${opts(cats, e.category, 'Выберите')}</select>
          <div class="grid2"><div><label>Сумма</label><input type="number" inputmode="numeric" id="exAmount" value="${e.amount ?? ''}" placeholder="0"></div>
          <div><label>Дата</label><input type="date" id="exDate" value="${e.spent_at}"></div></div>
          <label>Чем платили</label>${segHtml('exmethod', e.method)}
          <label>Комментарий</label><input id="exComment" value="${esc(e.comment)}" placeholder="например: бумага, 5 пачек" autocomplete="off">
        </div>
        <button class="btn" data-act="exsave">Сохранить расход</button>
        ${e.id ? '<button class="btn danger" data-act="exdel">Удалить расход</button>' : ''}`;
    },

    async order(v) {
      const o = (v.data = await call('order', { id: v.id }, { quiet: true }));
      const info = [['Дата', fmtDate(o.order_date)], ['Менеджер', o.manager_code], ['Дизайнер', o.designer_code], ['Источник', o.source],
        ['Клиент', o.client], ['Телефон', o.phone ? `<a href="tel:${esc(o.phone.replace(/\s/g, ''))}">${esc(o.phone)}</a>` : ''],
        ['Доставка', [DELIVERY[o.delivery_type], o.delivery_region, o.delivery_service].filter(Boolean).join(' · ')],
        ['Адрес', o.delivery], ['Трек-номер', o.tracking], ['Комментарий', o.comment],
        ['Instagram', o.instagram ? `<a href="${esc(igUrl(o.instagram))}" data-act="link">${esc(o.instagram)}</a>` : ''],
        ['amoCRM', o.amo_lead_id ? `<a href="${AMO + o.amo_lead_id}" data-act="link">сделка ${o.amo_lead_id}</a>` : '']]
        .filter(([, x]) => x).map(([k, x]) => `<div class="row"><span class="hint" style="width:96px;flex:none">${k}</span><span class="grow">${['Телефон', 'Instagram', 'amoCRM'].includes(k) ? x : esc(x)}</span></div>`).join('');
      return `<h1>№${o.id} · ${esc(o.company || o.client || 'Заказ')}</h1>
        ${stepper(o)}
        <div class="list">${info}</div>
        <h2>Продукты</h2>
        <div class="card">${o.items.map((i) => `<div class="total-line"><span>${esc(i.product)} ×${i.qty}${inkDot(i.ink)}</span><span>${money(i.amount)}</span></div>`).join('')}
          <div class="total-line big"><span>Итого</span><span>${money(o.total)} сум</span></div>
          <div class="total-line"><span class="green">Оплачено</span><span class="green">${money(o.paid)}</span></div>
          <div class="total-line"><span class="${o.rest > 0 ? 'red' : 'green'}"><b>Остаток</b></span><span class="${o.rest > 0 ? 'red' : 'green'}"><b>${money(o.rest)}</b></span></div></div>
        <h2>Оплаты</h2>
        <div class="list">${o.payments.map((p) => `<div class="row"><div class="grow">${METHODS[p.method]}<div class="sub">${fmtDate(p.paid_at)}${p.paid_time ? ' · ' + String(p.paid_time).slice(0, 5) : ''}</div></div>
          ${p.receipt_url ? `<a class="receipt" href="${esc(p.receipt_url)}" data-act="receipt" title="Чек"><img src="${esc(p.receipt_url)}" alt="Чек"></a>`
            : `<label class="btn sm ghost receipt-add">📎 Чек<input type="file" accept="image/*" hidden data-receipt-for="${p.id}"></label>`}
          <div class="amt">${money(p.amount)}</div>${isOwner() ? `<button class="btn sm danger" data-act="paydel" data-id="${p.id}">✕</button>` : ''}</div>`).join('') || '<div class="row hint">Оплат пока нет</div>'}</div>
        ${o.rest > 0 && o.stage !== 'Отменён' ? `<div class="card" style="margin-top:8px"><b>Добавить оплату</b>
          ${segHtml('method', 'click')}
          <label>Сумма</label><input type="number" inputmode="numeric" placeholder="Сумма" value="${o.rest}" id="payAmount">
          <div class="grid2"><div><label>Дата оплаты</label><input type="date" value="${today()}" id="payDate"></div>
          <div><label>Время оплаты</label><input type="time" value="${nowTime()}" id="payTime"></div></div>
          ${receiptPicker()}
          <button class="btn" data-act="payadd">Сохранить оплату</button></div>` : ''}
        <h2>Утверждённый дизайн</h2>
        <div class="card">${(o.designs || []).length ? `<div class="designs">${o.designs.map((d) => `<div class="design">
            <a href="${esc(d.url)}" data-act="receipt"><img src="${esc(d.url)}" alt="Дизайн"></a>
            <button data-act="designdel" data-id="${d.id}" aria-label="Удалить">✕</button></div>`).join('')}</div>` : '<div class="hint">Дизайн ещё не прикреплён</div>'}
          ${designPicker(o.id)}</div>
        <button class="btn ghost" data-act="edit">Редактировать заказ</button>
        <button class="btn ghost" data-act="merge">Объединить с другим заказом</button>
        ${isOwner() ? '<button class="btn danger" data-act="delete">Удалить заказ</button>' : ''}`;
    },

    async form(v) {
      const o = v.data;
      const names = (k, f = 'name') => S.dicts[k].filter((x) => x.active !== false).map((x) => x[f]);
      const staff = S.dicts.staff.filter((s) => s.active).map((s) => s.code);
      v.after = () => { recalcForm(); };
      return `<h1>${o.id ? 'Заказ №' + o.id : 'Новый заказ'}</h1>
        <div class="card">
          <div class="grid2"><div><label>Дата</label><input type="date" name="order_date" value="${o.order_date || today()}"></div>
          <div><label>Менеджер</label>${isOwner() ? `<select name="manager_code">${opts(staff, o.manager_code || S.user.code)}</select>` : `<input value="${esc(S.user.code)}" disabled>`}</div></div>
          <div class="grid2"><div><label>Дизайнер</label><select name="designer_code">${opts(names('designers', 'code'), o.designer_code)}</select></div>
          <div><label>Источник</label><select name="source" data-input="source">${opts(names('sources'), o.source)}</select></div></div>
          <div id="igField" ${isInstagram(o.source) ? '' : 'hidden'}><label>Ссылка на Instagram</label>
            <input name="instagram" value="${esc(o.instagram)}" placeholder="https://instagram.com/… или @ник" autocomplete="off"></div>
          <label>Клиент (имя / ник)</label><input name="client" value="${esc(o.client)}" autocomplete="off">
          <label>Компания / текст печати</label><input name="company" value="${esc(o.company)}" autocomplete="off">
          <label>Телефон</label><input name="phone" type="tel" value="${esc(o.phone)}" placeholder="90 123 45 67">
          <label>Сделка в amoCRM (ссылка)</label><input name="amo_lead" value="${o.amo_lead_id ? esc(AMO + o.amo_lead_id) : ''}" placeholder="Вставьте ссылку, если по телефону не найдётся" autocomplete="off">
        </div>
        <h2>Продукты</h2>
        <div class="card"><div class="hint">Отметьте все продукты заказа (можно несколько), затем укажите количество и сумму каждого</div>
          <div class="chips wrap" id="pick">${pickHtml(o.items || [])}</div>
          <div id="items">${(o.items || []).map(itemHtml).join('')}</div>
          <div class="total-line big" style="margin-top:8px"><span>Итого</span><span id="formTotal">0</span></div></div>
        ${o.payments?.length ? '' : `<h2>Предоплата</h2><div class="card">${segHtml('method', 'click')}
          <div class="grid2"><div><label>Сумма</label><input type="number" inputmode="numeric" placeholder="Можно пусто" id="firstPay"></div>
          <div><label>Время оплаты</label><input type="time" value="${nowTime()}" id="firstPayTime"></div></div>
          ${receiptPicker()}</div>`}
        <h2>Утверждённый дизайн</h2><div class="card">${designPicker()}</div>
        <h2>Доставка</h2>
        <div class="card"><div class="seg" data-seg="dtype">${Object.entries(DELIVERY).map(([k, t]) =>
          `<button data-act="seg" data-v="${k}" class="${k === (o.delivery_type || 'Самовывоз') ? 'on' : ''}">${t}</button>`).join('')}</div>
          <div id="dFields">${deliveryFields(o.delivery_type || 'Самовывоз', o)}</div></div>
        <div class="card" style="margin-top:8px">
          <label style="margin-top:0">Этап</label><select name="stage">${opts(S.dicts.stages, o.stage || flow()[0]).replace('<option value="">—</option>', '')}</select>
          <label>Комментарий</label><textarea name="comment">${esc(o.comment)}</textarea>
        </div>
        <button class="btn" data-act="save">Сохранить заказ</button>`;
    },

    async staff(v) {
      const s = v.data || { code: '', name: '', telegram_id: '', role: 'manager', active: true };
      return `<h1>${s.code ? 'Сотрудник ' + esc(s.code) : 'Новый сотрудник'}</h1>
        <div class="card">
          <label style="margin-top:0">Код (как в заказах: MY, SH…)</label><input id="sCode" value="${esc(s.code)}" ${s.code ? 'disabled' : ''}>
          <label>Имя</label><input id="sName" value="${esc(s.name)}">
          <label>Telegram ID</label><input id="sTg" inputmode="numeric" value="${esc(s.telegram_id || '')}" placeholder="например 123456789">
          <label>Роль</label><select id="sRole">${['manager', 'owner'].map((r) => `<option value="${r}" ${s.role === r ? 'selected' : ''}>${r === 'owner' ? 'Руководитель (видит всё)' : 'Менеджер (видит свои заказы)'}</option>`).join('')}</select>
          <label><input type="checkbox" id="sActive" ${s.active ? 'checked' : ''} style="width:auto;min-height:0"> Активен</label>
        </div>
        <button class="btn" data-act="staffsave">Сохранить</button>`;
    },
  };

  const segHtml = (name, cur) => `<div class="seg" data-seg="${name}">${Object.entries(METHODS).map(([k, t]) => `<button data-act="seg" data-v="${k}" class="${k === cur ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const pickHtml = (items) => {
    const chosen = new Set(items.map((i) => i.product));
    return S.dicts.products.filter((p) => p.active !== false).map((p) =>
      `<button class="chip ${chosen.has(p.name) ? 'on' : ''}" data-act="pick" data-v="${esc(p.name)}">${chosen.has(p.name) ? '✓ ' : ''}${esc(p.name)}</button>`).join('');
  };
  const itemHtml = (i) => `<div class="item" data-product="${esc(i.product)}"><div class="iname">${esc(i.product)}</div>
    <input type="number" inputmode="decimal" data-f="qty" value="${i.qty ?? 1}" min="0" placeholder="шт."><input type="number" inputmode="numeric" data-f="amount" value="${i.amount ?? ''}" placeholder="Сумма, сум">
    <button data-act="delitem" aria-label="Убрать">×</button>
    ${hasInk(i.product) ? `<div class="inks"><span class="hint">Siyoh rangi:</span>${Object.entries(INKS).map(([k, c]) =>
      `<button class="ink ${k === i.ink ? 'on' : ''}" data-act="ink" data-v="${k}"><i style="background:${c}"></i>${k}</button>`).join('')}</div>` : ''}</div>`;
  function deliveryFields(type, o) {
    if (type === 'Самовывоз') return '<p class="hint" style="margin:10px 2px 0">Клиент заберёт заказ сам.</p>';
    return `${type === 'Область' ? `<label>Область</label><select name="delivery_region">${opts(REGIONS, o.delivery_region, 'Выберите область')}</select>` : ''}
      <label>${type === 'Область' ? 'Чем отправляем' : 'Кто доставит'}</label>
      <select name="delivery_service">${opts(SERVICES[type], o.delivery_service)}</select>
      <label>${type === 'Область' ? 'Адрес или отделение почты (без области)' : 'Адрес'}</label>
      <input name="delivery" value="${esc(o.delivery)}" placeholder="${type === 'Область' ? 'Чорсу бозор' : 'Юнусабад, 4-квартал, дом 12'}">
      ${type === 'Область' ? `<label>Трек-номер (можно позже)</label><input name="tracking" value="${esc(o.tracking)}">` : ''}`;
  }
  const deliveryText = (o) => o.delivery_type === 'Область'
    ? ['📦', o.delivery_region, o.delivery_service].filter(Boolean).join(' ')
    : o.delivery_type === 'Ташкент' ? '🚚 Ташкент' + (o.delivery_service ? ' · ' + o.delivery_service : '') : '';
  const itemRows = () => [...document.querySelectorAll('#items .item')];
  function refreshPick() {
    const pick = document.getElementById('pick');
    if (pick) pick.innerHTML = pickHtml(itemRows().map((r) => ({ product: r.dataset.product })));
    recalcForm();
  }
  function recalcForm() {
    const el = document.getElementById('formTotal'); if (!el) return;
    el.textContent = money([...document.querySelectorAll('#items [data-f=amount]')].reduce((s, x) => s + (Number(x.value) || 0), 0)) + ' сум';
  }
  const segVal = (name) => { const b = document.querySelector(`[data-seg=${name}] .on`); return b && b.dataset.v; };

  // ---------- действия ----------
  const ACTS = {
    reload: () => { cache.clear(); render(); },
    tab: (el) => setTab(el.dataset.v),
    client: (el) => push({ type: 'client', key: el.dataset.key }),
    merge: () => { S.mergeQ = ''; push({ type: 'merge', id: S.stack[S.stack.length - 1].id }); },
    async mergepick(el) {
      const v = S.stack[S.stack.length - 1], from = Number(el.dataset.id);
      if (!(await ask(`Объединить заказ №${from} в №${v.id}? Продукты и оплаты №${from} перейдут в №${v.id}, а №${from} исчезнет.`))) return;
      try {
        await call('order_merge', { id: v.id, from }); haptic('success'); toast(`№${from} объединён с №${v.id}`); pop();
      } catch { /* call уже показал ошибку */ }
    },
    period: (el) => { S.filters.period = el.dataset.v; render(); },
    status: (el) => { S.filters.status = el.dataset.v; render(); },
    fstage: (el) => { S.filters.stage = el.dataset.v; render(); },
    expenses: () => push({ type: 'expenses' }),
    expense: (el) => {
      const e = el.dataset.id && (S.expenses || []).find((x) => String(x.id) === el.dataset.id);
      push({ type: 'expense', data: e ? { ...e } : null });
    },
    async exsave(el) {
      const v = S.stack[S.stack.length - 1];
      const row = { id: v.data?.id, category: document.getElementById('exCat').value, amount: Number(document.getElementById('exAmount').value),
        spent_at: document.getElementById('exDate').value, method: segVal('exmethod'), comment: document.getElementById('exComment').value };
      if (!row.category) return toast('Выберите вид расхода');
      if (!(row.amount > 0)) return toast('Введите сумму');
      el.disabled = true;
      try { await call('expense_save', row); haptic('success'); toast('Расход сохранён'); pop(); }
      catch { el.disabled = false; }
    },
    async exdel() {
      const v = S.stack[S.stack.length - 1];
      if (!(await ask(`Удалить расход ${money(v.data.amount)} сум (${v.data.category})?`))) return;
      await call('expense_delete', { id: v.data.id }); haptic('success'); toast('Расход удалён'); pop();
    },
    dperiod: (el) => {
      S.dash.period = el.dataset.v;
      if (el.dataset.v === 'custom' && !S.dash.from) Object.assign(S.dash, range('month'));
      render();
    },
    open: (el) => push({ type: 'order', id: Number(el.dataset.id) }),
    new: () => push({ type: 'form', data: { items: [] } }),
    edit: () => { const o = S.stack[S.stack.length - 1].data; push({ type: 'form', data: JSON.parse(JSON.stringify(o)) }); },
    pick: (el) => {
      const row = itemRows().find((r) => r.dataset.product === el.dataset.v);
      if (row) row.remove();
      else {
        document.getElementById('items').insertAdjacentHTML('beforeend', itemHtml({ product: el.dataset.v }));
        itemRows().pop().querySelector('[data-f=amount]').focus();
      }
      refreshPick();
    },
    delitem: (el) => { el.closest('.item').remove(); refreshPick(); },
    ink: (el) => el.parentNode.querySelectorAll('.ink').forEach((b) => b.classList.toggle('on', b === el)),
    seg: (el) => {
      el.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
      if (el.parentNode.dataset.seg === 'dtype') {
        const keep = {};
        ['delivery', 'delivery_region', 'delivery_service', 'tracking'].forEach((n) => { const x = $app.querySelector(`[name=${n}]`); if (x) keep[n] = x.value; });
        document.getElementById('dFields').innerHTML = deliveryFields(el.dataset.v, keep);
      }
    },
    async save(el) {
      const v = S.stack[S.stack.length - 1];
      const val = (n) => { const x = $app.querySelector(`[name=${n}]`); return x ? x.value : undefined; };
      const order = { id: v.data.id, order_date: val('order_date'), manager_code: val('manager_code'), designer_code: val('designer_code'),
        source: val('source'), client: val('client'), company: val('company'), phone: val('phone'), stage: val('stage'),
        delivery: val('delivery'), comment: val('comment'), delivery_type: segVal('dtype'),
        delivery_region: val('delivery_region'), delivery_service: val('delivery_service'), tracking: val('tracking'),
        amo_lead: val('amo_lead'), instagram: isInstagram(val('source')) ? val('instagram') : '' };
      if (order.delivery_type === 'Область' && !order.delivery_region) return toast('Выберите область доставки');
      if (order.delivery_type === 'Область' && !order.delivery_service) return toast('Выберите, чем отправляем (BTS, EMU…)');
      const items = itemRows().map((r) => ({
        product: r.dataset.product, qty: r.querySelector('[data-f=qty]').value, amount: r.querySelector('[data-f=amount]').value,
        ink: r.querySelector('.ink.on')?.dataset.v || null }));
      if (!items.length) return toast('Отметьте хотя бы один продукт');
      const noInk = items.find((i) => hasInk(i.product) && !i.ink);
      if (noInk) return toast(`${noInk.product}: siyoh rangini tanlang`);
      if (items.some((i) => !(Number(i.amount) > 0)) && !(await ask('У некоторых продуктов не указана сумма. Сохранить так?'))) return;
      if (!order.client && !order.company && !order.phone) return toast('Укажите клиента, компанию или телефон');
      if (isOwner() && !order.manager_code) return toast('Выберите менеджера');
      const fp = document.getElementById('firstPay');
      const payment = fp && Number(fp.value) > 0 ? { method: segVal('method'), amount: Number(fp.value), paid_at: order.order_date,
        paid_time: document.getElementById('firstPayTime').value, receipt: S.receipt } : null;
      if (S.receipt && !payment) return toast('Чек прикреплён — укажите сумму предоплаты');
      if (order.stage === CLOSED && v.data.stage !== CLOSED) {
        const rest = items.reduce((s, i) => s + (Number(i.amount) || 0), 0) - (Number(v.data.paid) || 0) - (payment ? payment.amount : 0);
        if (rest > 0) return toast(closeDebtMsg(rest));
      }
      el.disabled = true;
      const design = S.design;
      try {
        const saved = await call('order_save', { order, items, payment });
        // заказ уже сохранён: если дизайн не загрузится, его можно добавить в карточке
        const ok = !design || await call('design_add', { order_id: saved.id, image: design }, { quiet: true }).then(() => true, () => false);
        haptic('success'); toast(ok ? 'Заказ сохранён' : 'Заказ сохранён, но дизайн не загрузился — добавьте его в карточке');
        S.stack = S.stack.filter((x) => x.type !== 'form' && !(x.type === 'order' && x.id === saved.id));
        push({ type: 'order', id: saved.id });
      } catch { el.disabled = false; }
    },
    async payadd(el) {
      const v = S.stack[S.stack.length - 1];
      const amount = Number(document.getElementById('payAmount').value);
      if (!(amount > 0)) return toast('Введите сумму');
      if (amount > v.data.rest && !(await ask(`Сумма больше остатка (${money(v.data.rest)}). Всё равно сохранить?`))) return;
      el.disabled = true;
      try { await call('payment_add', { order_id: v.id, method: segVal('method'), amount, paid_at: document.getElementById('payDate').value, paid_time: document.getElementById('payTime').value, receipt: S.receipt }); haptic('success'); toast('Оплата добавлена'); render(); }
      catch { el.disabled = false; }
    },
    async stage(el) {
      const v = S.stack[S.stack.length - 1], s = el.dataset.v;
      if (s === v.data.stage) return;
      if (s === CLOSED && v.data.rest > 0) { haptic('error'); return toast(closeDebtMsg(v.data.rest)); }
      if (s === CANCEL && !(await ask(`Отменить заказ №${v.id}?`))) return;
      await call('order_stage', { id: v.id, stage: s }); haptic('success'); toast('Этап: ' + s); render();
    },
    async paydel(el) {
      if (!(await ask('Удалить эту оплату?'))) return;
      await call('payment_delete', { id: Number(el.dataset.id) }); render();
    },
    async delete() {
      const v = S.stack[S.stack.length - 1];
      if (!(await ask(`Удалить заказ №${v.id} полностью? Это нельзя отменить.`))) return;
      await call('order_delete', { id: v.id }); toast('Заказ удалён'); pop();
    },
    staff: (el) => push({ type: 'staff', data: S.dicts.staff.find((s) => s.code === el.dataset.code) }),
    async staffsave() {
      const code = document.getElementById('sCode').value.trim();
      if (!code) return toast('Введите код');
      const res = await call('staff_save', { code, name: document.getElementById('sName').value, telegram_id: document.getElementById('sTg').value.trim() || null,
        role: document.getElementById('sRole').value, active: document.getElementById('sActive').checked });
      setMe(res); toast('Сохранено'); pop();
    },
    async dict(el) {
      const inp = $app.querySelector(`[data-dict=${el.dataset.kind}]`);
      if (!inp.value.trim()) return;
      const res = await call('dict_add', { kind: el.dataset.kind, name: inp.value.trim() }); setMe(res); toast('Добавлено'); render();
    },
    async sheetsync(el) {
      const date = document.getElementById('syncDate').value;
      if (!date) return toast('Выберите дату');
      el.disabled = true; toast('Выгружаю… это может занять минуту');
      try { const r = await call('sheets_sync', { date }); haptic('success'); toast(`Готово: ${r.count} заказов за ${fmtDate(date)}`); }
      finally { el.disabled = false; }
    },
    async reqok(el) {
      const card = el.closest('[data-req]');
      const code = (card.querySelector('[data-f=newcode]').value.trim() || card.querySelector('[data-f=code]').value).toUpperCase();
      if (!code) return toast('Выберите код сотрудника или впишите новый');
      el.disabled = true;
      try {
        setMe(await call('access_decide', { telegram_id: Number(card.dataset.req), approve: true, code }));
        haptic('success'); toast(`Доступ открыт: ${code}`); render();
      } catch { el.disabled = false; }
    },
    async reqno(el) {
      const card = el.closest('[data-req]');
      if (!(await ask('Отклонить заявку?'))) return;
      setMe(await call('access_decide', { telegram_id: Number(card.dataset.req), approve: false })); toast('Заявка отклонена'); render();
    },
    // склад
    stock: () => { S.stockQ = ''; push({ type: 'stock' }); },
    stockitem: (el) => push({ type: 'stockitem', product: el.dataset.v }),
    stockin: (el) => push({ type: 'stockin', kind: el.dataset.v }),
    stockcount: () => push({ type: 'stockcount' }),
    mvadd: () => {
      const names = S.dicts.products.filter((x) => x.active !== false).map((x) => x.name);
      document.getElementById('moveItems').insertAdjacentHTML('beforeend', `<div class="mv">
        <select data-f="product">${opts(names, '', 'Товар')}</select>
        <input type="number" inputmode="numeric" min="0" data-f="qty" placeholder="шт.">
        <button data-act="mvdel" aria-label="Убрать">×</button></div>`);
    },
    mvdel: (el) => el.closest('.mv').remove(),
    async mvsave(el) {
      const v = S.stack[S.stack.length - 1];
      const items = [...document.querySelectorAll('#moveItems .mv')].map((r) => ({
        product: r.querySelector('[data-f=product]').value, qty: Number(r.querySelector('[data-f=qty]').value) }));
      if (items.some((i) => i.product && !(i.qty > 0))) return toast('Укажите количество');
      const ok = items.filter((i) => i.product && i.qty > 0);
      if (!ok.length) return toast('Выберите товар и количество');
      el.disabled = true;
      try {
        await call('stock_in', { kind: v.kind, items: ok, moved_at: document.getElementById('mvDate').value, comment: document.getElementById('mvComment').value });
        haptic('success'); toast(v.kind === 'out' ? 'Списано' : 'Приход сохранён'); pop();
      } catch { el.disabled = false; }
    },
    async movedel(el) {
      if (!(await ask('Удалить эту запись прихода / списания?'))) return;
      await call('stock_move_delete', { id: Number(el.dataset.id) }); toast('Удалено'); render();
    },
    minset: (el) => { document.getElementById('minQty').value = el.dataset.v; },
    async minsave(el) {
      const v = S.stack[S.stack.length - 1];
      el.disabled = true;
      try { await call('stock_count', { rows: [{ product: v.product, min_qty: document.getElementById('minQty').value }] }); haptic('success'); toast('Минимум сохранён'); render(); }
      catch { el.disabled = false; }
    },
    // новый товар прямо со страницы остатков (попадёт и в справочник продуктов для заказов)
    async stockadd(el) {
      const v = S.stack[S.stack.length - 1], inp = document.getElementById('newProduct'), name = inp.value.trim();
      if (!name) return toast('Впишите название товара');
      if (S.dicts.products.some((x) => x.name.toLowerCase() === name.toLowerCase())) return toast('Такой товар уже есть в списке');
      v.draft = {}; // не теряем уже вписанные цифры
      document.querySelectorAll('.srow[data-product]').forEach((r) => {
        v.draft[r.dataset.product] = { qty: r.querySelector('[data-f=qty]').value, min: r.querySelector('[data-f=min]').value };
      });
      v.month = $app.querySelector('[data-input=scmonth]').value || v.month;
      el.disabled = true;
      try {
        setMe(await call('dict_add', { kind: 'products', name })); haptic('success'); toast(`Добавлен: ${name}`);
        await render();
        const row = $app.querySelector(`.srow[data-product="${CSS.escape(name)}"] [data-f=qty]`);
        if (row) { row.scrollIntoView({ block: 'center' }); row.focus(); }
      } catch { el.disabled = false; }
    },
    async scsave(el) {
      const month = $app.querySelector('[data-input=scmonth]').value;
      const rows = [...document.querySelectorAll('.srow[data-product]')].map((r) => {
        const qty = r.querySelector('[data-f=qty]').value.trim(), min = r.querySelector('[data-f=min]');
        const row = { product: r.dataset.product, qty };
        if (min.value.trim() !== min.dataset.orig) row.min_qty = min.value.trim(); // минимум шлём только изменённый
        return row;
      }).filter((r) => r.qty !== '' || r.min_qty !== undefined);
      if (!rows.length) return toast('Ничего не изменено');
      if (rows.some((r) => r.qty !== '') && !month) return toast('Укажите месяц');
      el.disabled = true;
      try { await call('stock_count', { month, rows }); haptic('success'); toast('Сохранено'); pop(); }
      catch { el.disabled = false; }
    },
    // раздел «Чек и дизайн»
    ptarget: (el) => { S.paste.target = el.dataset.v; paintPaste(); },
    pfile: (el) => { S.paste.target = el.dataset.v; paintPaste(); $app.querySelector(`[data-paste=${el.dataset.v}]`).click(); },
    pclear: (el) => { S.paste[el.dataset.v] = null; paintPaste(); },
    ppick: (el) => { Object.assign(S.paste, { orderId: Number(el.dataset.id), payTo: null }); render(); },
    punpick: () => { S.paste.orderId = null; render(); },
    payto: (el) => {
      S.paste.payTo = el.dataset.v;
      el.parentNode.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', b === el));
      document.getElementById('newPay').hidden = el.dataset.v !== 'new';
    },
    async psave(el) {
      const P = S.paste;
      if (!P.receipt && !P.design) return toast('Вставьте чек или дизайн (Ctrl+V)');
      if (!P.orderId) return toast('Выберите заказ');
      let pay = null;
      if (P.receipt && (!P.payTo || P.payTo === 'new')) {
        const amount = Number(document.getElementById('payAmount').value);
        if (!(amount > 0)) return toast('Введите сумму оплаты по чеку');
        const o = await cached('order', { id: P.orderId });
        if (amount > o.rest && !(await ask(`Сумма больше остатка (${money(o.rest)}). Всё равно сохранить?`))) return;
        pay = { order_id: P.orderId, method: segVal('method'), amount, receipt: P.receipt,
          paid_at: document.getElementById('payDate').value, paid_time: document.getElementById('payTime').value };
      }
      el.disabled = true;
      try {
        if (P.receipt) {
          await call(pay ? 'payment_add' : 'payment_receipt', pay || { id: Number(P.payTo), receipt: P.receipt });
          P.receipt = null; paintPaste(); // чек уже сохранён — при повторе не создадим вторую оплату
        }
        if (P.design) await call('design_add', { order_id: P.orderId, image: P.design });
        haptic('success'); toast(`Сохранено в заказ №${P.orderId}`);
        S.paste = { target: 'receipt' }; render();
      } catch { el.disabled = false; }
    },
    async designdel(el) {
      if (!(await ask('Удалить этот дизайн?'))) return;
      await call('design_delete', { id: Number(el.dataset.id) }); toast('Дизайн удалён'); render();
    },
    link: (el) => (tg && tg.openLink ? tg.openLink(el.href) : window.open(el.href, '_blank')),
    receipt: (el) => ACTS.link(el),
    copyid: (el) => { navigator.clipboard && navigator.clipboard.writeText(el.dataset.v); toast('ID скопирован'); },
  };
  $app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && ACTS[el.dataset.act]) { e.preventDefault(); ACTS[el.dataset.act](el); }
  });
  // Enter в поле формы — переход к следующему полю (на телефоне кнопка клавиатуры «Далее»), а не «ничего»
  const fields = () => [...$app.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=search]):not([disabled]), select, textarea')]
    .filter((x) => x.offsetParent !== null);
  $app.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key !== 'Enter' || e.isComposing || !t.matches('input, select') || t.type === 'search') return;
    e.preventDefault();
    const list = fields(), next = list[list.indexOf(t) + 1];
    if (next) { next.focus(); if (next.select && next.tagName === 'INPUT' && next.type !== 'date' && next.type !== 'time') next.select(); }
    else t.blur(); // последнее поле — просто убираем клавиатуру
  });
  // подсказка клавиатуре телефона: на Enter показать «Далее»
  new MutationObserver(() => $app.querySelectorAll('input:not([enterkeyhint])').forEach((x) => x.setAttribute('enterkeyhint', x.type === 'search' ? 'search' : 'next')))
    .observe($app, { childList: true, subtree: true });

  // ряды чипов на компьютере: колесо мыши и перетаскивание листают их вбок (на телефоне — обычный свайп)
  $app.addEventListener('wheel', (e) => {
    const row = e.target.closest('.chips:not(.wrap)');
    if (row && row.scrollWidth > row.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { row.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  let drag = null;
  $app.addEventListener('pointerdown', (e) => {
    const row = e.pointerType === 'mouse' && e.target.closest('.chips:not(.wrap)');
    if (row) drag = { row, x: e.clientX, left: row.scrollLeft, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 5) drag.moved = true;
    if (drag.moved) drag.row.scrollLeft = drag.left - dx;
  });
  window.addEventListener('pointerup', () => { setTimeout(() => { drag = null; }); });
  // после перетаскивания не нажимаем чип, на котором отпустили мышь
  $app.addEventListener('click', (e) => { if (drag?.moved) { e.stopPropagation(); e.preventDefault(); } }, true);
  $app.addEventListener('input', (e) => {
    const k = e.target.dataset.input;
    if (e.target.closest('#items')) recalcForm();
    if (k === 'q' || k === 'cq' || k === 'mq' || k === 'pq' || k === 'sq') {
      if (k === 'q') S.filters.q = e.target.value; else if (k === 'cq') S.clientQ = e.target.value;
      else if (k === 'pq') S.paste.q = e.target.value; else if (k === 'sq') S.stockQ = e.target.value; else S.mergeQ = e.target.value;
      clearTimeout(ACTS.qt); ACTS.qt = setTimeout(() => { const pos = e.target.selectionStart; render().then(() => { const s = $app.querySelector(`[data-input=${k}]`); if (s) { s.focus(); s.setSelectionRange(pos, pos); } }); }, 350);
    }
  });
  $app.addEventListener('change', async (e) => {
    const k = e.target.dataset.input;
    if (k === 'dfrom' || k === 'dto') { S.dash[k === 'dfrom' ? 'from' : 'to'] = e.target.value; render(); }
    if (k === 'scmonth' && e.target.value) { S.stack[S.stack.length - 1].month = e.target.value; render(); } // подставить внесённое за тот месяц
    if (e.target.dataset.demo !== undefined) { location.search = '?demo=' + e.target.value; }
    if (k === 'source') document.getElementById('igField').hidden = !isInstagram(e.target.value);
    const file = e.target.files && e.target.files[0];
    if (file && e.target.dataset.receiptNew !== undefined) {
      try {
        showReceipt(await readReceipt(file));
      } catch (err) { toast(err.message); }
    }
    if (file && e.target.dataset.paste) { await setPaste(e.target.dataset.paste, file); e.target.value = ''; }
    if (file && (e.target.dataset.designFor || e.target.dataset.designNew !== undefined)) await putDesign(file);
    if (file && e.target.dataset.receiptFor) {
      let receipt;
      try { receipt = await readReceipt(file); } catch (err) { return toast(err.message); }
      try {
        await call('payment_receipt', { id: Number(e.target.dataset.receiptFor), receipt }); haptic('success'); toast('Чек сохранён'); render();
      } catch { /* call уже показал ошибку */ }
    }
  });

  // ---------- вставка картинок: Ctrl+V и перетаскивание ----------
  // раздел «Чек и дизайн» перерисовываем точечно, чтобы не сбросить уже введённую сумму
  function paintPaste() {
    const P = S.paste;
    $app.querySelectorAll('[data-zone]').forEach((z) => {
      const k = z.dataset.zone, img = z.querySelector('img');
      z.classList.toggle('on', P.target === k);
      img.hidden = !P[k]; if (P[k]) img.src = P[k]; else img.removeAttribute('src');
      z.querySelector('.drop-empty').hidden = !!P[k];
      z.querySelector('[data-act=pclear]').hidden = !P[k];
    });
    const box = document.getElementById('payBox');
    if (box) box.hidden = !P.receipt;
  }
  // Поля «Чек» / «Дизайн» в форме и карточке заказа: выделенное рамкой принимает Ctrl+V
  function paintPz() {
    const zones = [...$app.querySelectorAll('[data-pz]')];
    if (zones.length && !zones.some((z) => z.dataset.pz === S.pz)) S.pz = zones[0].dataset.pz;
    zones.forEach((z) => z.classList.toggle('on', z.dataset.pz === S.pz));
  }
  $app.addEventListener('click', (e) => {
    const z = e.target.closest('[data-pz]');
    if (z) { S.pz = z.dataset.pz; paintPz(); }
  });
  // чек к новой оплате (форма заказа и карточка заказа)
  function showReceipt(data) {
    S.receipt = data;
    const img = document.getElementById('receiptPreview'); img.src = data; img.hidden = false;
    document.getElementById('receiptEmpty').hidden = true;
    haptic('success'); toast('Чек вставлен');
  }
  // дизайн: в карточке заказа сохраняется сразу, в форме — вместе с заказом
  async function putDesign(file) {
    let image;
    try { image = await readReceipt(file, 2400, 0.9); } catch (err) { return toast(err.message); }
    const input = $app.querySelector('[data-design-for]');
    if (input) {
      toast('Сохраняю дизайн…');
      try { await call('design_add', { order_id: Number(input.dataset.designFor), image }); haptic('success'); toast('Дизайн сохранён'); render(); }
      catch { /* call уже показал ошибку */ }
      return;
    }
    S.design = image;
    const img = document.getElementById('designPreview'); img.src = image; img.hidden = false;
    document.getElementById('designEmpty').hidden = true;
    haptic('success'); toast('Дизайн вставлен — сохранится вместе с заказом');
  }
  const putPz = async (kind, file) => {
    if (kind === 'design') return putDesign(file);
    try { showReceipt(await readReceipt(file)); } catch (err) { toast(err.message); }
  };
  async function setPaste(k, file) {
    try { S.paste[k] = k === 'design' ? await readReceipt(file, 2400, 0.9) : await readReceipt(file); }
    catch (err) { return toast(err.message); }
    paintPaste(); haptic('success');
    toast(k === 'design' ? 'Дизайн вставлен' : S.paste.orderId ? 'Чек вставлен' : 'Чек вставлен — выберите заказ');
  }
  const isPasteTab = () => !S.stack.length && S.tab === 'paste';
  const imageFile = (dt) => [...((dt && dt.files) || [])].find((f) => f.type.startsWith('image/'))
    || [...((dt && dt.items) || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile())[0];
  document.addEventListener('paste', async (e) => {
    const file = imageFile(e.clipboardData);
    if (!file) return; // обычный текст вставляется как всегда
    if (isPasteTab()) { e.preventDefault(); return setPaste(S.paste.target, file); }
    // в карточке заказа и в форме Ctrl+V прикрепляет чек к новой оплате
    paintPz();
    if ($app.querySelector(`[data-pz=${S.pz}]`)) { e.preventDefault(); putPz(S.pz, file); }
    else toast('Здесь некуда вставить картинку — откройте раздел «📎 Чеки»');
  });
  $app.addEventListener('dragover', (e) => {
    const z = e.target.closest(isPasteTab() ? '[data-zone]' : '[data-pz]');
    if (z) { e.preventDefault(); z.classList.add('over'); }
  });
  $app.addEventListener('dragleave', (e) => { const z = e.target.closest('[data-zone], [data-pz]'); if (z) z.classList.remove('over'); });
  $app.addEventListener('drop', (e) => {
    const z = e.target.closest(isPasteTab() ? '[data-zone]' : '[data-pz]');
    if (!z) return;
    e.preventDefault(); z.classList.remove('over');
    const file = imageFile(e.dataTransfer);
    if (!file) return toast('Перетащите картинку');
    if (z.dataset.zone) { S.paste.target = z.dataset.zone; setPaste(z.dataset.zone, file); }
    else { S.pz = z.dataset.pz; paintPz(); putPz(z.dataset.pz, file); }
  });

  function demoBar() {
    if (!window.IS_DEMO) return '';
    const cur = new URLSearchParams(location.search).get('demo') || 'owner';
    return `<div class="demo-bar">Демо-режим, данные не сохраняются. Смотреть как:
      <select data-demo>${['owner', 'MY', 'SH', 'D', 'V'].map((r) => `<option ${r === cur ? 'selected' : ''} value="${r}">${r === 'owner' ? 'руководитель' : 'менеджер ' + r}</option>`).join('')}</select></div>`;
  }

  // ---------- старт ----------
  async function start() {
    if (tg) { tg.ready(); tg.expand(); if (tg.initData) document.documentElement.classList.add('tg'); }
    if (!window.IS_DEMO && !(tg && tg.initData)) {
      $app.innerHTML = '<div class="center"><h1>Откройте через Telegram</h1><p class="hint">Это приложение работает внутри бота. Для просмотра без Telegram добавьте к адресу <b>?demo</b>.</p></div>';
      return;
    }
    try {
      const me = await window.api('me');
      S.user = me.user; setMe(me); $tabs.hidden = false;
      $tabs.querySelector('[data-tab=clients]').hidden = !isOwner(); // клиентская база — только руководителю
      if (new URLSearchParams(location.search).get('tab') === 'more') S.tab = 'more'; // кнопка из уведомления о заявке
      render();
    } catch (e) {
      if (e.error === 'not_registered' || e.message === 'not_registered') {
        // rejected — заявку отклонили; approved — доступ был, но сотрудника отключили
        $app.innerHTML = e.request && e.request !== 'pending'
          ? `<div class="center"><h1>Нет доступа</h1><p class="hint">Доступ закрыт руководителем. Если это ошибка, напишите ему.</p></div>`
          : `<div class="center"><h1>Заявка отправлена</h1><p>Руководитель получил уведомление и откроет вам доступ.</p>
          <p class="hint">Ваш Telegram ID: <b>${esc(e.telegram_id)}</b></p>
          <p class="hint">Когда доступ откроют, бот пришлёт сообщение. Тогда закройте и снова откройте приложение.</p></div>`;
      } else {
        $app.innerHTML = `<div class="center"><h1>Не удалось подключиться</h1><p class="hint">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Повторить</button></div>`;
      }
    }
  }
  start();
})();
