/**
 * SDS拡張コンポーネント — component.js
 * 出力モード: Web部品（IIFE・埋め込み型）
 *
 * ■ Undefined項目（仕様未確定のため未実装）
 *   - 講師割当の必須チェック
 *   - 教室割当の必須チェック
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
        EventBus.emit(`${name}:${event}`, { state });
        return true;
      },
    };
  }

  /* ─────────────────────────────────────────
   * ログ
   * ───────────────────────────────────────── */
  let _logEl = null;
  function log(msg) {
    const now = new Date().toLocaleTimeString('ja-JP');
    if (_logEl) {
      const div = document.createElement('div');
      div.className = 'sds-log-entry';
      div.innerHTML = `<span class="ts">${now}</span><span class="ev">${escHtml(msg)}</span>`;
      _logEl.prepend(div);
    }
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  function btn(label, cls, onClick) {
    return h('button', { class: `sds-btn ${cls}`, onClick }, label);
  }

  function inputEl(placeholder, id) {
    return h('input', { class: 'sds-input', placeholder, id: id || '' });
  }

  function selectEl(options, id) {
    const sel = h('select', { class: 'sds-select', id: id || '' });
    options.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value; o.textContent = opt.label;
      sel.appendChild(o);
    });
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

  /** 講師管理 */
  function buildTeacherMgmt(root) {
    const machine = createMachine('teacher', '未登録', {
      '未登録':  { '講師登録':   '登録済' },
      '登録済':  { '講師情報更新': '登録済', '稼働開始': '稼働中' },
      '稼働中':  { '休止処理':   '休止中', '退職処理': '退職済' },
      '休止中':  { '稼働開始':   '稼働中' },
    });

    let teacherName = '';

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`,
        s === '稼働中' ? 'ok' : s === '未登録' ? 'idle' : s === '休止中' ? 'warn' : 'danger'));

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
        const inp = inputEl('名前を変更', 'teacher-name-update');
        root.appendChild(inp);
        root.appendChild(btn('更新', 'sds-btn-ghost', () => {
          if (inp.value) teacherName = inp.value;
          machine.transition('講師情報更新');
          render();
        }));
        root.appendChild(btn('稼働開始', 'sds-btn-success', () => {
          machine.transition('稼働開始'); render();
        }));
      }

      if (s === '稼働中') {
        root.appendChild(infoRow('講師名', teacherName));
        root.appendChild(infoRow('状態', '稼働中'));
        root.appendChild(btn('休止', 'sds-btn-warning', () => {
          machine.transition('休止処理'); render();
        }));
        root.appendChild(btn('退職', 'sds-btn-danger', () => {
          machine.transition('退職処理'); render();
        }));
      }

      if (s === '休止中') {
        root.appendChild(infoRow('講師名', teacherName));
        root.appendChild(btn('稼働再開', 'sds-btn-success', () => {
          machine.transition('稼働開始'); render();
        }));
      }

      if (s === '退職済') {
        root.appendChild(badge('退職済 — 操作不可', 'danger'));
      }
    }
    render();
  }

  /** 講師割当 */
  function buildTeacherAssign(root) {
    const machine = createMachine('teacher-assign', '未割当', {
      '未割当': { '講師割当':    '割当済' },
      '割当済': { '講師割当解除': '未割当' },
    });

    const teachers = ['佐藤先生', '田中先生', '山田先生'];
    let assigned = '';

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`, s === '割当済' ? 'ok' : 'idle'));

      if (s === '未割当') {
        root.appendChild(h('label', { class: 'sds-label' }, '講師を選択'));
        const sel = selectEl(teachers.map(t => ({ value: t, label: t })), 'teacher-sel');
        root.appendChild(sel);
        root.appendChild(undefinedNote('講師割当の必須チェック'));
        root.appendChild(btn('割当', 'sds-btn-primary', () => {
          assigned = sel.value;
          machine.transition('講師割当'); render();
        }));
      }

      if (s === '割当済') {
        root.appendChild(infoRow('担当講師', assigned));
        root.appendChild(btn('解除', 'sds-btn-danger', () => {
          assigned = '';
          machine.transition('講師割当解除'); render();
        }));
      }
    }
    render();
  }

  /** 教室管理 */
  function buildRoomMgmt(root) {
    const machine = createMachine('room', '未登録', {
      '未登録':   { '教室登録':    '使用可能' },
      '使用可能': { '教室使用開始': '使用中', '使用停止': '停止中' },
      '使用中':   { '使用停止':    '停止中' },
      '停止中':   { '教室使用開始': '使用可能' },
    });

    let roomName = '';

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`,
        s === '使用中' ? 'ok' : s === '使用可能' ? 'info' : s === '未登録' ? 'idle' : 'warn'));

      if (s === '未登録') {
        const inp = inputEl('教室名を入力');
        root.appendChild(inp);
        root.appendChild(btn('登録', 'sds-btn-primary', () => {
          roomName = inp.value || '（未入力）';
          machine.transition('教室登録'); render();
        }));
      }

      if (s === '使用可能' || s === '停止中') {
        root.appendChild(infoRow('教室名', roomName));
        root.appendChild(btn('使用開始', 'sds-btn-success', () => {
          machine.transition('教室使用開始'); render();
        }));
        root.appendChild(btn('停止', 'sds-btn-warning', () => {
          machine.transition('使用停止'); render();
        }));
      }

      if (s === '使用中') {
        root.appendChild(infoRow('教室名', roomName));
        root.appendChild(btn('使用停止', 'sds-btn-warning', () => {
          machine.transition('使用停止'); render();
        }));
      }
    }
    render();
  }

  /** 教室割当 */
  function buildRoomAssign(root) {
    const machine = createMachine('room-assign', '未割当', {
      '未割当': { '教室割当':    '割当済' },
      '割当済': { '教室割当解除': '未割当' },
    });

    const rooms = ['A教室', 'B教室', 'C教室'];
    let assigned = '';

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`, s === '割当済' ? 'ok' : 'idle'));

      if (s === '未割当') {
        root.appendChild(h('label', { class: 'sds-label' }, '教室を選択'));
        const sel = selectEl(rooms.map(r => ({ value: r, label: r })), 'room-sel');
        root.appendChild(sel);
        root.appendChild(undefinedNote('教室割当の必須チェック'));
        root.appendChild(btn('割当', 'sds-btn-primary', () => {
          assigned = sel.value;
          machine.transition('教室割当'); render();
        }));
      }

      if (s === '割当済') {
        root.appendChild(infoRow('割当教室', assigned));
        root.appendChild(btn('解除', 'sds-btn-danger', () => {
          assigned = '';
          machine.transition('教室割当解除'); render();
        }));
      }
    }
    render();
  }

  /** 通知管理 */
  function buildNotification(root) {
    const machine = createMachine('notification', '未通知', {
      '未通知':   { '通知予定作成': '通知予定' },
      '通知予定': { '通知送信':    '送信済',  '通知キャンセル': '未通知' },
      '送信済':   { '通知予定作成': '通知予定' },
    });

    function render() {
      root.innerHTML = '';
      const s = machine.state;
      root.appendChild(badge(`状態: ${s}`,
        s === '送信済' ? 'ok' : s === '通知予定' ? 'info' : 'idle'));

      root.appendChild(undefinedNote('通知手段（メール / SMS / Push）'));

      if (s === '未通知' || s === '送信済') {
        root.appendChild(btn('通知予定を作成', 'sds-btn-primary', () => {
          machine.transition('通知予定作成'); render();
        }));
      }

      if (s === '通知予定') {
        root.appendChild(infoRow('予定', '通知待機中'));
        root.appendChild(btn('送信', 'sds-btn-success', () => {
          machine.transition('通知送信'); render();
        }));
        root.appendChild(btn('キャンセル', 'sds-btn-ghost', () => {
          machine.transition('通知キャンセル'); render();
        }));
      }
    }
    render();
  }

  /** 座席制御 */
  function buildSeat(root) {
    const CAPACITY = 8;
    let used = 3;

    const machine = createMachine('seat', '空きあり', {
      '空きあり': { '予約枠確保': '空きあり' }, // 満席時は render 内でガード
      '満席':     { '予約枠解放': '空きあり' },
    });

    function render() {
      root.innerHTML = '';
      const full = used >= CAPACITY;
      const s = full ? '満席' : '空きあり';
      root.appendChild(badge(`状態: ${s}`, full ? 'danger' : 'ok'));
      root.appendChild(undefinedNote('座席制御の予約システム連携方式'));

      root.appendChild(infoRow('定員', String(CAPACITY)));
      root.appendChild(infoRow('使用数', String(used)));

      // プログレスバー
      const pct = Math.round(used / CAPACITY * 100);
      const wrap = h('div', { class: 'sds-progress-wrap' });
      const bar  = h('div', { class: 'sds-progress-bar' });
      bar.style.width = `${pct}%`;
      bar.style.background = full ? 'var(--sds-danger)' : 'var(--sds-accent)';
      wrap.appendChild(bar);
      root.appendChild(wrap);

      // 座席ビジュアル
      const grid = h('div', { class: 'sds-seat-grid' });
      for (let i = 0; i < CAPACITY; i++) {
        const cls = i < used ? (full ? 'sds-seat-cell full' : 'sds-seat-cell used') : 'sds-seat-cell';
        grid.appendChild(h('div', { class: cls }, String(i + 1)));
      }
      root.appendChild(grid);

      if (!full) {
        root.appendChild(btn('予約枠確保', 'sds-btn-primary', () => {
          if (used < CAPACITY) used++;
          machine.transition('予約枠確保'); render();
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
    { id: 'teacher-mgmt',    label: '講師管理',   build: buildTeacherMgmt },
    { id: 'teacher-assign',  label: '講師割当',   build: buildTeacherAssign },
    { id: 'room-mgmt',       label: '教室管理',   build: buildRoomMgmt },
    { id: 'room-assign',     label: '教室割当',   build: buildRoomAssign },
    { id: 'notification',    label: '通知',       build: buildNotification },
    { id: 'contact',         label: '連絡先',     build: buildContact },
    { id: 'history',         label: '連絡履歴',   build: buildContactHistory },
    { id: 'fee',             label: '月謝調整',   build: buildFeeAdjust },
    { id: 'seat',            label: '座席制御',   build: buildSeat },
    { id: 'settings',        label: '設定反映',   build: buildSettings },
  ];

  function initComponent({ mountElement, options = {} }) {
    const mountEl = typeof mountElement === 'string'
      ? document.querySelector(mountElement)
      : mountElement;

    if (!mountEl) {
      console.error('[SDS] mountElement が見つかりません:', mountElement);
      return;
    }

    // ルートラッパー
    const root = h('div', { class: 'sds-root' });
    mountEl.appendChild(root);

    // ヘッダー
    root.appendChild(h('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:16px;' },
      h('span', { style: 'font-size:18px;font-weight:700;letter-spacing:.02em;' }, '塾管理 拡張SDS'),
      badge('Web部品', 'info')
    ));

    // タブ
    const tabNav   = h('div', { class: 'sds-tabs' });
    const panelWrap = h('div', {});
    const panels   = {};
    const tabBtns  = {};

    TABS.forEach(tab => {
      const tabBtn = h('button', {
        class: 'sds-tab-btn',
        onClick() { switchTab(tab.id); }
      }, tab.label);
      tabNav.appendChild(tabBtn);
      tabBtns[tab.id] = tabBtn;

      const panel = h('div', { class: 'sds-panel' });
      const contentRoot = h('div', {});
      panel.appendChild(card(tab.label, contentRoot));
      tab.build(contentRoot);
      panels[tab.id] = panel;
      panelWrap.appendChild(panel);
    });

    root.appendChild(tabNav);
    root.appendChild(panelWrap);

    // ログエリア
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
    log('SDS コンポーネント 初期化完了');
  }

  // グローバル公開（名前空間汚染を最小限に）
  global.SDS = global.SDS || {};
  global.SDS.initComponent = initComponent;
  global.SDS.EventBus      = EventBus;

})(window);
