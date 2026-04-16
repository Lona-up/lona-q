/** ブラウザにストレージの永続化を要求する */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

/** ストレージが永続化されているか確認する */
export async function isStoragePersisted(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  if (!navigator.storage?.persisted) return false;
  return navigator.storage.persisted();
}

/** ストレージの使用量と上限を取得する */
export async function getStorageEstimate(): Promise<{ usage?: number; quota?: number }> {
  if (typeof navigator === 'undefined') return {};
  if (!navigator.storage?.estimate) return {};
  return navigator.storage.estimate();
}
