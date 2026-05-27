/**
 * SDS拡張コンポーネント — component.js
 * 出力モード: Web部品（IIFE・埋め込み型）
 *
 * ■ 画面間連携（v2追加）
 *   [1] 講師管理 → 講師割当   : 稼働中の講師のみ割当候補に表示
 *   [2] 教室管理 → 教室割当   : 使用可能／使用中の教室のみ割当候補に表示
 *   [3] 講師割当＋教室割当 → 通知 : 両方割当済で通知予定を自動作成
 *   [4] 座席制御 → 通知       : 満席になったら自動通知予定を作成
 *
 * ■ Undefined項目（仕様未確定のため未実装）
 *   - 通知手段（メール / SMS / Push など）
 *   - 月謝連動ルール
 *   - 座席制御の予約システム連携方式
 *   - 設定反映の影響範囲定義
 *   - 外部システム連携エンドポイント
 */
(function (global) {
  'use strict';

  /* ─────────────────────────────────────────
   * EventBus
   * ───────────────────────────────────────── */
  const EventBus = (function () {
    const _handlers = {};
    return {
      emit(event, payload) {
        (_handlers[event] || []).forEach(fn => fn(payload));
      },
      on(event, handler) {
        if (!_handlers[event]) _handlers[event] = [];
        _handlers[event].push(handler);
      },
    };
  })();

  /* ─────────────────────────────────────────
   * 画面間共有ストア
   * SDS間の直接参照禁止ルールを守りつつ、
   * EventBus経由でのみ更新される読み取り専用ビュー
   * ───────────────────────────────────────── */
  const Store = {
    // 稼働中の講師リスト { name, id }
    activeTeachers: [],
    // 使用可能な教室リスト { name, id }
    availableRooms: [],
    // 割当状態
    teacherAssigned: false,
    roomAssigned: false,
    // 通知コンポーネントへの再描画コールバック（登録側が注入）
    _notifyRender: null,
  };

  /* ─────────────────────────────────────────
   * ステートマシン ファクトリ
   * ───────────────────────────────────────── */
  function createMachine(name, initial, transitions) {
    let state = initial;
    return {
      get state() { return state; },
      transition(event) {
        const map = transitions[state];
        if (!map || !map[event]) {
          log(`[${name}] 無効遷移: ${state} —✕→ ${event}`);
          return false;
        }
        const next = map[event];
        log(`[${name}] ${state} —${event}→ ${next}`);
        state = next;
        EventBus.emit(`${name}:${event}`, { state, name });
        return true;
      },
    };
  }

  /* ─────────────────────────────────────────
   * ログ
   * ───────────────────────────────────────── */
  let _logEl = null;
  function log(msg, type) {
    const now = new Date().toLocaleTimeString('ja-JP');
    if (_logEl) {
      const div = document.createElement('div');
      div.className = 'sds-log-entry';
      const color = type === 'link' ? 'color:var(--sds-warning);font-weight:700;' : '';
      div.innerHTML = `<span class="ts">${now}</span><span class="ev" style="${color}">${escHtml(msg)}</span>`;
      _logEl.prepend(div);
    }
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ─────────────────────────────────────────
   * DOM ヘルパ
   * ───────────────────────────────────────── */
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

  function badge(label, type) {
    return h('span', { class: `sds-badge sds-badge-${type}` }, label);
  }

  function undefinedNote(label) {
    return h('span', { class: 'sds-undefined' }, `⚠ Undefined: ${label}`);
  }

  function linkNote(label) {
    return h('span', { class: 'sds-linked' }, `🔗 連携: ${label}`);
  }

  function btn(label, cls, onClick) {
    return h('button', { class: `sds-btn ${cls}`, onClick }, label);
  }

  function inputEl(placeholder, id) {
    return h('input', { class: 'sds-input', placeholder, id: id || '' });
  }

  function selectEl(options, id) {
    const sel = h('select', { class: 'sds-select', id: id || '' });
    if (options.length === 0) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = '（候補なし）'; o.disabled = true; o.selected = true;
      sel.appendChild(o);
    } else {
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value; o.textContent = opt.label;
        sel.appendChild(o);
      });
    }
    return sel;
  }

  function card(title, ...contents) {
    return h('div', { class: 'sds-card' },
      h('div', { class: 'sds-card-title' }, title),
      ...contents
    );
  }

  function infoRow(key, val) {
    return h('div', { class: 'sds-info-row' },
      h('span', { class: 'sds-info-key' }, key),
      h('span', {}, val)
    );
  }

  /* ─────────────────────────────────────────
   * 各サブコンポーネント
   * ───────────────────────────────────────── */

  /** 講師管理
   *  連携[1]送信側: 稼働開始/休止/退職 → Store.activeTeachers を更新 → EventBus emit
   */
  function buildTeacherMgmt(root) {
    const machine = createMachine('teacher', '未登録', {
      '未登録': { '講師登録':    '登録済' },
      '登録済': { '講師情報更新': '登録済', '稼働開始': '稼働中' },
      '稼働中': { '休止処理':   '休止中', '退職処理': '退職済' },
      '休止中': { '稼働開始':   '稼働中' },
    });

    let teacherName = '';
    // このインスタンスのID（デモ用シンプル実装）
    const teacherId = 'teacher-' + Date.now();

    function publishTeacherState() {
      const isActive = machine.state === '稼働中';
      // Store更新
      Store.activeTeachers = Store.activeTeachers.filter(t => t.id !== teacherId);
      if (isActive) Store.activeTeachers.push({ id: teacherId, name: teacherName });
      // 連携通知
      EventBus.emit('store:teachers-updated', { teachers: Store.activeTeachers });
      log(`🔗 連携[1] 稼働講師リスト更新 → 講師割当へ反映 (${Store.activeTeachers.length}名)`, 'link');
    }

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`,
        s === '稼働中' ? 'ok' : s === '未登録' ? 'idle' : s === '休止中' ? 'warn' : 'danger'));
      root.appendChild(linkNote('稼働状態の変化を「講師割当」へ自動反映'));

      if (s === '未登録') {
        const inp = inputEl('講師名を入力', 'teacher-name');
        root.appendChild(inp);
        root.appendChild(btn('登録', 'sds-btn-primary', () => {
          teacherName = inp.value || '（未入力）';
          machine.transition('講師登録');
          render();
        }));
      }

      if (s === '登録済') {
        root.appendChild(infoRow('講師名', teacherName));
        const inp = inputEl('名前を変更');
        root.appendChild(inp);
        root.appendChild(btn('更新', 'sds-btn-ghost', () => {
          if (inp.value) teacherName = inp.value;
          machine.transition('講師情報更新');
          render();
        }));
        root.appendChild(btn('稼働開始', 'sds-btn-success', () => {
          machine.transition('稼働開始');
          publishTeacherState();
          render();
        }));
      }

      if (s === '稼働中') {
        root.appendChild(infoRow('講師名', teacherName));
        root.appendChild(infoRow('状態', '稼働中'));
        root.appendChild(btn('休止', 'sds-btn-warning', () => {
          machine.transition('休止処理');
          publishTeacherState();
          render();
        }));
        root.appendChild(btn('退職', 'sds-btn-danger', () => {
          machine.transition('退職処理');
          publishTeacherState();
          render();
        }));
      }

      if (s === '休止中') {
        root.appendChild(infoRow('講師名', teacherName));
        root.appendChild(btn('稼働再開', 'sds-btn-success', () => {
          machine.transition('稼働開始');
          publishTeacherState();
          render();
        }));
      }

      if (s === '退職済') {
        root.appendChild(badge('退職済 — 操作不可', 'danger'));
      }
    }
    render();
  }

  /** 講師割当
   *  連携[1]受信側: store:teachers-updated → セレクトボックスをリアルタイム更新
   *  連携[3]送信側: 割当済 → Store.teacherAssigned = true → 両方揃えば通知自動作成
   */
  function buildTeacherAssign(root) {
    const machine = createMachine('teacher-assign', '未割当', {
      '未割当': { '講師割当':    '割当済' },
      '割当済': { '講師割当解除': '未割当' },
    });

    let assigned = '';
    // 再描画用参照
    let _render = null;

    // 連携[1] EventBus受信 → 再描画
    EventBus.on('store:teachers-updated', () => {
      if (_render) _render();
    });

    function checkBothAssigned() {
      if (Store.teacherAssigned && Store.roomAssigned) {
        EventBus.emit('store:both-assigned', {});
        log('🔗 連携[3] 講師＋教室が揃いました → 通知を自動作成', 'link');
      }
    }

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`, s === '割当済' ? 'ok' : 'idle'));
      root.appendChild(linkNote('稼働中の講師のみ表示（講師管理と連携）'));

      if (s === '未割当') {
        root.appendChild(h('label', { class: 'sds-label' }, '稼働中の講師を選択'));
        const opts = Store.activeTeachers.map(t => ({ value: t.name, label: t.name }));
        const sel = selectEl(opts, 'teacher-sel');
        root.appendChild(sel);

        if (Store.activeTeachers.length === 0) {
          root.appendChild(h('p', { class: 'sds-hint' }, '※ 先に「講師管理」で稼働開始してください'));
        }

        const assignBtn = btn('割当', 'sds-btn-primary', () => {
          if (!sel.value) return;
          assigned = sel.value;
          machine.transition('講師割当');
          Store.teacherAssigned = true;
          checkBothAssigned();
          render();
        });
        if (Store.activeTeachers.length === 0) assignBtn.disabled = true;
        root.appendChild(assignBtn);
      }

      if (s === '割当済') {
        root.appendChild(infoRow('担当講師', assigned));
        root.appendChild(btn('解除', 'sds-btn-danger', () => {
          assigned = '';
          machine.transition('講師割当解除');
          Store.teacherAssigned = false;
          render();
        }));
      }
    }
    _render = render;
    render();
  }

  /** 教室管理
   *  連携[2]送信側: 使用可能/使用中 → Store.availableRooms 更新 → EventBus emit
   */
  function buildRoomMgmt(root) {
    const machine = createMachine('room', '未登録', {
      '未登録':   { '教室登録':    '使用可能' },
      '使用可能': { '教室使用開始': '使用中', '使用停止': '停止中' },
      '使用中':   { '使用停止':    '停止中' },
      '停止中':   { '教室使用開始': '使用可能' },
    });

    let roomName = '';
    const roomId = 'room-' + Date.now();

    function publishRoomState() {
      const available = (machine.state === '使用可能' || machine.state === '使用中');
      Store.availableRooms = Store.availableRooms.filter(r => r.id !== roomId);
      if (available) Store.availableRooms.push({ id: roomId, name: roomName });
      EventBus.emit('store:rooms-updated', { rooms: Store.availableRooms });
      log(`🔗 連携[2] 使用可能教室リスト更新 → 教室割当へ反映 (${Store.availableRooms.length}室)`, 'link');
    }

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`,
        s === '使用中' ? 'ok' : s === '使用可能' ? 'info' : s === '未登録' ? 'idle' : 'warn'));
      root.appendChild(linkNote('使用可能／使用中の状態を「教室割当」へ自動反映'));

      if (s === '未登録') {
        const inp = inputEl('教室名を入力');
        root.appendChild(inp);
        root.appendChild(btn('登録', 'sds-btn-primary', () => {
          roomName = inp.value || '（未入力）';
          machine.transition('教室登録');
          publishRoomState();
          render();
        }));
      }

      if (s === '使用可能' || s === '停止中') {
        root.appendChild(infoRow('教室名', roomName));
        root.appendChild(btn('使用開始', 'sds-btn-success', () => {
          machine.transition('教室使用開始');
          publishRoomState();
          render();
        }));
        root.appendChild(btn('停止', 'sds-btn-warning', () => {
          machine.transition('使用停止');
          publishRoomState();
          render();
        }));
      }

      if (s === '使用中') {
        root.appendChild(infoRow('教室名', roomName));
        root.appendChild(btn('使用停止', 'sds-btn-warning', () => {
          machine.transition('使用停止');
          publishRoomState();
          render();
        }));
      }
    }
    render();
  }

  /** 教室割当
   *  連携[2]受信側: store:rooms-updated → セレクトボックスをリアルタイム更新
   *  連携[3]送信側: 割当済 → Store.roomAssigned = true → 両方揃えば通知自動作成
   */
  function buildRoomAssign(root) {
    const machine = createMachine('room-assign', '未割当', {
      '未割当': { '教室割当':    '割当済' },
      '割当済': { '教室割当解除': '未割当' },
    });

    let assigned = '';
    let _render = null;

    EventBus.on('store:rooms-updated', () => {
      if (_render) _render();
    });

    function checkBothAssigned() {
      if (Store.teacherAssigned && Store.roomAssigned) {
        EventBus.emit('store:both-assigned', {});
        log('🔗 連携[3] 講師＋教室が揃いました → 通知を自動作成', 'link');
      }
    }

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`, s === '割当済' ? 'ok' : 'idle'));
      root.appendChild(linkNote('使用可能な教室のみ表示（教室管理と連携）'));

      if (s === '未割当') {
        root.appendChild(h('label', { class: 'sds-label' }, '使用可能な教室を選択'));
        const opts = Store.availableRooms.map(r => ({ value: r.name, label: r.name }));
        const sel = selectEl(opts, 'room-sel');
        root.appendChild(sel);

        if (Store.availableRooms.length === 0) {
          root.appendChild(h('p', { class: 'sds-hint' }, '※ 先に「教室管理」で登録してください'));
        }

        const assignBtn = btn('割当', 'sds-btn-primary', () => {
          if (!sel.value) return;
          assigned = sel.value;
          machine.transition('教室割当');
          Store.roomAssigned = true;
          checkBothAssigned();
          render();
        });
        if (Store.availableRooms.length === 0) assignBtn.disabled = true;
        root.appendChild(assignBtn);
      }

      if (s === '割当済') {
        root.appendChild(infoRow('割当教室', assigned));
        root.appendChild(btn('解除', 'sds-btn-danger', () => {
          assigned = '';
          machine.transition('教室割当解除');
          Store.roomAssigned = false;
          render();
        }));
      }
    }
    _render = render;
    render();
  }

  /** 通知管理
   *  連携[3]受信側: store:both-assigned → 自動で通知予定を作成
   *  連携[4]受信側: store:seat-full     → 自動で満席通知予定を作成
   */
  function buildNotification(root) {
    const machine = createMachine('notification', '未通知', {
      '未通知':   { '通知予定作成': '通知予定' },
      '通知予定': { '通知送信': '送信済', '通知キャンセル': '未通知' },
      '送信済':   { '通知予定作成': '通知予定' },
    });

    let autoReason = ''; // 自動作成の理由テキスト
    let _render = null;

    // 連携[3]: 講師＋教室が揃ったら自動作成
    EventBus.on('store:both-assigned', () => {
      if (machine.state !== '通知予定') {
        autoReason = '講師・教室が揃いました（自動作成）';
        machine.transition('通知予定作成');
        if (_render) _render();
      }
    });

    // 連携[4]: 満席になったら自動作成
    EventBus.on('store:seat-full', () => {
      if (machine.state !== '通知予定') {
        autoReason = '座席が満席になりました（自動作成）';
        machine.transition('通知予定作成');
        if (_render) _render();
      }
    });

    // 通知タブのバッジを光らせるためのコールバック
    Store._notifyRender = () => { if (_render) _render(); };

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`,
        s === '送信済' ? 'ok' : s === '通知予定' ? 'info' : 'idle'));
      root.appendChild(linkNote('講師＋教室割当完了 / 満席 で自動作成'));
      root.appendChild(undefinedNote('通知手段（メール / SMS / Push）'));

      if (s === '通知予定' && autoReason) {
        root.appendChild(h('div', {
          style: 'background:#e8e0d4;border-left:3px solid var(--sds-warning);padding:8px 10px;border-radius:4px;font-size:12px;margin:8px 0;color:var(--sds-text);'
        }, `⚡ ${autoReason}`));
      }

      if (s === '未通知' || s === '送信済') {
        root.appendChild(btn('通知予定を手動作成', 'sds-btn-primary', () => {
          autoReason = '手動作成';
          machine.transition('通知予定作成');
          render();
        }));
      }

      if (s === '通知予定') {
        root.appendChild(infoRow('予定', '通知待機中'));
        root.appendChild(btn('送信', 'sds-btn-success', () => {
          autoReason = '';
          machine.transition('通知送信');
          render();
        }));
        root.appendChild(btn('キャンセル', 'sds-btn-ghost', () => {
          autoReason = '';
          machine.transition('通知キャンセル');
          render();
        }));
      }
    }
    _render = render;
    render();
  }

  /** 座席制御
   *  連携[4]送信側: 満席になったら store:seat-full を emit
   */
  function buildSeat(root) {
    const CAPACITY = 8;
    let used = 3;
    let seatFullEmitted = false; // 満席通知は1回だけ

    const machine = createMachine('seat', '空きあり', {
      '空きあり': { '予約枠確保': '空きあり' },
      '満席':     { '予約枠解放': '空きあり' },
    });

    function render() {
      root.innerHTML = '';
      const full = used >= CAPACITY;
      const s = full ? '満席' : '空きあり';
      root.appendChild(badge(`状態: ${s}`, full ? 'danger' : 'ok'));
      root.appendChild(linkNote('満席になると「通知」へ自動通知を送信'));
      root.appendChild(undefinedNote('座席制御の予約システム連携方式'));

      root.appendChild(infoRow('定員', String(CAPACITY)));
      root.appendChild(infoRow('使用数', String(used)));

      const pct = Math.round(used / CAPACITY * 100);
      const wrap = h('div', { class: 'sds-progress-wrap' });
      const bar  = h('div', { class: 'sds-progress-bar' });
      bar.style.width = `${pct}%`;
      bar.style.background = full ? 'var(--sds-danger)' : 'var(--sds-accent)';
      wrap.appendChild(bar);
      root.appendChild(wrap);

      const grid = h('div', { class: 'sds-seat-grid' });
      for (let i = 0; i < CAPACITY; i++) {
        const cls = i < used
          ? (full ? 'sds-seat-cell full' : 'sds-seat-cell used')
          : 'sds-seat-cell';
        grid.appendChild(h('div', { class: cls }, String(i + 1)));
      }
      root.appendChild(grid);

      if (!full) {
        seatFullEmitted = false; // 空きが戻ったらリセット
        root.appendChild(btn('予約枠確保', 'sds-btn-primary', () => {
          if (used < CAPACITY) used++;
          machine.transition('予約枠確保');
          // 満席になった瞬間に連携[4]発火
          if (used >= CAPACITY && !seatFullEmitted) {
            seatFullEmitted = true;
            EventBus.emit('store:seat-full', {});
            log('🔗 連携[4] 満席 → 通知を自動作成', 'link');
          }
          render();
        }));
      } else {
        root.appendChild(btn('予約枠解放', 'sds-btn-warning', () => {
          if (used > 0) used--;
          machine.transition('予約枠解放');
          render();
        }));
      }
    }
    render();
  }

  /** 月謝調整 */
  function buildFeeAdjust(root) {
    root.innerHTML = '';
    root.appendChild(badge('状態: Undefined', 'warn'));
    root.appendChild(undefinedNote('月謝連動ルール（仕様未確定のため非実装）'));
    root.appendChild(h('p', { style: 'color:var(--sds-muted);font-size:12px;margin-top:8px;' },
      'このコンポーネントは業務ルールが確定次第実装します。'));
  }

  /** 連絡先管理 */
  function buildContact(root) {
    root.innerHTML = '';
    root.appendChild(badge('状態: Undefined', 'warn'));
    root.appendChild(undefinedNote('連絡先管理の外部システム連携エンドポイント'));
    root.appendChild(h('p', { style: 'color:var(--sds-muted);font-size:12px;margin-top:8px;' },
      'このコンポーネントは外部連携仕様が確定次第実装します。'));
  }

  /** 連絡履歴 */
  function buildContactHistory(root) {
    root.innerHTML = '';
    root.appendChild(badge('状態: Undefined', 'warn'));
    root.appendChild(undefinedNote('連絡履歴の取得API・データ形式'));
    root.appendChild(h('p', { style: 'color:var(--sds-muted);font-size:12px;margin-top:8px;' },
      'このコンポーネントはAPIエンドポイント確定次第実装します。'));
  }

  /** 設定反映 */
  function buildSettings(root) {
    const machine = createMachine('settings', '要確認', {
      '要確認': { '影響範囲確認': '確認済', '反映除外': '除外済' },
      '確認済': { '反映除外': '除外済' },
    });

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`,
        s === '確認済' ? 'ok' : s === '除外済' ? 'warn' : 'info'));
      root.appendChild(undefinedNote('設定反映の影響範囲定義'));

      if (s === '要確認') {
        root.appendChild(btn('影響範囲確認', 'sds-btn-primary', () => {
          machine.transition('影響範囲確認'); render();
        }));
        root.appendChild(btn('反映除外', 'sds-btn-ghost', () => {
          machine.transition('反映除外'); render();
        }));
      }
      if (s === '確認済') {
        root.appendChild(infoRow('影響範囲', 'Undefined（確認済フラグのみ）'));
        root.appendChild(btn('反映除外', 'sds-btn-warning', () => {
          machine.transition('反映除外'); render();
        }));
      }
      if (s === '除外済') {
        root.appendChild(badge('除外済 — 操作不可', 'warn'));
      }
    }
    render();
  }

  /* ─────────────────────────────────────────
   * メインコンポーネント組み立て
   * ───────────────────────────────────────── */
  const TABS = [
    { id: 'teacher-mgmt',   label: '講師管理',  build: buildTeacherMgmt },
    { id: 'teacher-assign', label: '講師割当',  build: buildTeacherAssign },
    { id: 'room-mgmt',      label: '教室管理',  build: buildRoomMgmt },
    { id: 'room-assign',    label: '教室割当',  build: buildRoomAssign },
    { id: 'notification',   label: '通知',      build: buildNotification },
    { id: 'contact',        label: '連絡先',    build: buildContact },
    { id: 'history',        label: '連絡履歴',  build: buildContactHistory },
    { id: 'fee',            label: '月謝調整',  build: buildFeeAdjust },
    { id: 'seat',           label: '座席制御',  build: buildSeat },
    { id: 'settings',       label: '設定反映',  build: buildSettings },
  ];

  function initComponent({ mountElement, options = {} }) {
    const mountEl = typeof mountElement === 'string'
      ? document.querySelector(mountElement)
      : mountElement;

    if (!mountEl) {
      console.error('[SDS] mountElement が見つかりません:', mountElement);
      return;
    }

    const root = h('div', { class: 'sds-root' });
    mountEl.appendChild(root);

    root.appendChild(h('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:16px;' },
      h('span', { style: 'font-size:18px;font-weight:700;letter-spacing:.02em;' }, '塾管理 拡張SDS'),
      badge('Web部品', 'info'),
      badge('v2 連携対応', 'ok')
    ));

    const tabNav    = h('div', { class: 'sds-tabs' });
    const panelWrap = h('div', {});
    const panels    = {};
    const tabBtns   = {};

    // 通知タブに自動作成バッジを出すための参照
    const notifBadgeMap = {};

    TABS.forEach(tab => {
      const tabBtn = h('button', {
        class: 'sds-tab-btn',
        onClick() { switchTab(tab.id); }
      }, tab.label);
      tabNav.appendChild(tabBtn);
      tabBtns[tab.id] = tabBtn;

      const panel      = h('div', { class: 'sds-panel' });
      const contentRoot = h('div', {});
      panel.appendChild(card(tab.label, contentRoot));
      tab.build(contentRoot);
      panels[tab.id] = panel;
      panelWrap.appendChild(panel);
    });

    // 通知タブ: 自動作成時にタブボタンを点滅させる
    EventBus.on('store:both-assigned', () => flashTab('notification'));
    EventBus.on('store:seat-full',     () => flashTab('notification'));

    function flashTab(id) {
      const btn = tabBtns[id];
      if (!btn) return;
      btn.classList.add('sds-tab-flash');
      setTimeout(() => btn.classList.remove('sds-tab-flash'), 2000);
    }

    root.appendChild(tabNav);
    root.appendChild(panelWrap);

    // 連携マップ表示
    root.appendChild(h('div', { class: 'sds-card', style: 'margin-top:16px;' },
      h('div', { class: 'sds-card-title' }, '画面間連携マップ'),
      h('div', { style: 'font-size:11px;color:var(--sds-muted);line-height:2;' },
        h('span', { style: 'color:var(--sds-warning);' }, '🔗'),
        ' [1] 講師管理（稼働状態）→ 講師割当（候補リスト）',  h('br', {}),
        h('span', { style: 'color:var(--sds-warning);' }, '🔗'),
        ' [2] 教室管理（使用可能）→ 教室割当（候補リスト）',  h('br', {}),
        h('span', { style: 'color:var(--sds-warning);' }, '🔗'),
        ' [3] 講師割当＋教室割当（両方済）→ 通知（自動作成）', h('br', {}),
        h('span', { style: 'color:var(--sds-warning);' }, '🔗'),
        ' [4] 座席制御（満席）→ 通知（自動作成）'
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
    log('SDS コンポーネント v2 初期化完了（画面間連携 有効）');
  }

  global.SDS = global.SDS || {};
  global.SDS.initComponent = initComponent;
  global.SDS.EventBus      = EventBus;

})(window);
