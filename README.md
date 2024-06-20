## 環境構築

### git のインストール

git は Github Desktop をインストールすることでインストールされます。

[GitHub Desktop](https://desktop.github.com/)

### Node.js のインストール

PowerShell を起動し、以下のコマンドを実行します。

```powershell

winget install Schniz.fnm
fnm use --install-if-missing 20

```

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
