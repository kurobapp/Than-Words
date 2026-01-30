const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const fs = require("fs");

app.use(express.static("public"));

/* カードデータの読み込み */
let cardTemplates = [];
try {
  const data = fs.readFileSync("./card.json", "utf8");
  cardTemplates = JSON.parse(data);
} catch (err) {
  console.error("カードファイルの読み込みに失敗しました:", err);
  cardTemplates = [
    { name: "エラー用カード", type: "ADD", target: "SELF", rangeBase: [0, 0] },
  ];
}

const lobbies = {};
const socketToLobby = {};

/* --- 確率変動ロジック（対数正規分布） --- */
const getLogNormal = (base, sigma = 0.6) => {
  if (base === 0) return 0;
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.floor(base * Math.exp(z * sigma));
};

/* カード生成エンジン */
const generateCard = () => {
  const t = cardTemplates[Math.floor(Math.random() * cardTemplates.length)];
  let val1 = getLogNormal(t.rangeBase[0]);
  let val2 = getLogNormal(t.rangeBase[1]);
  const min = Math.min(val1, val2);
  const max = Math.max(val1, val2);

  return {
    id: Math.random().toString(36).substr(2, 9),
    name: t.name,
    type: t.type,
    target: t.target,
    min: Math.max(1, min), // 最低でも1
    max: Math.max(1, max),
  };
};

/* 通信処理 */
io.on("connection", (socket) => {
  /* ロビー作成 */
  socket.on("create-lobby", (username) => {
    const lobbyId = Math.floor(1000 + Math.random() * 9000).toString();
    lobbies[lobbyId] = {
      players: [{ id: socket.id, name: username, influence: 0, hand: [] }],
      hostId: socket.id,
      turn: 1,
      activePlayerIdx: 0,
      startPlayerIdx: 0, // 誰から始まったかを記録する変数
      lastAction: "プレイヤーを待機中...",
      maxPlayers: 4,
      isStarted: false,
    };
    socketToLobby[socket.id] = lobbyId;
    socket.join(lobbyId);
    socket.emit("lobby-created", lobbyId);
  });

  /* ロビー参加 */
  socket.on("join-lobby", (data) => {
    const { lobbyId, username } = data;
    const lobby = lobbies[lobbyId];

    if (lobby && !lobby.isStarted && lobby.players.length < lobby.maxPlayers) {
      lobby.players.push({
        id: socket.id,
        name: username,
        influence: 0,
        hand: [],
      });
      socketToLobby[socket.id] = lobbyId;
      socket.join(lobbyId);

      io.to(lobbyId).emit("update-waiting", {
        count: lobby.players.length,
        hostId: lobby.hostId,
      });
    }
  });

  /* ゲーム開始 */
  socket.on("start-game", () => {
    const lobbyId = socketToLobby[socket.id];
    const lobby = lobbies[lobbyId];

    if (lobby && lobby.hostId === socket.id && lobby.players.length >= 2) {
      lobby.isStarted = true;
      lobby.players.forEach((p) => {
        p.influence = Math.floor(Math.random() * 1901) + 100;
        p.hand = [generateCard(), generateCard(), generateCard()];
      });

      // --- スタートプレイヤーのランダム決定 ---
      lobby.activePlayerIdx = Math.floor(Math.random() * lobby.players.length);
      // 1周の判定用に、誰から始まったかを記録
      lobby.startPlayerIdx = lobby.activePlayerIdx;

      lobby.lastAction = `BATTLE START! ${lobby.players[lobby.activePlayerIdx].name}からスタート！`;
      io.to(lobbyId).emit("game-start", lobby);
    }
  });

  /* カードプレイ */
  socket.on("play-card", (cardId) => {
    const lobbyId = socketToLobby[socket.id];
    const lobby = lobbies[lobbyId];
    if (!lobby || lobby.players[lobby.activePlayerIdx].id !== socket.id) return;

    const player = lobby.players[lobby.activePlayerIdx];
    const cardIdx = player.hand.findIndex((c) => c.id === cardId);
    const card = player.hand[cardIdx];

    const finalValue =
      Math.floor(Math.random() * (card.max - card.min + 1)) + card.min;

    /* --- カード効果処理 --- */
    if (card.type === "ADD") {
      player.influence += finalValue;
      lobby.lastAction = `${player.name}が「${card.name}」で影響力を ${finalValue} 増やした！`;
    } else if (card.type === "SUB") {
      const targets = lobby.players.filter((p) => p.id !== player.id);
      const targetPlayer = targets[Math.floor(Math.random() * targets.length)];
      targetPlayer.influence = Math.max(0, targetPlayer.influence - finalValue);
      lobby.lastAction = `${targetPlayer.name}が、${player.name}の「${card.name}」で ${finalValue} 削られた！`;
    } else if (card.type === "SWAP") {
      const targets = lobby.players.filter((p) => p.id !== player.id);
      const targetPlayer = targets[Math.floor(Math.random() * targets.length)];

      if (Math.random() < 0.5) {
        const temp = player.influence;
        player.influence = targetPlayer.influence;
        targetPlayer.influence = temp;
        lobby.lastAction = `アカウント乗っ取り成功！${player.name}と${targetPlayer.name}の影響力が入れ替わった！`;
      } else {
        lobby.lastAction = `アカウント乗っ取り失敗... ${player.name}はセキュリティを突破できなかった！`;
      }
    } else if (card.type === "BAN") {
      const targetPlayer =
        lobby.players[Math.floor(Math.random() * lobby.players.length)];
      targetPlayer.influence = 0;
      lobby.lastAction = `【垢BAN】運営の鉄槌！${targetPlayer.name}の影響力が消滅した...`;
    } else if (card.type === "GAMBLE") {
      const targets = lobby.players.filter((p) => p.id !== player.id);
      const targetPlayer = targets[Math.floor(Math.random() * targets.length)];

      let myResult = "";
      if (Math.random() < 0.5) {
        player.influence *= finalValue;
        myResult = `${finalValue}倍`;
      } else {
        player.influence = 0;
        myResult = "0";
      }

      let enemyResult = "";
      if (Math.random() < 0.5) {
        targetPlayer.influence *= finalValue;
        enemyResult = `${finalValue}倍`;
      } else {
        targetPlayer.influence = 0;
        enemyResult = "0";
      }

      lobby.lastAction = `泥沼のレスバトル！${player.name}は${myResult}、${targetPlayer.name}は${enemyResult}になった！`;
    }

    // 手札補充
    player.hand[cardIdx] = generateCard();

    // ターン交代（時計回り）
    lobby.activePlayerIdx = (lobby.activePlayerIdx + 1) % lobby.players.length;

    // スタートプレイヤーに戻ってきたらターン数を加算
    if (lobby.activePlayerIdx === lobby.startPlayerIdx) {
      lobby.turn++;
    }

    if (lobby.turn > 5) {
      io.to(lobbyId).emit("game-over", lobby.players);
    } else {
      io.to(lobbyId).emit("update-game", lobby);
    }
  });

  socket.on("disconnect", () => {
    const id = socketToLobby[socket.id];
    if (id && lobbies[id]) {
      socket.to(id).emit("opponent-disconnected");
      delete lobbies[id];
    }
  });
});

http.listen(3000, "0.0.0.0", () => console.log("Server running on port 3000"));
