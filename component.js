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
    teachers:          [],   // { id, name, state } 講師マスタ（複数）
    rooms:             [],   // { id, name, state } 教室マスタ（複数）
    activeTeachers:    [],   // 稼働中の講師（割当セレクト用）
    availableRooms:    [],   // 使用可能な教室（割当セレクト用）
    assignedTeacherId: null,
    assignedRoomId:    null,
    teacherAssigned:   false,
    roomAssigned:      false,
    contacts:          [],   // { id, name, tel, mail }
    history:           [],   // { at, reason }
    prices:            {},
    feeStudents:       [],   // { id, name, subjectLabel, courseLabel, gradeLabel }
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
  /* ════════════════════════════════════════
   *  講師管理（複数登録対応）
   * ════════════════════════════════════════ */
  function buildTeacherMgmt(root) {
    if (!Store.teachers) Store.teachers = [];
    let addMode = false;
    const STATE_BADGE = { '登録済':'info', '稼働中':'ok', '休止中':'warn', '退職済':'danger' };
    const TRANSITIONS = {
      '登録済': { '稼働開始': '稼働中' },
      '稼働中': { '休止':    '休止中', '退職': '退職済' },
      '休止中': { '稼働再開': '稼働中' },
    };
    function publishTeachers() {
      Store.activeTeachers = Store.teachers
        .filter(t => t.state === '稼働中')
        .map(t => ({ id: t.id, name: t.name }));
      EventBus.emit('store:teachers-updated', {});
      log('🔗 連携[1] 稼働講師リスト更新 (' + Store.activeTeachers.length + '名)', 'link');
    }
    function doTransition(t, event) {
      const next = (TRANSITIONS[t.state] || {})[event];
      if (!next) { log('[teacher] 無効遷移: ' + t.state + ' —✕→ ' + event); return; }
      log('[teacher:' + t.name + '] ' + t.state + ' —' + event + '→ ' + next);
      t.state = next; publishTeachers(); render();
    }
    function renderCard(t) {
      const wrap = h('div', { class: 'sds-entity-card' });
      const head = h('div', { class: 'sds-entity-head' });
      head.appendChild(h('span', { class: 'sds-entity-name' }, t.name));
      head.appendChild(badge(t.state, STATE_BADGE[t.state] || 'idle'));
      wrap.appendChild(head);
      const acts = h('div', { class: 'sds-entity-actions' });
      if (t.state === '登録済') acts.appendChild(btn('稼働開始', 'sds-btn-success sds-btn-sm', () => doTransition(t, '稼働開始')));
      if (t.state === '稼働中') {
        acts.appendChild(btn('休止',   'sds-btn-warning sds-btn-sm', () => doTransition(t, '休止')));
        acts.appendChild(btn('退職',   'sds-btn-danger sds-btn-sm',  () => doTransition(t, '退職')));
      }
      if (t.state === '休止中') acts.appendChild(btn('稼働再開', 'sds-btn-success sds-btn-sm', () => doTransition(t, '稼働再開')));
      if (t.state !== '退職済') {
        acts.appendChild(btn('削除', 'sds-btn-ghost sds-btn-sm', () => {
          Store.teachers = Store.teachers.filter(x => x.id !== t.id);
          publishTeachers(); render();
        }));
      }
      wrap.appendChild(acts);
      return wrap;
    }
    function render() {
      root.innerHTML = '';
      root.appendChild(linkNote('稼働状態 → 講師割当の候補リスト'));
      const activeCount = Store.teachers.filter(t => t.state === '稼働中').length;
      root.appendChild(badge('登録: ' + Store.teachers.length + '名 / 稼働中: ' + activeCount + '名', 'info'));
      Store.teachers.forEach(t => root.appendChild(renderCard(t)));
      if (addMode) {
        const nameI = inp('講師名を入力');
        root.appendChild(nameI);
        let errEl = null;
        root.appendChild(btn('登録', 'sds-btn-primary', () => {
          if (errEl) { errEl.remove(); errEl = null; }
          const name = nameI.value.trim();
          if (!name) { errEl = errMsg('⚠ 講師名は必須です'); root.appendChild(errEl); return; }
          Store.teachers.push({ id: 'T' + Date.now(), name, state: '登録済' });
          log('講師登録: ' + name);
          addMode = false; publishTeachers(); render();
        }));
        root.appendChild(btn('キャンセル', 'sds-btn-ghost', () => { addMode = false; render(); }));
      } else {
        root.appendChild(btn('＋ 講師を追加', 'sds-btn-primary', () => { addMode = true; render(); }));
      }
    }
    render();
  }

  /* ── 講師割当（稼働中の講師をセレクトで選択）── */
  function buildTeacherAssign(root) {
    const machine = createMachine('teacher-assign', '未割当', {
      '未割当': { '講師割当': '割当済' },
      '割当済': { '講師割当解除': '未割当' },
    });
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
      root.appendChild(badge('状態: ' + s, s==='割当済'?'ok':'idle'));
      root.appendChild(linkNote('稼働中の講師のみ表示'));

      if (s === '未割当') {
        root.appendChild(h('label', { class: 'sds-label' }, '稼働中の講師を選択'));
        const active = Store.activeTeachers;
        const sel = selEl(active.map(t => ({ value: t.id, label: t.name })));
        root.appendChild(sel);
        if (!active.length)
          root.appendChild(h('p', { class: 'sds-hint' }, '※ 先に「講師管理」で稼働開始してください'));

        let errEl = null;
        const ab = btn('割当', 'sds-btn-primary', () => {
          if (errEl) { errEl.remove(); errEl = null; }
          if (!sel.value) { errEl = errMsg('⚠ 講師を選択してください'); root.appendChild(errEl); return; }
          Store.assignedTeacherId = sel.value;
          machine.transition('講師割当');
          Store.teacherAssigned = true;
          checkBoth(); render();
        });
        if (!active.length) ab.disabled = true;
        root.appendChild(ab);
      }
      if (s === '割当済') {
        const t = Store.activeTeachers.find(x => x.id === Store.assignedTeacherId);
        root.appendChild(infoRow('担当講師', t ? t.name : '（不明）'));
        root.appendChild(btn('解除', 'sds-btn-danger', () => {
          Store.assignedTeacherId = null;
          machine.transition('講師割当解除');
          Store.teacherAssigned = false; render();
        }));
      }
    }
    _r = render; render();
  }

  /* ════════════════════════════════════════
   *  教室管理（複数登録対応）
   * ════════════════════════════════════════ */
  function buildRoomMgmt(root) {
    if (!Store.rooms) Store.rooms = [];
    let addMode = false;
    const STATE_BADGE = { '使用可能':'info', '使用中':'ok', '停止中':'warn' };
    const TRANSITIONS = {
      '使用可能': { '使用開始': '使用中', '停止': '停止中' },
      '使用中':   { '停止':    '停止中' },
      '停止中':   { '使用再開': '使用可能' },
    };
    function publishRooms() {
      Store.availableRooms = Store.rooms
        .filter(r => r.state === '使用可能' || r.state === '使用中')
        .map(r => ({ id: r.id, name: r.name }));
      EventBus.emit('store:rooms-updated', {});
      log('🔗 連携[2] 使用可能教室更新 (' + Store.availableRooms.length + '室)', 'link');
    }
    function doTransition(r, event) {
      const next = (TRANSITIONS[r.state] || {})[event];
      if (!next) { log('[room] 無効遷移: ' + r.state + ' —✕→ ' + event); return; }
      log('[room:' + r.name + '] ' + r.state + ' —' + event + '→ ' + next);
      r.state = next; publishRooms(); render();
    }
    function renderCard(r) {
      const wrap = h('div', { class: 'sds-entity-card' });
      const head = h('div', { class: 'sds-entity-head' });
      head.appendChild(h('span', { class: 'sds-entity-name' }, r.name));
      head.appendChild(badge(r.state, STATE_BADGE[r.state] || 'idle'));
      wrap.appendChild(head);
      const acts = h('div', { class: 'sds-entity-actions' });
      if (r.state === '使用可能') {
        acts.appendChild(btn('使用開始', 'sds-btn-success sds-btn-sm', () => doTransition(r, '使用開始')));
        acts.appendChild(btn('停止',     'sds-btn-warning sds-btn-sm', () => doTransition(r, '停止')));
      }
      if (r.state === '使用中') acts.appendChild(btn('停止', 'sds-btn-warning sds-btn-sm', () => doTransition(r, '停止')));
      if (r.state === '停止中') acts.appendChild(btn('使用再開', 'sds-btn-success sds-btn-sm', () => doTransition(r, '使用再開')));
      acts.appendChild(btn('削除', 'sds-btn-ghost sds-btn-sm', () => {
        Store.rooms = Store.rooms.filter(x => x.id !== r.id);
        publishRooms(); render();
      }));
      wrap.appendChild(acts);
      return wrap;
    }
    function render() {
      root.innerHTML = '';
      root.appendChild(linkNote('使用可能状態 → 教室割当の候補リスト'));
      const availCount = Store.rooms.filter(r => r.state === '使用可能' || r.state === '使用中').length;
      root.appendChild(badge('登録: ' + Store.rooms.length + '室 / 使用可能: ' + availCount + '室', 'info'));
      Store.rooms.forEach(r => root.appendChild(renderCard(r)));
      if (addMode) {
        const nameI = inp('教室名を入力');
        root.appendChild(nameI);
        let errEl = null;
        root.appendChild(btn('登録', 'sds-btn-primary', () => {
          if (errEl) { errEl.remove(); errEl = null; }
          const name = nameI.value.trim();
          if (!name) { errEl = errMsg('⚠ 教室名は必須です'); root.appendChild(errEl); return; }
          Store.rooms.push({ id: 'R' + Date.now(), name, state: '使用可能' });
          log('教室登録: ' + name);
          addMode = false; publishRooms(); render();
        }));
        root.appendChild(btn('キャンセル', 'sds-btn-ghost', () => { addMode = false; render(); }));
      } else {
        root.appendChild(btn('＋ 教室を追加', 'sds-btn-primary', () => { addMode = true; render(); }));
      }
    }
    render();
  }

  /* ── 教室割当（使用可能な教室をセレクトで選択）── */
  function buildRoomAssign(root) {
    const machine = createMachine('room-assign', '未割当', {
      '未割当': { '教室割当': '割当済' },
      '割当済': { '教室割当解除': '未割当' },
    });
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
      root.appendChild(badge('状態: ' + s, s==='割当済'?'ok':'idle'));
      root.appendChild(linkNote('使用可能な教室のみ表示'));

      if (s === '未割当') {
        root.appendChild(h('label', { class: 'sds-label' }, '使用可能な教室を選択'));
        const avail = Store.availableRooms;
        const sel = selEl(avail.map(r => ({ value: r.id, label: r.name })));
        root.appendChild(sel);
        if (!avail.length)
          root.appendChild(h('p', { class: 'sds-hint' }, '※ 先に「教室管理」で登録してください'));

        let errEl = null;
        const ab = btn('割当', 'sds-btn-primary', () => {
          if (errEl) { errEl.remove(); errEl = null; }
          if (!sel.value) { errEl = errMsg('⚠ 教室を選択してください'); root.appendChild(errEl); return; }
          Store.assignedRoomId = sel.value;
          machine.transition('教室割当');
          Store.roomAssigned = true;
          checkBoth(); render();
        });
        if (!avail.length) ab.disabled = true;
        root.appendChild(ab);
      }
      if (s === '割当済') {
        const r = Store.availableRooms.find(x => x.id === Store.assignedRoomId);
        root.appendChild(infoRow('割当教室', r ? r.name : '（不明）'));
        root.appendChild(btn('解除', 'sds-btn-danger', () => {
          Store.assignedRoomId = null;
          machine.transition('教室割当解除');
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
  function buildFeeAdjust(root) {
    // 単価マトリクス: prices[講師名][教室名] = 円
    // Store.activeTeachers / Store.availableRooms を参照してリアルタイム生成
    let _r = null;
    EventBus.on('store:teachers-updated', () => { if (_r) _r(); });
    EventBus.on('store:rooms-updated',    () => { if (_r) _r(); });

    function getPrice(tName, rName) {
      if (!Store.prices[tName]) Store.prices[tName] = {};
      if (Store.prices[tName][rName] === undefined) Store.prices[tName][rName] = 5000; // デフォルト単価
      return Store.prices[tName][rName];
    }
    function setPrice(tName, rName, val) {
      if (!Store.prices[tName]) Store.prices[tName] = {};
      Store.prices[tName][rName] = val;
    }

    function render() {
      root.innerHTML = '';
      root.appendChild(badge('月謝調整 — 講師×教室 単価マトリクス', 'info'));
      root.appendChild(linkNote('講師・教室の登録状況を反映'));

      const teachers = Store.activeTeachers;
      const rooms    = Store.availableRooms;

      if (!teachers.length || !rooms.length) {
        root.appendChild(h('p', { class: 'sds-hint' },
          '※ 講師管理で稼働開始・教室管理で登録をしてください'));
        root.appendChild(h('p', { style: 'color:var(--sds-muted);font-size:12px;' },
          `現在: 講師 ${teachers.length}名 / 教室 ${rooms.length}室`));
        return;
      }

      // マトリクステーブル
      const table = h('table', { class: 'sds-matrix-table' });

      // ヘッダー行
      const thead = h('thead', {});
      const hRow  = h('tr', {});
      hRow.appendChild(h('th', { class: 'sds-matrix-th' }, '講師 \\ 教室'));
      rooms.forEach(r => hRow.appendChild(h('th', { class: 'sds-matrix-th' }, r.name)));
      hRow.appendChild(h('th', { class: 'sds-matrix-th' }, '小計'));
      thead.appendChild(hRow);
      table.appendChild(thead);

      // データ行
      const tbody  = h('tbody', {});
      let grandTotal = 0;
      const inputRefs = []; // { tName, rName, el }

      teachers.forEach(t => {
        const tr      = h('tr', {});
        let rowTotal  = 0;
        tr.appendChild(h('td', { class: 'sds-matrix-td sds-matrix-label' }, t.name));

        const subtotalEl = h('td', { class: 'sds-matrix-td sds-matrix-subtotal' }, '—');

        rooms.forEach(r => {
          const price  = getPrice(t.name, r.name);
          const numInp = inp('', '', 'number');
          numInp.value = String(price);
          numInp.min   = '0';
          numInp.className = 'sds-matrix-input';
          rowTotal += price;

          numInp.addEventListener('input', () => {
            const v = parseInt(numInp.value) || 0;
            setPrice(t.name, r.name, v);
            recalc();
          });

          inputRefs.push({ tName: t.name, rName: r.name, el: numInp });
          tr.appendChild(h('td', { class: 'sds-matrix-td' }, numInp));
        });

        grandTotal += rowTotal;
        subtotalEl.textContent = `¥${rowTotal.toLocaleString()}`;
        tr.appendChild(subtotalEl);
        tbody.appendChild(tr);
      });

      // 合計行
      const totalRow = h('tr', {});
      totalRow.appendChild(h('td', { class: 'sds-matrix-td sds-matrix-label' }, '合計'));
      rooms.forEach(() => totalRow.appendChild(h('td', { class: 'sds-matrix-td' }, '')));
      const grandEl = h('td', { class: 'sds-matrix-td sds-matrix-grand' }, `¥${grandTotal.toLocaleString()}`);
      totalRow.appendChild(grandEl);
      tbody.appendChild(totalRow);

      table.appendChild(tbody);
      root.appendChild(h('div', { style: 'overflow-x:auto;' }, table));

      // リアルタイム再計算
      function recalc() {
        let grand = 0;
        teachers.forEach(t => {
          let rowTotal = 0;
          rooms.forEach(r => {
            rowTotal += getPrice(t.name, r.name);
          });
          grand += rowTotal;
          // 小計セルを更新
          const idx = teachers.indexOf(t);
          const subtotals = tbody.querySelectorAll('.sds-matrix-subtotal');
          if (subtotals[idx]) subtotals[idx].textContent = `¥${rowTotal.toLocaleString()}`;
        });
        grandEl.textContent = `¥${grand.toLocaleString()}`;
      }

      root.appendChild(h('p', { style: 'font-size:11px;color:var(--sds-muted);margin-top:6px;' },
        '各セルの金額を直接編集できます。合計はリアルタイムで更新されます。'));

      root.appendChild(btn('この単価を確定', 'sds-btn-success', () => {
        let grand = 0;
        teachers.forEach(t => rooms.forEach(r => { grand += getPrice(t.name, r.name); }));
        log(`月謝単価確定 合計: ¥${grand.toLocaleString()}`);
        toast(`💴 月謝単価を確定しました（合計 ¥${grand.toLocaleString()}）`, 'success');
      }));
    }
    _r = render; render();
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
