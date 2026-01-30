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

/* カード生成ロジック */
const generateCard = () => {
  const t = cardTemplates[Math.floor(Math.random() * cardTemplates.length)];
  const min = Math.floor(t.rangeBase[0] * (Math.random() * 0.5 + 0.5));
  const max = Math.floor(t.rangeBase[1] * (Math.random() * 0.5 + 1.0));

  return {
    id: Math.random().toString(36).substr(2, 9),
    name: t.name,
    type: t.type,
    target: t.target,
    min: min,
    max: max,
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

      /* 全員に現在の人数とホストIDを通知 */
      io.to(lobbyId).emit("update-waiting", {
        count: lobby.players.length,
        hostId: lobby.hostId,
      });
    }
  });

  /* ゲーム開始（ホストのみ） */
  socket.on("start-game", () => {
    const lobbyId = socketToLobby[socket.id];
    const lobby = lobbies[lobbyId];

    if (lobby && lobby.hostId === socket.id && lobby.players.length >= 2) {
      lobby.isStarted = true;
      lobby.players.forEach((p) => {
        p.influence = Math.floor(Math.random() * 1901) + 100;
        p.hand = [generateCard(), generateCard(), generateCard()];
      });
      lobby.lastAction = "BATTLE START!";
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
      const temp = player.influence;
      player.influence = targetPlayer.influence;
      targetPlayer.influence = temp;
      lobby.lastAction = `アルゴリズム崩壊！${player.name}と${targetPlayer.name}の影響力が入れ替わった！`;
    }

    player.hand[cardIdx] = generateCard();
    lobby.activePlayerIdx = (lobby.activePlayerIdx + 1) % lobby.players.length;

    if (lobby.activePlayerIdx === 0) {
      lobby.turn++;
    }

    if (lobby.turn > 5) {
      io.to(lobbyId).emit("game-over", lobby.players);
    } else {
      io.to(lobbyId).emit("update-game", lobby);
    }
  });

  /* 切断処理 */
  socket.on("disconnect", () => {
    const id = socketToLobby[socket.id];
    if (id && lobbies[id]) {
      socket.to(id).emit("opponent-disconnected");
      delete lobbies[id];
    }
  });
});

http.listen(3000, "0.0.0.0", () => console.log("Server running on port 3000"));
