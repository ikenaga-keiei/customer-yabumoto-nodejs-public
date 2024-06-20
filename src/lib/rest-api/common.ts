import { kintoneAPI } from '@konomi-app/kintone-utilities';
import { config } from 'dotenv';
import { stringify } from 'qs';
config();

export const buildPath = (params: {
  endpointName: string;
  guestSpaceId?: number | string;
  preview?: boolean;
}) => {
  const { endpointName, guestSpaceId, preview } = params;
  const guestPath = guestSpaceId !== undefined ? `/guest/${guestSpaceId}` : '';
  const previewPath = preview ? '/preview' : '';
  return `/k${guestPath}/v1${previewPath}/${endpointName}.json`;
};

const createAuthHeader = (): Record<string, string> => {
  const { KINTONE_USERNAME, KINTONE_PASSWORD, KINTONE_API_TOKEN } = process.env;

  if (KINTONE_API_TOKEN) {
    return {
      'X-Cybozu-API-Token': KINTONE_API_TOKEN,
    };
  }
  return { 'X-Cybozu-Authorization': btoa(`${KINTONE_USERNAME}:${KINTONE_PASSWORD}`) };
};

export const api = async <T = any>(params: {
  endpointName: string;
  method: kintoneAPI.rest.Method;
  body: any;
  guestSpaceId?: number | string;
  preview?: boolean;
  debug?: boolean;
}): Promise<T> => {
  const { endpointName, method, body, guestSpaceId, preview, debug } = params;
  try {
    const path = buildPath({ endpointName, guestSpaceId, preview });
    if (debug) {
      console.groupCollapsed(
        `%ckintone REST API %c(${endpointName})`,
        'color: #1e40af;',
        'color: #aaa'
      );
      console.log(`path: ${path}`);
      console.log(`method: ${method}`);
      // console.log('body', body);
    }
    const urlParams = method === 'GET' ? `?${stringify(body)}` : '';

    const url = `${process.env.KINTONE_BASE_URL}${path}${urlParams}`;
    const requestParams = method === 'GET' ? undefined : JSON.stringify(body);

    const headers = {
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      ...createAuthHeader(),
    };
    const response = await fetch(url, {
      method,
      body: requestParams,
      headers,
    });
    if (debug) {
    }
    return response.json() as Promise<T>;
  } catch (error) {
    if (debug) {
      console.error(error);
    }
    throw error;
  } finally {
    if (debug) {
      console.groupEnd();
    }
  }
};

export const checkBrowser = () => {
  if (typeof window === 'undefined') {
    throw new Error('この関数はブラウザでのみ使用できます');
  }
};

export const sliceIntoChunks = <T>(array: T[], size: number): T[][] => {
  const result = [];
  for (let i = 0, j = array.length; i < j; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

export type WithDebug<T> = T & { debug?: boolean };
export type WithGuestSpaceId<T> = T & { guestSpaceId?: number | string };
export type WithCommonRequestParams<T> = WithDebug<WithGuestSpaceId<T>>;
export type TypeOmmited<T extends Record<string, any>> = {
  [P in keyof T]: Omit<T[P], 'type'>;
};

export type RecordFrame = Record<string, any>;

export type RecordToRequest<T extends RecordFrame = kintoneAPI.RecordData> = Partial<
  TypeOmmited<T>
>;
