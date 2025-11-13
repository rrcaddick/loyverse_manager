class AuditService:
    def __init__(self, logger):
        self.logger = logger

    def create_card_payment_audit(
        self, addpay_payments, loyverse_payments, aronium_payments
    ):
        # Create a set of all unique dates across all payment sources
        all_dates = set()
        for payments in [addpay_payments, loyverse_payments, aronium_payments]:
            all_dates.update(payment["date"] for payment in payments)

        # Convert payment lists to dictionaries for easier lookup
        addpay_dict = {p["date"]: p["amount"] for p in addpay_payments}
        loyverse_dict = {p["date"]: p["amount"] for p in loyverse_payments}
        aronium_dict = {p["date"]: p["amount"] for p in aronium_payments}

        audit_results = []
        for date in sorted(all_dates):
            # Get amounts, defaulting to 0 if date not found
            addpay_amt = addpay_dict.get(date, 0)
            loyverse_amt = loyverse_dict.get(date, 0)
            aronium_amt = aronium_dict.get(date, 0)

            # Calculate total and difference
            pos_total = loyverse_amt + aronium_amt
            difference = addpay_amt - pos_total

            audit_results.append(
                {
                    "date": date,
                    "addpay": addpay_amt,
                    "loyverse": loyverse_amt,
                    "aronium": aronium_amt,
                    "over_under": "over" if difference > 0 else "under",
                    "over_under_amt": difference,
                }
            )

        return audit_results

    def create_cash_payment_audit(self, loyverse_payments, aronium_payments):
        # Create a set of all unique dates across all payment sources
        all_dates = set()
        for payments in [loyverse_payments, aronium_payments]:
            all_dates.update(payment["date"] for payment in payments)

        # Convert payment lists to dictionaries for easier lookup
        loyverse_dict = {p["date"]: p["amount"] for p in loyverse_payments}
        aronium_dict = {p["date"]: p for p in aronium_payments}

        audit_results = []
        for date in sorted(all_dates):
            # Get amounts, defaulting to 0 if date not found

            loyverse_amt = loyverse_dict.get(date, 0)
            aronium_data = aronium_dict.get(
                date,
                {
                    "amount": 0,
                    "sales_total": 0,
                    "refund_total": 0,
                    "refund_count": 0,
                    "expected_cash": 0,
                },
            )

            audit_results.append(
                {
                    "date": date,
                    "loyverse": loyverse_amt,
                    "shop_refunds": aronium_data["refund_total"],
                    "shop_refunds_count": aronium_data["refund_count"],
                    "shop_cash": aronium_data["expected_cash"],
                }
            )

        return audit_results
