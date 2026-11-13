import { initializeScheduleSchema } from '../../dist-service/migrations.js';

// Construct the old schema explicitly; changing only user_version is not a migration fixture.
export function legacySchema(store, version = 3) {
  store.db.exec(`DROP TABLE schedule_run; DROP TABLE scheduled_task;
    CREATE TABLE policy(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES goal(id),version INTEGER NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL);
    ALTER TABLE agent_job ADD COLUMN next TEXT;
    CREATE TABLE agent_decision_work(decisionID TEXT PRIMARY KEY REFERENCES decision(id),workID TEXT NOT NULL REFERENCES agent_work(id),sourceJobID TEXT,issueKey TEXT NOT NULL DEFAULT '');
    DROP TABLE decision_source;
    CREATE TABLE strategy_loop(strategyID TEXT PRIMARY KEY,waitUntil TEXT,reason TEXT NOT NULL DEFAULT '',chain INTEGER NOT NULL DEFAULT 0,updatedAt TEXT NOT NULL);
  `);
  for (const row of store.query('SELECT id,payload FROM decision')) { const card=JSON.parse(row.payload);card.summary=card.body;card.background=card.body;card.agent='Polaris';delete card.body;store.query('UPDATE decision SET payload=? WHERE id=?',JSON.stringify(card),row.id); }
  initializeScheduleSchema(store);
  store.db.exec(`PRAGMA user_version=${version}`);
}
