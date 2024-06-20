import {
  convertFullwidthAlphanumericToHalfwidth,
  convertHalfwidthKatakanaToFullwidth,
} from './character-width-conversion';

export type Address = {
  todofuken: string;
  shikuchoson: string;
  banchi: string;
  tatemono: string;
};

export const formatPhoneNumber = (phoneNumber: string | undefined): string => {
  if (!phoneNumber) {
    return '';
  }
  if (!/^0/.test(phoneNumber)) {
    return formatPhoneNumber(`0${phoneNumber}`);
  }
  return convertFullwidthAlphanumericToHalfwidth(phoneNumber).replace(/[^0-9]/g, '');
};

export const formatAddressNumber = (addressNumber: string | undefined): string => {
  if (!addressNumber) {
    return '';
  }
  const replaced = convertFullwidthAlphanumericToHalfwidth(addressNumber).replace(/[^0-9]/g, '');

  return `0000000${replaced}`.slice(-7);
};

export const formatName = (name: string | undefined): string => {
  if (!name) {
    return '';
  }
  return convertHalfwidthKatakanaToFullwidth(
    convertFullwidthAlphanumericToHalfwidth(name)
      .replace(/\s/g, ' ')
      .replace(/㈱|[<＜\(（【]\s?株\s?[\)）】＞>]/g, '株式会社')
      .replace(/㈲|[<＜\(（【]\s?有\s?[\)）】＞>]/g, '有限会社')
      .replace(/[<＜\(（【]\s?同\s?[\)）】＞>]/g, '合同会社')
      .replace(/㈾|[<＜\(（【]\s?資\s?[\)）】＞>]/g, '合資会社')
      .replace(/㈴|[<＜\(（【]\s?名\s?[\)）】＞>]/g, '合名会社')
      .replace(/[<＜\(（【]\s?医\s?[\)）】＞>]/g, '医療法人')
      .replace(/[<＜\(（【]\s?福\s?[\)）】＞>]/g, '社会福祉法人')
      .replace(/[<＜\(（【]\s?社\s?[\)）】＞>]/g, '社団法人')
      .replace(/[<＜\(（【]\s?一社\s?[\)）】＞>]/g, '一般社団法人')
      .replace(/[<＜\(（【]\s?公社\s?[\)）】＞>]/g, '公益社団法人')
  );
};

export const formatAddress = (params: Partial<Address>): Address => {
  const { todofuken, shikuchoson, banchi, tatemono } = params;

  const convertCommon = (value: string | undefined) => {
    return convertHalfwidthKatakanaToFullwidth(convertFullwidthAlphanumericToHalfwidth(value ?? ''))
      .replace(/\s+/g, ' ')
      .replace(/(^\s+|\s+$)/g, '')
      .replace(/[―–——ー]/g, '-');
  };

  return {
    todofuken: convertCommon(todofuken),
    shikuchoson: convertCommon(shikuchoson),
    banchi: convertCommon(banchi),
    tatemono: convertCommon(tatemono),
  };
};

export const groupBy = <T>(values: T[], callback: (value: T) => string | number) => {
  return values.reduce<Record<string | number, T[]>>((acc, value) => {
    const key = callback(value);

    (acc[key] || (acc[key] = [])).push(value);

    return acc;
  }, {});
};

/**
 * 重複チェックのキーとなる文字列を生成する
 */
export const getUserKey = (params: { name: string; phoneNumber: string; address: Address }) => {
  const { name, phoneNumber, address } = params;
  return `${name}__${phoneNumber}__${address.todofuken}${address.shikuchoson}${address.banchi}${address.tatemono}`.replace(
    /\s/g,
    ''
  );
};

export function formatRemark(remark: string, templates: string[]) {
  const lfRemoved = remark.replace(/[\n\r]/g, '');

  return convertHalfwidthKatakanaToFullwidth(
    convertFullwidthAlphanumericToHalfwidth(
      templates.reduce((acc, template) => {
        // 正規表現の特殊文字をエスケープ
        const lfRemovedTemplate = template
          .replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
          .replace(/[\n\r]/g, '');
        return acc.replace(new RegExp(lfRemovedTemplate, 'g'), '');
      }, lfRemoved)
    )
  )
    .replace(/\s+/g, ' ')
    .replace(/(^\s+|\s+$)/g, '');
}

export const mergeRemark = (a: string, b: string) => {
  return formatRemark(`${a}\n${b}`, []);
};
