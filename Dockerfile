# ベースとなるイメージ（軽量なNode.js環境）
FROM node:18-alpine

# コンテナ内の作業ディレクトリを設定
WORKDIR /app

# 依存関係のファイルをコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm install

# ソースコード一式をコピー
COPY . .

# ポート3000を公開
EXPOSE 3000

# サーバー起動コマンド
CMD ["npm", "start"]
