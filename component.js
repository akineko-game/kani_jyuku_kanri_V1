/**
 * SDS拡張コンポーネント — component.js  v3.1
 *
 * ■ 確定仕様（v3.1）
 *   - 通知手段       : 画面内トーストのみ（外部送信なし）
 *   - 月謝調整       : 講師 × 教室の単価マトリクスで合計計算
 *   - 座席制御       : モック・UIのみ（APIなし）
 *   - 設定反映範囲   : 対象コンポーネントをチェックで選択（UIのみ）
 *   - 連絡先管理     : 保護者名・電話・メール の CRUD（UIのみ）
 *   - 連絡履歴       : インメモリ履歴リスト
 *   - 割当必須チェック: 未選択時エラー表示
 *
 * ■ 画面間連携（v2より継続）
 *   [1] 講師管理 → 講師割当   : 稼働中の講師のみ候補表示
 *   [2] 教室管理 → 教室割当   : 使用可能な教室のみ候補表示
 *   [3] 講師割当＋教室割当 → 通知 : 両方割当済で自動作成
 *   [4] 座席制御 → 通知       : 満席で自動通知作成
 */
(function (global) {
  'use strict';

  /* ── EventBus ── */
  const EventBus = (function () {
    const _h = {};
    return {
      emit(ev, payload) { (_h[ev] || []).forEach(fn => fn(payload)); },
      on(ev, handler)   { if (!_h[ev]) _h[ev] = []; _h[ev].push(handler); },
    };
  })();

  /* ── 共有ストア ── */
  const Store = {
    activeTeachers:  [],   // { id, name }
    availableRooms:  [],   // { id, name }
    teacherAssigned: false,
    roomAssigned:    false,
    contacts:        [],   // { id, name, tel, mail }
    history:         [],   // { at, reason }
    // 月謝マトリクス: prices[teacherName][roomName] = 単価
    prices:          {},
  };

  /* ── ステートマシン ── */
  function createMachine(name, initial, transitions) {
    let state = initial;
    return {
      get state() { return state; },
      transition(event) {
        const map = transitions[state];
        if (!map || !map[event]) { log(`[${name}] 無効遷移: ${state} —✕→ ${event}`); return false; }
        const next = map[event];
        log(`[${name}] ${state} —${event}→ ${next}`);
        state = next;
        EventBus.emit(`${name}:${event}`, { state, name });
        return true;
      },
    };
  }

  /* ── ログ ── */
  let _logEl = null;
  function log(msg, type) {
    const now = new Date().toLocaleTimeString('ja-JP');
    if (!_logEl) return;
    const div = document.createElement('div');
    div.className = 'sds-log-entry';
    const color = type === 'link' ? 'color:var(--sds-warning);font-weight:700;' : '';
    div.innerHTML = `<span class="ts">${now}</span><span class="ev" style="${color}">${escHtml(msg)}</span>`;
    _logEl.prepend(div);
  }

  /* ── トースト（画面内のみ・外部送信なし）── */
  let _toastEl = null;
  function toast(msg, type) {
    if (!_toastEl) return;
    _toastEl.textContent = msg;
    _toastEl.className = `sds-toast sds-toast-${type || 'info'} sds-toast-show`;
    clearTimeout(_toastEl._timer);
    _toastEl._timer = setTimeout(() => _toastEl.classList.remove('sds-toast-show'), 3500);
  }

  /* ── DOM ヘルパ ── */
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v);
    });
    children.forEach(c => {
      if (c == null) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  const badge    = (label, type) => h('span', { class: `sds-badge sds-badge-${type}` }, label);
  const linkNote = label => h('span', { class: 'sds-linked' }, `🔗 連携: ${label}`);
  const errMsg   = msg   => h('p',    { class: 'sds-errmsg' }, msg);
  const btn      = (label, cls, onClick) => h('button', { class: `sds-btn ${cls}`, onClick }, label);
  const inp      = (ph, id, type) => {
    const el = h('input', { class: 'sds-input', placeholder: ph, id: id || '' });
    if (type) el.type = type;
    return el;
  };
  function selEl(options, id) {
    const sel = h('select', { class: 'sds-select', id: id || '' });
    if (!options.length) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = '（候補なし）'; o.disabled = true; o.selected = true;
      sel.appendChild(o);
    } else {
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value; o.textContent = opt.label; sel.appendChild(o);
      });
    }
    return sel;
  }
  function card(title, ...contents) {
    return h('div', { class: 'sds-card' }, h('div', { class: 'sds-card-title' }, title), ...contents);
  }
  function infoRow(key, val) {
    return h('div', { class: 'sds-info-row' },
      h('span', { class: 'sds-info-key' }, key), h('span', {}, val));
  }

  /* ════════════════════════════════════
   *  サブコンポーネント
   * ════════════════════════════════════ */

  /* ── 講師管理 ── */
  function buildTeacherMgmt(root) {
    const machine = createMachine('teacher', '未登録', {
      '未登録': { '講師登録': '登録済' },
      '登録済': { '講師情報更新': '登録済', '稼働開始': '稼働中' },
      '稼働中': { '休止処理': '休止中', '退職処理': '退職済' },
      '休止中': { '稼働開始': '稼働中' },
    });
    let teacherName = '';
    const teacherId = 'T' + Date.now();

    function publish() {
      Store.activeTeachers = Store.activeTeachers.filter(t => t.id !== teacherId);
      if (machine.state === '稼働中') Store.activeTeachers.push({ id: teacherId, name: teacherName });
      EventBus.emit('store:teachers-updated', {});
      log(`🔗 連携[1] 稼働講師リスト更新 (${Store.activeTeachers.length}名)`, 'link');
    }

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`,
        s==='稼働中'?'ok': s==='未登録'?'idle': s==='休止中'?'warn':'danger'));
      root.appendChild(linkNote('稼働状態 → 講師割当の候補リスト'));

      if (s === '未登録') {
        const i = inp('講師名を入力');
        root.appendChild(i);
        root.appendChild(btn('登録', 'sds-btn-primary', () => {
          teacherName = i.value.trim() || '（未入力）';
          machine.transition('講師登録'); render();
        }));
      }
      if (s === '登録済') {
        root.appendChild(infoRow('講師名', teacherName));
        const i = inp('名前を変更');
        root.appendChild(i);
        root.appendChild(btn('更新', 'sds-btn-ghost', () => {
          if (i.value.trim()) teacherName = i.value.trim();
          machine.transition('講師情報更新'); render();
        }));
        root.appendChild(btn('稼働開始', 'sds-btn-success', () => {
          machine.transition('稼働開始'); publish(); render();
        }));
      }
      if (s === '稼働中') {
        root.appendChild(infoRow('講師名', teacherName));
        root.appendChild(btn('休止', 'sds-btn-warning', () => {
          machine.transition('休止処理'); publish(); render();
        }));
        root.appendChild(btn('退職', 'sds-btn-danger', () => {
          machine.transition('退職処理'); publish(); render();
        }));
      }
      if (s === '休止中') {
        root.appendChild(infoRow('講師名', teacherName));
        root.appendChild(btn('稼働再開', 'sds-btn-success', () => {
          machine.transition('稼働開始'); publish(); render();
        }));
      }
      if (s === '退職済') root.appendChild(badge('退職済 — 操作不可', 'danger'));
    }
    render();
  }

  /* ── 講師割当（必須チェック付き）── */
  function buildTeacherAssign(root) {
    const machine = createMachine('teacher-assign', '未割当', {
      '未割当': { '講師割当': '割当済' },
      '割当済': { '講師割当解除': '未割当' },
    });
    let assigned = '';
    let _r = null;
    EventBus.on('store:teachers-updated', () => { if (_r) _r(); });

    function checkBoth() {
      if (Store.teacherAssigned && Store.roomAssigned) {
        EventBus.emit('store:both-assigned', {});
        log('🔗 連携[3] 講師＋教室揃い → 通知自動作成', 'link');
      }
    }

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`, s==='割当済'?'ok':'idle'));
      root.appendChild(linkNote('稼働中の講師のみ表示'));

      if (s === '未割当') {
        root.appendChild(h('label', { class: 'sds-label' }, '稼働中の講師を選択'));
        const opts = Store.activeTeachers.map(t => ({ value: t.name, label: t.name }));
        const sel = selEl(opts);
        root.appendChild(sel);
        if (!Store.activeTeachers.length)
          root.appendChild(h('p', { class: 'sds-hint' }, '※ 先に「講師管理」で稼働開始してください'));

        let errEl = null;
        const ab = btn('割当', 'sds-btn-primary', () => {
          if (errEl) { errEl.remove(); errEl = null; }
          if (!sel.value) { errEl = errMsg('⚠ 講師を選択してください'); root.appendChild(errEl); return; }
          assigned = sel.value;
          machine.transition('講師割当');
          Store.teacherAssigned = true;
          checkBoth(); render();
        });
        if (!Store.activeTeachers.length) ab.disabled = true;
        root.appendChild(ab);
      }
      if (s === '割当済') {
        root.appendChild(infoRow('担当講師', assigned));
        root.appendChild(btn('解除', 'sds-btn-danger', () => {
          assigned = ''; machine.transition('講師割当解除');
          Store.teacherAssigned = false; render();
        }));
      }
    }
    _r = render; render();
  }

  /* ── 教室管理 ── */
  function buildRoomMgmt(root) {
    const machine = createMachine('room', '未登録', {
      '未登録':   { '教室登録': '使用可能' },
      '使用可能': { '教室使用開始': '使用中', '使用停止': '停止中' },
      '使用中':   { '使用停止': '停止中' },
      '停止中':   { '教室使用開始': '使用可能' },
    });
    let roomName = '';
    const roomId = 'R' + Date.now();

    function publish() {
      Store.availableRooms = Store.availableRooms.filter(r => r.id !== roomId);
      if (machine.state === '使用可能' || machine.state === '使用中')
        Store.availableRooms.push({ id: roomId, name: roomName });
      EventBus.emit('store:rooms-updated', {});
      log(`🔗 連携[2] 使用可能教室更新 (${Store.availableRooms.length}室)`, 'link');
    }

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`,
        s==='使用中'?'ok': s==='使用可能'?'info': s==='未登録'?'idle':'warn'));
      root.appendChild(linkNote('使用可能状態 → 教室割当の候補リスト'));

      if (s === '未登録') {
        const i = inp('教室名を入力');
        root.appendChild(i);
        root.appendChild(btn('登録', 'sds-btn-primary', () => {
          roomName = i.value.trim() || '（未入力）';
          machine.transition('教室登録'); publish(); render();
        }));
      }
      if (s === '使用可能' || s === '停止中') {
        root.appendChild(infoRow('教室名', roomName));
        root.appendChild(btn('使用開始', 'sds-btn-success', () => {
          machine.transition('教室使用開始'); publish(); render();
        }));
        root.appendChild(btn('停止', 'sds-btn-warning', () => {
          machine.transition('使用停止'); publish(); render();
        }));
      }
      if (s === '使用中') {
        root.appendChild(infoRow('教室名', roomName));
        root.appendChild(btn('使用停止', 'sds-btn-warning', () => {
          machine.transition('使用停止'); publish(); render();
        }));
      }
    }
    render();
  }

  /* ── 教室割当（必須チェック付き）── */
  function buildRoomAssign(root) {
    const machine = createMachine('room-assign', '未割当', {
      '未割当': { '教室割当': '割当済' },
      '割当済': { '教室割当解除': '未割当' },
    });
    let assigned = '';
    let _r = null;
    EventBus.on('store:rooms-updated', () => { if (_r) _r(); });

    function checkBoth() {
      if (Store.teacherAssigned && Store.roomAssigned) {
        EventBus.emit('store:both-assigned', {});
        log('🔗 連携[3] 講師＋教室揃い → 通知自動作成', 'link');
      }
    }

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`, s==='割当済'?'ok':'idle'));
      root.appendChild(linkNote('使用可能な教室のみ表示'));

      if (s === '未割当') {
        root.appendChild(h('label', { class: 'sds-label' }, '使用可能な教室を選択'));
        const opts = Store.availableRooms.map(r => ({ value: r.name, label: r.name }));
        const sel = selEl(opts);
        root.appendChild(sel);
        if (!Store.availableRooms.length)
          root.appendChild(h('p', { class: 'sds-hint' }, '※ 先に「教室管理」で登録してください'));

        let errEl = null;
        const ab = btn('割当', 'sds-btn-primary', () => {
          if (errEl) { errEl.remove(); errEl = null; }
          if (!sel.value) { errEl = errMsg('⚠ 教室を選択してください'); root.appendChild(errEl); return; }
          assigned = sel.value;
          machine.transition('教室割当');
          Store.roomAssigned = true;
          checkBoth(); render();
        });
        if (!Store.availableRooms.length) ab.disabled = true;
        root.appendChild(ab);
      }
      if (s === '割当済') {
        root.appendChild(infoRow('割当教室', assigned));
        root.appendChild(btn('解除', 'sds-btn-danger', () => {
          assigned = ''; machine.transition('教室割当解除');
          Store.roomAssigned = false; render();
        }));
      }
    }
    _r = render; render();
  }

  /* ── 通知管理（画面内トーストのみ・外部送信なし）── */
  function buildNotification(root) {
    const machine = createMachine('notification', '未通知', {
      '未通知':   { '通知予定作成': '通知予定' },
      '通知予定': { '通知送信': '送信済', '通知キャンセル': '未通知' },
      '送信済':   { '通知予定作成': '通知予定' },
    });
    let autoReason = '';
    let _r = null;

    EventBus.on('store:both-assigned', () => {
      if (machine.state !== '通知予定') {
        autoReason = '講師・教室が揃いました';
        machine.transition('通知予定作成'); if (_r) _r();
      }
    });
    EventBus.on('store:seat-full', () => {
      if (machine.state !== '通知予定') {
        autoReason = '座席が満席になりました';
        machine.transition('通知予定作成'); if (_r) _r();
      }
    });

    function doSend(reason) {
      const rec = { at: new Date().toLocaleString('ja-JP'), reason };
      Store.history.unshift(rec);
      EventBus.emit('store:history-updated', {});
      toast(`🔔 通知完了: ${reason}`, 'success');
      log(`🔔 通知送信: ${reason}`);
    }

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`, s==='送信済'?'ok': s==='通知予定'?'info':'idle'));
      root.appendChild(linkNote('講師＋教室割当完了 / 満席 で自動作成'));

      // 通知手段の説明（確定仕様）
      root.appendChild(h('div', { class: 'sds-spec-note' }, '📢 通知手段: 画面内トースト（外部送信なし）'));

      if (s === '通知予定' && autoReason) {
        root.appendChild(h('div', { class: 'sds-auto-reason' }, `⚡ ${autoReason}（自動作成）`));
      }

      if (s === '未通知' || s === '送信済') {
        const reasonInp = inp('通知内容を入力（任意）');
        root.appendChild(reasonInp);
        root.appendChild(btn('通知予定を手動作成', 'sds-btn-primary', () => {
          autoReason = reasonInp.value.trim() || '手動通知';
          machine.transition('通知予定作成'); render();
        }));
      }
      if (s === '通知予定') {
        root.appendChild(infoRow('内容', autoReason || '（未設定）'));
        root.appendChild(btn('送信（トースト表示）', 'sds-btn-success', () => {
          const reason = autoReason || '通知';
          autoReason = '';
          machine.transition('通知送信');
          doSend(reason);
          render();
        }));
        root.appendChild(btn('キャンセル', 'sds-btn-ghost', () => {
          autoReason = ''; machine.transition('通知キャンセル'); render();
        }));
      }
    }
    _r = render; render();
  }

  /* ── 連絡先管理（UIのみ・CRUD）── */
  function buildContact(root) {
    function render() {
      root.innerHTML = '';
      root.appendChild(badge(`登録件数: ${Store.contacts.length}`, 'info'));

      root.appendChild(h('label', { class: 'sds-label' }, '保護者名'));
      const nameI = inp('例: 山田 花子');
      root.appendChild(nameI);
      root.appendChild(h('label', { class: 'sds-label' }, '電話番号'));
      const telI = inp('例: 090-0000-0000', '', 'tel');
      root.appendChild(telI);
      root.appendChild(h('label', { class: 'sds-label' }, 'メールアドレス'));
      const mailI = inp('例: hanako@example.com', '', 'email');
      root.appendChild(mailI);

      let errEl = null;
      root.appendChild(btn('追加', 'sds-btn-primary', () => {
        if (errEl) { errEl.remove(); errEl = null; }
        if (!nameI.value.trim()) {
          errEl = errMsg('⚠ 保護者名は必須です'); root.appendChild(errEl); return;
        }
        Store.contacts.push({ id: Date.now(), name: nameI.value.trim(), tel: telI.value.trim(), mail: mailI.value.trim() });
        log(`連絡先追加: ${nameI.value.trim()}`); render();
      }));

      if (Store.contacts.length) {
        root.appendChild(h('div', { class: 'sds-card-title', style: 'margin-top:14px;' }, '登録済み連絡先'));
        Store.contacts.forEach(c => {
          root.appendChild(h('div', { class: 'sds-contact-row' },
            h('div', { class: 'sds-contact-info' },
              h('strong', {}, c.name),
              c.tel  ? h('span', { class: 'sds-contact-sub' }, `📞 ${c.tel}`)  : null,
              c.mail ? h('span', { class: 'sds-contact-sub' }, `✉ ${c.mail}`) : null
            ),
            btn('削除', 'sds-btn-danger', () => {
              Store.contacts = Store.contacts.filter(x => x.id !== c.id);
              log(`連絡先削除: ${c.name}`); render();
            })
          ));
        });
      }
    }
    render();
  }

  /* ── 連絡履歴（インメモリ）── */
  function buildContactHistory(root) {
    let _r = null;
    EventBus.on('store:history-updated', () => { if (_r) _r(); });

    function render() {
      root.innerHTML = '';
      root.appendChild(badge(`履歴件数: ${Store.history.length}`, 'info'));

      if (!Store.history.length) {
        root.appendChild(h('p', { style: 'color:var(--sds-muted);font-size:12px;margin-top:8px;' },
          '通知を送信すると履歴が表示されます。'));
        return;
      }

      Store.history.forEach(rec => {
        root.appendChild(h('div', { class: 'sds-history-row' },
          h('span', { class: 'sds-history-at' }, rec.at),
          h('span', { class: 'sds-history-body' }, rec.reason)
        ));
      });

      root.appendChild(btn('履歴をクリア', 'sds-btn-ghost', () => {
        Store.history = []; log('連絡履歴をクリア'); render();
      }));
    }
    _r = render; render();
  }

  /* ── 月謝調整（講師 × 教室 単価マトリクス）── */
  /* ════════════════════════════════════════
   *  月謝調整
   *  計算式: 月謝 = 科目単価 + コース単価 + 学年単価  （3軸の単純加算）
   *
   *  画面は3タブ構成
   *    [A] 単価設定  : 科目・コース・学年 それぞれの単価リストを編集
   *    [B] 生徒登録  : 生徒ごとに科目・コース・学年を選択
   *    [C] 月謝一覧  : 全生徒の月謝計算結果と合計を表示
   * ════════════════════════════════════════ */
  function buildFeeAdjust(root) {

    /* ── マスターデータ ── */
    const FeeData = {
      // 科目単価リスト [{ label, price }]
      subjects: [
        { label: '数学', price: 5000 },
        { label: '英語', price: 5000 },
        { label: '理科', price: 4000 },
        { label: '国語', price: 4000 },
      ],
      // コース単価リスト [{ label, price }]
      courses: [
        { label: '週1回', price: 0    },
        { label: '週2回', price: 3000 },
        { label: '週3回', price: 6000 },
      ],
      // 学年単価リスト [{ label, price }]
      grades: [
        { label: '中1', price: 0    },
        { label: '中2', price: 0    },
        { label: '中3', price: 2000 },
        { label: '高1', price: 3000 },
        { label: '高2', price: 3000 },
        { label: '高3', price: 5000 },
      ],
      // 生徒リスト [{ id, name, subjectLabel, courseLabel, gradeLabel }]
      students: [],
    };

    let currentTab = 'price';

    /* ── 計算: 3軸の単純加算 ── */
    function calcFee(subjectLabel, courseLabel, gradeLabel) {
      const s = FeeData.subjects.find(x => x.label === subjectLabel);
      const c = FeeData.courses.find(x => x.label === courseLabel);
      const g = FeeData.grades.find(x => x.label === gradeLabel);
      return (s ? s.price : 0) + (c ? c.price : 0) + (g ? g.price : 0);
    }

    /* ── タブナビ ── */
    function renderTabs(wrap) {
      const tabs = [
        { key: 'price',   label: '① 単価設定' },
        { key: 'student', label: '② 生徒登録' },
        { key: 'list',    label: '③ 月謝一覧' },
      ];
      const nav = h('div', { class: 'sds-fee-tabs' });
      tabs.forEach(t => {
        nav.appendChild(h('button', {
          class: `sds-fee-tab-btn${currentTab === t.key ? ' active' : ''}`,
          onClick() { currentTab = t.key; render(); },
        }, t.label));
      });
      wrap.appendChild(nav);
    }

    /* ── [A] 単価設定タブ ── */
    function renderPriceTab(wrap) {
      wrap.appendChild(h('p', { class: 'sds-fee-desc' },
        '科目・コース・学年それぞれに単価を設定します。月謝 = 3つの合計です。'));

      // 単価グループを汎用関数で描画
      function renderPriceGroup(title, list) {
        wrap.appendChild(h('div', { class: 'sds-fee-group-title' }, title));
        list.forEach(item => {
          const row = h('div', { class: 'sds-fee-price-row' });
          row.appendChild(h('span', { class: 'sds-fee-price-label' }, item.label));
          const ni = h('input', { class: 'sds-matrix-input' });
          ni.type = 'number'; ni.min = '0'; ni.step = '500';
          ni.value = String(item.price);
          ni.addEventListener('input', () => {
            item.price = parseInt(ni.value) || 0;
            // 生徒一覧の金額プレビューに即時反映させるため再描画は行わない（入力中は保持）
          });
          const yen = h('span', { class: 'sds-fee-yen' }, '円 / 月');
          row.appendChild(ni); row.appendChild(yen);
          wrap.appendChild(row);
        });
      }

      renderPriceGroup('科目単価', FeeData.subjects);
      renderPriceGroup('コース単価（週1を基準に追加額）', FeeData.courses);
      renderPriceGroup('学年単価（中1を基準に追加額）', FeeData.grades);

      // 計算式の説明
      wrap.appendChild(h('div', { class: 'sds-fee-formula' },
        h('span', { class: 'sds-fee-formula-label' }, '計算式'),
        h('span', { class: 'sds-fee-formula-body' }, '月謝 = 科目単価 ＋ コース単価 ＋ 学年単価')
      ));

      // 例示
      const eg = calcFee('数学', '週2回', '中3');
      wrap.appendChild(h('div', { class: 'sds-fee-example' },
        `例）数学（週2回・中3）= ¥${FeeData.subjects.find(s=>s.label==='数学').price.toLocaleString()} ＋ ¥${FeeData.courses.find(c=>c.label==='週2回').price.toLocaleString()} ＋ ¥${FeeData.grades.find(g=>g.label==='中3').price.toLocaleString()} = ¥${eg.toLocaleString()}`
      ));
    }

    /* ── [B] 生徒登録タブ ── */
    function renderStudentTab(wrap) {
      wrap.appendChild(h('p', { class: 'sds-fee-desc' },
        '生徒ごとに受講する科目・コース・学年を選択して登録します。'));

      // 登録フォーム
      const form = h('div', { class: 'sds-fee-form' });

      form.appendChild(h('label', { class: 'sds-label' }, '生徒名'));
      const nameI = h('input', { class: 'sds-input', placeholder: '例: 山田 太郎' });
      form.appendChild(nameI);

      // 科目セレクト
      form.appendChild(h('label', { class: 'sds-label' }, '科目'));
      const subSel = h('select', { class: 'sds-select' });
      FeeData.subjects.forEach(s => {
        const o = document.createElement('option');
        o.value = s.label; o.textContent = `${s.label}（¥${s.price.toLocaleString()}）`;
        subSel.appendChild(o);
      });
      form.appendChild(subSel);

      // コースセレクト
      form.appendChild(h('label', { class: 'sds-label' }, 'コース'));
      const courseSel = h('select', { class: 'sds-select' });
      FeeData.courses.forEach(c => {
        const o = document.createElement('option');
        o.value = c.label;
        o.textContent = `${c.label}（+¥${c.price.toLocaleString()}）`;
        courseSel.appendChild(o);
      });
      form.appendChild(courseSel);

      // 学年セレクト
      form.appendChild(h('label', { class: 'sds-label' }, '学年'));
      const gradeSel = h('select', { class: 'sds-select' });
      FeeData.grades.forEach(g => {
        const o = document.createElement('option');
        o.value = g.label;
        o.textContent = `${g.label}（+¥${g.price.toLocaleString()}）`;
        gradeSel.appendChild(o);
      });
      form.appendChild(gradeSel);

      // リアルタイムプレビュー
      const preview = h('div', { class: 'sds-fee-preview' });
      function updatePreview() {
        const fee = calcFee(subSel.value, courseSel.value, gradeSel.value);
        preview.innerHTML = '';
        preview.appendChild(h('span', {}, '月謝予定額'));
        preview.appendChild(h('span', { class: 'sds-fee-preview-amt' }, `¥${fee.toLocaleString()}`));
      }
      [subSel, courseSel, gradeSel].forEach(el => el.addEventListener('change', updatePreview));
      updatePreview();
      form.appendChild(preview);

      let errEl = null;
      form.appendChild(btn('登録', 'sds-btn-primary', () => {
        if (errEl) { errEl.remove(); errEl = null; }
        if (!nameI.value.trim()) {
          errEl = errMsg('⚠ 生徒名は必須です'); form.appendChild(errEl); return;
        }
        FeeData.students.push({
          id:           'st-' + Date.now(),
          name:         nameI.value.trim(),
          subjectLabel: subSel.value,
          courseLabel:  courseSel.value,
          gradeLabel:   gradeSel.value,
        });
        log(`生徒登録: ${nameI.value.trim()} / ${subSel.value} ${courseSel.value} ${gradeSel.value} → ¥${calcFee(subSel.value, courseSel.value, gradeSel.value).toLocaleString()}`);
        render();
      }));
      wrap.appendChild(form);

      // 登録済み一覧（簡易）
      if (FeeData.students.length) {
        wrap.appendChild(h('div', { class: 'sds-fee-group-title', style: 'margin-top:14px;' },
          `登録済み（${FeeData.students.length}名）`));
        FeeData.students.forEach(st => {
          const fee = calcFee(st.subjectLabel, st.courseLabel, st.gradeLabel);
          wrap.appendChild(h('div', { class: 'sds-fee-student-row' },
            h('span', { class: 'sds-fee-student-name' }, st.name),
            h('span', { class: 'sds-fee-student-detail' },
              `${st.subjectLabel} / ${st.courseLabel} / ${st.gradeLabel}`),
            h('span', { class: 'sds-fee-student-amt' }, `¥${fee.toLocaleString()}`),
            btn('削除', 'sds-btn-danger', () => {
              FeeData.students = FeeData.students.filter(x => x.id !== st.id);
              log(`生徒削除: ${st.name}`); render();
            })
          ));
        });
      }
    }

    /* ── [C] 月謝一覧タブ ── */
    function renderListTab(wrap) {
      wrap.appendChild(h('p', { class: 'sds-fee-desc' },
        '登録済み生徒の月謝計算結果です。単価設定を変更すると自動的に再計算されます。'));

      if (!FeeData.students.length) {
        wrap.appendChild(h('p', { class: 'sds-hint' }, '※ 先に「② 生徒登録」タブで生徒を登録してください'));
        return;
      }

      // テーブル
      const table = h('table', { class: 'sds-matrix-table' });
      const thead = h('thead', {});
      const hRow  = h('tr', {});
      ['生徒名', '科目', 'コース', '学年', '科目単価', 'コース単価', '学年単価', '合計月謝'].forEach(t =>
        hRow.appendChild(h('th', { class: 'sds-matrix-th' }, t)));
      thead.appendChild(hRow); table.appendChild(thead);

      const tbody = h('tbody', {});
      let grandTotal = 0;

      FeeData.students.forEach(st => {
        const s   = FeeData.subjects.find(x => x.label === st.subjectLabel) || { price: 0 };
        const c   = FeeData.courses.find(x => x.label === st.courseLabel)   || { price: 0 };
        const g   = FeeData.grades.find(x => x.label === st.gradeLabel)     || { price: 0 };
        const fee = s.price + c.price + g.price;
        grandTotal += fee;

        const tr = h('tr', {});
        [
          st.name,
          st.subjectLabel,
          st.courseLabel,
          st.gradeLabel,
          `¥${s.price.toLocaleString()}`,
          `¥${c.price.toLocaleString()}`,
          `¥${g.price.toLocaleString()}`,
        ].forEach((val, i) => {
          const cls = i === 0 ? 'sds-matrix-td sds-matrix-label' : 'sds-matrix-td';
          tr.appendChild(h('td', { class: cls }, val));
        });
        tr.appendChild(h('td', { class: 'sds-matrix-td sds-matrix-grand' }, `¥${fee.toLocaleString()}`));
        tbody.appendChild(tr);
      });

      // 合計行
      const totalRow = h('tr', {});
      ['合計', '', '', '', '', '', ''].forEach(v =>
        totalRow.appendChild(h('td', { class: 'sds-matrix-td sds-matrix-label' }, v)));
      totalRow.appendChild(h('td', { class: 'sds-matrix-td sds-matrix-grand',
        style: 'font-size:15px;' }, `¥${grandTotal.toLocaleString()}`));
      tbody.appendChild(totalRow);

      table.appendChild(tbody);
      wrap.appendChild(h('div', { style: 'overflow-x:auto;' }, table));

      // 合計バー
      wrap.appendChild(h('div', { class: 'sds-fee-grand' },
        h('span', {}, `全生徒 月謝合計（${FeeData.students.length}名）`),
        h('span', { class: 'sds-fee-grand-amt' }, `¥${grandTotal.toLocaleString()}`)
      ));
    }

    /* ── メイン描画 ── */
    function render() {
      root.innerHTML = '';
      root.appendChild(badge('月謝調整', 'info'));

      const wrap = h('div', {});
      renderTabs(wrap);
      const content = h('div', { class: 'sds-fee-content' });
      if (currentTab === 'price')   renderPriceTab(content);
      if (currentTab === 'student') renderStudentTab(content);
      if (currentTab === 'list')    renderListTab(content);
      wrap.appendChild(content);
      root.appendChild(wrap);
    }
    render();
  }

  /* ── 座席制御（UIのみ）── */
  function buildSeat(root) {
    const CAPACITY = 8;
    let used = 3;
    let seatFullEmitted = false;

    const machine = createMachine('seat', '空きあり', {
      '空きあり': { '予約枠確保': '空きあり' },
      '満席':     { '予約枠解放': '空きあり' },
    });

    function render() {
      root.innerHTML = '';
      const full = used >= CAPACITY;
      root.appendChild(badge(`状態: ${full?'満席':'空きあり'}`, full?'danger':'ok'));
      root.appendChild(linkNote('満席 → 通知自動作成'));

      root.appendChild(infoRow('定員',  String(CAPACITY)));
      root.appendChild(infoRow('使用数', String(used)));

      const pct  = Math.round(used / CAPACITY * 100);
      const wrap = h('div', { class: 'sds-progress-wrap' });
      const bar  = h('div', { class: 'sds-progress-bar' });
      bar.style.width      = `${pct}%`;
      bar.style.background = full ? 'var(--sds-danger)' : 'var(--sds-accent)';
      wrap.appendChild(bar); root.appendChild(wrap);

      const grid = h('div', { class: 'sds-seat-grid' });
      for (let i = 0; i < CAPACITY; i++) {
        const cls = i < used ? (full?'sds-seat-cell full':'sds-seat-cell used') : 'sds-seat-cell';
        grid.appendChild(h('div', { class: cls }, String(i+1)));
      }
      root.appendChild(grid);

      if (!full) {
        seatFullEmitted = false;
        root.appendChild(btn('予約枠確保', 'sds-btn-primary', () => {
          if (used < CAPACITY) used++;
          machine.transition('予約枠確保');
          if (used >= CAPACITY && !seatFullEmitted) {
            seatFullEmitted = true;
            EventBus.emit('store:seat-full', {});
            log('🔗 連携[4] 満席 → 通知自動作成', 'link');
          }
          render();
        }));
      } else {
        root.appendChild(btn('予約枠解放', 'sds-btn-warning', () => {
          if (used > 0) used--;
          machine.transition('予約枠解放'); render();
        }));
      }
    }
    render();
  }

  /* ── 設定反映（チェックリスト・UIのみ）── */
  function buildSettings(root) {
    const machine = createMachine('settings', '要確認', {
      '要確認': { '影響範囲確認': '確認済', '反映除外': '除外済' },
      '確認済': { '反映除外': '除外済' },
    });
    const COMPONENTS = ['講師管理', '講師割当', '教室管理', '教室割当', '通知', '月謝調整', '座席制御'];
    const checked = new Set(COMPONENTS);

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`, s==='確認済'?'ok': s==='除外済'?'warn':'info'));

      if (s !== '除外済') {
        root.appendChild(h('div', { class: 'sds-card-title', style: 'margin-top:4px;' }, '設定反映対象コンポーネント'));
        COMPONENTS.forEach(name => {
          const chk = h('input', { type: 'checkbox', id: 'chk-' + name });
          chk.checked = checked.has(name);
          chk.addEventListener('change', () => {
            if (chk.checked) checked.add(name); else checked.delete(name);
          });
          root.appendChild(h('div', { class: 'sds-check-row' },
            chk, h('label', { for: 'chk-' + name }, name)
          ));
        });
      }

      if (s === '要確認') {
        root.appendChild(btn('影響範囲確認', 'sds-btn-primary', () => {
          machine.transition('影響範囲確認');
          log(`設定反映対象: ${[...checked].join(', ')}`); render();
        }));
        root.appendChild(btn('反映除外', 'sds-btn-ghost', () => {
          machine.transition('反映除外'); render();
        }));
      }
      if (s === '確認済') {
        root.appendChild(infoRow('反映対象数', `${checked.size} コンポーネント`));
        root.appendChild(infoRow('対象', [...checked].join(', ')));
        root.appendChild(btn('反映除外', 'sds-btn-warning', () => {
          machine.transition('反映除外'); render();
        }));
      }
      if (s === '除外済') root.appendChild(badge('除外済 — 操作不可', 'warn'));
    }
    render();
  }

  /* ════════════════════════════════════
   *  メイン組み立て
   * ════════════════════════════════════ */
  const TABS = [
    { id: 'teacher-mgmt',   label: '講師管理', build: buildTeacherMgmt },
    { id: 'teacher-assign', label: '講師割当', build: buildTeacherAssign },
    { id: 'room-mgmt',      label: '教室管理', build: buildRoomMgmt },
    { id: 'room-assign',    label: '教室割当', build: buildRoomAssign },
    { id: 'notification',   label: '通知',     build: buildNotification },
    { id: 'contact',        label: '連絡先',   build: buildContact },
    { id: 'history',        label: '連絡履歴', build: buildContactHistory },
    { id: 'fee',            label: '月謝調整', build: buildFeeAdjust },
    { id: 'seat',           label: '座席制御', build: buildSeat },
    { id: 'settings',       label: '設定反映', build: buildSettings },
  ];

  function initComponent({ mountElement, options = {} }) {
    const mountEl = typeof mountElement === 'string'
      ? document.querySelector(mountElement) : mountElement;
    if (!mountEl) { console.error('[SDS] mountElement not found:', mountElement); return; }

    const root = h('div', { class: 'sds-root' });
    mountEl.appendChild(root);

    _toastEl = h('div', { class: 'sds-toast' });
    root.appendChild(_toastEl);

    root.appendChild(h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;' },
      h('span', { style: 'font-size:18px;font-weight:700;' }, '塾管理 拡張SDS'),
      badge('Web部品', 'info'),
      badge('v3.1', 'ok')
    ));

    const tabNav    = h('div', { class: 'sds-tabs' });
    const panelWrap = h('div', {});
    const panels    = {};
    const tabBtns   = {};

    TABS.forEach(tab => {
      const tb = h('button', { class: 'sds-tab-btn', onClick() { switchTab(tab.id); } }, tab.label);
      tabNav.appendChild(tb); tabBtns[tab.id] = tb;

      const panel = h('div', { class: 'sds-panel' });
      const cr    = h('div', {});
      panel.appendChild(card(tab.label, cr));
      tab.build(cr);
      panels[tab.id] = panel;
      panelWrap.appendChild(panel);
    });

    EventBus.on('store:both-assigned', () => flashTab('notification'));
    EventBus.on('store:seat-full',     () => flashTab('notification'));

    function flashTab(id) {
      const b = tabBtns[id]; if (!b) return;
      b.classList.add('sds-tab-flash');
      setTimeout(() => b.classList.remove('sds-tab-flash'), 2000);
    }

    root.appendChild(tabNav);
    root.appendChild(panelWrap);

    root.appendChild(h('div', { class: 'sds-card', style: 'margin-top:16px;' },
      h('div', { class: 'sds-card-title' }, '画面間連携マップ'),
      h('div', { style: 'font-size:11px;color:var(--sds-muted);line-height:2;' },
        h('span', { style: 'color:var(--sds-warning);' }, '🔗'), ' [1] 講師管理（稼働）→ 講師割当（候補）', h('br', {}),
        h('span', { style: 'color:var(--sds-warning);' }, '🔗'), ' [2] 教室管理（使用可能）→ 教室割当（候補）', h('br', {}),
        h('span', { style: 'color:var(--sds-warning);' }, '🔗'), ' [3] 講師＋教室割当済 → 通知自動作成', h('br', {}),
        h('span', { style: 'color:var(--sds-warning);' }, '🔗'), ' [4] 座席満席 → 通知自動作成'
      )
    ));

    _logEl = h('div', { class: 'sds-log' });
    root.appendChild(h('div', { class: 'sds-card-title', style: 'margin-top:16px;' }, '状態遷移ログ'));
    root.appendChild(_logEl);

    function switchTab(id) {
      Object.values(panels).forEach(p => p.classList.remove('active'));
      Object.values(tabBtns).forEach(b => b.classList.remove('active'));
      panels[id].classList.add('active');
      tabBtns[id].classList.add('active');
    }

    switchTab(TABS[0].id);
    log('SDS v3.1 初期化完了');
  }

  global.SDS = global.SDS || {};
  global.SDS.initComponent = initComponent;
  global.SDS.EventBus      = EventBus;

})(window);
