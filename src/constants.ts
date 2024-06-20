import { config } from 'dotenv';
config();

const baseUrl = process.env.KINTONE_BASE_URL;

const isProduction = baseUrl?.includes('yabumoto');

isProduction ? console.log('本番用として実行します') : console.log('開発用として実行します');

export const APP_ID_CLIENT = isProduction ? 12 : 546;

export const APP_ID_REMARK_TEMPLATE = isProduction ? 11 : 540;
