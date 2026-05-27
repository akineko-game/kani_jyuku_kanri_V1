/**
 * SDS拡張コンポーネント — component.js  v4
 *
 * ■ v4 変更点
 *   - 複数講師・複数教室に対応（リスト管理、各エンティティが独立した状態機械を持つ）
 *   - メール文面表示モーダル（コピー可能）
 *   - Undefined全解消（v3.1仕様を継続）
 *
 * ■ 確定仕様
 *   - 通知手段       : 画面内トースト＋メール文面モーダル表示
 *   - 月謝調整       : 講師 × 教室 単価マトリクス
 *   - 座席制御       : UIのみ（モック）
 *   - 設定反映範囲   : チェックリストで対象コンポーネント選択
 *   - 連絡先管理     : 保護者名・電話・メール CRUD
 *   - 連絡履歴       : インメモリ履歴リスト
 *   - 割当必須チェック: 未選択時エラー表示
 *
 * ■ 画面間連携
 *   [1] 講師管理 → 講師割当   : 稼働中の講師のみ候補
 *   [2] 教室管理 → 教室割当   : 使用可能な教室のみ候補
 *   [3] 講師割当＋教室割当 → 通知 : 両方割当済で自動作成
 *   [4] 座席制御 → 通知       : 満席で自動作成
 */
(function (global) {
  'use strict';

  /* ── EventBus ── */
  const EventBus = (function () {
    const _h = {};
    return {
      emit(ev, p) { (_h[ev] || []).forEach(fn => fn(p)); },
      on(ev, fn)  { if (!_h[ev]) _h[ev] = []; _h[ev].push(fn); },
    };
  })();

  /* ── 共有ストア ── */
  const Store = {
    // 複数講師: [{ id, name, state:'未登録'|'登録済'|'稼働中'|'休止中'|'退職済' }]
    teachers: [],
    // 複数教室: [{ id, name, state:'未登録'|'使用可能'|'使用中'|'停止中' }]
    rooms: [],
    // 割当
    assignedTeacherId: null,
    assignedRoomId:    null,
    // 月謝単価: prices[teacherId][roomId] = 円
    prices: {},
    // 連絡先・履歴
    contacts: [],
    history:  [],
  };

  let _uid = 1;
  const uid = () => 'sds-' + (_uid++);

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
        EventBus.emit(`${name}:${event}`, { state });
        return true;
      },
    };
  }

  /* ── ログ ── */
  let _logEl = null;
  function log(msg, type) {
    if (!_logEl) return;
    const d = document.createElement('div');
    d.className = 'sds-log-entry';
    const c = type === 'link' ? 'color:var(--sds-warning);font-weight:700;' : '';
    d.innerHTML = `<span class="ts">${new Date().toLocaleTimeString('ja-JP')}</span><span class="ev" style="${c}">${escHtml(msg)}</span>`;
    _logEl.prepend(d);
  }

  /* ── トースト ── */
  let _toastEl = null;
  function toast(msg, type) {
    if (!_toastEl) return;
    _toastEl.textContent = msg;
    _toastEl.className = `sds-toast sds-toast-${type||'info'} sds-toast-show`;
    clearTimeout(_toastEl._t);
    _toastEl._t = setTimeout(() => _toastEl.classList.remove('sds-toast-show'), 3500);
  }

  /* ── メール文面モーダル ── */
  let _modalEl = null;
  function showMailModal(subject, body) {
    if (!_modalEl) return;
    _modalEl.querySelector('.sds-modal-subject').value = subject;
    _modalEl.querySelector('.sds-modal-body').value    = body;
    _modalEl.classList.add('sds-modal-show');
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
  const badge    = (lbl, type) => h('span', { class:`sds-badge sds-badge-${type}` }, lbl);
  const linkNote = lbl => h('span', { class:'sds-linked' }, `🔗 連携: ${lbl}`);
  const errMsg   = msg => h('p',    { class:'sds-errmsg' }, msg);
  const btn      = (lbl, cls, fn) => h('button', { class:`sds-btn ${cls}`, onClick:fn }, lbl);
  function inp(ph, type) {
    const el = h('input', { class:'sds-input', placeholder:ph });
    if (type) el.type = type;
    return el;
  }
  function selEl(options) {
    const sel = h('select', { class:'sds-select' });
    if (!options.length) {
      const o = document.createElement('option');
      o.value=''; o.textContent='（候補なし）'; o.disabled=true; o.selected=true;
      sel.appendChild(o);
    } else {
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value=opt.value; o.textContent=opt.label; sel.appendChild(o);
      });
    }
    return sel;
  }
  function card(title, ...contents) {
    return h('div', { class:'sds-card' }, h('div', { class:'sds-card-title' }, title), ...contents);
  }
  function infoRow(key, val) {
    return h('div', { class:'sds-info-row' },
      h('span', { class:'sds-info-key' }, key), h('span', {}, val));
  }

  /* ── 講師状態ヘルパ ── */
  const TEACHER_TRANS = {
    '未登録': { '登録':    '登録済' },
    '登録済': { '稼働開始': '稼働中' },
    '稼働中': { '休止':    '休止中', '退職': '退職済' },
    '休止中': { '稼働開始': '稼働中' },
  };
  const TEACHER_BADGE = { '未登録':'idle', '登録済':'info', '稼働中':'ok', '休止中':'warn', '退職済':'danger' };

  /* ── 教室状態ヘルパ ── */
  const ROOM_TRANS = {
    '未登録':   { '登録':    '使用可能' },
    '使用可能': { '使用開始': '使用中', '停止': '停止中' },
    '使用中':   { '停止':    '停止中' },
    '停止中':   { '使用開始': '使用可能' },
  };
  const ROOM_BADGE = { '未登録':'idle', '使用可能':'info', '使用中':'ok', '停止中':'warn' };

  /* ════════════════════════════════════════
   *  講師管理（複数対応）
   * ════════════════════════════════════════ */
  function buildTeacherMgmt(root) {
    let addMode = false;

    function publishTeachers() {
      EventBus.emit('store:teachers-updated', {});
      const active = Store.teachers.filter(t => t.state === '稼働中').length;
      log(`🔗 連携[1] 稼働講師リスト更新 (${active}名)`, 'link');
    }

    function renderCard(t) {
      const wrap = h('div', { class:'sds-entity-card' });

      // ヘッダ行
      const head = h('div', { class:'sds-entity-head' });
      head.appendChild(h('span', { class:'sds-entity-name' }, t.name));
      head.appendChild(badge(t.state, TEACHER_BADGE[t.state] || 'idle'));
      wrap.appendChild(head);

      // ボタン群
      const acts = h('div', { class:'sds-entity-actions' });

      if (t.state === '登録済') {
        acts.appendChild(btn('稼働開始', 'sds-btn-success sds-btn-sm', () => {
          t.state = '稼働中'; publishTeachers(); render();
        }));
      }
      if (t.state === '稼働中') {
        acts.appendChild(btn('休止', 'sds-btn-warning sds-btn-sm', () => {
          t.state = '休止中'; publishTeachers(); render();
        }));
        acts.appendChild(btn('退職', 'sds-btn-danger sds-btn-sm', () => {
          t.state = '退職済'; publishTeachers(); render();
        }));
      }
      if (t.state === '休止中') {
        acts.appendChild(btn('稼働再開', 'sds-btn-success sds-btn-sm', () => {
          t.state = '稼働中'; publishTeachers(); render();
        }));
      }
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
      root.appendChild(badge(`登録: ${Store.teachers.length}名 / 稼働中: ${activeCount}名`, 'info'));

      Store.teachers.forEach(t => root.appendChild(renderCard(t)));

      // 追加フォーム
      if (addMode) {
        const nameI = inp('講師名を入力');
        root.appendChild(nameI);
        let errEl = null;
        root.appendChild(btn('登録', 'sds-btn-primary', () => {
          if (errEl) { errEl.remove(); errEl = null; }
          const name = nameI.value.trim();
          if (!name) { errEl = errMsg('⚠ 講師名は必須です'); root.insertBefore(errEl, root.lastChild); return; }
          Store.teachers.push({ id: uid(), name, state: '登録済' });
          addMode = false; publishTeachers(); render();
        }));
        root.appendChild(btn('キャンセル', 'sds-btn-ghost', () => { addMode = false; render(); }));
      } else {
        root.appendChild(btn('＋ 講師を追加', 'sds-btn-primary', () => { addMode = true; render(); }));
      }
    }
    render();
  }

  /* ════════════════════════════════════════
   *  講師割当（複数講師から選択）
   * ════════════════════════════════════════ */
  function buildTeacherAssign(root) {
    const machine = createMachine('teacher-assign', '未割当', {
      '未割当': { '講師割当': '割当済' },
      '割当済': { '講師割当解除': '未割当' },
    });
    let _r = null;
    EventBus.on('store:teachers-updated', () => { if (_r) _r(); });

    function checkBoth() {
      if (Store.assignedTeacherId && Store.assignedRoomId) {
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
        root.appendChild(h('label', { class:'sds-label' }, '稼働中の講師を選択'));
        const active = Store.teachers.filter(t => t.state === '稼働中');
        const sel = selEl(active.map(t => ({ value:t.id, label:t.name })));
        root.appendChild(sel);
        if (!active.length)
          root.appendChild(h('p', { class:'sds-hint' }, '※ 先に「講師管理」で稼働開始してください'));

        let errEl = null;
        const ab = btn('割当', 'sds-btn-primary', () => {
          if (errEl) { errEl.remove(); errEl = null; }
          if (!sel.value) { errEl = errMsg('⚠ 講師を選択してください'); root.appendChild(errEl); return; }
          Store.assignedTeacherId = sel.value;
          machine.transition('講師割当'); checkBoth(); render();
        });
        if (!active.length) ab.disabled = true;
        root.appendChild(ab);
      }

      if (s === '割当済') {
        const t = Store.teachers.find(x => x.id === Store.assignedTeacherId);
        root.appendChild(infoRow('担当講師', t ? t.name : '（不明）'));
        root.appendChild(btn('解除', 'sds-btn-danger', () => {
          Store.assignedTeacherId = null;
          machine.transition('講師割当解除'); render();
        }));
      }
    }
    _r = render; render();
  }

  /* ════════════════════════════════════════
   *  教室管理（複数対応）
   * ════════════════════════════════════════ */
  function buildRoomMgmt(root) {
    let addMode = false;

    function publishRooms() {
      EventBus.emit('store:rooms-updated', {});
      const avail = Store.rooms.filter(r => r.state === '使用可能' || r.state === '使用中').length;
      log(`🔗 連携[2] 使用可能教室更新 (${avail}室)`, 'link');
    }

    function renderCard(r) {
      const wrap = h('div', { class:'sds-entity-card' });
      const head = h('div', { class:'sds-entity-head' });
      head.appendChild(h('span', { class:'sds-entity-name' }, r.name));
      head.appendChild(badge(r.state, ROOM_BADGE[r.state] || 'idle'));
      wrap.appendChild(head);

      const acts = h('div', { class:'sds-entity-actions' });
      if (r.state === '使用可能' || r.state === '停止中') {
        acts.appendChild(btn('使用開始', 'sds-btn-success sds-btn-sm', () => {
          r.state = '使用中'; publishRooms(); render();
        }));
      }
      if (r.state === '使用中') {
        acts.appendChild(btn('停止', 'sds-btn-warning sds-btn-sm', () => {
          r.state = '停止中'; publishRooms(); render();
        }));
      }
      if (r.state === '停止中') {
        acts.appendChild(btn('使用再開', 'sds-btn-success sds-btn-sm', () => {
          r.state = '使用可能'; publishRooms(); render();
        }));
      }
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
      root.appendChild(badge(`登録: ${Store.rooms.length}室 / 使用可能: ${availCount}室`, 'info'));

      Store.rooms.forEach(r => root.appendChild(renderCard(r)));

      if (addMode) {
        const nameI = inp('教室名を入力');
        root.appendChild(nameI);
        let errEl = null;
        root.appendChild(btn('登録', 'sds-btn-primary', () => {
          if (errEl) { errEl.remove(); errEl = null; }
          const name = nameI.value.trim();
          if (!name) { errEl = errMsg('⚠ 教室名は必須です'); root.insertBefore(errEl, root.lastChild); return; }
          Store.rooms.push({ id: uid(), name, state: '使用可能' });
          addMode = false; publishRooms(); render();
        }));
        root.appendChild(btn('キャンセル', 'sds-btn-ghost', () => { addMode = false; render(); }));
      } else {
        root.appendChild(btn('＋ 教室を追加', 'sds-btn-primary', () => { addMode = true; render(); }));
      }
    }
    render();
  }

  /* ════════════════════════════════════════
   *  教室割当（複数教室から選択）
   * ════════════════════════════════════════ */
  function buildRoomAssign(root) {
    const machine = createMachine('room-assign', '未割当', {
      '未割当': { '教室割当': '割当済' },
      '割当済': { '教室割当解除': '未割当' },
    });
    let _r = null;
    EventBus.on('store:rooms-updated', () => { if (_r) _r(); });

    function checkBoth() {
      if (Store.assignedTeacherId && Store.assignedRoomId) {
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
        root.appendChild(h('label', { class:'sds-label' }, '使用可能な教室を選択'));
        const avail = Store.rooms.filter(r => r.state === '使用可能' || r.state === '使用中');
        const sel = selEl(avail.map(r => ({ value:r.id, label:r.name })));
        root.appendChild(sel);
        if (!avail.length)
          root.appendChild(h('p', { class:'sds-hint' }, '※ 先に「教室管理」で登録してください'));

        let errEl = null;
        const ab = btn('割当', 'sds-btn-primary', () => {
          if (errEl) { errEl.remove(); errEl = null; }
          if (!sel.value) { errEl = errMsg('⚠ 教室を選択してください'); root.appendChild(errEl); return; }
          Store.assignedRoomId = sel.value;
          machine.transition('教室割当'); checkBoth(); render();
        });
        if (!avail.length) ab.disabled = true;
        root.appendChild(ab);
      }

      if (s === '割当済') {
        const r = Store.rooms.find(x => x.id === Store.assignedRoomId);
        root.appendChild(infoRow('割当教室', r ? r.name : '（不明）'));
        root.appendChild(btn('解除', 'sds-btn-danger', () => {
          Store.assignedRoomId = null;
          machine.transition('教室割当解除'); render();
        }));
      }
    }
    _r = render; render();
  }

  /* ════════════════════════════════════════
   *  通知管理（トースト＋メール文面モーダル）
   * ════════════════════════════════════════ */
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
        autoReason = '担当講師・教室が確定しました';
        machine.transition('通知予定作成'); if (_r) _r();
      }
    });
    EventBus.on('store:seat-full', () => {
      if (machine.state !== '通知予定') {
        autoReason = '座席が満席になりました';
        machine.transition('通知予定作成'); if (_r) _r();
      }
    });

    function buildMailBody(reason) {
      const t = Store.teachers.find(x => x.id === Store.assignedTeacherId);
      const r = Store.rooms.find(x => x.id === Store.assignedRoomId);
      const tName = t ? t.name : '（未割当）';
      const rName = r ? r.name : '（未割当）';
      const subject = `【塾からのお知らせ】${reason}`;
      const body =
`保護者の皆様

いつもお世話になっております。

【お知らせ内容】
${reason}

【担当講師】${tName}
【使用教室】${rName}
【日時】　　${new Date().toLocaleString('ja-JP')}

ご不明な点がございましたら、お気軽にご連絡ください。

――――――――――――――――――――
塾管理システム　自動通知
――――――――――――――――――――`;
      return { subject, body };
    }

    function doSend(reason) {
      const rec = { at: new Date().toLocaleString('ja-JP'), reason };
      Store.history.unshift(rec);
      EventBus.emit('store:history-updated', {});
      toast(`🔔 通知完了: ${reason}`, 'success');
      log(`🔔 通知: ${reason}`);
      const { subject, body } = buildMailBody(reason);
      showMailModal(subject, body);
    }

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`, s==='送信済'?'ok': s==='通知予定'?'info':'idle'));
      root.appendChild(linkNote('講師＋教室割当完了 / 満席 で自動作成'));
      root.appendChild(h('div', { class:'sds-spec-note' }, '📢 通知: トースト表示＋メール文面生成'));

      if (s === '通知予定' && autoReason)
        root.appendChild(h('div', { class:'sds-auto-reason' }, `⚡ ${autoReason}（自動作成）`));

      if (s === '未通知' || s === '送信済') {
        const ri = inp('通知内容を入力（任意）');
        root.appendChild(ri);
        root.appendChild(btn('通知予定を手動作成', 'sds-btn-primary', () => {
          autoReason = ri.value.trim() || '手動通知';
          machine.transition('通知予定作成'); render();
        }));
      }

      if (s === '通知予定') {
        root.appendChild(infoRow('内容', autoReason || '（未設定）'));
        root.appendChild(btn('送信 ＋ メール文面を表示', 'sds-btn-success', () => {
          const reason = autoReason || '通知';
          autoReason = '';
          machine.transition('通知送信');
          doSend(reason); render();
        }));
        root.appendChild(btn('キャンセル', 'sds-btn-ghost', () => {
          autoReason = ''; machine.transition('通知キャンセル'); render();
        }));
      }
    }
    _r = render; render();
  }

  /* ════════════════════════════════════════
   *  連絡先管理
   * ════════════════════════════════════════ */
  function buildContact(root) {
    function render() {
      root.innerHTML = '';
      root.appendChild(badge(`登録件数: ${Store.contacts.length}`, 'info'));

      root.appendChild(h('label', { class:'sds-label' }, '保護者名'));
      const nameI = inp('例: 山田 花子');
      root.appendChild(nameI);
      root.appendChild(h('label', { class:'sds-label' }, '電話番号'));
      const telI = inp('例: 090-0000-0000', 'tel');
      root.appendChild(telI);
      root.appendChild(h('label', { class:'sds-label' }, 'メールアドレス'));
      const mailI = inp('例: hanako@example.com', 'email');
      root.appendChild(mailI);

      let errEl = null;
      root.appendChild(btn('追加', 'sds-btn-primary', () => {
        if (errEl) { errEl.remove(); errEl = null; }
        if (!nameI.value.trim()) { errEl = errMsg('⚠ 保護者名は必須です'); root.appendChild(errEl); return; }
        Store.contacts.push({ id: uid(), name: nameI.value.trim(), tel: telI.value.trim(), mail: mailI.value.trim() });
        log(`連絡先追加: ${nameI.value.trim()}`); render();
      }));

      if (Store.contacts.length) {
        root.appendChild(h('div', { class:'sds-card-title', style:'margin-top:14px;' }, '登録済み連絡先'));
        Store.contacts.forEach(c => {
          root.appendChild(h('div', { class:'sds-contact-row' },
            h('div', { class:'sds-contact-info' },
              h('strong', {}, c.name),
              c.tel  ? h('span', { class:'sds-contact-sub' }, `📞 ${c.tel}`)  : null,
              c.mail ? h('span', { class:'sds-contact-sub' }, `✉ ${c.mail}`) : null
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

  /* ════════════════════════════════════════
   *  連絡履歴
   * ════════════════════════════════════════ */
  function buildContactHistory(root) {
    let _r = null;
    EventBus.on('store:history-updated', () => { if (_r) _r(); });
    function render() {
      root.innerHTML = '';
      root.appendChild(badge(`履歴件数: ${Store.history.length}`, 'info'));
      if (!Store.history.length) {
        root.appendChild(h('p', { style:'color:var(--sds-muted);font-size:12px;margin-top:8px;' },
          '通知を送信すると履歴が表示されます。'));
        return;
      }
      Store.history.forEach(rec => {
        root.appendChild(h('div', { class:'sds-history-row' },
          h('span', { class:'sds-history-at' }, rec.at),
          h('span', { class:'sds-history-body' }, rec.reason)
        ));
      });
      root.appendChild(btn('履歴をクリア', 'sds-btn-ghost', () => {
        Store.history = []; log('連絡履歴をクリア'); render();
      }));
    }
    _r = render; render();
  }

  /* ════════════════════════════════════════
   *  月謝調整（講師 × 教室 マトリクス・複数対応）
   * ════════════════════════════════════════ */
  function buildFeeAdjust(root) {
    let _r = null;
    EventBus.on('store:teachers-updated', () => { if (_r) _r(); });
    EventBus.on('store:rooms-updated',    () => { if (_r) _r(); });

    function getPrice(tId, rId) {
      if (!Store.prices[tId]) Store.prices[tId] = {};
      if (Store.prices[tId][rId] === undefined) Store.prices[tId][rId] = 5000;
      return Store.prices[tId][rId];
    }
    function setPrice(tId, rId, v) {
      if (!Store.prices[tId]) Store.prices[tId] = {};
      Store.prices[tId][rId] = v;
    }

    function render() {
      root.innerHTML = '';
      root.appendChild(badge('月謝調整 — 講師×教室 単価マトリクス', 'info'));
      root.appendChild(linkNote('講師・教室の登録状況をリアルタイム反映'));

      const teachers = Store.teachers.filter(t => t.state !== '退職済');
      const rooms    = Store.rooms.filter(r => r.state !== '未登録');

      if (!teachers.length || !rooms.length) {
        root.appendChild(h('p', { class:'sds-hint' }, '※ 講師と教室を登録してください'));
        root.appendChild(h('p', { style:'color:var(--sds-muted);font-size:12px;' },
          `現在: 講師 ${teachers.length}名 / 教室 ${rooms.length}室`));
        return;
      }

      const table = h('table', { class:'sds-matrix-table' });
      const thead = h('thead', {});
      const hRow  = h('tr', {});
      hRow.appendChild(h('th', { class:'sds-matrix-th' }, '講師 \\ 教室'));
      rooms.forEach(r => hRow.appendChild(h('th', { class:'sds-matrix-th' }, r.name)));
      hRow.appendChild(h('th', { class:'sds-matrix-th' }, '小計'));
      thead.appendChild(hRow);
      table.appendChild(thead);

      const tbody = h('tbody', {});
      let grandTotal = 0;
      const subtotalEls = [];

      teachers.forEach((t, ti) => {
        const tr = h('tr', {});
        tr.appendChild(h('td', { class:'sds-matrix-td sds-matrix-label' }, t.name));
        let rowTotal = 0;
        const subEl = h('td', { class:'sds-matrix-td sds-matrix-subtotal' });

        rooms.forEach(r => {
          const price = getPrice(t.id, r.id);
          rowTotal += price;
          const ni = h('input', { class:'sds-matrix-input' });
          ni.type = 'number'; ni.min = '0'; ni.value = String(price);
          ni.addEventListener('input', () => {
            const v = parseInt(ni.value) || 0;
            setPrice(t.id, r.id, v);
            recalc();
          });
          tr.appendChild(h('td', { class:'sds-matrix-td' }, ni));
        });

        grandTotal += rowTotal;
        subEl.textContent = `¥${rowTotal.toLocaleString()}`;
        subtotalEls.push(subEl);
        tr.appendChild(subEl);
        tbody.appendChild(tr);
      });

      // 合計行
      const totalRow = h('tr', {});
      totalRow.appendChild(h('td', { class:'sds-matrix-td sds-matrix-label' }, '合計'));
      rooms.forEach(() => totalRow.appendChild(h('td', { class:'sds-matrix-td' }, '')));
      const grandEl = h('td', { class:'sds-matrix-td sds-matrix-grand' }, `¥${grandTotal.toLocaleString()}`);
      totalRow.appendChild(grandEl);
      tbody.appendChild(totalRow);
      table.appendChild(tbody);

      root.appendChild(h('div', { style:'overflow-x:auto;' }, table));
      root.appendChild(h('p', { style:'font-size:11px;color:var(--sds-muted);margin-top:6px;' },
        '各セルを直接編集できます。合計はリアルタイムで更新されます。'));

      function recalc() {
        let grand = 0;
        teachers.forEach((t, ti) => {
          let rowTotal = 0;
          rooms.forEach(r => { rowTotal += getPrice(t.id, r.id); });
          grand += rowTotal;
          if (subtotalEls[ti]) subtotalEls[ti].textContent = `¥${rowTotal.toLocaleString()}`;
        });
        grandEl.textContent = `¥${grand.toLocaleString()}`;
      }

      root.appendChild(btn('この単価を確定', 'sds-btn-success', () => {
        let grand = 0;
        teachers.forEach(t => rooms.forEach(r => { grand += getPrice(t.id, r.id); }));
        log(`月謝単価確定 合計: ¥${grand.toLocaleString()}`);
        toast(`💴 月謝単価確定（合計 ¥${grand.toLocaleString()}）`, 'success');
      }));
    }
    _r = render; render();
  }

  /* ════════════════════════════════════════
   *  座席制御
   * ════════════════════════════════════════ */
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
      root.appendChild(infoRow('定員',   String(CAPACITY)));
      root.appendChild(infoRow('使用数', String(used)));
      const wrap = h('div', { class:'sds-progress-wrap' });
      const bar  = h('div', { class:'sds-progress-bar' });
      bar.style.width      = `${Math.round(used/CAPACITY*100)}%`;
      bar.style.background = full ? 'var(--sds-danger)' : 'var(--sds-accent)';
      wrap.appendChild(bar); root.appendChild(wrap);
      const grid = h('div', { class:'sds-seat-grid' });
      for (let i = 0; i < CAPACITY; i++) {
        const cls = i < used ? (full?'sds-seat-cell full':'sds-seat-cell used') : 'sds-seat-cell';
        grid.appendChild(h('div', { class:cls }, String(i+1)));
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

  /* ════════════════════════════════════════
   *  設定反映
   * ════════════════════════════════════════ */
  function buildSettings(root) {
    const machine = createMachine('settings', '要確認', {
      '要確認': { '影響範囲確認': '確認済', '反映除外': '除外済' },
      '確認済': { '反映除外': '除外済' },
    });
    const COMPONENTS = ['講師管理','講師割当','教室管理','教室割当','通知','月謝調整','座席制御'];
    const checked = new Set(COMPONENTS);
    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`, s==='確認済'?'ok': s==='除外済'?'warn':'info'));
      if (s !== '除外済') {
        root.appendChild(h('div', { class:'sds-card-title', style:'margin-top:4px;' }, '設定反映対象コンポーネント'));
        COMPONENTS.forEach(name => {
          const chk = h('input', { type:'checkbox', id:'chk-'+name });
          chk.checked = checked.has(name);
          chk.addEventListener('change', () => { if (chk.checked) checked.add(name); else checked.delete(name); });
          root.appendChild(h('div', { class:'sds-check-row' }, chk, h('label', { for:'chk-'+name }, name)));
        });
      }
      if (s === '要確認') {
        root.appendChild(btn('影響範囲確認', 'sds-btn-primary', () => {
          machine.transition('影響範囲確認');
          log(`設定反映対象: ${[...checked].join(', ')}`); render();
        }));
        root.appendChild(btn('反映除外', 'sds-btn-ghost', () => { machine.transition('反映除外'); render(); }));
      }
      if (s === '確認済') {
        root.appendChild(infoRow('反映対象数', `${checked.size} コンポーネント`));
        root.appendChild(infoRow('対象', [...checked].join(', ')));
        root.appendChild(btn('反映除外', 'sds-btn-warning', () => { machine.transition('反映除外'); render(); }));
      }
      if (s === '除外済') root.appendChild(badge('除外済 — 操作不可', 'warn'));
    }
    render();
  }

  /* ════════════════════════════════════════
   *  メイン組み立て
   * ════════════════════════════════════════ */
  const TABS = [
    { id:'teacher-mgmt',   label:'講師管理', build:buildTeacherMgmt },
    { id:'teacher-assign', label:'講師割当', build:buildTeacherAssign },
    { id:'room-mgmt',      label:'教室管理', build:buildRoomMgmt },
    { id:'room-assign',    label:'教室割当', build:buildRoomAssign },
    { id:'notification',   label:'通知',     build:buildNotification },
    { id:'contact',        label:'連絡先',   build:buildContact },
    { id:'history',        label:'連絡履歴', build:buildContactHistory },
    { id:'fee',            label:'月謝調整', build:buildFeeAdjust },
    { id:'seat',           label:'座席制御', build:buildSeat },
    { id:'settings',       label:'設定反映', build:buildSettings },
  ];

  function initComponent({ mountElement }) {
    const mountEl = typeof mountElement === 'string'
      ? document.querySelector(mountElement) : mountElement;
    if (!mountEl) { console.error('[SDS] mountElement not found'); return; }

    const root = h('div', { class:'sds-root' });
    mountEl.appendChild(root);

    // トースト
    _toastEl = h('div', { class:'sds-toast' });
    root.appendChild(_toastEl);

    // メール文面モーダル
    _modalEl = h('div', { class:'sds-modal' });
    const modalInner = h('div', { class:'sds-modal-inner' });
    modalInner.appendChild(h('div', { class:'sds-modal-title' }, '📧 メール文面'));

    modalInner.appendChild(h('label', { class:'sds-label' }, '件名'));
    const subjectEl = h('textarea', { class:'sds-modal-subject sds-modal-textarea' });
    subjectEl.rows = 1; subjectEl.style.resize = 'none';
    modalInner.appendChild(subjectEl);

    modalInner.appendChild(h('label', { class:'sds-label', style:'margin-top:8px;' }, '本文'));
    const bodyEl = h('textarea', { class:'sds-modal-body sds-modal-textarea' });
    bodyEl.rows = 12;
    modalInner.appendChild(bodyEl);

    const copyBtn = btn('📋 本文をコピー', 'sds-btn-success', () => {
      navigator.clipboard.writeText(bodyEl.value).then(() => {
        toast('📋 コピーしました', 'success');
      });
    });
    modalInner.appendChild(copyBtn);
    modalInner.appendChild(btn('閉じる', 'sds-btn-ghost', () => {
      _modalEl.classList.remove('sds-modal-show');
    }));
    _modalEl.appendChild(modalInner);
    _modalEl.addEventListener('click', e => {
      if (e.target === _modalEl) _modalEl.classList.remove('sds-modal-show');
    });
    root.appendChild(_modalEl);

    // ヘッダ
    root.appendChild(h('div', { style:'display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;' },
      h('span', { style:'font-size:18px;font-weight:700;' }, '塾管理 拡張SDS'),
      badge('Web部品', 'info'),
      badge('v4', 'ok')
    ));

    const tabNav    = h('div', { class:'sds-tabs' });
    const panelWrap = h('div', {});
    const panels    = {};
    const tabBtns   = {};

    TABS.forEach(tab => {
      const tb = h('button', { class:'sds-tab-btn', onClick() { switchTab(tab.id); } }, tab.label);
      tabNav.appendChild(tb); tabBtns[tab.id] = tb;
      const panel = h('div', { class:'sds-panel' });
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

    // 連携マップ
    root.appendChild(h('div', { class:'sds-card', style:'margin-top:16px;' },
      h('div', { class:'sds-card-title' }, '画面間連携マップ'),
      h('div', { style:'font-size:11px;color:var(--sds-muted);line-height:2;' },
        h('span', { style:'color:var(--sds-warning);' }, '🔗'), ' [1] 講師管理（稼働）→ 講師割当（候補）', h('br', {}),
        h('span', { style:'color:var(--sds-warning);' }, '🔗'), ' [2] 教室管理（使用可能）→ 教室割当（候補）', h('br', {}),
        h('span', { style:'color:var(--sds-warning);' }, '🔗'), ' [3] 講師＋教室割当済 → 通知自動作成', h('br', {}),
        h('span', { style:'color:var(--sds-warning);' }, '🔗'), ' [4] 座席満席 → 通知自動作成'
      )
    ));

    _logEl = h('div', { class:'sds-log' });
    root.appendChild(h('div', { class:'sds-card-title', style:'margin-top:16px;' }, '状態遷移ログ'));
    root.appendChild(_logEl);

    function switchTab(id) {
      Object.values(panels).forEach(p => p.classList.remove('active'));
      Object.values(tabBtns).forEach(b => b.classList.remove('active'));
      panels[id].classList.add('active');
      tabBtns[id].classList.add('active');
    }
    switchTab(TABS[0].id);
    log('SDS v4 初期化完了（複数講師・教室対応、メール文面生成）');
  }

  global.SDS = global.SDS || {};
  global.SDS.initComponent = initComponent;
  global.SDS.EventBus      = EventBus;
})(window);
