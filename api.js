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
    sources: ['Instagram', '1 Pechat', '2 Botir', 'Повторный клиент', 'Рекомендация', 'Сайт', 'Звонок', 'Другое'].map((name) => ({ name, active: true })),
    products: ['Печать автомат', 'Печать пластик', 'Печать металл', 'Штамп', 'Датер / нумератор', 'Табличка', 'Бейдж', 'Наклейка',
      'Сертификат', 'Визитка', 'Баннер', 'Логотип / дизайн', 'Подушка / краска', 'Пакеты', 'Другое'].map((name) => ({ name, active: true, ink: /^(Печать|Штамп|Датер)/.test(name), body: name === 'Печать автомат' })),
    stages: STAGES,
    body_colors: ['Qora', 'Pushti', 'Qizil', "Ko'k", 'Sariq', 'Jigarrang', 'Yashil'],
    expense_categories: ['Материалы', 'Реклама', 'Зарплата', 'Аренда', 'Доставка', 'Коммунальные', 'Налоги',
      'Фото бумага', 'Расходы по баннеру', 'Изготовление таблички', 'Расходы по штампам', 'Интернет', 'Обед для работы',
      'Бензин для бизнеса', 'АБС', 'Инвестиция', 'Прочее'].map((name) => ({ name, active: true })),
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
    db.expenses = [{ id: 1, spent_at: iso(today), amount: 450000, category: 'Материалы', method: 'cash', comment: 'бумага' },
      { id: 2, spent_at: iso(today), amount: 300000, category: 'Реклама', method: 'card', comment: 'Instagram' }];
    db.designs = [];
    // склад: остаток на начало месяца по двум товарам, чтобы было видно и норму, и «мало осталось»
    const month1 = iso(today).slice(0, 8) + '01';
    db.counts = [{ product: 'Печать автомат', month: month1, qty: 60 }, { product: 'Штамп', month: month1, qty: 12 }];
    db.moves = [{ id: 1, product: 'Штамп', kind: 'in', qty: 5, moved_at: iso(today), comment: 'поставка' }];
    demoDicts.products.find((x) => x.name === 'Печать автомат').min_qty = 50;
    demoDicts.products.find((x) => x.name === 'Штамп').min_qty = 10;
    let seq = { o: Math.max(0, ...db.orders.map((o) => o.id)), p: 1, e: 3, d: 1, m: 2 };
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
      return { ...o, total, paid, rest, pay_status, items: items.map(({ product, qty, amount, ink, body }) => ({ product, qty, amount, ink, body })),
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
      order: (p) => ({ ...view(find(p.id)), payments: db.payments.filter((x) => x.order_id === Number(p.id)),
        designs: db.designs.filter((x) => x.order_id === Number(p.id)) }),
      design_add: (p) => { find(p.order_id); db.designs.push({ id: seq.d++, order_id: Number(p.order_id), url: p.image }); return A.order({ id: p.order_id }); },
      design_delete: (p) => {
        const d = db.designs.find((x) => x.id === Number(p.id));
        db.designs = db.designs.filter((x) => x !== d);
        return A.order({ id: d.order_id });
      },
      order_save: (p) => {
        const items = (p.items || []).filter((i) => i.product);
        if (!items.length) throw new Error('Добавьте хотя бы один продукт');
        const row = { ...p.order, manager_code: user.role === 'owner' ? p.order.manager_code : user.code };
        let id = Number(p.order.id);
        if (id) { Object.assign(find(id), row); db.items = db.items.filter((i) => i.order_id !== id); }
        else { id = ++seq.o; db.orders.push({ ...row, id, stage: row.stage || STAGES[0] }); }
        items.forEach((i) => {
          const body = demoDicts.products.some((p) => p.name === i.product && p.body) ? i.body || 'Qora' : null;
          if (body && !demoDicts.body_colors.includes(body)) demoDicts.body_colors.push(body); // как сервер: новый цвет запоминаем
          db.items.push({ order_id: id, product: i.product, qty: Number(i.qty) || 1, amount: Number(i.amount) || 0, ink: i.ink || null, body });
        });
        if (p.payment && Number(p.payment.amount) > 0) A.payment_add({ order_id: id, ...p.payment });
        return A.order({ id });
      },
      order_merge: (p) => {
        const into = find(p.id), from = find(p.from);
        db.items.forEach((i) => { if (i.order_id === from.id) i.order_id = into.id; });
        db.payments.forEach((x) => { if (x.order_id === from.id) x.order_id = into.id; });
        db.designs.forEach((x) => { if (x.order_id === from.id) x.order_id = into.id; });
        into.designer2_code = into.designer2_code || [from.designer_code, from.designer2_code].find((d) => d && d !== (into.designer_code || from.designer_code)) || null;
        ['client', 'company', 'phone', 'instagram', 'source', 'designer_code', 'delivery_type', 'delivery_region', 'delivery'].forEach((f) => { into[f] = into[f] || from[f]; });
        db.orders = db.orders.filter((o) => o !== from);
        return A.order({ id: into.id });
      },
      order_stage: (p) => { find(p.id).stage = p.stage; return A.order(p); },
      order_delete: (p) => { if (user.role !== 'owner') throw new Error('Доступно только руководителю'); db.orders = db.orders.filter((o) => o.id !== Number(p.id)); return { ok: true }; },
      payment_add: (p) => {
        find(p.order_id);
        if (!(Number(p.amount) > 0)) throw new Error('Сумма оплаты должна быть больше нуля');
        db.payments.push({ id: seq.p++, order_id: Number(p.order_id), method: p.method, amount: Number(p.amount), paid_at: p.paid_at || iso(new Date()), paid_time: p.paid_time || null,
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
      finance: (p) => {
        const inRange = (d) => (!p.from || d >= p.from) && (!p.to || d <= p.to);
        return { payments: db.payments.filter((x) => inRange(x.paid_at)),
          expenses: db.expenses.filter((x) => inRange(x.spent_at)).sort((a, b) => b.spent_at.localeCompare(a.spent_at) || b.id - a.id) };
      },
      expense_save: (p) => {
        if (!(Number(p.amount) > 0)) throw new Error('Сумма расхода должна быть больше нуля');
        const row = { spent_at: p.spent_at || iso(new Date()), amount: Number(p.amount), category: p.category, method: p.method || 'cash', comment: p.comment || null };
        const cur = db.expenses.find((x) => x.id === Number(p.id));
        cur ? Object.assign(cur, row) : db.expenses.push({ id: seq.e++, ...row });
        return { ok: true };
      },
      expense_delete: (p) => { db.expenses = db.expenses.filter((x) => x.id !== Number(p.id)); return { ok: true }; },
      stock: () => demoDicts.products.filter((x) => x.active !== false).map((x, i) => {
        const c = db.counts.filter((r) => r.product === x.name).sort((a, b) => b.month.localeCompare(a.month))[0];
        const mv = db.moves.filter((m) => m.product === x.name);
        const base = c ? c.month : mv.map((m) => m.moved_at).sort()[0] || null;
        const after = (d) => base && d >= base;
        const sumMv = (k) => mv.filter((m) => m.kind === k && after(m.moved_at)).reduce((s, m) => s + m.qty, 0);
        const sold = db.items.filter((it) => it.product === x.name && after((db.orders.find((o) => o.id === it.order_id && o.stage !== 'Отменён') || {}).order_date || ''))
          .reduce((s, it) => s + Number(it.qty), 0);
        const opening = c ? c.qty : 0, incoming = sumMv('in'), outgoing = sumMv('out');
        return { product: x.name, base_date: base, opening, incoming, outgoing, sold, sort: i,
          stock: base ? opening + incoming - outgoing - sold : null, min_qty: x.min_qty ?? null, low_alerted: false };
      }),
      stock_item: (p) => ({ ...A.stock().find((r) => r.product === p.product),
        counts: db.counts.filter((r) => r.product === p.product).sort((a, b) => b.month.localeCompare(a.month)),
        moves: db.moves.filter((m) => m.product === p.product).sort((a, b) => b.id - a.id) }),
      stock_in: (p) => {
        (p.items || []).filter((i) => i.product && Number(i.qty) > 0).forEach((i) => db.moves.push({ id: seq.m++, product: i.product,
          kind: p.kind === 'out' ? 'out' : 'in', qty: Number(i.qty), moved_at: p.moved_at || iso(new Date()), comment: p.comment || null }));
        return { ok: true };
      },
      stock_move_delete: (p) => { db.moves = db.moves.filter((m) => m.id !== Number(p.id)); return { ok: true }; },
      stock_count: (p) => {
        const month = p.month + '-01';
        (p.rows || []).forEach((r) => {
          if (r.qty !== '' && r.qty != null) {
            db.counts = db.counts.filter((c) => !(c.product === r.product && c.month === month));
            db.counts.push({ product: r.product, month, qty: Number(r.qty) });
          }
          if (r.min_qty !== undefined) demoDicts.products.find((x) => x.name === r.product).min_qty = r.min_qty === '' ? null : Number(r.min_qty);
        });
        return { ok: true };
      },
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
