// api(action, params) → данные. В Telegram ходит в функцию Supabase,
// с ?demo в адресе работает в памяти на данных из demo-data.js.
(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  const qs = new URLSearchParams(location.search);
  const DEMO = qs.has('demo');

  async function remote(action, params = {}) {
    const cfg = window.APP_CONFIG;
    const res = await fetch(cfg.FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-init-data': (tg && tg.initData) || '',
        apikey: cfg.ANON_KEY,
        Authorization: 'Bearer ' + cfg.ANON_KEY,
      },
      body: JSON.stringify({ action, ...params }),
    });
    let body;
    try { body = await res.json(); } catch { body = { ok: false, error: 'Сервер недоступен (' + res.status + ')' }; }
    if (!body.ok) throw Object.assign(new Error(body.error || 'Ошибка'), body);
    return body.data;
  }

  // ---------- демо ----------
  const STAGES = ['Потребность выявлена', 'Дизайн готов', 'Производство', 'Оплачено', 'Доставка', 'Почта', 'Сделка закрыта', 'Отменён'];
  const demoDicts = {
    staff: ['MY', 'SH', 'D', 'V', 'OY', 'YO'].map((c, i) => ({ code: c, name: c, telegram_id: i < 4 ? 1000 + i : null, role: 'manager', active: true })),
    designers: ['1A', 'IK', 'F', 'N', 'Zu', 'Lu', 'AS', 'AD', 'AO', 'AB', 'R'].map((code) => ({ code, active: true })),
    sources: ['Instagram', 'Telegram 1', 'Telegram 2', 'Повторный клиент', 'Рекомендация', 'Сайт', 'Звонок', 'Другое'].map((name) => ({ name, active: true })),
    products: ['Печать автомат', 'Печать пластик', 'Печать металл', 'Штамп', 'Датер / нумератор', 'Табличка', 'Бейдж', 'Наклейка',
      'Сертификат', 'Визитка', 'Баннер', 'Логотип / дизайн', 'Подушка / краска', 'Пакеты', 'Другое'].map((name) => ({ name, active: true })),
    stages: STAGES,
  };

  function demoApi() {
    const role = qs.get('demo') || 'owner';
    const src = window.DEMO_DATA || { orders: [], items: [], payments: [] };
    const db = JSON.parse(JSON.stringify(src));
    // демо-данные «переезжают» на сегодня, чтобы дашборд за месяц не был пустым
    const today = new Date(); const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    db.orders.forEach((o) => (o.order_date = iso(today))); db.payments.forEach((p) => (p.paid_at = iso(today)));
    // этапы в демо разбросаны по заказам, чтобы было видно все пять
    db.orders.forEach((o, i) => { if (!STAGES.includes(o.stage)) o.stage = STAGES[i % (STAGES.length - 1)]; });
    db.requests = [{ telegram_id: 777000111, name: 'Новый менеджер', username: 'new_manager', created_at: iso(today) }];
    let seq = { o: Math.max(0, ...db.orders.map((o) => o.id)), p: 1 };
    db.payments.forEach((p) => (p.id = seq.p++));
    const user = role === 'owner'
      ? { telegram_id: 1, name: 'Руководитель (демо)', role: 'owner', code: null }
      : { telegram_id: 2, name: role + ' (демо)', role: 'manager', code: role };

    const view = (o) => {
      const items = db.items.filter((i) => i.order_id === o.id);
      const pays = db.payments.filter((p) => p.order_id === o.id);
      const sum = (arr, m) => arr.filter((p) => !m || p.method === m).reduce((s, p) => s + p.amount, 0);
      const total = sum(items), paid = sum(pays), rest = total - paid;
      const pay_status = o.stage === 'Отменён' ? 'Отменён' : paid === 0 && total > 0 ? 'Не оплачено' : rest > 0 ? 'Частично' : 'Оплачено';
      return { ...o, total, paid, rest, pay_status, items: items.map(({ product, qty, amount }) => ({ product, qty, amount })),
        paid_click: sum(pays, 'click'), paid_card: sum(pays, 'card'), paid_cash: sum(pays, 'cash'), paid_transfer: sum(pays, 'transfer') };
    };
    const find = (id) => {
      const o = db.orders.find((x) => x.id === Number(id));
      if (!o) throw new Error('Заказ не найден');
      if (user.role !== 'owner' && o.manager_code !== user.code) throw new Error('Это заказ другого менеджера');
      return o;
    };
    const A = {
      me: () => ({ user, dicts: demoDicts, requests: user.role === 'owner' ? db.requests : [] }),
      access_decide: (p) => {
        const r = db.requests.find((x) => x.telegram_id === Number(p.telegram_id));
        if (p.approve) {
          const s = demoDicts.staff.find((x) => x.code === p.code);
          if (s) s.telegram_id = r.telegram_id;
          else demoDicts.staff.push({ code: p.code, name: r.name, telegram_id: r.telegram_id, role: 'manager', active: true });
        }
        db.requests = db.requests.filter((x) => x !== r);
        return A.me();
      },
      orders: (p) => db.orders.map(view)
        .filter((o) => user.role === 'owner' || o.manager_code === user.code)
        .filter((o) => (!p.from || o.order_date >= p.from) && (!p.to || o.order_date <= p.to))
        .filter((o) => !p.debt || (o.rest > 0 && o.stage !== 'Отменён'))
        .sort((a, b) => (b.order_date + String(b.id).padStart(9, '0')).localeCompare(a.order_date + String(a.id).padStart(9, '0'))),
      order: (p) => ({ ...view(find(p.id)), payments: db.payments.filter((x) => x.order_id === Number(p.id)) }),
      order_save: (p) => {
        const items = (p.items || []).filter((i) => i.product);
        if (!items.length) throw new Error('Добавьте хотя бы один продукт');
        const row = { ...p.order, manager_code: user.role === 'owner' ? p.order.manager_code : user.code };
        let id = Number(p.order.id);
        if (id) { Object.assign(find(id), row); db.items = db.items.filter((i) => i.order_id !== id); }
        else { id = ++seq.o; db.orders.push({ ...row, id, stage: row.stage || STAGES[0] }); }
        items.forEach((i) => db.items.push({ order_id: id, product: i.product, qty: Number(i.qty) || 1, amount: Number(i.amount) || 0 }));
        if (p.payment && Number(p.payment.amount) > 0) A.payment_add({ order_id: id, ...p.payment });
        return A.order({ id });
      },
      order_stage: (p) => { find(p.id).stage = p.stage; return A.order(p); },
      order_delete: (p) => { if (user.role !== 'owner') throw new Error('Доступно только руководителю'); db.orders = db.orders.filter((o) => o.id !== Number(p.id)); return { ok: true }; },
      payment_add: (p) => {
        find(p.order_id);
        if (!(Number(p.amount) > 0)) throw new Error('Сумма оплаты должна быть больше нуля');
        db.payments.push({ id: seq.p++, order_id: Number(p.order_id), method: p.method, amount: Number(p.amount), paid_at: p.paid_at || iso(new Date()),
          receipt_url: p.receipt || null }); // в демо чек хранится прямо картинкой
        return A.order({ id: p.order_id });
      },
      payment_receipt: (p) => {
        const pay = db.payments.find((x) => x.id === Number(p.id));
        pay.receipt_url = p.receipt;
        return A.order({ id: pay.order_id });
      },
      payment_delete: (p) => {
        const pay = db.payments.find((x) => x.id === Number(p.id));
        db.payments = db.payments.filter((x) => x !== pay);
        return A.order({ id: pay.order_id });
      },
      staff_save: (p) => {
        const s = demoDicts.staff.find((x) => x.code === p.code.toUpperCase());
        const row = { code: p.code.toUpperCase(), name: p.name || p.code, telegram_id: p.telegram_id ? Number(p.telegram_id) : null, role: p.role || 'manager', active: p.active !== false };
        s ? Object.assign(s, row) : demoDicts.staff.push(row);
        return A.me();
      },
      sheets_sync: (p) => ({ count: db.orders.filter((o) => o.order_date === p.date).length }),
      dict_add: (p) => {
        const list = demoDicts[p.kind];
        const key = p.kind === 'designers' ? 'code' : 'name';
        if (!list.some((x) => x[key] === p.name)) list.push({ [key]: p.name, active: true });
        return A.me();
      },
    };
    return async (action, params = {}) => {
      await new Promise((r) => setTimeout(r, 120));
      if (!A[action]) throw new Error('Неизвестное действие');
      return JSON.parse(JSON.stringify(A[action](params)));
    };
  }

  window.api = DEMO ? demoApi() : remote;
  window.IS_DEMO = DEMO;
})();
