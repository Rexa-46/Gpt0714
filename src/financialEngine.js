// Rexa financial domain helpers. Cash amount and P&L amount are intentionally
// separate: financing/asset/debt movements can change cash without becoming
// operating income/expense.
export const isPnlTransaction = (tx) => Number(tx?.pnlAmount ?? (tx?.isPnlExcluded ? 0 : tx?.amount || 0)) !== 0;
export const pnlAmount = (tx) => Number(tx?.pnlAmount ?? (tx?.isPnlExcluded ? 0 : tx?.amount || 0));
export const linkedTx = (tx) => ({
  ...tx,
  id: tx.id || `${tx.sourceType || "tx"}-${tx.sourceId || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  createdAt: tx.createdAt || new Date().toISOString(),
});
export function removeLinkedTransactions(list, sourceType, sourceId) {
  return list.filter((t) => !(t.sourceType === sourceType && t.sourceId === sourceId));
}
export function hasLinkedTransaction(list, sourceType, sourceId) {
  return list.some((t) => t.sourceType === sourceType && t.sourceId === sourceId);
}
export function postOnce(list, tx) {
  if (tx?.sourceType && tx?.sourceId && hasLinkedTransaction(list, tx.sourceType, tx.sourceId)) return list;
  return [linkedTx(tx), ...list];
}
