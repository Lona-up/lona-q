export class LonaQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LonaQError';
  }
}

export class LonaQNotReadyError extends LonaQError {
  constructor() {
    super('Database is not initialized yet');
    this.name = 'LonaQNotReadyError';
  }
}

export class LonaQQueryError extends LonaQError {
  sql?: string;
  constructor(message: string, sql?: string) {
    super(message);
    this.name = 'LonaQQueryError';
    this.sql = sql;
  }
}

export class LonaQStorageError extends LonaQError {
  constructor(message: string) {
    super(message);
    this.name = 'LonaQStorageError';
  }
}

export class LonaQTimeoutError extends LonaQError {
  constructor(message?: string) {
    super(message ?? 'Operation timed out');
    this.name = 'LonaQTimeoutError';
  }
}
