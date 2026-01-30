const socket = io();
const menu = document.getElementById("main-menu");
let currentLobbyId = "";

/* 初期イベント設定 */
window.onload = () => {
  document.getElementById("create-lobby").onclick = () => {
    const name = document.getElementById("username").value || "USER";
    socket.emit("create-lobby", name);
  };
  document.getElementById("join-lobby").onclick = () => {
    const id = prompt("4桁のロビーID");
    const name = document.getElementById("username").value || "USER";
    if (id) {
      currentLobbyId = id;
      socket.emit("join-lobby", { lobbyId: id, username: name });
    }
  };
};

/* 待機・開始イベント */
socket.on("lobby-created", (id) => {
  currentLobbyId = id;
  renderWaiting(1, socket.id);
});

socket.on("update-waiting", (data) => {
  /* 階層を修正してundefinedを防止 */
  renderWaiting(data.count, data.hostId);
});

socket.on("game-start", (l) => render(l));
socket.on("update-game", (l) => render(l));

/* 待機画面の描画 */
function renderWaiting(count, hostId) {
  const isHost = socket.id === hostId;
  const canStart = count >= 2;

  menu.innerHTML = `
    <div class="container">
      <h1>LOBBY ID: ${currentLobbyId}</h1>
      <div class="loading-spinner"></div>
      <p>プレイヤーを待っています... (${count}/4)</p>
      ${
        isHost
          ? `<button id="start-btn" class="btn-primary" ${canStart ? "" : "disabled"}
            style="${canStart ? "" : "opacity:0.5; cursor:not-allowed;"}">
            ${canStart ? "ゲームを開始する" : "2人以上で開始可能"}
           </button>`
          : `<p style="font-size: 0.9rem; color: #aaa;">ホストが開始するのを待っています...</p>`
      }
    </div>
  `;

  if (isHost && canStart) {
    document.getElementById("start-btn").onclick = () => {
      socket.emit("start-game");
    };
  }
}

/* ゲーム画面の描画 */
function render(l) {
  const me = l.players.find((p) => p.id === socket.id);
  const opponents = l.players.filter((p) => p.id !== socket.id);
  const isMyTurn = l.players[l.activePlayerIdx].id === socket.id;

  menu.innerHTML = `
    <div class="game-container">
      <div class="turn-info">TURN: ${l.turn}/5 | アクティブ: ${l.players[l.activePlayerIdx].name}</div>
      <div class="opponents-wrapper" style="display: flex; justify-content: space-around; margin-bottom: 20px;">
        ${opponents
          .map(
            (op) => `
          <div class="opponent-card ${l.players[l.activePlayerIdx].id === op.id ? "active-glow" : ""}">
            <div style="font-size: 0.8rem;">${op.name}</div>
            <div class="influence-display" style="font-size: 1.2rem;">INF: ${op.influence}</div>
          </div>
        `,
          )
          .join("")}
      </div>
      <div class="log-display">${l.lastAction}</div>
      <div class="my-area">
        <div class="influence-display highlight">MY: ${me.influence}</div>
        <p style="color: #27ae60; font-weight: bold;">
          ${isMyTurn ? "★ あなたの番です！" : "待機中..."}
        </p>
        <div class="hand">
          ${me.hand
            .map(
              (c) => `
            <div class="card" onclick="${isMyTurn ? `socket.emit('play-card', '${c.id}')` : ""}"
                 style="${isMyTurn ? "cursor: pointer;" : "opacity: 0.6; cursor: not-allowed;"}">
              <div class="card-target">${c.target === "SELF" ? "自分" : "誰か"}</div>
              <div class="card-name">${c.name}</div>
              <div class="card-stats">
                ${c.type === "SWAP" ? "入れ替え" : `${c.min}〜${c.max}<br>${c.type === "ADD" ? "増" : "減"}`}
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

/* 終了イベント */
socket.on("game-over", (ps) => {
  const sorted = [...ps].sort((a, b) => b.influence - a.influence);
  const rank = sorted.findIndex((p) => p.id === socket.id) + 1;
  menu.innerHTML = `
    <div class="result-screen">
      <h1>RANKING: ${rank}位</h1>
      <div style="text-align: left; display: inline-block; margin-bottom: 20px;">
        ${sorted.map((p, i) => `<p>${i + 1}位: ${p.name} (${p.influence})</p>`).join("")}
      </div>
      <br>
      <button onclick="location.reload()" class="btn-primary">ロビーへ戻る</button>
    </div>
  `;
});

socket.on("opponent-disconnected", () => {
  alert("プレイヤーが切断されました");
  location.reload();
});
