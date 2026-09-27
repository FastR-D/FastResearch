export function createTransactionStore(db) {
  return {
    async put(transaction) {
      db.prepare('DELETE FROM fastcas_transactions WHERE expires_at <= ?').run(Date.now());
      db.prepare('INSERT INTO fastcas_transactions(state, payload, expires_at) VALUES(?, ?, ?)').run(
        transaction.state,
        JSON.stringify(transaction),
        transaction.expiresAt,
      );
    },
    async take(state) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('SELECT payload, expires_at FROM fastcas_transactions WHERE state = ?').get(state);
        db.prepare('DELETE FROM fastcas_transactions WHERE state = ?').run(state);
        db.exec('COMMIT');
        if (!row || row.expires_at <= Date.now()) return undefined;
        return JSON.parse(row.payload);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export function createReplayStore(db) {
  return {
    async accept(id, expiresAt) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('SELECT id FROM replay WHERE id = ?').get(id);
        if (row) {
          db.exec('COMMIT');
          return false;
        }
        db.prepare('INSERT INTO replay(id, expires_at) VALUES(?, ?)').run(id, expiresAt);
        db.exec('COMMIT');
        return true;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}