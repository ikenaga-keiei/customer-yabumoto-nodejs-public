import { APP_ID_CLIENT, APP_ID_REMARK_TEMPLATE } from '../constants';
import { getAllRecords } from './rest-api';

export const getClientRecordsMap = async (params: { fields: string[] }) => {
  const { fields } = params;
  const records = await getAllRecords({ app: APP_ID_CLIENT, fields });
  console.log(`🙍 顧客レコードを${records.length}件取得しました`);
  return records.reduce<Record<string, (typeof records)[number]>>((acc, record) => {
    acc[record['重複キー'].value as string] = record;
    return acc;
  }, {});
};

export const getRemarkTemplates = async (): Promise<string[]> => {
  const templateRecords = await getAllRecords({
    app: APP_ID_REMARK_TEMPLATE,
    fields: ['テンプレート'],
    debug: true,
  });
  return templateRecords.map((record) => record['テンプレート'].value as string);
};
