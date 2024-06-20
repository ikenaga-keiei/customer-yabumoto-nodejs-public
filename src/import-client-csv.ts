import { readFileSync } from 'fs';
import { mkdirsSync, writeJsonSync } from 'fs-extra';
import { parse } from 'papaparse';
import path from 'path';
import {
  convertFullwidthAlphanumericToHalfwidth,
  convertHalfwidthKatakanaToFullwidth,
} from './lib/character-width-conversion';
import { getClientRecordsMap, getRemarkTemplates } from './lib/kintone';
import { bulkRequest } from './lib/rest-api';
import {
  Address,
  formatAddress,
  formatAddressNumber,
  formatName,
  formatPhoneNumber,
  formatRemark,
  getUserKey,
} from './lib/utils';
import { APP_ID_CLIENT } from './constants';
import { sendMessageForIkenagaChatwork } from './lib/chatwork';
import { Observer } from './observer';

const TARGET_PATHS = [
  path.join('target', 'new-customer-01.csv'),
  path.join('target', 'new-customer-02.csv'),
  path.join('target', 'new-customer-03.csv'),
  path.join('target', 'new-customer-04.csv'),
  path.join('target', 'new-customer-05.csv'),
  path.join('target', 'new-customer-06.csv'),
  path.join('target', 'new-customer-07.csv'),
  path.join('target', 'new-customer-08.csv'),
  path.join('target', 'new-customer-09.csv'),
];
const OUTPUT_ROOT = 'log';

const TATENPO_COLUMNS = [
  '使用区分',
  '顧客ID',
  '顧客コード',
  '顧客ランク',
  '法人名・団体名',
  '法人名・団体名(フリガナ)',
  '部署名',
  '電話番号(会社)',
  '名前',
  'フリガナ',
  'ニックネーム',
  '性別',
  'メールアドレス',
  'メールアドレス２',
  '【電話番号】',
  '電話番号1',
  '電話番号２',
  'FAX番号',
  '国',
  '郵便番号',
  '都道府県',
  '市区町村',
  '番地',
  '建物名',
  'お知らせメール受取フラグ',
  '備考',
  '請求締切有無',
  '請求締グループID',
  '回収サイクル',
  '回収日',
  '購入累計金額',
  '購入回数',
] as const;

type TatenpoClientCSVRow = Record<(typeof TATENPO_COLUMNS)[number], string>;
type ExtendedTatenpoClientCSVRow = TatenpoClientCSVRow & {
  key: string;
  name: string;
  address: Address;
  addressNumber: string;
  phoneNumber: string;
  primaryPhoneNumber: string;
  secondaryPhoneNumber: string;
  tertiaryPhoneNumber: string;
  remark: string;
};

(async () => {
  try {
    for (const path of TARGET_PATHS) {
      console.log(`📝 ${path} を処理中...`);
      const file = readFileSync(path, 'utf-8');
      await updateClients(file);
    }
  } catch (error: any) {
    console.error(error);
    sendMessageForIkenagaChatwork(`顧客データ取込時にエラーが発生しました[hr]${error?.message}`);
  }
})();

async function updateClients(file: string) {
  const { data, errors } = parse<TatenpoClientCSVRow>(file, { header: true, quoteChar: '"' });
  console.log('データ件数', data.length);

  const datetime = new Date().toLocaleString().replace(/[/: ]/g, '_');
  const observer = new Observer(path.join(OUTPUT_ROOT, `${datetime}_import_client_csv.log`));

  mkdirsSync(OUTPUT_ROOT);

  observer.start('テンプレートの取得');
  const remarkTemplates = await getRemarkTemplates();
  observer.log(`テンプレート件数: ${remarkTemplates.length}`);
  observer.end();

  observer.start('登録済みの顧客情報の取得');
  const kintoneRecordsMap = await getClientRecordsMap({
    fields: ['$id', '重複キー', 'タテンポガイド備考'],
  });
  observer.end();

  observer.start('データの整形');
  const completed = data.map((row) => extendRow(row, remarkTemplates));
  observer.log('整形後のデータ件数', completed.length);
  observer.log('サンプル', JSON.stringify(completed[0], null, 2));
  const reducedTatenpoRows = Object.values(
    completed.reduce<Record<string, ExtendedTatenpoClientCSVRow>>((acc, row) => {
      const { key } = row;
      if (!acc[key]) {
        acc[key] = row;
        return acc;
      }
      acc[key].remark = acc[key].remark ? acc[key].remark + `\n${row.remark}` : row.remark;
      return acc;
    }, {})
  );
  observer.log('重複排除後のデータ件数', reducedTatenpoRows.length);
  observer.end();

  observer.start('追加・更新対象の抽出');
  const { targetsToAdd, targetsToRemarkUpdate } = getUpdateTargets({
    tatenpoRows: reducedTatenpoRows,
    kintoneRecordsMap,
  });
  observer.end();

  console.time('create records');
  const newRecords = targetsToAdd.map(getKintoneRecordFromRow);
  console.log('追加レコード数', newRecords.length);
  const recordsToUpdate = targetsToRemarkUpdate
    .filter(({ row }) => row.remark)
    .map(({ id, row }) => {
      return {
        id,
        record: {
          タテンポガイド備考: {
            value: convertHalfwidthKatakanaToFullwidth(
              convertFullwidthAlphanumericToHalfwidth(row.remark)
            ),
          },
        },
      };
    });
  console.log('更新レコード数', recordsToUpdate.length);
  console.timeEnd('create records');

  const bulkRequestParams: Parameters<typeof bulkRequest>[0] = {
    requests: [
      { type: 'addAllRecords', params: { app: APP_ID_CLIENT, records: newRecords } },
      { type: 'updateAllRecords', params: { app: APP_ID_CLIENT, records: recordsToUpdate } },
    ],
    debug: true,
  };

  writeJsonSync(path.join(OUTPUT_ROOT, `${datetime}-bulk-request.json`), bulkRequestParams);

  const { results } = await bulkRequest(bulkRequestParams);

  writeJsonSync(path.join(OUTPUT_ROOT, `${datetime}-errors.json`), errors);
  writeJsonSync(path.join(OUTPUT_ROOT, `${datetime}-results.json`), results);
}

function extendRow(
  row: TatenpoClientCSVRow,
  remarkTemplates: string[]
): ExtendedTatenpoClientCSVRow {
  const name = formatName(row['名前']);
  const address = formatAddress({
    todofuken: row['都道府県'],
    shikuchoson: row['市区町村'],
    banchi: row['番地'],
    tatemono: row['建物名'],
  });
  const primaryPhoneNumber = formatPhoneNumber(row['【電話番号】']);
  const secondaryPhoneNumber = formatPhoneNumber(row['電話番号1']);
  const tertiaryPhoneNumber = formatPhoneNumber(row['電話番号２']);
  const addressNumber = formatAddressNumber(row['郵便番号']);
  const phoneNumber = primaryPhoneNumber || secondaryPhoneNumber || tertiaryPhoneNumber;

  const key = getUserKey({ name, phoneNumber, address });

  const remark = formatRemark(row['備考'] ?? '', remarkTemplates);

  return {
    ...row,
    key,
    name,
    remark,
    address,
    addressNumber,
    phoneNumber,
    primaryPhoneNumber,
    secondaryPhoneNumber,
    tertiaryPhoneNumber,
  };
}

function getKintoneRecordFromRow(row: ExtendedTatenpoClientCSVRow) {
  return {
    タテンポガイド顧客ID: { value: row['顧客ID'] },
    名前: { value: row.name },
    フリガナ: {
      value: convertHalfwidthKatakanaToFullwidth(
        convertFullwidthAlphanumericToHalfwidth(row['フリガナ'] ?? '')
      ),
    },
    メールアドレス: {
      value: row['メールアドレス'] ? row['メールアドレス'].toLowerCase() : '',
    },
    電話番号: { value: row.primaryPhoneNumber },
    電話番号1: { value: row.secondaryPhoneNumber },
    電話番号2: { value: row.tertiaryPhoneNumber },
    FAX番号: { value: formatPhoneNumber(row['FAX番号']) },
    郵便番号: { value: row.addressNumber },
    タテンポガイド備考: { value: row.remark },
    都道府県: { value: row.address.todofuken },
    市区町村: { value: row.address.shikuchoson },
    番地: { value: row.address.banchi },
    建物名: { value: row.address.tatemono },
    重複キー: { value: row.key },
    送付先情報: {
      value: [
        {
          value: {
            送付先名前: { value: row.name },
            送付先電話番号: { value: row.phoneNumber },
            送付先郵便番号: { value: row.addressNumber },
            送付先都道府県: { value: row.address.todofuken },
            送付先市区町村: { value: row.address.shikuchoson },
            送付先番地: { value: row.address.banchi },
            送付先建物名: { value: row.address.tatemono },
          },
        },
      ],
    },
  };
}

function getUpdateTargets(params: {
  tatenpoRows: ExtendedTatenpoClientCSVRow[];
  kintoneRecordsMap: Awaited<ReturnType<typeof getClientRecordsMap>>;
}) {
  const { tatenpoRows, kintoneRecordsMap } = params;
  const additionalTargetsMap: Record<string, ExtendedTatenpoClientCSVRow> = {};
  const targetsForRemarkUpdateMap: Record<
    string,
    { id: string; row: ExtendedTatenpoClientCSVRow }
  > = {};
  for (const row of tatenpoRows) {
    const { key } = row;
    const foundTargetToRemarkUpdate = targetsForRemarkUpdateMap[key];
    if (foundTargetToRemarkUpdate) {
      const registeredRemark = foundTargetToRemarkUpdate.row.remark;
      foundTargetToRemarkUpdate.row.remark = registeredRemark
        ? registeredRemark + `\n${row.remark}`
        : row.remark;
      continue;
    }
    const foundRegistered = kintoneRecordsMap[key];
    if (foundRegistered) {
      const registeredRemark = foundRegistered['タテンポガイド備考'].value as string;
      targetsForRemarkUpdateMap[key] = {
        id: foundRegistered.$id.value as string,
        row: {
          ...row,
          備考: registeredRemark ? registeredRemark + `\n${row.remark}` : row.remark,
        },
      };
      continue;
    }
    const found = additionalTargetsMap[key];
    if (found) {
      const registeredRemark = found.remark;
      found.remark = registeredRemark ? registeredRemark + `\n${row.remark}` : row.remark;
      continue;
    }
    additionalTargetsMap[key] = row;
  }
  return {
    targetsToAdd: Object.values(additionalTargetsMap),
    targetsToRemarkUpdate: Object.values(targetsForRemarkUpdateMap).filter(({ row }) => row.remark),
  };
}
