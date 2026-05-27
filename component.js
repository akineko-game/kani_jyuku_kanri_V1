/**
 * SDS拡張コンポーネント — component.js  v6（状態駆動UIエンジン統合版）
 *
 * ■ 確定仕様
 *   - 講師管理     : 複数登録対応（カードリスト＋追加ボタン）
 *   - 教室管理     : 複数登録対応（カードリスト＋追加ボタン）
 *   - 講師割当     : 稼働中の講師をセレクトで選択（ID参照）
 *   - 教室割当     : 使用可能な教室をセレクトで選択（ID参照）
 *   - 通知         : 画面内トースト＋メール文面モーダル（コピー可能）
 *   - 連絡先管理   : 保護者名・電話・メール CRUD
 *   - 連絡履歴     : インメモリ履歴リスト
 *   - 月謝調整     : 科目単価＋コース単価＋学年単価の加算方式、生徒別計算
 *   - 座席制御     : 授業コマ（曜日・時間・科目・定員）登録＋生徒予約＋空き可視化
 *   - 設定反映     : 対象コンポーネントをチェックリストで選択
 *   - 割当必須チェック: 未選択時エラー表示
 *   - 状態駆動UI : Storeから次ステップを推定し、ガイド・進捗・タブ強調を自動更新
 *
 * ■ 画面間連携
 *   [1] 講師管理（稼働）     → 講師割当（候補リスト）
 *   [2] 教室管理（使用可能） → 教室割当（候補リスト）
 *   [3] 講師割当＋教室割当済 → 通知自動作成
 *   [4] 座席満席             → 通知自動作成
 *   [5] 月謝タブの生徒リスト → 座席制御の予約セレクトに流用
 */
(function (global) {
  'use strict';

  /* ══════════════════════════════════════
   *  EventBus
   * ══════════════════════════════════════ */
  const EventBus = (function () {
    const _h = {};
    return {
      emit(ev, p) { (_h[ev] || []).forEach(fn => fn(p)); },
      on(ev, fn)  { if (!_h[ev]) _h[ev] = []; _h[ev].push(fn); },
    };
  })();

  /* ══════════════════════════════════════
   *  共有ストア
   * ══════════════════════════════════════ */
  const Store = {
    teachers:          [],   // { id, name, state:'登録済'|'稼働中'|'休止中'|'退職済' }
    rooms:             [],   // { id, name, state:'使用可能'|'使用中'|'停止中' }
    activeTeachers:    [],   // 稼働中の講師（割当セレクト用）{ id, name }
    availableRooms:    [],   // 使用可能な教室（割当セレクト用）{ id, name }
    assignedTeacherId: null,
    assignedRoomId:    null,
    teacherAssigned:   false,
    roomAssigned:      false,
    contacts:          [],   // { id, name, tel, mail }
    history:           [],   // { at, reason }
    feeStudents:       [],   // { id, name, subjectLabel, courseLabel, gradeLabel }
  };

  let _uid = 1;
  const uid = () => 'sds' + (_uid++);

  /* ══════════════════════════════════════
   *  ログ
   * ══════════════════════════════════════ */
  let _logEl = null;
  function log(msg, type) {
    if (!_logEl) return;
    const d = document.createElement('div');
    d.className = 'sds-log-entry';
    const c = type === 'link' ? 'color:var(--sds-warning);font-weight:700;' : '';
    d.innerHTML = '<span class="ts">' + new Date().toLocaleTimeString('ja-JP') + '</span>'
      + '<span class="ev" style="' + c + '">' + escHtml(msg) + '</span>';
    _logEl.prepend(d);
  }

  /* ══════════════════════════════════════
   *  トースト
   * ══════════════════════════════════════ */
  let _toastEl = null;
  function toast(msg, type) {
    if (!_toastEl) return;
    _toastEl.textContent = msg;
    _toastEl.className = 'sds-toast sds-toast-' + (type || 'info') + ' sds-toast-show';
    clearTimeout(_toastEl._t);
    _toastEl._t = setTimeout(() => _toastEl.classList.remove('sds-toast-show'), 3500);
  }

  /* ══════════════════════════════════════
   *  メール文面モーダル
   * ══════════════════════════════════════ */
  let _modalEl = null;
  function showMailModal(subject, body) {
    if (!_modalEl) return;
    _modalEl.querySelector('.sds-modal-subject').value = subject;
    _modalEl.querySelector('.sds-modal-body').value    = body;
    _modalEl.classList.add('sds-modal-show');
  }

  /* ══════════════════════════════════════
   *  DOM ヘルパ
   * ══════════════════════════════════════ */
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function h(tag, attrs) {
    var children = Array.prototype.slice.call(arguments, 2);
    var el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(function(kv) {
      var k = kv[0], v = kv[1];
      if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v);
    });
    children.forEach(function(c) {
      if (c == null) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  function badge(lbl, type) {
    return h('span', { class: 'sds-badge sds-badge-' + type }, lbl);
  }
  function linkNote(lbl) {
    return h('span', { class: 'sds-linked' }, '🔗 連携: ' + lbl);
  }
  function errMsg(msg) {
    return h('p', { class: 'sds-errmsg' }, msg);
  }
  function btn(lbl, cls, fn) {
    return h('button', { class: 'sds-btn ' + cls, onClick: fn }, lbl);
  }
  function inp(ph, type) {
    var el = h('input', { class: 'sds-input', placeholder: ph });
    if (type) el.type = type;
    return el;
  }
  function selEl(options) {
    var sel = h('select', { class: 'sds-select' });
    if (!options.length) {
      var o = document.createElement('option');
      o.value = ''; o.textContent = '（候補なし）'; o.disabled = true; o.selected = true;
      sel.appendChild(o);
    } else {
      options.forEach(function(opt) {
        var o = document.createElement('option');
        o.value = opt.value; o.textContent = opt.label; sel.appendChild(o);
      });
    }
    return sel;
  }
  function card(title) {
    var contents = Array.prototype.slice.call(arguments, 1);
    return h.apply(null, ['div', { class: 'sds-card' }, h('div', { class: 'sds-card-title' }, title)].concat(contents));
  }
  function infoRow(key, val) {
    return h('div', { class: 'sds-info-row' },
      h('span', { class: 'sds-info-key' }, key), h('span', {}, val));
  }
  function feeTabBtn(label, key, currentTab, onClick) {
    return h('button', {
      class: 'sds-fee-tab-btn' + (currentTab === key ? ' active' : ''),
      onClick: onClick,
    }, label);
  }

  /* ══════════════════════════════════════
   *  講師管理（複数登録対応）
   * ══════════════════════════════════════ */
  function buildTeacherMgmt(root) {
    var addMode = false;
    var BADGE  = { '登録済':'info', '稼働中':'ok', '休止中':'warn', '退職済':'danger' };
    var TRANS  = {
      '登録済': { '稼働開始': '稼働中' },
      '稼働中': { '休止': '休止中', '退職': '退職済' },
      '休止中': { '稼働再開': '稼働中' },
    };

    function publishTeachers() {
      Store.activeTeachers = Store.teachers
        .filter(function(t) { return t.state === '稼働中'; })
        .map(function(t) { return { id: t.id, name: t.name }; });
      EventBus.emit('store:teachers-updated', {});
      log('🔗 連携[1] 稼働講師リスト更新 (' + Store.activeTeachers.length + '名)', 'link');
    }

    function doTransition(t, ev) {
      var next = (TRANS[t.state] || {})[ev];
      if (!next) { log('[teacher] 無効遷移: ' + t.state + ' → ' + ev); return; }
      log('[teacher:' + t.name + '] ' + t.state + ' → ' + next);
      t.state = next; publishTeachers(); render();
    }

    function renderCard(t) {
      var wrap = h('div', { class: 'sds-entity-card' });
      var head = h('div', { class: 'sds-entity-head' });
      head.appendChild(h('span', { class: 'sds-entity-name' }, t.name));
      head.appendChild(badge(t.state, BADGE[t.state] || 'idle'));
      wrap.appendChild(head);
      var acts = h('div', { class: 'sds-entity-actions' });
      if (t.state === '登録済')
        acts.appendChild(btn('稼働開始', 'sds-btn-success sds-btn-sm', function() { doTransition(t, '稼働開始'); }));
      if (t.state === '稼働中') {
        acts.appendChild(btn('休止',   'sds-btn-warning sds-btn-sm', function() { doTransition(t, '休止'); }));
        acts.appendChild(btn('退職',   'sds-btn-danger sds-btn-sm',  function() { doTransition(t, '退職'); }));
      }
      if (t.state === '休止中')
        acts.appendChild(btn('稼働再開', 'sds-btn-success sds-btn-sm', function() { doTransition(t, '稼働再開'); }));
      if (t.state !== '退職済')
        acts.appendChild(btn('削除', 'sds-btn-ghost sds-btn-sm', function() {
          Store.teachers = Store.teachers.filter(function(x) { return x.id !== t.id; });
          publishTeachers(); render();
        }));
      wrap.appendChild(acts);
      return wrap;
    }

    function render() {
      root.innerHTML = '';
      root.appendChild(linkNote('稼働状態 → 講師割当の候補リスト'));
      var activeCount = Store.teachers.filter(function(t) { return t.state === '稼働中'; }).length;
      root.appendChild(badge('登録: ' + Store.teachers.length + '名 / 稼働中: ' + activeCount + '名', 'info'));
      Store.teachers.forEach(function(t) { root.appendChild(renderCard(t)); });

      if (addMode) {
        var nameI = inp('講師名を入力');
        root.appendChild(nameI);
        var errEl = null;
        root.appendChild(btn('登録', 'sds-btn-primary', function() {
          if (errEl) { errEl.remove(); errEl = null; }
          var name = nameI.value.trim();
          if (!name) { errEl = errMsg('⚠ 講師名は必須です'); root.appendChild(errEl); return; }
          Store.teachers.push({ id: uid(), name: name, state: '登録済' });
          log('講師登録: ' + name);
          addMode = false; publishTeachers(); render();
        }));
        root.appendChild(btn('キャンセル', 'sds-btn-ghost', function() { addMode = false; render(); }));
      } else {
        root.appendChild(btn('＋ 講師を追加', 'sds-btn-primary', function() { addMode = true; render(); }));
      }
    }
    render();
  }

  /* ══════════════════════════════════════
   *  講師割当
   * ══════════════════════════════════════ */
  function buildTeacherAssign(root) {
    var state = '未割当';
    var _r = null;
    EventBus.on('store:teachers-updated', function() { if (_r) _r(); });

    function checkBoth() {
      if (Store.teacherAssigned && Store.roomAssigned) {
        EventBus.emit('store:both-assigned', {});
        log('🔗 連携[3] 講師＋教室揃い → 通知自動作成', 'link');
      }
    }

    function render() {
      root.innerHTML = '';
      root.appendChild(badge('状態: ' + state, state === '割当済' ? 'ok' : 'idle'));
      root.appendChild(linkNote('稼働中の講師のみ表示'));

      if (state === '未割当') {
        root.appendChild(h('label', { class: 'sds-label' }, '稼働中の講師を選択'));
        var active = Store.activeTeachers;
        var sel = selEl(active.map(function(t) { return { value: t.id, label: t.name }; }));
        root.appendChild(sel);
        if (!active.length)
          root.appendChild(h('p', { class: 'sds-hint' }, '※ 先に「講師管理」で稼働開始してください'));
        var errEl = null;
        var ab = btn('割当', 'sds-btn-primary', function() {
          if (errEl) { errEl.remove(); errEl = null; }
          if (!sel.value) { errEl = errMsg('⚠ 講師を選択してください'); root.appendChild(errEl); return; }
          Store.assignedTeacherId = sel.value;
          Store.teacherAssigned = true;
          state = '割当済';
          log('[teacher-assign] 未割当 → 割当済');
          checkBoth(); render();
        });
        if (!active.length) ab.disabled = true;
        root.appendChild(ab);
      }

      if (state === '割当済') {
        var t = Store.activeTeachers.find(function(x) { return x.id === Store.assignedTeacherId; });
        root.appendChild(infoRow('担当講師', t ? t.name : '（不明）'));
        root.appendChild(btn('解除', 'sds-btn-danger', function() {
          Store.assignedTeacherId = null;
          Store.teacherAssigned = false;
          state = '未割当';
          log('[teacher-assign] 割当済 → 未割当');
          render();
        }));
      }
    }
    _r = render; render();
  }

  /* ══════════════════════════════════════
   *  教室管理（複数登録対応）
   * ══════════════════════════════════════ */
  function buildRoomMgmt(root) {
    var addMode = false;
    var BADGE = { '使用可能':'info', '使用中':'ok', '停止中':'warn' };
    var TRANS = {
      '使用可能': { '使用開始': '使用中', '停止': '停止中' },
      '使用中':   { '停止': '停止中' },
      '停止中':   { '使用再開': '使用可能' },
    };

    function publishRooms() {
      Store.availableRooms = Store.rooms
        .filter(function(r) { return r.state === '使用可能' || r.state === '使用中'; })
        .map(function(r) { return { id: r.id, name: r.name }; });
      EventBus.emit('store:rooms-updated', {});
      log('🔗 連携[2] 使用可能教室更新 (' + Store.availableRooms.length + '室)', 'link');
    }

    function doTransition(r, ev) {
      var next = (TRANS[r.state] || {})[ev];
      if (!next) { log('[room] 無効遷移: ' + r.state + ' → ' + ev); return; }
      log('[room:' + r.name + '] ' + r.state + ' → ' + next);
      r.state = next; publishRooms(); render();
    }

    function renderCard(r) {
      var wrap = h('div', { class: 'sds-entity-card' });
      var head = h('div', { class: 'sds-entity-head' });
      head.appendChild(h('span', { class: 'sds-entity-name' }, r.name));
      head.appendChild(badge(r.state, BADGE[r.state] || 'idle'));
      wrap.appendChild(head);
      var acts = h('div', { class: 'sds-entity-actions' });
      if (r.state === '使用可能') {
        acts.appendChild(btn('使用開始', 'sds-btn-success sds-btn-sm', function() { doTransition(r, '使用開始'); }));
        acts.appendChild(btn('停止', 'sds-btn-warning sds-btn-sm', function() { doTransition(r, '停止'); }));
      }
      if (r.state === '使用中')
        acts.appendChild(btn('停止', 'sds-btn-warning sds-btn-sm', function() { doTransition(r, '停止'); }));
      if (r.state === '停止中')
        acts.appendChild(btn('使用再開', 'sds-btn-success sds-btn-sm', function() { doTransition(r, '使用再開'); }));
      acts.appendChild(btn('削除', 'sds-btn-ghost sds-btn-sm', function() {
        Store.rooms = Store.rooms.filter(function(x) { return x.id !== r.id; });
        publishRooms(); render();
      }));
      wrap.appendChild(acts);
      return wrap;
    }

    function render() {
      root.innerHTML = '';
      root.appendChild(linkNote('使用可能状態 → 教室割当の候補リスト'));
      var availCount = Store.rooms.filter(function(r) { return r.state === '使用可能' || r.state === '使用中'; }).length;
      root.appendChild(badge('登録: ' + Store.rooms.length + '室 / 使用可能: ' + availCount + '室', 'info'));
      Store.rooms.forEach(function(r) { root.appendChild(renderCard(r)); });

      if (addMode) {
        var nameI = inp('教室名を入力');
        root.appendChild(nameI);
        var errEl = null;
        root.appendChild(btn('登録', 'sds-btn-primary', function() {
          if (errEl) { errEl.remove(); errEl = null; }
          var name = nameI.value.trim();
          if (!name) { errEl = errMsg('⚠ 教室名は必須です'); root.appendChild(errEl); return; }
          Store.rooms.push({ id: uid(), name: name, state: '使用可能' });
          log('教室登録: ' + name);
          addMode = false; publishRooms(); render();
        }));
        root.appendChild(btn('キャンセル', 'sds-btn-ghost', function() { addMode = false; render(); }));
      } else {
        root.appendChild(btn('＋ 教室を追加', 'sds-btn-primary', function() { addMode = true; render(); }));
      }
    }
    render();
  }

  /* ══════════════════════════════════════
   *  教室割当
   * ══════════════════════════════════════ */
  function buildRoomAssign(root) {
    var state = '未割当';
    var _r = null;
    EventBus.on('store:rooms-updated', function() { if (_r) _r(); });

    function checkBoth() {
      if (Store.teacherAssigned && Store.roomAssigned) {
        EventBus.emit('store:both-assigned', {});
        log('🔗 連携[3] 講師＋教室揃い → 通知自動作成', 'link');
      }
    }

    function render() {
      root.innerHTML = '';
      root.appendChild(badge('状態: ' + state, state === '割当済' ? 'ok' : 'idle'));
      root.appendChild(linkNote('使用可能な教室のみ表示'));

      if (state === '未割当') {
        root.appendChild(h('label', { class: 'sds-label' }, '使用可能な教室を選択'));
        var avail = Store.availableRooms;
        var sel = selEl(avail.map(function(r) { return { value: r.id, label: r.name }; }));
        root.appendChild(sel);
        if (!avail.length)
          root.appendChild(h('p', { class: 'sds-hint' }, '※ 先に「教室管理」で登録してください'));
        var errEl = null;
        var ab = btn('割当', 'sds-btn-primary', function() {
          if (errEl) { errEl.remove(); errEl = null; }
          if (!sel.value) { errEl = errMsg('⚠ 教室を選択してください'); root.appendChild(errEl); return; }
          Store.assignedRoomId = sel.value;
          Store.roomAssigned = true;
          state = '割当済';
          log('[room-assign] 未割当 → 割当済');
          checkBoth(); render();
        });
        if (!avail.length) ab.disabled = true;
        root.appendChild(ab);
      }

      if (state === '割当済') {
        var r = Store.availableRooms.find(function(x) { return x.id === Store.assignedRoomId; });
        root.appendChild(infoRow('割当教室', r ? r.name : '（不明）'));
        root.appendChild(btn('解除', 'sds-btn-danger', function() {
          Store.assignedRoomId = null;
          Store.roomAssigned = false;
          state = '未割当';
          log('[room-assign] 割当済 → 未割当');
          render();
        }));
      }
    }
    _r = render; render();
  }

  /* ══════════════════════════════════════
   *  通知管理（トースト＋メール文面モーダル）
   * ══════════════════════════════════════ */
  function buildNotification(root) {
    var state = '未通知';
    var autoReason = '';
    var _r = null;

    EventBus.on('store:both-assigned', function() {
      if (state !== '通知予定') {
        autoReason = '担当講師・教室が確定しました';
        state = '通知予定';
        log('[notification] 未通知 → 通知予定');
        if (_r) _r();
      }
    });
    EventBus.on('store:seat-full', function() {
      if (state !== '通知予定') {
        autoReason = '座席が満席になりました';
        state = '通知予定';
        log('[notification] → 通知予定（満席）');
        if (_r) _r();
      }
    });

    function buildMailBody(reason) {
      var t = Store.activeTeachers.find(function(x) { return x.id === Store.assignedTeacherId; });
      var r = Store.availableRooms.find(function(x) { return x.id === Store.assignedRoomId; });
      var subject = '【塾からのお知らせ】' + reason;
      var body = '保護者の皆様\n\nいつもお世話になっております。\n\n【お知らせ内容】\n' + reason
        + '\n\n【担当講師】' + (t ? t.name : '（未割当）')
        + '\n【使用教室】' + (r ? r.name : '（未割当）')
        + '\n【日時】　　' + new Date().toLocaleString('ja-JP')
        + '\n\nご不明な点がございましたら、お気軽にご連絡ください。\n\n――――――――――――――――――――\n塾管理システム　自動通知\n――――――――――――――――――――';
      return { subject: subject, body: body };
    }

    function doSend(reason) {
      Store.history.unshift({ at: new Date().toLocaleString('ja-JP'), reason: reason });
      EventBus.emit('store:history-updated', {});
      toast('🔔 通知完了: ' + reason, 'success');
      log('🔔 通知: ' + reason);
      var mb = buildMailBody(reason);
      showMailModal(mb.subject, mb.body);
    }

    function render() {
      root.innerHTML = '';
      root.appendChild(badge('状態: ' + state, state === '送信済' ? 'ok' : state === '通知予定' ? 'info' : 'idle'));
      root.appendChild(linkNote('講師＋教室割当完了 / 満席 で自動作成'));
      root.appendChild(h('div', { class: 'sds-spec-note' }, '📢 通知: トースト＋メール文面生成'));

      if (state === '通知予定' && autoReason)
        root.appendChild(h('div', { class: 'sds-auto-reason' }, '⚡ ' + autoReason + '（自動作成）'));

      if (state === '未通知' || state === '送信済') {
        var ri = inp('通知内容を入力（任意）');
        root.appendChild(ri);
        root.appendChild(btn('通知予定を手動作成', 'sds-btn-primary', function() {
          autoReason = ri.value.trim() || '手動通知';
          state = '通知予定';
          log('[notification] → 通知予定（手動）');
          render();
        }));
      }

      if (state === '通知予定') {
        root.appendChild(infoRow('内容', autoReason || '（未設定）'));
        root.appendChild(btn('送信 ＋ メール文面を表示', 'sds-btn-success', function() {
          var reason = autoReason || '通知';
          state = '送信済';
          autoReason = '';
          log('[notification] 通知予定 → 送信済');
          doSend(reason); render();
        }));
        root.appendChild(btn('キャンセル', 'sds-btn-ghost', function() {
          state = '未通知'; autoReason = '';
          log('[notification] 通知予定 → 未通知');
          render();
        }));
      }
    }
    _r = render; render();
  }

  /* ══════════════════════════════════════
   *  連絡先管理
   * ══════════════════════════════════════ */
  function buildContact(root) {
    function render() {
      root.innerHTML = '';
      root.appendChild(badge('登録件数: ' + Store.contacts.length, 'info'));
      root.appendChild(h('label', { class: 'sds-label' }, '保護者名'));
      var nameI = inp('例: 山田 花子');
      root.appendChild(nameI);
      root.appendChild(h('label', { class: 'sds-label' }, '電話番号'));
      var telI = inp('例: 090-0000-0000', 'tel');
      root.appendChild(telI);
      root.appendChild(h('label', { class: 'sds-label' }, 'メールアドレス'));
      var mailI = inp('例: hanako@example.com', 'email');
      root.appendChild(mailI);
      var errEl = null;
      root.appendChild(btn('追加', 'sds-btn-primary', function() {
        if (errEl) { errEl.remove(); errEl = null; }
        if (!nameI.value.trim()) { errEl = errMsg('⚠ 保護者名は必須です'); root.appendChild(errEl); return; }
        Store.contacts.push({ id: uid(), name: nameI.value.trim(), tel: telI.value.trim(), mail: mailI.value.trim() });
        log('連絡先追加: ' + nameI.value.trim()); render();
      }));
      if (Store.contacts.length) {
        root.appendChild(h('div', { class: 'sds-card-title', style: 'margin-top:14px;' }, '登録済み連絡先'));
        Store.contacts.forEach(function(c) {
          root.appendChild(h('div', { class: 'sds-contact-row' },
            h('div', { class: 'sds-contact-info' },
              h('strong', {}, c.name),
              c.tel  ? h('span', { class: 'sds-contact-sub' }, '📞 ' + c.tel)  : null,
              c.mail ? h('span', { class: 'sds-contact-sub' }, '✉ ' + c.mail) : null
            ),
            btn('削除', 'sds-btn-danger', function() {
              Store.contacts = Store.contacts.filter(function(x) { return x.id !== c.id; });
              log('連絡先削除: ' + c.name); render();
            })
          ));
        });
      }
    }
    render();
  }

  /* ══════════════════════════════════════
   *  連絡履歴
   * ══════════════════════════════════════ */
  function buildContactHistory(root) {
    var _r = null;
    EventBus.on('store:history-updated', function() { if (_r) _r(); });
    function render() {
      root.innerHTML = '';
      root.appendChild(badge('履歴件数: ' + Store.history.length, 'info'));
      if (!Store.history.length) {
        root.appendChild(h('p', { style: 'color:var(--sds-muted);font-size:12px;margin-top:8px;' }, '通知を送信すると履歴が表示されます。'));
        return;
      }
      Store.history.forEach(function(rec) {
        root.appendChild(h('div', { class: 'sds-history-row' },
          h('span', { class: 'sds-history-at' }, rec.at),
          h('span', { class: 'sds-history-body' }, rec.reason)
        ));
      });
      root.appendChild(btn('履歴をクリア', 'sds-btn-ghost', function() {
        Store.history = []; log('連絡履歴をクリア'); render();
      }));
    }
    _r = render; render();
  }

  /* ══════════════════════════════════════
   *  月謝調整
   *  計算式: 月謝 = 科目単価 + コース単価 + 学年単価（3軸の単純加算）
   *  生徒リストは Store.feeStudents に保存（座席制御と共有）
   * ══════════════════════════════════════ */
  function buildFeeAdjust(root) {
    var FeeData = {
      subjects: [
        { label: '数学', price: 5000 },
        { label: '英語', price: 5000 },
        { label: '理科', price: 4000 },
        { label: '国語', price: 4000 },
      ],
      courses: [
        { label: '週1回', price: 0    },
        { label: '週2回', price: 3000 },
        { label: '週3回', price: 6000 },
      ],
      grades: [
        { label: '中1', price: 0    },
        { label: '中2', price: 0    },
        { label: '中3', price: 2000 },
        { label: '高1', price: 3000 },
        { label: '高2', price: 3000 },
        { label: '高3', price: 5000 },
      ],
    };

    var currentTab = 'price';

    function calcFee(sLbl, cLbl, gLbl) {
      var s = FeeData.subjects.find(function(x) { return x.label === sLbl; });
      var c = FeeData.courses.find(function(x) { return x.label === cLbl; });
      var g = FeeData.grades.find(function(x) { return x.label === gLbl; });
      return (s ? s.price : 0) + (c ? c.price : 0) + (g ? g.price : 0);
    }

    function renderTabs(wrap) {
      var tabs = [{ key:'price', label:'① 単価設定' }, { key:'student', label:'② 生徒登録' }, { key:'list', label:'③ 月謝一覧' }];
      var nav = h('div', { class: 'sds-fee-tabs' });
      tabs.forEach(function(t) {
        nav.appendChild(h('button', {
          class: 'sds-fee-tab-btn' + (currentTab === t.key ? ' active' : ''),
          onClick: function() { currentTab = t.key; render(); },
        }, t.label));
      });
      wrap.appendChild(nav);
    }

    function renderPriceTab(wrap) {
      wrap.appendChild(h('p', { class: 'sds-fee-desc' }, '科目・コース・学年それぞれに単価を設定します。月謝 = 3つの合計です。'));
      function renderGroup(title, list) {
        wrap.appendChild(h('div', { class: 'sds-fee-group-title' }, title));
        list.forEach(function(item) {
          var row = h('div', { class: 'sds-fee-price-row' });
          row.appendChild(h('span', { class: 'sds-fee-price-label' }, item.label));
          var ni = h('input', { class: 'sds-matrix-input' });
          ni.type = 'number'; ni.min = '0'; ni.step = '500'; ni.value = String(item.price);
          ni.addEventListener('input', function() { item.price = parseInt(ni.value) || 0; });
          row.appendChild(ni);
          row.appendChild(h('span', { class: 'sds-fee-yen' }, '円 / 月'));
          wrap.appendChild(row);
        });
      }
      renderGroup('科目単価', FeeData.subjects);
      renderGroup('コース単価（週1を0円として追加額）', FeeData.courses);
      renderGroup('学年単価（中1を0円として追加額）', FeeData.grades);
      wrap.appendChild(h('div', { class: 'sds-fee-formula' },
        h('span', { class: 'sds-fee-formula-label' }, '計算式'),
        h('span', { class: 'sds-fee-formula-body' }, '月謝 = 科目単価 ＋ コース単価 ＋ 学年単価')
      ));
      var eg = calcFee('数学', '週2回', '中3');
      var sP = FeeData.subjects.find(function(x){ return x.label==='数学'; }).price;
      var cP = FeeData.courses.find(function(x){ return x.label==='週2回'; }).price;
      var gP = FeeData.grades.find(function(x){ return x.label==='中3'; }).price;
      wrap.appendChild(h('div', { class: 'sds-fee-example' },
        '例）数学（週2回・中3）= ¥' + sP.toLocaleString() + ' ＋ ¥' + cP.toLocaleString() + ' ＋ ¥' + gP.toLocaleString() + ' = ¥' + eg.toLocaleString()
      ));
    }

    function renderStudentTab(wrap) {
      wrap.appendChild(h('p', { class: 'sds-fee-desc' }, '生徒を登録します。ここの生徒リストは「座席制御」タブの予約にも使えます。'));
      var form = h('div', { class: 'sds-fee-form' });
      form.appendChild(h('label', { class: 'sds-label' }, '生徒名'));
      var nameI = h('input', { class: 'sds-input', placeholder: '例: 山田 太郎' });
      form.appendChild(nameI);

      form.appendChild(h('label', { class: 'sds-label' }, '科目'));
      var subSel = h('select', { class: 'sds-select' });
      FeeData.subjects.forEach(function(s) {
        var o = document.createElement('option'); o.value = s.label; o.textContent = s.label + '（¥' + s.price.toLocaleString() + '）'; subSel.appendChild(o);
      });
      form.appendChild(subSel);

      form.appendChild(h('label', { class: 'sds-label' }, 'コース'));
      var courseSel = h('select', { class: 'sds-select' });
      FeeData.courses.forEach(function(c) {
        var o = document.createElement('option'); o.value = c.label; o.textContent = c.label + '（+¥' + c.price.toLocaleString() + '）'; courseSel.appendChild(o);
      });
      form.appendChild(courseSel);

      form.appendChild(h('label', { class: 'sds-label' }, '学年'));
      var gradeSel = h('select', { class: 'sds-select' });
      FeeData.grades.forEach(function(g) {
        var o = document.createElement('option'); o.value = g.label; o.textContent = g.label + '（+¥' + g.price.toLocaleString() + '）'; gradeSel.appendChild(o);
      });
      form.appendChild(gradeSel);

      var preview = h('div', { class: 'sds-fee-preview' });
      function updatePreview() {
        var fee = calcFee(subSel.value, courseSel.value, gradeSel.value);
        preview.innerHTML = '';
        preview.appendChild(h('span', {}, '月謝予定額'));
        preview.appendChild(h('span', { class: 'sds-fee-preview-amt' }, '¥' + fee.toLocaleString()));
      }
      [subSel, courseSel, gradeSel].forEach(function(el) { el.addEventListener('change', updatePreview); });
      updatePreview();
      form.appendChild(preview);

      var errEl = null;
      form.appendChild(btn('登録', 'sds-btn-primary', function() {
        if (errEl) { errEl.remove(); errEl = null; }
        if (!nameI.value.trim()) { errEl = errMsg('⚠ 生徒名は必須です'); form.appendChild(errEl); return; }
        Store.feeStudents.push({ id: uid(), name: nameI.value.trim(), subjectLabel: subSel.value, courseLabel: courseSel.value, gradeLabel: gradeSel.value });
        EventBus.emit('store:students-updated', {});
        log('生徒登録: ' + nameI.value.trim() + ' → ¥' + calcFee(subSel.value, courseSel.value, gradeSel.value).toLocaleString());
        render();
      }));
      wrap.appendChild(form);

      if (Store.feeStudents.length) {
        wrap.appendChild(h('div', { class: 'sds-fee-group-title', style: 'margin-top:14px;' }, '登録済み（' + Store.feeStudents.length + '名）'));
        Store.feeStudents.forEach(function(st) {
          var fee = calcFee(st.subjectLabel, st.courseLabel, st.gradeLabel);
          wrap.appendChild(h('div', { class: 'sds-fee-student-row' },
            h('span', { class: 'sds-fee-student-name' }, st.name),
            h('span', { class: 'sds-fee-student-detail' }, st.subjectLabel + ' / ' + st.courseLabel + ' / ' + st.gradeLabel),
            h('span', { class: 'sds-fee-student-amt' }, '¥' + fee.toLocaleString()),
            btn('削除', 'sds-btn-danger', function() {
              Store.feeStudents = Store.feeStudents.filter(function(x) { return x.id !== st.id; });
              EventBus.emit('store:students-updated', {});
              log('生徒削除: ' + st.name); render();
            })
          ));
        });
      }
    }

    function renderListTab(wrap) {
      wrap.appendChild(h('p', { class: 'sds-fee-desc' }, '登録済み生徒の月謝計算結果です。単価設定を変更すると再計算されます。'));
      if (!Store.feeStudents.length) {
        wrap.appendChild(h('p', { class: 'sds-hint' }, '※ 先に「② 生徒登録」で生徒を登録してください'));
        return;
      }
      var table = h('table', { class: 'sds-matrix-table' });
      var thead = h('thead', {}); var hRow = h('tr', {});
      ['生徒名','科目','コース','学年','科目単価','コース単価','学年単価','合計月謝'].forEach(function(t) {
        hRow.appendChild(h('th', { class: 'sds-matrix-th' }, t));
      });
      thead.appendChild(hRow); table.appendChild(thead);
      var tbody = h('tbody', {}); var grandTotal = 0;
      Store.feeStudents.forEach(function(st) {
        var s = FeeData.subjects.find(function(x) { return x.label === st.subjectLabel; }) || { price: 0 };
        var c = FeeData.courses.find(function(x) { return x.label === st.courseLabel; })   || { price: 0 };
        var g = FeeData.grades.find(function(x) { return x.label === st.gradeLabel; })     || { price: 0 };
        var fee = s.price + c.price + g.price; grandTotal += fee;
        var tr = h('tr', {});
        [st.name, st.subjectLabel, st.courseLabel, st.gradeLabel,
          '¥' + s.price.toLocaleString(), '¥' + c.price.toLocaleString(), '¥' + g.price.toLocaleString()
        ].forEach(function(val, i) {
          tr.appendChild(h('td', { class: i === 0 ? 'sds-matrix-td sds-matrix-label' : 'sds-matrix-td' }, val));
        });
        tr.appendChild(h('td', { class: 'sds-matrix-td sds-matrix-grand' }, '¥' + fee.toLocaleString()));
        tbody.appendChild(tr);
      });
      var totalRow = h('tr', {});
      ['合計','','','','','',''].forEach(function(v) { totalRow.appendChild(h('td', { class: 'sds-matrix-td sds-matrix-label' }, v)); });
      totalRow.appendChild(h('td', { class: 'sds-matrix-td sds-matrix-grand', style: 'font-size:15px;' }, '¥' + grandTotal.toLocaleString()));
      tbody.appendChild(totalRow); table.appendChild(tbody);
      wrap.appendChild(h('div', { style: 'overflow-x:auto;' }, table));
      wrap.appendChild(h('div', { class: 'sds-fee-grand' },
        h('span', {}, '全生徒 月謝合計（' + Store.feeStudents.length + '名）'),
        h('span', { class: 'sds-fee-grand-amt' }, '¥' + grandTotal.toLocaleString())
      ));
    }

    function render() {
      root.innerHTML = '';
      root.appendChild(badge('月謝調整', 'info'));
      var wrap = h('div', {});
      renderTabs(wrap);
      var content = h('div', { class: 'sds-fee-content' });
      if (currentTab === 'price')   renderPriceTab(content);
      if (currentTab === 'student') renderStudentTab(content);
      if (currentTab === 'list')    renderListTab(content);
      wrap.appendChild(content);
      root.appendChild(wrap);
    }
    render();
  }

  /* ══════════════════════════════════════
   *  座席制御（授業コマ予約＋空き状況可視化）
   *  予約生徒は Store.feeStudents から選択（月謝タブと共有）
   * ══════════════════════════════════════ */
  function buildSeat(root) {
    var Slots = { list: [
      { id: 'SL001', day: '月', time: '16:00', subject: '数学', capacity: 6,
        bookings: ['山田 太郎', '田中 花子', '鈴木 次郎'] },
      { id: 'SL002', day: '水', time: '17:00', subject: '英語', capacity: 5,
        bookings: ['佐藤 さくら', '山田 太郎'] },
      { id: 'SL003', day: '金', time: '18:00', subject: '理科', capacity: 4,
        bookings: ['田中 花子', '鈴木 次郎', '佐藤 さくら', '山田 太郎'] },
      { id: 'SL004', day: '土', time: '10:00', subject: '国語', capacity: 8,
        bookings: ['田中 花子'] },
    ] };
    var DAYS    = ['月','火','水','木','金','土','日'];
    var TIMES   = ['9:00','10:00','11:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'];
    var SUBJECTS = ['数学','英語','理科','国語','社会','小論文'];
    var showAddForm = false;
    var _r = null;
    EventBus.on('store:students-updated', function() { if (_r) _r(); });

    function slotStatus(slot) {
      var r = slot.capacity - slot.bookings.length;
      return { remain: r, full: r <= 0, badgeType: r <= 0 ? 'danger' : r <= 2 ? 'warn' : 'ok',
               badgeLabel: r <= 0 ? '満席' : '空き ' + r + '/' + slot.capacity };
    }

    function renderSlotCard(slot) {
      var st = slotStatus(slot);
      var pct = Math.min(100, Math.round(slot.bookings.length / slot.capacity * 100));
      var c = h('div', { class: 'sds-slot-card' });
      var head = h('div', { class: 'sds-slot-head' });
      head.appendChild(h('span', { class: 'sds-slot-title' }, slot.day + '曜 ' + slot.time + ' ／ ' + slot.subject));
      head.appendChild(badge(st.badgeLabel, st.badgeType));
      head.appendChild(btn('削除', 'sds-btn-ghost sds-btn-sm', function() {
        Slots.list = Slots.list.filter(function(s) { return s.id !== slot.id; });
        log('コマ削除: ' + slot.day + '曜 ' + slot.time + ' ' + slot.subject); render();
      }));
      c.appendChild(head);
      var pw = h('div', { class: 'sds-progress-wrap' });
      var pb = h('div', { class: 'sds-progress-bar' });
      pb.style.width      = pct + '%';
      pb.style.background = st.full ? 'var(--sds-danger)' : pct >= 70 ? 'var(--sds-warning)' : 'var(--sds-success)';
      pw.appendChild(pb); c.appendChild(pw);
      if (slot.bookings.length) {
        var bl = h('div', { class: 'sds-booking-list' });
        slot.bookings.forEach(function(name, i) {
          bl.appendChild(h('div', { class: 'sds-booking-row' },
            h('span', { class: 'sds-booking-num' }, String(i + 1)),
            h('span', { class: 'sds-booking-name' }, name),
            btn('キャンセル', 'sds-btn-danger sds-btn-sm', function() {
              slot.bookings.splice(i, 1);
              log('予約キャンセル: ' + slot.day + '曜 ' + slot.time + ' / ' + name); render();
            })
          ));
        });
        c.appendChild(bl);
      } else {
        c.appendChild(h('p', { class: 'sds-slot-empty' }, '予約なし'));
      }
      if (!st.full) {
        var addRow = h('div', { class: 'sds-booking-add-row' });
        var students = Store.feeStudents;
        var nameInput;
        if (students.length) {
          var sel = h('select', { class: 'sds-select sds-select-inline' });
          var blank = document.createElement('option');
          blank.value = ''; blank.textContent = '生徒を選択...'; sel.appendChild(blank);
          students.forEach(function(s) {
            var o = document.createElement('option'); o.value = s.name; o.textContent = s.name;
            if (slot.bookings.indexOf(s.name) >= 0) { o.textContent += '（予約済）'; o.disabled = true; }
            sel.appendChild(o);
          });
          nameInput = sel;
        } else {
          nameInput = h('input', { class: 'sds-input sds-input-inline', placeholder: '生徒名を入力（月謝タブで登録すると選択式になります）' });
        }
        addRow.appendChild(nameInput);
        var errEl = null;
        addRow.appendChild(btn('予約', 'sds-btn-success sds-btn-sm', function() {
          if (errEl) { errEl.remove(); errEl = null; }
          var name = (nameInput.value || '').trim();
          if (!name) { errEl = errMsg('⚠ 生徒を選択してください'); c.appendChild(errEl); return; }
          if (slot.bookings.indexOf(name) >= 0) { errEl = errMsg('⚠ ' + name + ' はすでに予約済みです'); c.appendChild(errEl); return; }
          slot.bookings.push(name);
          log('予約追加: ' + slot.day + '曜 ' + slot.time + ' ' + slot.subject + ' / ' + name);
          if (slot.bookings.length >= slot.capacity) {
            EventBus.emit('store:seat-full', { slot: slot });
            log('🔗 連携[4] 満席: ' + slot.day + '曜 ' + slot.time + ' ' + slot.subject + ' → 通知自動作成', 'link');
          }
          render();
        }));
        c.appendChild(addRow);
      }
      return c;
    }

    function renderAddForm(wrap) {
      var form = h('div', { class: 'sds-slot-form' });
      form.appendChild(h('div', { class: 'sds-fee-group-title' }, '新しいコマを追加'));
      form.appendChild(h('label', { class: 'sds-label' }, '曜日'));
      var daySel = h('select', { class: 'sds-select' });
      DAYS.forEach(function(d) { var o = document.createElement('option'); o.value = d; o.textContent = d + '曜日'; daySel.appendChild(o); });
      form.appendChild(daySel);
      form.appendChild(h('label', { class: 'sds-label' }, '開始時間'));
      var timeSel = h('select', { class: 'sds-select' });
      TIMES.forEach(function(t) { var o = document.createElement('option'); o.value = t; o.textContent = t; timeSel.appendChild(o); });
      form.appendChild(timeSel);
      form.appendChild(h('label', { class: 'sds-label' }, '科目'));
      var subSel = h('select', { class: 'sds-select' });
      SUBJECTS.forEach(function(s) { var o = document.createElement('option'); o.value = s; o.textContent = s; subSel.appendChild(o); });
      form.appendChild(subSel);
      form.appendChild(h('label', { class: 'sds-label' }, '定員（人）'));
      var capI = h('input', { class: 'sds-input' }); capI.type = 'number'; capI.min = '1'; capI.max = '20'; capI.value = '6';
      form.appendChild(capI);
      var errEl = null;
      var btnRow = h('div', { style: 'display:flex;gap:6px;margin-top:4px;' });
      btnRow.appendChild(btn('追加', 'sds-btn-primary', function() {
        if (errEl) { errEl.remove(); errEl = null; }
        var cap = parseInt(capI.value) || 0;
        if (cap < 1) { errEl = errMsg('⚠ 定員は1以上にしてください'); form.appendChild(errEl); return; }
        var dup = Slots.list.find(function(s) { return s.day === daySel.value && s.time === timeSel.value && s.subject === subSel.value; });
        if (dup) { errEl = errMsg('⚠ 同じ曜日・時間・科目のコマが既に存在します'); form.appendChild(errEl); return; }
        Slots.list.push({ id: uid(), day: daySel.value, time: timeSel.value, subject: subSel.value, capacity: cap, bookings: [] });
        log('コマ追加: ' + daySel.value + '曜 ' + timeSel.value + ' ' + subSel.value + ' 定員' + cap + '名');
        showAddForm = false; render();
      }));
      btnRow.appendChild(btn('キャンセル', 'sds-btn-ghost', function() { showAddForm = false; render(); }));
      form.appendChild(btnRow); wrap.appendChild(form);
    }

    function renderSummary(wrap) {
      if (!Slots.list.length) return;
      var total     = Slots.list.reduce(function(s, sl) { return s + sl.capacity; }, 0);
      var booked    = Slots.list.reduce(function(s, sl) { return s + sl.bookings.length; }, 0);
      var fullCount = Slots.list.filter(function(sl) { return sl.bookings.length >= sl.capacity; }).length;
      var bar = h('div', { class: 'sds-seat-summary' });
      [[String(Slots.list.length), 'コマ'], [booked + '/' + total, '予約数/定員計'], [String(fullCount), '満席コマ']].forEach(function(item, i) {
        var el = h('div', { class: 'sds-seat-summary-item' + (i === 2 && fullCount ? ' sds-seat-summary-full' : '') });
        el.appendChild(h('span', { class: 'sds-seat-summary-num' }, item[0]));
        el.appendChild(h('span', { class: 'sds-seat-summary-label' }, item[1]));
        bar.appendChild(el);
      });
      wrap.appendChild(bar);
    }

    function render() {
      root.innerHTML = '';
      root.appendChild(linkNote('満席 → 通知自動作成'));
      var stCount = Store.feeStudents.length;
      root.appendChild(h('div', { style: 'font-size:11px;color:var(--sds-muted);margin-bottom:8px;' },
        stCount ? '👤 月謝タブの生徒 ' + stCount + '名 を予約選択肢として使用しています'
                : '👤 月謝調整タブで生徒を登録すると、予約がセレクト選択式になります'));
      renderSummary(root);
      var sorted = Slots.list.slice().sort(function(a, b) {
        var di = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
        return di !== 0 ? di : TIMES.indexOf(a.time) - TIMES.indexOf(b.time);
      });
      if (!sorted.length) {
        root.appendChild(h('p', { style: 'color:var(--sds-muted);font-size:12px;margin:12px 0;' }, '授業コマがまだ登録されていません。「＋ コマを追加」から登録してください。'));
      } else {
        sorted.forEach(function(slot) { root.appendChild(renderSlotCard(slot)); });
      }
      if (showAddForm) {
        renderAddForm(root);
      } else {
        root.appendChild(btn('＋ コマを追加', 'sds-btn-primary', function() { showAddForm = true; render(); }));
      }
    }
    _r = render; render();
  }

  /* ══════════════════════════════════════
   *  設定反映
   * ══════════════════════════════════════ */
  function buildSettings(root) {
    var state = '要確認';
    var COMPONENTS = ['講師管理','講師割当','教室管理','教室割当','通知','月謝調整','座席制御'];
    var checked = new Set(COMPONENTS);
    function render() {
      root.innerHTML = '';
      root.appendChild(badge('状態: ' + state, state === '確認済' ? 'ok' : state === '除外済' ? 'warn' : 'info'));
      if (state !== '除外済') {
        root.appendChild(h('div', { class: 'sds-card-title', style: 'margin-top:4px;' }, '設定反映対象コンポーネント'));
        COMPONENTS.forEach(function(name) {
          var chk = h('input', { type: 'checkbox', id: 'chk-' + name });
          chk.checked = checked.has(name);
          chk.addEventListener('change', function() { if (chk.checked) checked.add(name); else checked.delete(name); });
          root.appendChild(h('div', { class: 'sds-check-row' }, chk, h('label', { for: 'chk-' + name }, name)));
        });
      }
      if (state === '要確認') {
        root.appendChild(btn('影響範囲確認', 'sds-btn-primary', function() {
          state = '確認済'; log('設定反映対象: ' + Array.from(checked).join(', ')); render();
        }));
        root.appendChild(btn('反映除外', 'sds-btn-ghost', function() { state = '除外済'; render(); }));
      }
      if (state === '確認済') {
        root.appendChild(infoRow('反映対象数', checked.size + ' コンポーネント'));
        root.appendChild(infoRow('対象', Array.from(checked).join(', ')));
        root.appendChild(btn('反映除外', 'sds-btn-warning', function() { state = '除外済'; render(); }));
      }
      if (state === '除外済') root.appendChild(badge('除外済 — 操作不可', 'warn'));
    }
    render();
  }

  /* ══════════════════════════════════════
   *  状態駆動UIエンジン（SDS → UI自動誘導）
   *  - Storeを読み、現在の業務状態を推定
   *  - 次に操作すべきタブ・CTA・理由を返す
   *  - 既存タブUIを壊さず、上位にガイドを重ねる
   * ══════════════════════════════════════ */
  const WorkflowEngine = (function () {
    const STEPS = [
      { key:'teacherBase',  label:'講師準備',  tab:'teacher-mgmt'   },
      { key:'teacherAssign',label:'講師割当',  tab:'teacher-assign' },
      { key:'roomBase',     label:'教室準備',  tab:'room-mgmt'      },
      { key:'roomAssign',   label:'教室割当',  tab:'room-assign'    },
      { key:'notify',       label:'通知',      tab:'notification'   },
      { key:'student',      label:'生徒登録',  tab:'fee'            },
      { key:'seat',         label:'座席予約',  tab:'seat'           },
      { key:'settings',     label:'設定確認',  tab:'settings'       },
    ];

    function status() {
      const teacherRegistered = Store.teachers.length > 0;
      const teacherActive     = Store.activeTeachers.length > 0;
      const teacherAssigned   = !!Store.teacherAssigned;
      const roomRegistered    = Store.rooms.length > 0;
      const roomAvailable     = Store.availableRooms.length > 0;
      const roomAssigned      = !!Store.roomAssigned;
      const bothAssigned      = teacherAssigned && roomAssigned;
      const hasStudent        = Store.feeStudents.length > 0;
      const hasContact        = Store.contacts.length > 0;

      let next = null;
      if (!teacherRegistered) {
        next = { tab:'teacher-mgmt', title:'まず講師を登録してください', body:'講師がいないため、授業割当を開始できません。', cta:'講師管理へ進む', level:'warn' };
      } else if (!teacherActive) {
        next = { tab:'teacher-mgmt', title:'講師を稼働状態にしてください', body:'登録済み講師はいますが、割当に使える稼働中講師がいません。', cta:'講師管理へ進む', level:'warn' };
      } else if (!teacherAssigned) {
        next = { tab:'teacher-assign', title:'講師を授業に割り当てましょう', body:'稼働中講師がいます。次は担当講師を選択します。', cta:'講師割当へ進む', level:'info' };
      } else if (!roomRegistered) {
        next = { tab:'room-mgmt', title:'教室を登録してください', body:'講師は割当済みですが、教室が未登録です。', cta:'教室管理へ進む', level:'warn' };
      } else if (!roomAvailable) {
        next = { tab:'room-mgmt', title:'使用可能な教室を準備してください', body:'教室はありますが、割当に使える教室がありません。', cta:'教室管理へ進む', level:'warn' };
      } else if (!roomAssigned) {
        next = { tab:'room-assign', title:'教室を授業に割り当てましょう', body:'講師は割当済みです。次は使用教室を選択します。', cta:'教室割当へ進む', level:'info' };
      } else if (bothAssigned) {
        next = { tab:'notification', title:'授業条件が成立しました', body:'講師と教室が揃いました。保護者向け通知を確認できます。', cta:'通知へ進む', level:'ok' };
      }

      const done = {
        teacherBase:   teacherRegistered && teacherActive,
        teacherAssign: teacherAssigned,
        roomBase:      roomRegistered && roomAvailable,
        roomAssign:    roomAssigned,
        notify:        bothAssigned,
        student:       hasStudent,
        seat:          hasStudent,
        settings:      hasContact,
      };

      const completed = Object.keys(done).filter(k => done[k]).length;
      return { next, done, steps: STEPS, completed, total: STEPS.length };
    }

    function render(container, goTab) {
      if (!container) return;
      const s = status();
      const n = s.next;
      container.innerHTML = '';
      const wrap = h('div', { class: 'sds-workflow-card sds-workflow-' + (n ? n.level : 'ok') });
      const head = h('div', { class: 'sds-workflow-head' });
      head.appendChild(h('div', { class: 'sds-workflow-title' }, n ? n.title : '主要フローは完了しています'));
      head.appendChild(h('div', { class: 'sds-workflow-count' }, s.completed + '/' + s.total));
      wrap.appendChild(head);
      wrap.appendChild(h('div', { class: 'sds-workflow-body' }, n ? n.body : '必要に応じて月謝・座席・設定を確認してください。'));

      const meter = h('div', { class: 'sds-workflow-meter' });
      const bar = h('div', { class: 'sds-workflow-meter-bar' });
      bar.style.width = Math.round(s.completed / s.total * 100) + '%';
      meter.appendChild(bar); wrap.appendChild(meter);

      const chips = h('div', { class: 'sds-workflow-steps' });
      s.steps.forEach(function(step) {
        const isDone = !!s.done[step.key];
        const isNext = n && n.tab === step.tab;
        chips.appendChild(h('button', {
          class: 'sds-workflow-step ' + (isDone ? 'done ' : '') + (isNext ? 'next ' : ''),
          onClick: function() { goTab(step.tab); }
        }, (isDone ? '✓ ' : isNext ? '▶ ' : '○ ') + step.label));
      });
      wrap.appendChild(chips);

      if (n) {
        wrap.appendChild(btn(n.cta, 'sds-btn-primary', function() { goTab(n.tab); }));
      }
      container.appendChild(wrap);
    }

    return { status: status, render: render };
  })();

  /* ══════════════════════════════════════
   *  メイン組み立て
   * ══════════════════════════════════════ */
  /* ── ダミーデータ（初期値）── */
  (function() {
    var now = new Date();
    function daysAgo(d) {
      var dt = new Date(now); dt.setDate(dt.getDate() - d);
      return dt.toLocaleString('ja-JP');
    }

    // 講師（5名）
    Store.teachers = [
      { id: 'T001', name: '佐藤 明',   state: '稼働中' },
      { id: 'T002', name: '田中 恵子', state: '稼働中' },
      { id: 'T003', name: '山田 浩',   state: '稼働中' },
      { id: 'T004', name: '鈴木 由美', state: '休止中' },
      { id: 'T005', name: '伊藤 健一', state: '登録済' },
    ];
    Store.activeTeachers = Store.teachers
      .filter(function(t) { return t.state === '稼働中'; })
      .map(function(t) { return { id: t.id, name: t.name }; });

    // 教室（5室）
    Store.rooms = [
      { id: 'R001', name: 'A教室（個別指導）',   state: '使用中' },
      { id: 'R002', name: 'B教室（少人数）',     state: '使用可能' },
      { id: 'R003', name: 'C教室（グループ）',   state: '使用可能' },
      { id: 'R004', name: 'D教室（大教室）',     state: '使用可能' },
      { id: 'R005', name: 'E教室（補習・予備）', state: '停止中' },
    ];
    Store.availableRooms = Store.rooms
      .filter(function(r) { return r.state === '使用可能' || r.state === '使用中'; })
      .map(function(r) { return { id: r.id, name: r.name }; });

    // 連絡先（4名）
    Store.contacts = [
      { id: 'C001', name: '山田 花子', tel: '090-1234-5678', mail: 'hanako.yamada@example.com' },
      { id: 'C002', name: '田中 一郎', tel: '080-9876-5432', mail: 'ichiro.tanaka@example.com' },
      { id: 'C003', name: '鈴木 美穂', tel: '070-1111-2222', mail: 'miho.suzuki@example.com' },
      { id: 'C004', name: '佐藤 太郎', tel: '090-3333-4444', mail: 'taro.sato@example.com' },
    ];

    // 連絡履歴（4件）
    Store.history = [
      { at: daysAgo(0), reason: '担当講師・教室が確定しました' },
      { at: daysAgo(1), reason: '座席が満席になりました' },
      { at: daysAgo(3), reason: '月謝単価を改定しました' },
      { at: daysAgo(7), reason: '夏期講習のご案内' },
    ];

    // 月謝生徒（4名）
    Store.feeStudents = [
      { id: 'ST001', name: '山田 太郎', subjectLabel: '数学', courseLabel: '週2回', gradeLabel: '中3' },
      { id: 'ST002', name: '田中 花子', subjectLabel: '英語', courseLabel: '週1回', gradeLabel: '高1' },
      { id: 'ST003', name: '鈴木 次郎', subjectLabel: '理科', courseLabel: '週3回', gradeLabel: '中2' },
      { id: 'ST004', name: '佐藤 さくら', subjectLabel: '国語', courseLabel: '週2回', gradeLabel: '高3' },
    ];

    })();

  var TABS = [
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

  function initComponent(opts) {
    var mountEl = typeof opts.mountElement === 'string'
      ? document.querySelector(opts.mountElement) : opts.mountElement;
    if (!mountEl) { console.error('[SDS] mountElement not found'); return; }

    var root = h('div', { class: 'sds-root' });
    mountEl.appendChild(root);

    // トースト
    _toastEl = h('div', { class: 'sds-toast' });
    root.appendChild(_toastEl);

    // メール文面モーダル
    _modalEl = h('div', { class: 'sds-modal' });
    var mi = h('div', { class: 'sds-modal-inner' });
    mi.appendChild(h('div', { class: 'sds-modal-title' }, '📧 メール文面'));
    mi.appendChild(h('label', { class: 'sds-label' }, '件名'));
    var subjectEl = h('textarea', { class: 'sds-modal-subject sds-modal-textarea' }); subjectEl.rows = 1; subjectEl.style.resize = 'none';
    mi.appendChild(subjectEl);
    mi.appendChild(h('label', { class: 'sds-label', style: 'margin-top:8px;' }, '本文'));
    var bodyEl = h('textarea', { class: 'sds-modal-body sds-modal-textarea' }); bodyEl.rows = 12;
    mi.appendChild(bodyEl);
    mi.appendChild(btn('📋 本文をコピー', 'sds-btn-success', function() {
      navigator.clipboard.writeText(bodyEl.value).then(function() { toast('📋 コピーしました', 'success'); });
    }));
    mi.appendChild(btn('閉じる', 'sds-btn-ghost', function() { _modalEl.classList.remove('sds-modal-show'); }));
    _modalEl.appendChild(mi);
    _modalEl.addEventListener('click', function(e) { if (e.target === _modalEl) _modalEl.classList.remove('sds-modal-show'); });
    root.appendChild(_modalEl);

    // ヘッダ
    root.appendChild(h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;' },
      h('span', { style: 'font-size:18px;font-weight:700;' }, '塾管理 拡張SDS'),
      badge('Web部品', 'info'), badge('v6', 'ok'), badge('状態駆動UI', 'warn')
    ));

    var workflowGuide = h('div', { class: 'sds-workflow-guide' });
    root.appendChild(workflowGuide);

    var tabNav    = h('div', { class: 'sds-tabs' });
    var panelWrap = h('div', {});
    var panels    = {};
    var tabBtns   = {};

    TABS.forEach(function(tab) {
      var tb = h('button', { class: 'sds-tab-btn', onClick: function() { switchTab(tab.id); } }, tab.label);
      tabNav.appendChild(tb); tabBtns[tab.id] = tb;
      var panel = h('div', { class: 'sds-panel' });
      var cr    = h('div', {});
      panel.appendChild(card(tab.label, cr));
      tab.build(cr);
      panels[tab.id] = panel;
      panelWrap.appendChild(panel);
    });

    function flashTab(id) {
      var b = tabBtns[id]; if (!b) return;
      b.classList.add('sds-tab-flash');
      setTimeout(function() { b.classList.remove('sds-tab-flash'); }, 2000);
    }
    EventBus.on('store:both-assigned', function() { flashTab('notification'); });
    EventBus.on('store:seat-full',     function() { flashTab('notification'); });

    function updateWorkflowUI() {
      WorkflowEngine.render(workflowGuide, switchTab);
      var st = WorkflowEngine.status();
      Object.keys(tabBtns).forEach(function(id) {
        tabBtns[id].classList.remove('sds-tab-done', 'sds-tab-next');
      });
      st.steps.forEach(function(step) {
        if (!tabBtns[step.tab]) return;
        if (st.done[step.key]) tabBtns[step.tab].classList.add('sds-tab-done');
        if (st.next && st.next.tab === step.tab) tabBtns[step.tab].classList.add('sds-tab-next');
      });
    }

    root.addEventListener('click',  function() { setTimeout(updateWorkflowUI, 0); });
    root.addEventListener('change', function() { setTimeout(updateWorkflowUI, 0); });
    ['store:teachers-updated','store:rooms-updated','store:both-assigned','store:seat-full','store:students-updated','store:history-updated'].forEach(function(ev) {
      EventBus.on(ev, function() { setTimeout(updateWorkflowUI, 0); });
    });

    root.appendChild(tabNav);
    root.appendChild(panelWrap);

    // 連携マップ
    root.appendChild(h('div', { class: 'sds-card', style: 'margin-top:16px;' },
      h('div', { class: 'sds-card-title' }, '画面間連携マップ'),
      h('div', { style: 'font-size:11px;color:var(--sds-muted);line-height:2;' },
        h('span', { style: 'color:var(--sds-warning);' }, '🔗'), ' [1] 講師管理（稼働）→ 講師割当（候補）', h('br', {}),
        h('span', { style: 'color:var(--sds-warning);' }, '🔗'), ' [2] 教室管理（使用可能）→ 教室割当（候補）', h('br', {}),
        h('span', { style: 'color:var(--sds-warning);' }, '🔗'), ' [3] 講師＋教室割当済 → 通知自動作成', h('br', {}),
        h('span', { style: 'color:var(--sds-warning);' }, '🔗'), ' [4] 座席満席 → 通知自動作成', h('br', {}),
        h('span', { style: 'color:var(--sds-warning);' }, '🔗'), ' [5] 月謝タブの生徒 → 座席制御の予約に使用'
      )
    ));

    _logEl = h('div', { class: 'sds-log' });
    root.appendChild(h('div', { class: 'sds-card-title', style: 'margin-top:16px;' }, '状態遷移ログ'));
    root.appendChild(_logEl);

    function switchTab(id) {
      Object.keys(panels).forEach(function(k) { panels[k].classList.remove('active'); });
      Object.keys(tabBtns).forEach(function(k) { tabBtns[k].classList.remove('active'); });
      panels[id].classList.add('active');
      tabBtns[id].classList.add('active');
    }



    switchTab(TABS[0].id);
    updateWorkflowUI();
    log('SDS v6 初期化完了（状態駆動UIエンジン統合版）');
  }

  global.SDS = global.SDS || {};
  global.SDS.initComponent = initComponent;
  global.SDS.EventBus      = EventBus;

})(window);
