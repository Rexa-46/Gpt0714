// Rexa double-entry ledger primitives.
// The UI may continue to use the existing transaction model, while every
// financial event can now be represented as balanced journal lines.
export const LEDGER_ACCOUNTS = Object.freeze({
  CASH: 'ledger:cash',
  INCOME: 'ledger:income',
  EXPENSE: 'ledger:expense',
  RECEIVABLE: 'ledger:receivable',
  PAYABLE: 'ledger:payable',
  LOAN_LIABILITY: 'ledger:loan-liability',
  ASSET: 'ledger:asset',
  EQUITY: 'ledger:equity',
});

export function journalEntry({ id, date, sourceType, sourceId, lines = [], memo = '' }) {
  const normalized = lines.map((line) => ({
    account: String(line.account || ''),
    debit: Math.max(0, Number(line.debit || 0)),
    credit: Math.max(0, Number(line.credit || 0)),
    refId: line.refId || null,
  }));
  const debit = normalized.reduce((s, x) => s + x.debit, 0);
  const credit = normalized.reduce((s, x) => s + x.credit, 0);
  if (!normalized.length || Math.round(debit) !== Math.round(credit)) {
    throw new Error('UNBALANCED_JOURNAL');
  }
  return {
    id: id || `je-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: date || new Date().toISOString().slice(0, 10),
    sourceType: sourceType || 'transaction',
    sourceId: sourceId || null,
    memo,
    lines: normalized,
    total: Math.round(debit),
    createdAt: new Date().toISOString(),
  };
}

export function transactionToJournal(tx) {
  const amount = Math.round(Number(tx?.amount || 0));
  if (!amount) return null;
  const cash = tx.accountId || LEDGER_ACCOUNTS.CASH;
  if (tx.type === 'transfer') {
    return journalEntry({
      date: tx.date,
      sourceType: tx.sourceType || 'transfer',
      sourceId: tx.sourceId || tx.id,
      memo: tx.note || 'انتقال وجه',
      lines: [
        { account: tx.toAccountId || LEDGER_ACCOUNTS.CASH, debit: amount },
        { account: cash, credit: amount },
      ],
    });
  }
  if (tx.type === 'income') {
    const contra = tx.isFinancing && tx.sourceType === 'loan_receipt' ? LEDGER_ACCOUNTS.LOAN_LIABILITY : (tx.isPnlExcluded ? (tx.contraAccount || LEDGER_ACCOUNTS.EQUITY) : (tx.categoryId || LEDGER_ACCOUNTS.INCOME));
    return journalEntry({ date: tx.date, sourceType: tx.sourceType || 'transaction', sourceId: tx.sourceId || tx.id, memo: tx.note || 'دریافت', lines: [
      { account: cash, debit: amount }, { account: contra, credit: amount },
    ] });
  }
  if (tx.type === 'expense') {
    if (tx.sourceType === 'loan_installment') {
      const interest = Math.max(0, Math.min(amount, Number(tx.interestPart || tx.pnlAmount || 0)));
      const principal = Math.max(0, amount - interest);
      const lines = [];
      if (principal) lines.push({ account: LEDGER_ACCOUNTS.LOAN_LIABILITY, debit: principal });
      if (interest) lines.push({ account: tx.categoryId || LEDGER_ACCOUNTS.EXPENSE, debit: interest });
      lines.push({ account: cash, credit: amount });
      return journalEntry({ date: tx.date, sourceType: tx.sourceType, sourceId: tx.sourceId || tx.id, memo: tx.note || 'قسط وام', lines });
    }
    const contra = tx.isPnlExcluded ? (tx.contraAccount || LEDGER_ACCOUNTS.ASSET) : (tx.categoryId || LEDGER_ACCOUNTS.EXPENSE);
    return journalEntry({ date: tx.date, sourceType: tx.sourceType || 'transaction', sourceId: tx.sourceId || tx.id, memo: tx.note || 'پرداخت', lines: [
      { account: contra, debit: amount }, { account: cash, credit: amount },
    ] });
  }
  return null;
}

export function rebuildLedger(transactions = []) {
  return transactions.map(transactionToJournal).filter(Boolean);
}
