// Rexa double-entry ledger engine
// نسخه اصلاح‌شده برای ثبت صحیح تراکنش‌های مالی، وام، بدهی، طلب، چک و دارایی.

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

/**
 * ساخت یک سند حسابداری دوطرفه
 */
export function journalEntry({
  id,
  date,
  sourceType,
  sourceId,
  lines = [],
  memo = '',
}) {
  const normalized = lines
    .map((line) => ({
      account: String(line.account || ''),
      debit: Math.max(0, Number(line.debit || 0)),
      credit: Math.max(0, Number(line.credit || 0)),
      refId: line.refId || null,
    }))
    .filter((line) => line.account);

  const debit = normalized.reduce(
    (sum, line) => sum + line.debit,
    0
  );

  const credit = normalized.reduce(
    (sum, line) => sum + line.credit,
    0
  );

  // سند باید حتماً تراز باشد.
  if (
    !normalized.length ||
    Math.round(debit) !== Math.round(credit)
  ) {
    throw new Error('UNBALANCED_JOURNAL');
  }

  return {
    id:
      id ||
      `je-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,

    date:
      date ||
      new Date().toISOString().slice(0, 10),

    sourceType:
      sourceType || 'transaction',

    sourceId:
      sourceId || null,

    memo,

    lines: normalized,

    total: Math.round(debit),

    createdAt: new Date().toISOString(),
  };
}

/**
 * تبدیل یک تراکنش Rexa به سند حسابداری دوطرفه
 */
export function transactionToJournal(tx) {
  const amount = Math.round(
    Number(tx?.amount || 0)
  );

  if (!tx || !amount) {
    return null;
  }

  /*
   * حساب نقدی / بانکی مبدا
   */
  const cashAccount =
    tx.accountId ||
    LEDGER_ACCOUNTS.CASH;

  /*
   * ---------------------------------------------------------
   * انتقال وجه بین حساب‌ها
   * ---------------------------------------------------------
   *
   * بدهکار: حساب مقصد
   * بستانکار: حساب مبدا
   */
  if (tx.type === 'transfer') {
    return journalEntry({
      date: tx.date,

      sourceType:
        tx.sourceType || 'transfer',

      sourceId:
        tx.sourceId || tx.id,

      memo:
        tx.note || 'انتقال وجه',

      lines: [
        {
          account:
            tx.toAccountId ||
            LEDGER_ACCOUNTS.CASH,

          debit: amount,
        },

        {
          account: cashAccount,

          credit: amount,
        },
      ],
    });
  }

  /*
   * ---------------------------------------------------------
   * درآمد / دریافت
   * ---------------------------------------------------------
   */
  if (tx.type === 'income') {
    let contraAccount;

    /*
     * دریافت اصل وام
     *
     * بانک ↑
     * بدهی وام ↑
     */
    if (
      tx.isFinancing &&
      tx.sourceType === 'loan_receipt'
    ) {
      contraAccount =
        LEDGER_ACCOUNTS.LOAN_LIABILITY;
    }

    /*
     * وصول طلب
     *
     * بانک ↑
     * مطالبات ↓
     */
    else if (
      tx.sourceType === 'debt'
    ) {
      contraAccount =
        LEDGER_ACCOUNTS.RECEIVABLE;
    }

    /*
     * وصول چک دریافتی
     *
     * بانک ↑
     * اسناد دریافتنی ↓
     */
    else if (
      tx.sourceType === 'check'
    ) {
      contraAccount =
        LEDGER_ACCOUNTS.RECEIVABLE;
    }

    /*
     * سایر دریافت‌ها
     */
    else if (tx.isPnlExcluded) {
      contraAccount =
        tx.contraAccount ||
        LEDGER_ACCOUNTS.EQUITY;
    }

    else {
      contraAccount =
        tx.categoryId ||
        LEDGER_ACCOUNTS.INCOME;
    }

    return journalEntry({
      date: tx.date,

      sourceType:
        tx.sourceType ||
        'transaction',

      sourceId:
        tx.sourceId ||
        tx.id,

      memo:
        tx.note ||
        'دریافت',

      lines: [
        {
          account: cashAccount,
          debit: amount,
        },

        {
          account: contraAccount,
          credit: amount,
        },
      ],
    });
  }

  /*
   * ---------------------------------------------------------
   * هزینه / پرداخت
   * ---------------------------------------------------------
   */
  if (tx.type === 'expense') {

    /*
     * -------------------------------------------------------
     * قسط وام
     * -------------------------------------------------------
     *
     * مبلغ قسط = اصل + سود
     *
     * بدهکار: بدهی وام ← قسمت اصل
     * بدهکار: هزینه سود ← قسمت سود
     * بستانکار: بانک / صندوق ← کل مبلغ
     */
    if (
      tx.sourceType === 'loan_installment'
    ) {
      const interest = Math.max(
        0,
        Math.min(
          amount,
          Number(
            tx.interestPart ||
            tx.pnlAmount ||
            0
          )
        )
      );

      const principal = Math.max(
        0,
        amount - interest
      );

      const lines = [];

      if (principal > 0) {
        lines.push({
          account:
            LEDGER_ACCOUNTS.LOAN_LIABILITY,

          debit: principal,
        });
      }

      if (interest > 0) {
        lines.push({
          account:
            tx.categoryId ||
            LEDGER_ACCOUNTS.EXPENSE,

          debit: interest,
        });
      }

      lines.push({
        account: cashAccount,
        credit: amount,
      });

      return journalEntry({
        date: tx.date,

        sourceType:
          tx.sourceType,

        sourceId:
          tx.sourceId ||
          tx.id,

        memo:
          tx.note ||
          'قسط وام',

        lines,
      });
    }

    /*
     * -------------------------------------------------------
     * پرداخت بدهی
     *
     * بدهی ↓
     * بانک ↓
     * -------------------------------------------------------
     */
    if (
      tx.sourceType === 'debt'
    ) {
      return journalEntry({
        date: tx.date,

        sourceType:
          tx.sourceType,

        sourceId:
          tx.sourceId ||
          tx.id,

        memo:
          tx.note ||
          'تسویه بدهی',

        lines: [
          {
            account:
              LEDGER_ACCOUNTS.PAYABLE,

            debit: amount,
          },

          {
            account: cashAccount,

            credit: amount,
          },
        ],
      });
    }

    /*
     * -------------------------------------------------------
     * پرداخت چک
     *
     * اسناد پرداختنی ↓
     * بانک ↓
     * -------------------------------------------------------
     */
    if (
      tx.sourceType === 'check'
    ) {
      return journalEntry({
        date: tx.date,

        sourceType:
          tx.sourceType,

        sourceId:
          tx.sourceId ||
          tx.id,

        memo:
          tx.note ||
          'پرداخت چک',

        lines: [
          {
            account:
              LEDGER_ACCOUNTS.PAYABLE,

            debit: amount,
          },

          {
            account: cashAccount,

            credit: amount,
          },
        ],
      });
    }

    /*
     * -------------------------------------------------------
     * خرید دارایی
     *
     * دارایی ↑
     * بانک ↓
     * -------------------------------------------------------
     */
    if (
      tx.sourceType === 'asset_purchase'
    ) {
      return journalEntry({
        date: tx.date,

        sourceType:
          tx.sourceType,

        sourceId:
          tx.sourceId ||
          tx.id,

        memo:
          tx.note ||
          'خرید دارایی',

        lines: [
          {
            account:
              tx.assetAccount ||
              LEDGER_ACCOUNTS.ASSET,

            debit: amount,
          },

          {
            account: cashAccount,

            credit: amount,
          },
        ],
      });
    }

    /*
     * -------------------------------------------------------
     * پرداخت قبض
     *
     * قبض به عنوان هزینه واقعی ثبت می‌شود.
     * -------------------------------------------------------
     */
    if (
      tx.sourceType === 'bill'
    ) {
      return journalEntry({
        date: tx.date,

        sourceType:
          tx.sourceType,

        sourceId:
          tx.sourceId ||
          tx.id,

        memo:
          tx.note ||
          'پرداخت قبض',

        lines: [
          {
            account:
              tx.categoryId ||
              LEDGER_ACCOUNTS.EXPENSE,

            debit: amount,
          },

          {
            account: cashAccount,

            credit: amount,
          },
        ],
      });
    }

    /*
     * -------------------------------------------------------
     * سایر هزینه‌ها
     * -------------------------------------------------------
     */
    const expenseAccount =
      tx.isPnlExcluded
        ? (
            tx.contraAccount ||
            LEDGER_ACCOUNTS.ASSET
          )
        : (
            tx.categoryId ||
            LEDGER_ACCOUNTS.EXPENSE
          );

    return journalEntry({
      date: tx.date,

      sourceType:
        tx.sourceType ||
        'transaction',

      sourceId:
        tx.sourceId ||
        tx.id,

      memo:
        tx.note ||
        'پرداخت',

      lines: [
        {
          account:
            expenseAccount,

          debit: amount,
        },

        {
          account: cashAccount,

          credit: amount,
        },
      ],
    });
  }

  return null;
}

/**
 * بازسازی Ledger از روی تمام تراکنش‌ها
 */
export function rebuildLedger(
  transactions = []
) {
  return transactions
    .map((transaction) => {
      try {
        return transactionToJournal(
          transaction
        );
      } catch (error) {
        console.warn(
          'Rexa ledger: transaction skipped',
          transaction?.id,
          error
        );

        return null;
      }
    })
    .filter(Boolean);
}
