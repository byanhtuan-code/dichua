export const ADMIN_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'";

export const ADMIN_PAGE_HTML = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sân Tĩnh · Quản trị</title>
  <style>
    :root {
      --bg: #161311;
      --bg-card: #211c18;
      --bg-elev: #2b241f;
      --border: #43372d;
      --border-gold: #8c6d3b;
      --gold: #f0c46c;
      --gold-bright: #ffe094;
      --text: #f5efe6;
      --muted: #b5a695;
      --ok: #4cd98c;
      --warn: #f5b041;
      --err: #f26d6d;
      --jade: #3dd9ae;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px 16px 48px;
      background: radial-gradient(circle at 50% 0%, #2a211b 0%, var(--bg) 70%);
      color: var(--text);
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.45;
      min-height: 100vh;
    }
    .shell {
      max-width: 1060px;
      margin: 0 auto;
    }
    header.top {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 14px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand-mark {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: radial-gradient(circle, #ffe49e 0%, #c89132 70%, #5e3e12 100%);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #1f1408;
      font-weight: 900;
      font-size: 17px;
      box-shadow: 0 0 12px rgba(240, 196, 108, 0.45);
    }
    h1 {
      margin: 0;
      font-size: 20px;
      color: var(--gold-bright);
      letter-spacing: 0.02em;
    }
    .sub {
      font-size: 12px;
      color: var(--muted);
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.32);
    }
    .card h2 {
      margin: 0 0 6px;
      font-size: 16px;
      color: var(--gold);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .card p.desc {
      margin: 0 0 14px;
      color: var(--muted);
      font-size: 13px;
    }
    .login-box {
      max-width: 400px;
      margin: 48px auto;
      border-color: var(--border-gold);
    }
    .field {
      margin-bottom: 12px;
    }
    .field label {
      display: block;
      font-size: 12.5px;
      color: var(--muted);
      margin-bottom: 4px;
      font-weight: 600;
    }
    input[type="text"],
    input[type="password"],
    input[type="number"],
    select {
      width: 100%;
      padding: 8px 10px;
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 14px;
      outline: none;
    }
    input:focus, select:focus {
      border-color: var(--gold);
    }
    button {
      padding: 8px 14px;
      border-radius: 6px;
      border: 1px solid var(--border-gold);
      background: linear-gradient(180deg, #e5b55c 0%, #b88228 100%);
      color: #1c1307;
      font-weight: 700;
      font-size: 13.5px;
      cursor: pointer;
      transition: filter 0.15s;
    }
    button:hover:not(:disabled) {
      filter: brightness(1.08);
    }
    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    button.secondary {
      background: var(--bg-elev);
      color: var(--text);
      border-color: var(--border);
      font-weight: 600;
    }
    button.danger {
      background: rgba(242, 109, 109, 0.16);
      color: #ff9c9c;
      border-color: rgba(242, 109, 109, 0.45);
      font-weight: 600;
    }
    button.small {
      padding: 4px 9px;
      font-size: 12px;
    }
    .row-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 12px;
    }
    .status-msg {
      min-height: 20px;
      margin-top: 8px;
      font-size: 13px;
      font-weight: 600;
    }
    .status-msg.ok { color: var(--ok); }
    .status-msg.err { color: var(--err); }
    .status-msg.warn { color: var(--warn); }

    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }
    .tab-btn {
      background: var(--bg-card);
      color: var(--muted);
      border: 1px solid var(--border);
      padding: 8px 15px;
      border-radius: 8px;
      font-weight: 600;
    }
    .tab-btn.active {
      background: linear-gradient(180deg, #3a2e22 0%, #2a2118 100%);
      color: var(--gold-bright);
      border-color: var(--gold);
      box-shadow: 0 0 10px rgba(240, 196, 108, 0.2);
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .stat-box {
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
    }
    .stat-label {
      font-size: 12px;
      color: var(--muted);
    }
    .stat-val {
      font-size: 22px;
      font-weight: 800;
      color: var(--gold-bright);
      margin-top: 2px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      text-align: left;
      vertical-align: middle;
    }
    th {
      color: var(--gold);
      font-weight: 600;
      background: rgba(0, 0, 0, 0.2);
    }
    td input[type="number"],
    td input[type="text"] {
      padding: 5px 8px;
      font-size: 13px;
    }
    .badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 99px;
      font-size: 11px;
      font-weight: 700;
    }
    .badge.pro {
      background: rgba(240, 196, 108, 0.2);
      color: var(--gold-bright);
      border: 1px solid var(--border-gold);
    }
    .badge.free {
      background: rgba(181, 166, 149, 0.15);
      color: var(--muted);
    }
    .badge.online {
      background: rgba(76, 217, 140, 0.18);
      color: var(--ok);
    }
    .rooms-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 10px;
    }
    .room-card {
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
    }
    .room-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .room-title {
      font-weight: 700;
      color: var(--gold-bright);
    }
    .broadcast-grid {
      display: grid;
      grid-template-columns: 180px 180px 1fr auto;
      gap: 8px;
      align-items: end;
    }
    @media (max-width: 720px) {
      .broadcast-grid {
        grid-template-columns: 1fr;
      }
    }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <div class="shell">
    <header class="top">
      <div class="brand">
        <span class="brand-mark">卍</span>
        <div>
          <h1>Sân Tĩnh · Quản trị</h1>
          <div class="sub">Hệ thống điều hành Chùa Sơn Tịnh Online</div>
        </div>
      </div>
      <div id="top-actions" hidden>
        <span id="admin-badge" class="badge pro" style="margin-right:8px;">Quản trị viên</span>
        <button type="button" id="btn-logout" class="secondary small">Đăng xuất</button>
      </div>
    </header>

    <!-- CỔNG ĐĂNG NHẬP ADMIN -->
    <section id="login-view" class="card login-box">
      <h2>Đăng nhập Quản trị</h2>
      <p class="desc">Nhập tài khoản và mật khẩu quản trị để mở bảng điều khiển.</p>
      <form id="login-form" action="javascript:void(0);">
        <div class="field">
          <label for="login-user">Tài khoản</label>
          <input id="login-user" type="text" autocomplete="username" value="admin" />
        </div>
        <div class="field">
          <label for="login-pw">Mật khẩu</label>
          <input id="login-pw" type="password" autocomplete="current-password" placeholder="Nhập mật khẩu (ví dụ: 681995)..." />
        </div>
        <div class="row-actions">
          <button type="button" id="btn-login" style="width:100%;">Vào trang Quản trị</button>
        </div>
        <div id="login-msg" class="status-msg" role="status"></div>
      </form>
    </section>

    <!-- BẢNG ĐIỀU KHIỂN CHÍNH -->
    <main id="app-view" hidden>
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-label">Đạo hữu đang online</div>
          <div class="stat-val" id="stat-real">0</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Bot thiền hành</div>
          <div class="stat-val" id="stat-bots">0</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Tài khoản đã đăng ký</div>
          <div class="stat-val" id="stat-accounts">0</div>
        </div>
      </div>

      <nav class="tabs" aria-label="Phân khu quản trị">
        <button type="button" class="tab-btn active" data-tab="tab-live">1. Giám sát & Điều hành Phòng</button>
        <button type="button" class="tab-btn" data-tab="tab-accounts">2. Quản lý Tài khoản</button>
        <button type="button" class="tab-btn" data-tab="tab-pop">3. Số phòng & Bot</button>
        <button type="button" class="tab-btn" data-tab="tab-names">4. Đổi tên 10 Phòng</button>
      </nav>

      <!-- TAB 1: GIÁM SÁT TRỰC TUYẾN & ĐIỀU HÀNH -->
      <section id="tab-live" class="tab-pane">
        <div class="card">
          <h2>Phát Thông Bạch (Thông báo Chùa)</h2>
          <p class="desc">Gửi lời nhắn hiển thị trực tiếp lên khung đàm đạo và bong bóng thoại trong phòng.</p>
          <form id="broadcast-form" class="broadcast-grid">
            <div>
              <label for="bc-room" style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">Phạm vi</label>
              <select id="bc-room">
                <option value="all">Toàn bộ 10 phòng</option>
                <option value="san-01">Phòng 1 (san-01)</option>
                <option value="san-02">Phòng 2 (san-02)</option>
                <option value="san-03">Phòng 3 (san-03)</option>
                <option value="san-04">Phòng 4 (san-04)</option>
                <option value="san-05">Phòng 5 (san-05)</option>
                <option value="san-06">Phòng 6 (san-06)</option>
                <option value="san-07">Phòng 7 (san-07)</option>
                <option value="san-08">Phòng 8 (san-08)</option>
                <option value="san-09">Phòng 9 (san-09)</option>
                <option value="san-10">Phòng 10 (san-10)</option>
              </select>
            </div>
            <div>
              <label for="bc-sender" style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">Danh xưng</label>
              <input id="bc-sender" type="text" maxlength="20" value="📢 Ban Quản Tự" />
            </div>
            <div>
              <label for="bc-text" style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">Nội dung thông bạch</label>
              <input id="bc-text" type="text" maxlength="240" placeholder="Nhập nội dung thông báo gửi tới các đạo hữu..." required />
            </div>
            <div>
              <button type="submit">Phát thông báo</button>
            </div>
          </form>
          <div id="bc-msg" class="status-msg" role="status"></div>
        </div>

        <div class="card">
          <h2>
            <span>Trạng thái 10 Phòng Trực tuyến</span>
            <span style="display:flex;gap:8px;align-items:center;">
              <label style="font-size:12px;color:var(--muted);font-weight:400;display:inline-flex;align-items:center;gap:4px;">
                <input type="checkbox" id="chk-autorefresh" checked /> Tự làm mới (5s)
              </label>
              <button type="button" id="btn-refresh-live" class="secondary small">Làm mới ngay</button>
              <button type="button" id="btn-clear-all-chat" class="danger small">Xóa chat cả 10 phòng</button>
            </span>
          </h2>
          <div id="live-msg" class="status-msg" role="status"></div>
          <div id="live-rooms-list"></div>
        </div>
      </section>

      <!-- TAB 2: QUẢN LÝ TÀI KHOẢN -->
      <section id="tab-accounts" class="tab-pane" hidden>
        <div class="card">
          <h2>
            <span>Danh sách Tài khoản Đạo hữu</span>
            <button type="button" id="btn-refresh-accounts" class="secondary small">Làm mới</button>
          </h2>
          <p class="desc">Tìm kiếm tài khoản, nâng cấp bậc đàm đạo (Free / Pro), đổi pháp danh hiển thị, đặt lại mật khẩu hoặc xóa tài khoản.</p>
          <form id="account-search-form" style="display:flex;gap:8px;margin-bottom:12px;max-width:460px;">
            <input id="acc-search" type="text" placeholder="Tìm theo username hoặc tên hiển thị..." />
            <button type="submit" class="secondary">Tìm kiếm</button>
          </form>
          <div id="acc-msg" class="status-msg" role="status"></div>
          <div style="overflow-x:auto;">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tài khoản</th>
                  <th>Tên hiển thị</th>
                  <th>Hạng</th>
                  <th>Trạng thái</th>
                  <th>Ngày tạo</th>
                  <th>Thao tác quản trị</th>
                </tr>
              </thead>
              <tbody id="acc-tbody"></tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- TAB 3: SỐ PHÒNG MỖI HẠNG & SỐ BOT -->
      <section id="tab-pop" class="tab-pane" hidden>
        <div class="card">
          <h2>Số phòng mỗi hạng và số bot</h2>
          <p class="desc" id="pop-limits-desc">Phân bổ 10 phòng vào 4 hạng và cấu hình số lượng bot tự động trong mỗi hạng.</p>
          <form id="pop-form">
            <div style="overflow-x:auto;">
              <table>
                <thead>
                  <tr>
                    <th>Hạng phòng</th>
                    <th>Số phòng</th>
                    <th>Bot thấp nhất</th>
                    <th>Bot cao nhất</th>
                  </tr>
                </thead>
                <tbody id="pop-tbody"></tbody>
              </table>
            </div>
            <div class="field" style="max-width:260px;margin-top:14px;">
              <label for="pop-min-bots">Bot tối thiểu giữ lại trong mỗi phòng</label>
              <input id="pop-min-bots" type="number" min="0" max="15" required />
            </div>
            <div class="row-actions">
              <button type="submit" id="btn-save-pop">Lưu cấu hình Bot</button>
              <button type="button" id="btn-reset-pop" class="secondary">Về mặc định</button>
            </div>
            <div id="pop-msg" class="status-msg" role="status"></div>
          </form>
        </div>
      </section>

      <!-- TAB 4: ĐỔI TÊN 10 PHÒNG -->
      <section id="tab-names" class="tab-pane" hidden>
        <div class="card">
          <h2>Tên phòng</h2>
          <p class="desc" id="names-desc">Đặt tên hiển thị cho 10 phòng (không để trống, không trùng nhau).</p>
          <form id="names-form">
            <div id="names-grid" class="rooms-grid"></div>
            <div class="row-actions">
              <button type="submit" id="btn-save-names">Lưu tên phòng</button>
              <button type="button" id="btn-reset-names" class="secondary">Về mặc định</button>
            </div>
            <div id="names-msg" class="status-msg" role="status"></div>
          </form>
        </div>
      </section>
    </main>
  </div>

  <script>
  (function () {
    var STORAGE_USER = "santinh.admin.user";
    var STORAGE_PW = "santinh.admin.pw";
    var TIER_LABELS = {
      full: "Đầy (Full)",
      high: "Đông (High)",
      medium: "Vừa (Medium)",
      low: "Vắng (Low)"
    };
    var TIER_KEYS = ["full", "high", "medium", "low"];

    // Lưu phiên trên cả RAM để hoạt động ngay cả khi trình duyệt hoặc iframe tên miền khóa sessionStorage
    var memUser = "admin";
    var memPw = "";
    var authMode = "pair"; // "pair" = Bearer user:pw, "pw" = Bearer pw

    var loginView = document.getElementById("login-view");
    var appView = document.getElementById("app-view");
    var topActions = document.getElementById("top-actions");
    var adminBadge = document.getElementById("admin-badge");
    var loginForm = document.getElementById("login-form");
    var loginUser = document.getElementById("login-user");
    var loginPw = document.getElementById("login-pw");
    var btnLogin = document.getElementById("btn-login");
    var loginMsg = document.getElementById("login-msg");

    var statReal = document.getElementById("stat-real");
    var statBots = document.getElementById("stat-bots");
    var statAccounts = document.getElementById("stat-accounts");

    var popData = null;
    var roomNamesData = null;
    var refreshTimer = null;

    function getCreds() {
      if (memPw) {
        return { user: memUser || "admin", pw: memPw };
      }
      try {
        var u = sessionStorage.getItem(STORAGE_USER) || "admin";
        var p = sessionStorage.getItem(STORAGE_PW) || "";
        memUser = u;
        memPw = p;
        return { user: u, pw: p };
      } catch (_e) {
        return { user: memUser || "admin", pw: memPw || "" };
      }
    }

    function setCreds(user, pw) {
      memUser = user || "admin";
      memPw = pw || "";
      try {
        sessionStorage.setItem(STORAGE_USER, memUser);
        sessionStorage.setItem(STORAGE_PW, memPw);
      } catch (_e) {}
    }

    function clearCreds() {
      memPw = "";
      try {
        sessionStorage.removeItem(STORAGE_USER);
        sessionStorage.removeItem(STORAGE_PW);
      } catch (_e) {}
    }

    function setStatus(el, text, kind) {
      if (!el) return;
      el.textContent = text || "";
      el.className = "status-msg" + (kind ? " " + kind : "");
    }

    function rawFetch(path, opts, mode) {
      var creds = getCreds();
      var headers = Object.assign({}, (opts && opts.headers) || {});
      headers["authorization"] =
        mode === "pw" ? "Bearer " + creds.pw : "Bearer " + creds.user + ":" + creds.pw;
      if (opts && opts.body !== undefined) {
        headers["content-type"] = "application/json";
      }
      return fetch(path, {
        method: (opts && opts.method) || "GET",
        headers: headers,
        body: opts && opts.body !== undefined ? JSON.stringify(opts.body) : undefined
      });
    }

    function api(path, opts) {
      opts = opts || {};
      return rawFetch(path, opts, authMode).then(function (res) {
        if (res.status === 401) {
          var altMode = authMode === "pair" ? "pw" : "pair";
          return rawFetch(path, opts, altMode).then(function (retryRes) {
            if (retryRes.ok) {
              authMode = altMode;
            }
            return retryRes;
          });
        }
        return res;
      });
    }

    function showLogin(msg, kind) {
      appView.hidden = true;
      topActions.hidden = true;
      loginView.hidden = false;
      if (btnLogin) {
        btnLogin.disabled = false;
        btnLogin.textContent = "Vào trang Quản trị";
      }
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      setStatus(loginMsg, msg || "", kind || "err");
    }

    function showApp(user) {
      loginView.hidden = true;
      appView.hidden = false;
      topActions.hidden = false;
      if (btnLogin) {
        btnLogin.disabled = false;
        btnLogin.textContent = "Vào trang Quản trị";
      }
      adminBadge.textContent = "Admin: " + user;
      startAutoRefresh();
    }

    // Chuyển Tab
    var tabBtns = document.querySelectorAll(".tab-btn");
    var tabPanes = document.querySelectorAll(".tab-pane");
    for (var i = 0; i < tabBtns.length; i++) {
      tabBtns[i].addEventListener("click", function (ev) {
        var target = ev.currentTarget.getAttribute("data-tab");
        for (var j = 0; j < tabBtns.length; j++) {
          tabBtns[j].classList.toggle("active", tabBtns[j].getAttribute("data-tab") === target);
        }
        for (var k = 0; k < tabPanes.length; k++) {
          tabPanes[k].hidden = tabPanes[k].id !== target;
        }
      });
    }

    document.getElementById("btn-logout").addEventListener("click", function () {
      clearCreds();
      loginPw.value = "";
      showLogin("Đã đăng xuất khỏi phiên quản trị.", "ok");
    });

    // =========================================================================
    // 1. TẢI DỮ LIỆU TỔNG QUAN & PHÒNG TRỰC TUYẾN
    // =========================================================================
    var liveRoomsList = document.getElementById("live-rooms-list");
    var liveMsg = document.getElementById("live-msg");

    function formatTime(ms) {
      if (!ms) return "—";
      var d = new Date(ms);
      return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
        " " + d.toLocaleDateString("vi-VN");
    }

    function renderOverview(data) {
      if (!data) return;
      statReal.textContent = String(data.totalReal || 0);
      statBots.textContent = String(data.totalBots || 0);
      liveRoomsList.replaceChildren();

      var rooms = data.rooms || [];
      for (var i = 0; i < rooms.length; i++) {
        var r = rooms[i];
        var card = document.createElement("div");
        card.className = "room-card";

        var head = document.createElement("div");
        head.className = "room-head";

        var titleSpan = document.createElement("span");
        titleSpan.className = "room-title";
        titleSpan.textContent = "Phòng " + r.number + " · " + r.name + " (" + r.id + ")";

        var metaSpan = document.createElement("span");
        metaSpan.style.fontSize = "12px";
        metaSpan.style.color = "var(--muted)";
        metaSpan.textContent =
          "Đạo hữu thật: " + r.realCount +
          " | Bot: " + r.botCount +
          " | Hiển thị: " + r.shownCount + "/" + r.capacity +
          (r.chatAllowed ? " | Đàm đạo: Bật" : " | Tịnh tâm (Khóa chat)");

        var clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "secondary small";
        clearBtn.textContent = "Xóa chat (" + (r.chatLines ? r.chatLines.length : 0) + ")";
        clearBtn.setAttribute("data-room", r.id);
        clearBtn.addEventListener("click", function (ev) {
          var roomId = ev.currentTarget.getAttribute("data-room");
          clearRoomChat(roomId);
        });

        head.append(titleSpan, metaSpan, clearBtn);
        card.appendChild(head);

        if (r.visitors && r.visitors.length > 0) {
          var tbl = document.createElement("table");
          var thead = document.createElement("thead");
          thead.innerHTML =
            "<tr><th>Tên nhân vật</th><th>Tài khoản</th><th>Trạng thái</th><th>Tọa độ</th><th>Thao tác</th></tr>";
          tbl.appendChild(thead);
          var tbody = document.createElement("tbody");

          for (var vIdx = 0; vIdx < r.visitors.length; vIdx++) {
            var v = r.visitors[vIdx];
            var tr = document.createElement("tr");

            var tdName = document.createElement("td");
            tdName.style.fontWeight = "700";
            tdName.textContent = v.name + " ";
            var idSub = document.createElement("span");
            idSub.style.fontSize = "11px";
            idSub.style.color = "var(--muted)";
            idSub.textContent = "(" + v.visitorId + ")";
            tdName.appendChild(idSub);

            var tdAcc = document.createElement("td");
            if (v.username) {
              tdAcc.textContent = v.username + " ";
              var b = document.createElement("span");
              b.className = "badge " + (v.tier === "pro" ? "pro" : "free");
              b.textContent = v.tier === "pro" ? "PRO" : "FREE";
              tdAcc.appendChild(b);
            } else {
              tdAcc.style.color = "var(--muted)";
              tdAcc.textContent = "Khách vãng lai";
            }

            var tdPose = document.createElement("td");
            tdPose.textContent =
              v.pose +
              (v.cushion !== null ? " (Đệm #" + v.cushion + ")" : "") +
              (v.asleep ? " · Đang ngủ gật" : "");

            var tdPos = document.createElement("td");
            tdPos.textContent = "(" + v.x + ", " + v.z + ")";

            var tdAct = document.createElement("td");
            var btnRename = document.createElement("button");
            btnRename.type = "button";
            btnRename.className = "secondary small";
            btnRename.style.marginRight = "6px";
            btnRename.textContent = "Đổi tên";
            btnRename.setAttribute("data-room", r.id);
            btnRename.setAttribute("data-vid", v.visitorId);
            btnRename.setAttribute("data-vname", v.name);
            btnRename.addEventListener("click", function (ev) {
              var btn = ev.currentTarget;
              promptRenameVisitor(
                btn.getAttribute("data-room"),
                btn.getAttribute("data-vid"),
                btn.getAttribute("data-vname")
              );
            });

            var btnKick = document.createElement("button");
            btnKick.type = "button";
            btnKick.className = "danger small";
            btnKick.textContent = "Mời ra";
            btnKick.setAttribute("data-room", r.id);
            btnKick.setAttribute("data-vid", v.visitorId);
            btnKick.setAttribute("data-vname", v.name);
            btnKick.addEventListener("click", function (ev) {
              var btn = ev.currentTarget;
              kickVisitor(
                btn.getAttribute("data-room"),
                btn.getAttribute("data-vid"),
                btn.getAttribute("data-vname")
              );
            });

            tdAct.append(btnRename, btnKick);
            tr.append(tdName, tdAcc, tdPose, tdPos, tdAct);
            tbody.appendChild(tr);
          }
          tbl.appendChild(tbody);
          card.appendChild(tbl);
        } else {
          var empty = document.createElement("div");
          empty.style.fontSize = "12.5px";
          empty.style.color = "var(--muted)";
          empty.textContent = "Chưa có đạo hữu thật trong phòng này.";
          card.appendChild(empty);
        }

        liveRoomsList.appendChild(card);
      }
    }

    function loadOverview() {
      return api("/api/admin/overview").then(function (res) {
        if (!res.ok) return;
        return res.json().then(renderOverview);
      }).catch(function () {});
    }

    function promptRenameVisitor(roomId, visitorId, currentName) {
      var next = window.prompt("Nhập tên hiển thị mới cho đạo hữu (" + currentName + "):", currentName);
      if (next === null || next.trim() === "") return;
      api("/api/admin/rename-visitor", {
        method: "POST",
        body: { room: roomId, visitorId: visitorId, name: next.trim() }
      }).then(function (res) {
        if (res.ok) {
          setStatus(liveMsg, "Đã đổi tên đạo hữu thành công.", "ok");
          loadOverview();
        } else {
          setStatus(liveMsg, "Không thể đổi tên (tên không hợp lệ hoặc đạo hữu đã rời phòng).", "err");
        }
      });
    }

    function kickVisitor(roomId, visitorId, name) {
      if (!window.confirm("Mời đạo hữu \"" + name + "\" rời khỏi phòng " + roomId + "?")) return;
      api("/api/admin/kick", {
        method: "POST",
        body: { room: roomId, visitorId: visitorId }
      }).then(function (res) {
        if (res.ok) {
          setStatus(liveMsg, "Đã mời \"" + name + "\" rời khỏi phòng.", "ok");
          loadOverview();
        } else {
          setStatus(liveMsg, "Đạo hữu không còn trong phòng.", "warn");
          loadOverview();
        }
      });
    }

    function clearRoomChat(roomId) {
      var label = roomId === "all" ? "toàn bộ 10 phòng" : ("phòng " + roomId);
      if (!window.confirm("Xóa lịch sử đàm đạo của " + label + "?")) return;
      api("/api/admin/clear-chat", {
        method: "POST",
        body: { room: roomId }
      }).then(function (res) {
        if (res.ok) {
          setStatus(liveMsg, "Đã xóa lịch sử đàm đạo của " + label + ".", "ok");
          loadOverview();
        } else {
          setStatus(liveMsg, "Không thể xóa lịch sử đàm đạo.", "err");
        }
      });
    }

    document.getElementById("btn-refresh-live").addEventListener("click", function () {
      loadOverview();
      setStatus(liveMsg, "Đã cập nhật trạng thái trực tuyến.", "ok");
    });

    document.getElementById("btn-clear-all-chat").addEventListener("click", function () {
      clearRoomChat("all");
    });

    document.getElementById("broadcast-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var room = document.getElementById("bc-room").value;
      var sender = document.getElementById("bc-sender").value.trim() || "📢 Ban Quản Tự";
      var textEl = document.getElementById("bc-text");
      var text = textEl.value.trim();
      var bcMsg = document.getElementById("bc-msg");
      if (!text) return;
      api("/api/admin/broadcast", {
        method: "POST",
        body: { room: room, sender: sender, text: text }
      }).then(function (res) {
        if (res.ok) {
          textEl.value = "";
          setStatus(bcMsg, "Đã phát thông bạch thành công.", "ok");
          loadOverview();
        } else {
          setStatus(bcMsg, "Không thể phát thông bạch (kiểm tra lại nội dung).", "err");
        }
      });
    });

    // =========================================================================
    // 2. QUẢN LÝ TÀI KHOẢN NGƯỜI CHƠI
    // =========================================================================
    var accTbody = document.getElementById("acc-tbody");
    var accMsg = document.getElementById("acc-msg");
    var accSearchInput = document.getElementById("acc-search");

    function renderAccounts(data) {
      if (!data) return;
      statAccounts.textContent = String(data.total || 0);
      accTbody.replaceChildren();
      var list = data.accounts || [];
      if (list.length === 0) {
        var trEmpty = document.createElement("tr");
        var tdEmpty = document.createElement("td");
        tdEmpty.colSpan = 7;
        tdEmpty.style.color = "var(--muted)";
        tdEmpty.textContent = "Không tìm thấy tài khoản nào.";
        trEmpty.appendChild(tdEmpty);
        accTbody.appendChild(trEmpty);
        return;
      }

      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        var tr = document.createElement("tr");

        var tdId = document.createElement("td");
        tdId.textContent = "#" + a.id;

        var tdUser = document.createElement("td");
        tdUser.style.fontWeight = "700";
        tdUser.textContent = a.username;

        var tdDisp = document.createElement("td");
        tdDisp.textContent = a.displayName;

        var tdTier = document.createElement("td");
        var badge = document.createElement("span");
        badge.className = "badge " + (a.tier === "pro" ? "pro" : "free");
        badge.textContent = a.tier === "pro" ? "PRO" : "FREE";
        tdTier.appendChild(badge);

        var tdSeen = document.createElement("td");
        if (a.activeSessions > 0) {
          var bOn = document.createElement("span");
          bOn.className = "badge online";
          bOn.textContent = a.activeSessions + " phiên";
          tdSeen.appendChild(bOn);
        } else {
          tdSeen.style.color = "var(--muted)";
          tdSeen.textContent = a.lastSeen ? formatTime(a.lastSeen) : "Chưa hoạt động";
        }

        var tdCreated = document.createElement("td");
        tdCreated.style.fontSize = "12px";
        tdCreated.style.color = "var(--muted)";
        tdCreated.textContent = formatTime(a.createdAt);

        var tdAct = document.createElement("td");
        var nextTier = a.tier === "pro" ? "free" : "pro";

        var btnTier = document.createElement("button");
        btnTier.type = "button";
        btnTier.className = "secondary small";
        btnTier.style.marginRight = "5px";
        btnTier.textContent = a.tier === "pro" ? "Hạ Free" : "Nâng Pro";
        btnTier.setAttribute("data-id", String(a.id));
        btnTier.setAttribute("data-tier", nextTier);
        btnTier.addEventListener("click", function (ev) {
          var id = ev.currentTarget.getAttribute("data-id");
          var tier = ev.currentTarget.getAttribute("data-tier");
          updateAccountTier(id, tier);
        });

        var btnName = document.createElement("button");
        btnName.type = "button";
        btnName.className = "secondary small";
        btnName.style.marginRight = "5px";
        btnName.textContent = "Đổi tên";
        btnName.setAttribute("data-id", String(a.id));
        btnName.setAttribute("data-name", a.displayName);
        btnName.addEventListener("click", function (ev) {
          var id = ev.currentTarget.getAttribute("data-id");
          var cur = ev.currentTarget.getAttribute("data-name");
          updateAccountName(id, cur);
        });

        var btnPw = document.createElement("button");
        btnPw.type = "button";
        btnPw.className = "secondary small";
        btnPw.style.marginRight = "5px";
        btnPw.textContent = "Đặt lại MK";
        btnPw.setAttribute("data-id", String(a.id));
        btnPw.setAttribute("data-user", a.username);
        btnPw.addEventListener("click", function (ev) {
          var id = ev.currentTarget.getAttribute("data-id");
          var u = ev.currentTarget.getAttribute("data-user");
          resetAccountPassword(id, u);
        });

        var btnDel = document.createElement("button");
        btnDel.type = "button";
        btnDel.className = "danger small";
        btnDel.textContent = "Xóa";
        btnDel.setAttribute("data-id", String(a.id));
        btnDel.setAttribute("data-user", a.username);
        btnDel.addEventListener("click", function (ev) {
          var id = ev.currentTarget.getAttribute("data-id");
          var u = ev.currentTarget.getAttribute("data-user");
          deleteAccountById(id, u);
        });

        tdAct.append(btnTier, btnName, btnPw, btnDel);
        tr.append(tdId, tdUser, tdDisp, tdTier, tdSeen, tdCreated, tdAct);
        accTbody.appendChild(tr);
      }
    }

    function loadAccounts() {
      var q = encodeURIComponent(accSearchInput.value.trim());
      return api("/api/admin/accounts?q=" + q + "&limit=100").then(function (res) {
        if (!res.ok) return;
        return res.json().then(renderAccounts);
      }).catch(function () {});
    }

    function updateAccountTier(id, tier) {
      api("/api/admin/accounts/" + id + "/tier", {
        method: "PUT",
        body: { tier: tier }
      }).then(function (res) {
        if (res.ok) {
          setStatus(accMsg, "Đã cập nhật hạng tài khoản #" + id + " sang " + tier.toUpperCase() + ".", "ok");
          loadAccounts();
          loadOverview();
        } else {
          setStatus(accMsg, "Không thể đổi hạng tài khoản.", "err");
        }
      });
    }

    function updateAccountName(id, curName) {
      var next = window.prompt("Nhập tên hiển thị mới cho tài khoản #" + id + ":", curName);
      if (next === null || next.trim() === "") return;
      api("/api/admin/accounts/" + id + "/name", {
        method: "PUT",
        body: { displayName: next.trim() }
      }).then(function (res) {
        if (res.ok) {
          setStatus(accMsg, "Đã đổi tên hiển thị cho tài khoản #" + id + ".", "ok");
          loadAccounts();
        } else {
          setStatus(accMsg, "Tên hiển thị không hợp lệ.", "err");
        }
      });
    }

    function resetAccountPassword(id, username) {
      var nextPw = window.prompt("Nhập mật khẩu mới (tối thiểu 8 ký tự) cho tài khoản \"" + username + "\":");
      if (nextPw === null || nextPw === "") return;
      api("/api/admin/accounts/" + id + "/password", {
        method: "PUT",
        body: { password: nextPw }
      }).then(function (res) {
        if (res.ok) {
          setStatus(accMsg, "Đã đặt lại mật khẩu và đăng xuất các phiên cũ của \"" + username + "\".", "ok");
          loadAccounts();
          loadOverview();
        } else {
          setStatus(accMsg, "Mật khẩu không hợp lệ (cần từ 8..128 ký tự).", "err");
        }
      });
    }

    function deleteAccountById(id, username) {
      if (!window.confirm("Xóa vĩnh viễn tài khoản \"" + username + "\" (#" + id + ") và ngắt kết nối khỏi phòng?")) return;
      api("/api/admin/accounts/" + id, {
        method: "DELETE"
      }).then(function (res) {
        if (res.ok) {
          setStatus(accMsg, "Đã xóa tài khoản \"" + username + "\".", "ok");
          loadAccounts();
          loadOverview();
        } else {
          setStatus(accMsg, "Không thể xóa tài khoản.", "err");
        }
      });
    }

    document.getElementById("account-search-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      loadAccounts();
    });

    document.getElementById("btn-refresh-accounts").addEventListener("click", function () {
      loadAccounts();
      setStatus(accMsg, "Đã làm mới danh sách tài khoản.", "ok");
    });

    // =========================================================================
    // 3. CẤU HÌNH SỐ PHÒNG MỖI HẠNG & SỐ BOT (/api/admin/population)
    // =========================================================================
    var popTbody = document.getElementById("pop-tbody");
    var popMinBots = document.getElementById("pop-min-bots");
    var popMsg = document.getElementById("pop-msg");
    var popLimitsDesc = document.getElementById("pop-limits-desc");

    function getTierObj(cfg, key, idx) {
      if (!cfg) return {};
      if (cfg.tiers && Array.isArray(cfg.tiers)) return cfg.tiers[idx] || {};
      if (cfg.tiers && typeof cfg.tiers === "object") return cfg.tiers[key] || {};
      return cfg[key] || {};
    }

    function fillPopForm(cfg, limits) {
      if (!cfg) return;
      popTbody.replaceChildren();
      if (limits) {
        popLimitsDesc.textContent =
          "Tổng số phòng phải đúng bằng " + limits.rooms +
          " phòng; số bot trong khoảng 0.." + limits.maxBots +
          "; bot tối thiểu 0.." + limits.maxMinBots + ".";
        popMinBots.max = String(limits.maxMinBots);
      }

      for (var i = 0; i < TIER_KEYS.length; i++) {
        var key = TIER_KEYS[i];
        var t = getTierObj(cfg, key, i);
        var roomsVal = t.rooms !== undefined ? t.rooms : (t.count !== undefined ? t.count : 0);
        var minVal = t.min !== undefined ? t.min : (t.minBots !== undefined ? t.minBots : 0);
        var maxVal = t.max !== undefined ? t.max : (t.maxBots !== undefined ? t.maxBots : 0);

        var tr = document.createElement("tr");

        var tdLabel = document.createElement("td");
        tdLabel.style.fontWeight = "600";
        tdLabel.textContent = TIER_LABELS[key] || key;

        var tdRooms = document.createElement("td");
        var inpRooms = document.createElement("input");
        inpRooms.type = "number";
        inpRooms.min = "0";
        inpRooms.max = limits ? String(limits.rooms) : "10";
        inpRooms.required = true;
        inpRooms.id = "pop-" + key + "-rooms";
        inpRooms.value = String(roomsVal);
        tdRooms.appendChild(inpRooms);

        var tdMin = document.createElement("td");
        var inpMin = document.createElement("input");
        inpMin.type = "number";
        inpMin.min = "0";
        inpMin.max = limits ? String(limits.maxBots) : "24";
        inpMin.required = true;
        inpMin.id = "pop-" + key + "-min";
        inpMin.value = String(minVal);
        tdMin.appendChild(inpMin);

        var tdMax = document.createElement("td");
        var inpMax = document.createElement("input");
        inpMax.type = "number";
        inpMax.min = "0";
        inpMax.max = limits ? String(limits.maxBots) : "24";
        inpMax.required = true;
        inpMax.id = "pop-" + key + "-max";
        inpMax.value = String(maxVal);
        tdMax.appendChild(inpMax);

        tr.append(tdLabel, tdRooms, tdMin, tdMax);
        popTbody.appendChild(tr);
      }
      popMinBots.value = String(cfg.minBots !== undefined ? cfg.minBots : 0);
    }

    function buildPopPayload(templateCfg) {
      var clone = JSON.parse(JSON.stringify(templateCfg));
      clone.minBots = Number(popMinBots.value);
      for (var i = 0; i < TIER_KEYS.length; i++) {
        var key = TIER_KEYS[i];
        var rVal = Number(document.getElementById("pop-" + key + "-rooms").value);
        var minVal = Number(document.getElementById("pop-" + key + "-min").value);
        var maxVal = Number(document.getElementById("pop-" + key + "-max").value);

        var target = getTierObj(clone, key, i);
        if ("count" in target && !("rooms" in target)) target.count = rVal;
        else target.rooms = rVal;

        if ("minBots" in target && !("min" in target)) target.minBots = minVal;
        else target.min = minVal;

        if ("maxBots" in target && !("max" in target)) target.maxBots = maxVal;
        else target.max = maxVal;
      }
      return clone;
    }

    document.getElementById("pop-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!popData) return;
      var payload = buildPopPayload(popData.config);
      api("/api/admin/population", {
        method: "PUT",
        body: payload
      }).then(function (res) {
        if (res.ok) {
          return res.json().then(function (d) {
            popData = d;
            fillPopForm(d.config, d.limits);
            setStatus(popMsg, "Đã lưu cấu hình số phòng và bot.", "ok");
            loadOverview();
          });
        }
        setStatus(popMsg, "Cấu hình không hợp lệ (tổng số phòng phải bằng 10 và Bot thấp không vượt Bot cao).", "err");
      });
    });

    document.getElementById("btn-reset-pop").addEventListener("click", function () {
      if (!popData || !popData.defaults) return;
      fillPopForm(popData.defaults, popData.limits);
      setStatus(popMsg, "Đã điền cấu hình mặc định (bấm \"Lưu cấu hình Bot\" để áp dụng).", "warn");
    });

    // =========================================================================
    // 4. ĐỔI TÊN 10 PHÒNG (/api/admin/rooms)
    // =========================================================================
    var namesGrid = document.getElementById("names-grid");
    var namesMsg = document.getElementById("names-msg");
    var namesDesc = document.getElementById("names-desc");

    function fillNamesForm(names, maxChars) {
      if (!names || !Array.isArray(names)) return;
      namesGrid.replaceChildren();
      if (maxChars) {
        namesDesc.textContent = "Đặt tên hiển thị cho 10 phòng (1.." + maxChars + " ký tự, không trùng nhau).";
      }
      for (var i = 0; i < names.length; i++) {
        var wrap = document.createElement("div");
        wrap.className = "field";
        var lbl = document.createElement("label");
        lbl.setAttribute("for", "room-name-" + i);
        lbl.textContent = "Phòng " + (i + 1) + " (san-" + (i + 1 < 10 ? "0" + (i + 1) : (i + 1)) + ")";
        var inp = document.createElement("input");
        inp.type = "text";
        inp.id = "room-name-" + i;
        inp.maxLength = maxChars || 24;
        inp.required = true;
        inp.value = names[i] || "";
        wrap.append(lbl, inp);
        namesGrid.appendChild(wrap);
      }
    }

    function collectRoomNames(count) {
      var arr = [];
      for (var i = 0; i < count; i++) {
        var el = document.getElementById("room-name-" + i);
        arr.push(el ? el.value.trim() : "");
      }
      return arr;
    }

    document.getElementById("names-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!roomNamesData) return;
      var count = (roomNamesData.names && roomNamesData.names.length) || 10;
      var names = collectRoomNames(count);

      api("/api/admin/rooms", {
        method: "PUT",
        body: { names: names }
      }).then(function (res) {
        if (res.status === 400) {
          return api("/api/admin/rooms", { method: "PUT", body: names });
        }
        return res;
      }).then(function (res) {
        if (res && res.ok) {
          return res.json().then(function (d) {
            roomNamesData = d;
            fillNamesForm(d.names, d.maxChars);
            setStatus(namesMsg, "Đã lưu tên 10 phòng thành công.", "ok");
            loadOverview();
          });
        }
        setStatus(namesMsg, "Tên phòng không hợp lệ (không để trống và không trùng tên giữa 2 phòng).", "err");
      });
    });

    document.getElementById("btn-reset-names").addEventListener("click", function () {
      if (!roomNamesData || !roomNamesData.defaults) return;
      fillNamesForm(roomNamesData.defaults, roomNamesData.maxChars);
      setStatus(namesMsg, "Đã điền tên phòng mặc định (bấm \"Lưu tên phòng\" để áp dụng).", "warn");
    });

    // =========================================================================
    // KHỞI ĐỘNG & ĐĂNG NHẬP
    // =========================================================================
    function startAutoRefresh() {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(function () {
        var chk = document.getElementById("chk-autorefresh");
        if (chk && chk.checked && !appView.hidden) {
          loadOverview();
        }
      }, 5000);
    }

    function bootstrapAll() {
      var creds = getCreds();
      if (!creds.pw) {
        showLogin("", "");
        return;
      }
      if (btnLogin) {
        btnLogin.disabled = true;
        btnLogin.textContent = "Đang xác thực...";
      }
      setStatus(loginMsg, "Đang kết nối máy chủ quản trị...", "warn");
      api("/api/admin/population").then(function (res) {
        if (res.status === 401) {
          clearCreds();
          showLogin("Sai tài khoản hoặc mật khẩu quản trị.", "err");
          return;
        }
        if (res.status === 429) {
          var retry = res.headers.get("retry-after") || "60";
          showLogin("Nhập sai quá nhiều lần. Vui lòng thử lại sau " + retry + " giây.", "err");
          return;
        }
        if (!res.ok) {
          showLogin("Máy chủ từ chối truy cập (HTTP " + res.status + "). Hãy kiểm tra biến ADMIN_PASSWORD trên Northflank.", "err");
          return;
        }
        return res.json().then(function (pop) {
          popData = pop;
          showApp(creds.user);
          try {
            fillPopForm(pop.config || pop, pop.limits);
          } catch (err) {
            console.error(err);
          }
          return Promise.all([
            api("/api/admin/rooms").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
            loadOverview(),
            loadAccounts()
          ]);
        }).then(function (results) {
          if (results && results[0]) {
            roomNamesData = results[0];
            try {
              fillNamesForm(roomNamesData.names, roomNamesData.maxChars);
            } catch (err) {
              console.error(err);
            }
          }
        });
      }).catch(function (err) {
        console.error(err);
        showLogin("Lỗi kết nối tới máy chủ. Nếu dùng tên miền dichua.asia, hãy trỏ CNAME/URL trực tiếp thay vì Frame Redirect.", "err");
      });
    }

    function handleLoginAttempt(ev) {
      if (ev) ev.preventDefault();
      var u = (loginUser && loginUser.value ? loginUser.value.trim() : "") || "admin";
      var p = loginPw && loginPw.value ? loginPw.value.trim() : "";
      if (!p) {
        setStatus(loginMsg, "Vui lòng nhập mật khẩu quản trị.", "warn");
        if (loginPw) loginPw.focus();
        return;
      }
      setCreds(u, p);
      bootstrapAll();
    }

    if (btnLogin) {
      btnLogin.addEventListener("click", handleLoginAttempt);
    }
    if (loginForm) {
      loginForm.addEventListener("submit", handleLoginAttempt);
    }
    if (loginPw) {
      loginPw.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          handleLoginAttempt(ev);
        }
      });
    }
    if (loginUser) {
      loginUser.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          handleLoginAttempt(ev);
        }
      });
    }

    bootstrapAll();
  })();
  </script>
</body>
</html>
`;
