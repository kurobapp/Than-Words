const socket = io();
const menu = document.getElementById("main-menu");
let currentLobbyId = "";

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

socket.on("lobby-created", (id) => {
  currentLobbyId = id;
  renderWaiting(1, socket.id);
});

socket.on("update-waiting", (data) => {
  renderWaiting(data.count, data.hostId);
});

socket.on("game-start", (l) => render(l));
socket.on("update-game", (l) => render(l));

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
            <div class="influence-display" style="font-size: 1.0rem;">影響力: ${op.influence}</div>
          </div>
        `,
          )
          .join("")}
      </div>
      <div class="log-display">${l.lastAction}</div>
      <div class="my-area">
        <div class="influence-display highlight">影響力: ${me.influence}</div>
        <p style="color: #27ae60; font-weight: bold;">
          ${isMyTurn ? "★ あなたの番です！" : "待機中..."}
        </p>
        <div class="hand">
          ${me.hand
            .map(
              (c) => `
            <div class="card" onclick="${isMyTurn ? `socket.emit('play-card', '${c.id}')` : ""}"
                 style="${isMyTurn ? "cursor: pointer;" : "opacity: 0.6; cursor: not-allowed;"}">
              <div class="card-target">${translateTarget(c.target)}</div>
              <div class="card-name">${c.name}</div>
              <div class="card-stats">
                ${describeEffect(c)}
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

function translateTarget(t) {
  if (t === "SELF") return "自分";
  if (t === "ENEMY") return "相手";
  if (t === "ALL") return "誰か";
  return "全体";
}

function describeEffect(c) {
  if (c.type === "SWAP") return "影響力を入れ替える！(50%)";
  if (c.type === "BAN") return "誰かの影響力0にする！";
  if (c.type === "GAMBLE") return `自分&敵<br>0 or ${c.min}〜${c.max}倍`;
  return `${c.min}〜${c.max}<br>${c.type === "ADD" ? "増" : "減"}`;
}

socket.on("game-over", (ps) => {
  const sorted = [...ps].sort((a, b) => b.influence - a.influence);
  const rank = sorted.findIndex((p) => p.id === socket.id) + 1;
  menu.innerHTML = `
    <div class="result-screen">
      <h1>RANKING: ${rank}位</h1>
      <div style="text-align: left; display: inline-block; margin-bottom: 20px;">
        ${sorted.map((p, i) => `<p>${i + 1}位: ${p.name} (影響力: ${p.influence})</p>`).join("")}
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
