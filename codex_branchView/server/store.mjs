import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Only local UI associations and task recovery state are persisted here.
// Questions and answers are read from the current machine's Codex history.
export class Store {
 constructor(dir){
  fs.mkdirSync(dir,{recursive:true});
  this.db=new DatabaseSync(path.join(dir,'branches.sqlite'));
  this.db.exec(`PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS records (kind TEXT,id TEXT,value TEXT NOT NULL,PRIMARY KEY(kind,id));
   DELETE FROM records WHERE kind='snapshot';`);
 }
 get(kind,id){const r=this.db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind,id);return r?JSON.parse(r.value):null;}
 all(kind){return this.db.prepare('SELECT value FROM records WHERE kind=?').all(kind).map(r=>JSON.parse(r.value));}
 put(kind,id,value){this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value').run(kind,id,JSON.stringify(value));return value;}
 close(){this.db.close();}
}
