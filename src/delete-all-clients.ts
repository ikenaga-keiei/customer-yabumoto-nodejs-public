import { APP_ID_CLIENT } from './constants';
import { deleteAllRecordsByQuery } from './lib/rest-api';
import fs from 'fs-extra';
import path from 'path';

(async () => {
  const results = await deleteAllRecordsByQuery({ app: APP_ID_CLIENT, query: '', debug: true });

  const datetime = new Date().toLocaleString().replace(/[/: ]/g, '_');
  fs.writeJsonSync(path.join('log', `${datetime}-delete-all-clients.json`), results);
})();
