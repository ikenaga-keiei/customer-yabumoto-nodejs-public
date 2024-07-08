## 環境構築

### git のインストール

git は Github Desktop をインストールすることでインストールされます。

[GitHub Desktop](https://desktop.github.com/)

### Node.js のインストール

[Node.js](https://nodejs.org/en/download/prebuilt-installer)

上記のページから、20.15.0 LTS をダウンロードしてインストールしてください。

### リポジトリのクローン

コマンドプロンプト、もしくは PowerShell を起動し、プログラムをインストールしたいフォルダに移動した上で以下のコマンドを実行します。

```bash
git clone https://github.com/ikenaga-keiei/customer-yabumoto-nodejs-public.git
```

### .env ファイルの作成

.env.sample ファイルをコピーして .env ファイルを作成してください。

```bash
copy .env.sample .env
```

コピー後、ご利用の環境に合わせて .env ファイルを編集してください。
