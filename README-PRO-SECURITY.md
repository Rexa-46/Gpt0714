# Rexa Pro Security / Storage Architecture

- Android/iOS native persistence uses encrypted SQLite (SQLCipher) through `@capacitor-community/sqlite`.
- The SQLite encryption secret is stored through the native secure-storage layer and is not exported in backups.
- GitHub sync token and sync passphrase are stored in `@aparajita/capacitor-secure-storage` on native platforms; only non-sensitive sync metadata remains in localStorage.
- Existing localStorage data is migrated into SQLite on first native launch. The legacy values are retained for rollback compatibility until a future cleanup migration is explicitly introduced.
- Web builds intentionally retain localStorage fallback; secure-storage web implementations are not treated as secure production storage.
- Backups remain application-level encrypted/portable JSON and do not contain GitHub credentials or the SQLite encryption secret.

The SQLite plugin uses SQLCipher on native platforms. See its encryption documentation before distributing the app internationally because SQLCipher has encryption/export compliance considerations.
