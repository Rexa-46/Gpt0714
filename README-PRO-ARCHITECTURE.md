# Rexa Professional Accounting Upgrade

This build introduces a lightweight financial-domain layer in `src/financialEngine.js`.

## Accounting rules
- Cash movement (`amount`) is kept separate from P&L movement (`pnlAmount`).
- Loan principal receipt is financing cash flow, not income.
- Loan installment cash leaves the account, while the estimated interest portion is P&L expense.
- Check settlement changes cash but is excluded from operating P&L.
- Debt settlement changes cash but is excluded from operating P&L.
- Asset purchase changes cash and asset value, but is excluded from operating P&L.
- Linked source IDs prevent duplicate posting.
- Accounts/categories with historical references are archived instead of hard-deleted.
- Recurring bill payments receive a unique source ID per payment, so future months are not blocked by duplicate detection.
- Backup format is version 3 and transaction migration upgrades legacy loan transactions.

## Remaining deliberate roadmap
- Move the complete data store from JSON/localStorage to encrypted SQLite.
- Store GitHub credentials in Android Keystore using a Capacitor 8 secure-storage plugin.
- Add full double-entry journal lines for liabilities/equity/asset accounts.
- Add automated integration tests for all financial workflows.
