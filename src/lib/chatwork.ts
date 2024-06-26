import ChatworkApi from 'chatwork-api-client';
import { config } from 'dotenv';
config();

const chatworkClient = new ChatworkApi(process.env.CHATWORK_API_TOKEN);

export const sendMessageForIkenagaChatwork = (message: string) => {
  return chatworkClient.postRoomMessage(238818241, {
    body: `[info][title]${process.env.KINTONE_BASE_URL}でのエラー[/title]${message}[/info]`,
  });
};
