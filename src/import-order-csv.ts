import path from 'path';
import { parse } from 'papaparse';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import {
  convertFullwidthAlphanumericToHalfwidth,
  convertHalfwidthKatakanaToFullwidth,
} from './lib/character-width-conversion';
import {
  Address,
  formatAddress,
  formatAddressNumber,
  formatName,
  formatPhoneNumber,
  formatRemark,
  getUserKey,
  groupBy,
} from './lib/utils';
import { kintoneAPI } from '@konomi-app/kintone-utilities';
import { bulkRequest } from './lib/rest-api';
import { APP_ID_CLIENT } from './constants';
import { getClientRecordsMap, getRemarkTemplates } from './lib/kintone';
import { sendMessageForIkenagaChatwork, sendResultMessageForIkenagaChatwork } from './lib/chatwork';
import { Observer } from './observer';
import fs from 'fs-extra';
import { DateTime } from 'luxon';
import { config } from 'dotenv';
config();

type CacheData = {
  version: 1;
  orderIds: string[];
};

const OUTPUT_ROOT = 'log';

const CACHE_ROOT = 'cache';

/**
 * タテンポガイドから出力された注文情報のCSVデータのカラム
 */
const TATENPO_COLUMNS = [
  '受注ID',
  '受注ステータス',
  '受注日時',
  'ECサイト',
  'ECサイトの受注番号',
  '受注方法',
  '備考',
  '担当者備考',
  'キャンセル理由',
  'キャンセル備考',
  '受注区分',
  '在庫引当',
  '請求区分',
  '入金区分',
  '配送区分',
  '支払い方法',
  '与信処理日時',
  '請求処理日時',
  '入金日',
  '入金済額',
  '顧客マスタID',
  '注文者氏名',
  '注文者カナ',
  '注文者法人名・団体名',
  '注文者電話番号',
  '注文者電話番号２',
  '注文者FAX番号',
  '注文者電話番号(会社)',
  '注文者メールアドレス',
  '注文者メールアドレス２',
  '注文者郵便番号',
  '注文者都道府県',
  '注文者市区町村',
  '注文者番地',
  '注文者建物名',
  '性別',
  'お知らせメール受取フラグ',
  'Yahoo!ID',
  '楽天スーパーDEAL',
  '送付先氏名',
  '送付先カナ',
  '送付先法人名・団体名',
  '送付先郵便番号',
  '送付先都道府県',
  '送付先市区町村',
  '送付先番地',
  '送付先建物名',
  '送付先電話番号',
  '配送方法',
  '配送希望日',
  '配送希望時間',
] as const;

type TatenpoOrderCSVRow = Record<(typeof TATENPO_COLUMNS)[number], string>;

type ExtendedTatenpoOrderCSVRow = TatenpoOrderCSVRow & {
  key: string;
  ordererName: string;
  address: Address;
  addressNumber: string;
  phoneNumber: string;
  primaryPhoneNumber: string;
  secondaryPhoneNumber: string;
  tertiaryPhoneNumber: string;
  remark: string;
  recipientKey: string;
  recipientName: string;
  recipientAddress: Address;
  recipientAddressNumber: string;
  recipientPhoneNumber: string;
};

(async () => {
  try {
    [OUTPUT_ROOT, CACHE_ROOT].forEach((dir) => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    });

    const now = DateTime.local();
    const { year, month } = now;
    const { year: previousMonthYear, month: previousMonth } = now.minus({ months: 1 });

    const isPreviousMonthEnabled =
      previousMonthYear > 2024 || (previousMonthYear === 2024 && previousMonth >= 6);

    const dates = [
      ...(isPreviousMonthEnabled ? [{ year: previousMonthYear, month: previousMonth }] : []),
      { year, month },
    ];

    const observer = new Observer(
      path.join(OUTPUT_ROOT, `${now.toFormat('yyyy_MM_dd_hh_mm_ss')}_import_order_csv.log`)
    );
    for (const { year, month } of dates) {
      try {
        observer.log(`📝 ${year}年${month}月の受注データ取込を開始します`);
        await importOrderCSV({ year, month, observer });
        try {
          await sendResultMessageForIkenagaChatwork(observer.getFullLog());
        } catch (e) {}
      } catch (error: any) {
        observer.log(error?.message);
        try {
          await sendMessageForIkenagaChatwork(
            `${year}年${month}月の受注データ取込時にエラーが発生しました[hr]${error?.message}
    ${observer.getFullLog()}`
          );
        } catch (e) {
          await sendMessageForIkenagaChatwork(
            `${year}年${month}月の受注データ取込時にエラーが発生しました[hr]${error?.message}`
          );
        }
      }
    }
    observer.write();
  } catch (error) {
    try {
      if (error instanceof Error) {
        await sendMessageForIkenagaChatwork(
          `受注データ取込時にエラーが発生しました[hr]${error.message}`
        );
      } else {
        await sendMessageForIkenagaChatwork(`受注データ取込時にエラーが発生しました`);
      }
    } catch (e) {}
  }
})();

/**
 * 受注データを読み込み、顧客情報を登録・更新する
 *
 * - CSVを読み込む
 * - 重複する受注IDを削除する
 * - 顧客情報を取得する
 * - 備考テンプレートを取得する
 * - CSVデータを補完する
 * - 顧客情報の登録・更新の振り分けを行う
 *   - 行の「注文者氏名」、「注文者電話番号」、「注文者都道府県」「注文者市区町村」、「注文者番地」、「注文者建物名」をキーとする
 *   - いずれかの顧客情報の「重複キー」とキーが一致する場合は更新対象、そうでない場合は追加対象とする
 * - レコードを作成する
 * - レコードを登録・更新する
 * - キャッシュデータを更新する
 */
async function importOrderCSV(params: { year: number; month: number; observer: Observer }) {
  const { year, month, observer } = params;
  const monthString = month.toString().padStart(2, '0');
  const targetFilePath = path.join(
    process.env.TG_ORDER_DIRECTORY_PATH!,
    year.toString(),
    monthString,
    `tg_order_sells__${year}_${monthString}.csv`
  );

  if (!existsSync(targetFilePath)) {
    throw new Error(`${targetFilePath} が見つかりません`);
  }

  const file = readFileSync(targetFilePath, 'utf-8');

  observer.start('CSVデータの読み込み');
  const { data, errors } = parse<TatenpoOrderCSVRow>(file, { header: true });
  for (const error of errors) {
    observer.log(`[ERROR] ${error.message}`);
  }
  observer.end();

  observer.start('受注IDが重複するデータを削除');
  const cachePath = path.join(CACHE_ROOT, `${year}_${monthString}.json`);

  let cacheData: CacheData = {
    version: 1,
    orderIds: [],
  };
  if (fs.existsSync(cachePath)) {
    cacheData = fs.readJSONSync(cachePath);
    observer.log(`📦 キャッシュデータを読み込みました`);
  }

  const filteredData = data
    .filter((row) => !!row['注文者氏名'] || !!row['注文者電話番号'] || !!row['注文者都道府県'])
    .filter((row) => !cacheData.orderIds.includes(row['受注ID']))
    .filter((row, index, self) => self.findIndex((r) => r['受注ID'] === row['受注ID']) === index);

  cacheData.orderIds.push(...filteredData.map((row) => row['受注ID']));
  observer.end();

  if (!filteredData.length) {
    observer.log('未登録のデータが存在しないため、処理を終了します');
    observer.write();
    return;
  }

  observer.start('備考テンプレートの取得');
  const remarkTemplates = await getRemarkTemplates();
  observer.end();

  observer.start('CSVデータの補完');
  const completed = filteredData.map((row) => extendTatenpoOrderCSVRow(row, remarkTemplates));
  observer.end();

  observer.start('登録済みの顧客情報を取得');
  const clientRecordsMap = await getClientRecordsMap({
    fields: ['$id', '重複キー', '備考', '送付先情報'],
  });
  observer.end();

  observer.start('顧客情報の登録・更新の振り分け');
  let addTargets: typeof completed = [];
  let updateTargets: typeof completed = [];
  for (const row of completed) {
    const key = row.key;
    const foundInAddTargets = addTargets.find((r) => r.key === key);
    if (foundInAddTargets) {
      foundInAddTargets.remark += `\n${row.remark}`;
    } else if (clientRecordsMap[key]) {
      const foundInUpdateTargets = updateTargets.find((r) => r.key === key);
      if (foundInUpdateTargets) {
        foundInUpdateTargets.remark += `\n${row.remark}`;
      } else {
        updateTargets.push(row);
      }
    } else {
      addTargets.push(row);
    }
  }
  observer.end();

  observer.start('レコードの作成');
  const newRecords = addTargets.map(getKintoneRecordFromCsvRow);
  const recordsToUpdate: any[] = [];
  const updateOrderers = groupBy(updateTargets, (row) => row.key);
  for (const [key, values] of Object.entries(updateOrderers)) {
    const registered = clientRecordsMap[key];
    if (!registered) {
      continue;
    }

    const subtable = registered['送付先情報'] as kintoneAPI.field.Subtable;

    const newSubtable = values.reduce((acc, csvRow) => {
      const key = csvRow.recipientKey;

      const isDuplicate = acc.value.some(
        (recipient) =>
          key ===
          getUserKey({
            name: recipient.value['送付先名前'].value as string,
            phoneNumber: recipient.value['送付先電話番号'].value as string,
            address: {
              todofuken: recipient.value['送付先都道府県'].value as string,
              shikuchoson: recipient.value['送付先市区町村'].value as string,
              banchi: recipient.value['送付先番地'].value as string,
              tatemono: recipient.value['送付先建物名'].value as string,
            },
          })
      );

      if (isDuplicate) {
        return acc;
      }

      acc.value.push({
        value: {
          // @ts-ignore
          送付先名前: { value: csvRow.recipientName },
          // @ts-ignore
          送付先電話番号: { value: csvRow.recipientPhoneNumber },
          // @ts-ignore
          送付先郵便番号: { value: csvRow.recipientAddressNumber },
          // @ts-ignore
          送付先都道府県: { value: csvRow.recipientAddress.todofuken },
          // @ts-ignore
          送付先市区町村: { value: csvRow.recipientAddress.shikuchoson },
          // @ts-ignore
          送付先番地: { value: csvRow.recipientAddress.banchi },
          // @ts-ignore
          送付先建物名: { value: csvRow.recipientAddress.tatemono },
        },
      });

      return acc;
    }, subtable);

    const newRemark = `${values.map((row) => row.remark).join('\n')}${
      registered['備考']?.value ? `\n${registered['備考'].value}` : ''
    }`;

    recordsToUpdate.push({
      id: registered?.$id.value as string,
      record: {
        送付先情報: newSubtable,
        備考: { value: newRemark },
      },
    });
  }
  observer.end();

  observer.start('レコードの登録・更新');
  observer.log(`${newRecords.length}件のレコードを追加します`);
  observer.log(`${recordsToUpdate.length}件のレコードを更新します`);

  const { results } = await bulkRequest({
    requests: [
      {
        type: 'addAllRecords',
        params: { app: APP_ID_CLIENT, records: newRecords },
      },
      {
        type: 'updateAllRecords',
        params: { app: APP_ID_CLIENT, records: recordsToUpdate },
      },
    ],
    debug: true,
  });
  observer.end();

  observer.start('キャッシュデータの更新');
  fs.writeJSONSync(cachePath, cacheData);
  observer.log(`📦 キャッシュデータを更新しました`);
  observer.end();

  await observer.write();
}

function extendTatenpoOrderCSVRow(
  row: TatenpoOrderCSVRow,
  remarkTemplates: string[]
): ExtendedTatenpoOrderCSVRow {
  const ordererName = formatName(row['注文者氏名']);
  const address = formatAddress({
    todofuken: row['注文者都道府県'],
    shikuchoson: row['注文者市区町村'],
    banchi: row['注文者番地'],
    tatemono: row['注文者建物名'],
  });
  const addressNumber = formatAddressNumber(row['注文者郵便番号']);
  const primaryPhoneNumber = formatPhoneNumber(row['注文者電話番号']);
  const secondaryPhoneNumber = formatPhoneNumber(row['注文者電話番号(会社)']);
  const tertiaryPhoneNumber = formatPhoneNumber(row['注文者電話番号２']);
  const phoneNumber = primaryPhoneNumber || secondaryPhoneNumber || tertiaryPhoneNumber;

  const key = getUserKey({ name: ordererName, phoneNumber, address });

  const remark = formatRemark(
    `${row['受注ID']}, ${row['受注日時']}${row['担当者備考'] ? `, ${row['担当者備考']}` : ''}`,
    remarkTemplates
  );

  const recipientName = formatName(row['送付先氏名']);
  const recipientAddress = formatAddress({
    todofuken: row['送付先都道府県'],
    shikuchoson: row['送付先市区町村'],
    banchi: row['送付先番地'],
    tatemono: row['送付先建物名'],
  });
  const recipientAddressNumber = formatAddressNumber(row['送付先郵便番号']);
  const recipientPhoneNumber = formatPhoneNumber(row['送付先電話番号']);

  const recipientKey = getUserKey({
    name: recipientName,
    phoneNumber: recipientPhoneNumber,
    address: recipientAddress,
  });

  return {
    ...row,
    key,
    ordererName,
    address,
    addressNumber,
    phoneNumber,
    primaryPhoneNumber,
    secondaryPhoneNumber,
    tertiaryPhoneNumber,
    remark,
    recipientKey,
    recipientName,
    recipientAddress,
    recipientAddressNumber,
    recipientPhoneNumber,
  };
}

function getKintoneRecordFromCsvRow(row: ExtendedTatenpoOrderCSVRow) {
  return {
    タテンポガイド顧客ID: { value: row['顧客マスタID'] },
    名前: { value: row.ordererName },
    フリガナ: {
      value: convertHalfwidthKatakanaToFullwidth(
        convertFullwidthAlphanumericToHalfwidth(row['注文者カナ'] ?? '')
      ),
    },
    電話番号: { value: row.primaryPhoneNumber },
    電話番号1: { value: row.secondaryPhoneNumber },
    電話番号2: { value: row.tertiaryPhoneNumber },
    FAX番号: { value: formatPhoneNumber(row['注文者FAX番号']) },
    郵便番号: { value: formatAddressNumber(row['注文者郵便番号']) },
    備考: { value: row.remark },
    都道府県: { value: row.address.todofuken },
    市区町村: { value: row.address.shikuchoson },
    番地: { value: row.address.banchi },
    建物名: { value: row.address.tatemono },
    重複キー: { value: row.key },
    送付先情報: {
      value: [
        {
          value: {
            送付先名前: { value: row.recipientName },
            送付先電話番号: { value: row.recipientPhoneNumber },
            送付先郵便番号: { value: row.recipientAddressNumber },
            送付先都道府県: { value: row.recipientAddress.todofuken },
            送付先市区町村: { value: row.recipientAddress.shikuchoson },
            送付先番地: { value: row.recipientAddress.banchi },
            送付先建物名: { value: row.recipientAddress.tatemono },
          },
        },
      ],
    },
  };
}
