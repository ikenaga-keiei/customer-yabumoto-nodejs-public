import fs from 'fs-extra';

/**
 * 時間のかかる処理の前後で実行し、処理の進捗を監視するためのクラス
 * 時間の計測と、ファイルへのログ出力を行う
 */
export class Observer {
  #label: string | null;
  #startTime: number;
  #logFilePath: string;
  #log: string;

  constructor(logFilePath: string) {
    this.#label = null;
    this.#startTime = 0;
    this.#logFilePath = logFilePath;
    this.#log = '';
  }

  public log(...params: Parameters<typeof console.log>) {
    console.log(...params);
    this.#log +=
      params.map((param) => (typeof param === 'string' ? param : JSON.stringify(param))).join(' ') +
      '\n';
  }

  /**
   * 処理の開始時間を記録する
   */
  start(label?: string) {
    const now = new Date();
    this.#startTime = now.getTime();
    if (label) {
      this.#label = label;
      console.group(label);
      this.log(`[${now.toLocaleString()}] ${label}:開始`);
    }
  }

  /**
   * 処理の終了時間を記録し、処理時間を出力する
   */
  end() {
    const now = new Date();
    const elapsed = now.getTime() - this.#startTime;
    this.log(`[${now.toLocaleString()}] ${this.#label}:終了 ${elapsed}ms`);
    if (this.#label) {
      console.groupEnd();
    }
    this.#label = null;
  }

  /**
   * ログをファイルに出力する
   */
  public write() {
    return fs.writeFile(this.#logFilePath, this.#log);
  }
}
