from datetime import datetime, timedelta

from src.models.audit import (
    CardPaymentAudit,
    CashBagAssignment,
    CashBagVerification,
)
from src.repositories.aronium import AroniumRepository
from src.services.loyverse import LoyverseService
from src.services.paycloud import PayCloudService


class AuditService:
    """
    Orchestrates audit workflows for payment verification and cash bag tracking.
    Fetches data from multiple sources, compares them, and persists audit records.
    """

    def __init__(
        self,
        logger,
        paycloud_service: PayCloudService,
        loyverse_service: LoyverseService,
        aronium_repository: AroniumRepository,
    ):
        self.logger = logger
        self.paycloud_service = paycloud_service
        self.loyverse_service = loyverse_service
        self.aronium_repository = aronium_repository

    def create_card_payment_audit(self, start_date=None, end_date=None):
        """
        Create card payment audit comparing Paycloud vs POS systems.
        Fetches data, compares daily totals, and stores results in database.

        Args:
            start_date: Start date (YYYY-MM-DD), defaults to 61 days ago
            end_date: End date (YYYY-MM-DD), defaults to today

        Returns:
            List of CardPaymentAudit instances
        """
        self.logger.info(f"Creating card payment audit from {start_date} to {end_date}")

        # Fetch data from all sources
        paycloud_payments = self.paycloud_service.get_daily_card_payments()
        loyverse_receipts = self.loyverse_service.get_receipts()
        loyverse_payments = self.loyverse_service.get_card_payments(loyverse_receipts)
        aronium_payments = self.aronium_repository.get_card_payments()

        # Create dictionaries for easier lookup
        paycloud_dict = {p["date"]: p["amount"] for p in paycloud_payments}
        loyverse_dict = {p["date"]: p["amount"] for p in loyverse_payments}
        aronium_dict = {p["date"]: p["amount"] for p in aronium_payments}

        # Get all unique dates
        all_dates = (
            set(paycloud_dict.keys())
            | set(loyverse_dict.keys())
            | set(aronium_dict.keys())
        )

        # Build audit records
        audit_records = []
        for date in sorted(all_dates):
            paycloud_amt = paycloud_dict.get(date, 0)
            loyverse_amt = loyverse_dict.get(date, 0)
            aronium_amt = aronium_dict.get(date, 0)
            pos_total = loyverse_amt + aronium_amt
            variance = paycloud_amt - pos_total

            audit_records.append(
                {
                    "audit_date": date,
                    "paycloud_amount": paycloud_amt,
                    "loyverse_amount": loyverse_amt,
                    "aronium_amount": aronium_amt,
                    "pos_total": pos_total,
                    "variance": variance,
                }
            )

        # Save to database
        if audit_records:
            CardPaymentAudit.create_batch(audit_records)
            self.logger.info(f"Created {len(audit_records)} card payment audit records")

        # Return the created records
        if start_date and end_date:
            return CardPaymentAudit.get_by_date_range(start_date, end_date)
        else:
            # Return all records we just created
            dates_created = [r["audit_date"] for r in audit_records]
            if dates_created:
                return CardPaymentAudit.get_by_date_range(
                    min(dates_created), max(dates_created)
                )
            return []

    def create_cash_bag_assignments(self, start_date=None, end_date=None):
        """
        Create cash bag assignments for cash collected.
        Generates unique bag IDs for each cash collection point.

        For Aronium: 1 bag per day (daily total)
        For Loyverse: Multiple bags per day (by employee + POS device combination)

        Args:
            start_date: Start date (YYYY-MM-DD), defaults to yesterday
            end_date: End date (YYYY-MM-DD), defaults to yesterday

        Returns:
            List of CashBagAssignment instances
        """
        # Default to yesterday if not specified
        if not start_date or not end_date:
            yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
            start_date = start_date or yesterday
            end_date = end_date or yesterday

        self.logger.info(
            f"Creating cash bag assignments from {start_date} to {end_date}"
        )

        assignments = []

        # Get Aronium cash data (daily totals)
        aronium_cash = self.aronium_repository.get_cash_payments()
        aronium_dict = {
            p["date"]: p for p in aronium_cash
        }  # Keep full record for expected_cash

        # Get Loyverse cash data (by shift/employee/device)
        loyverse_receipts = self.loyverse_service.get_receipts()
        loyverse_shifts = self.loyverse_service.get_cash_payments_by_shift(
            loyverse_receipts
        )

        # Filter by date range
        start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
        end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()

        # Create Aronium bags (1 per day)
        for date_str, aronium_data in aronium_dict.items():
            date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
            if start_dt <= date_obj <= end_dt:
                assignments.append(
                    {
                        "assignment_date": date_str,
                        "source_system": "aronium",
                        "source_identifier": "daily-total",
                        "expected_amount": aronium_data["expected_cash"],
                    }
                )

        # Create Loyverse bags (multiple per day by employee/device)
        for shift in loyverse_shifts:
            date_obj = datetime.strptime(shift["date"], "%Y-%m-%d").date()
            if start_dt <= date_obj <= end_dt:
                source_id = (
                    f"emp-{shift['employee_id'][:8]}_dev-{shift['pos_device_id'][:8]}"
                )
                assignments.append(
                    {
                        "assignment_date": shift["date"],
                        "source_system": "loyverse",
                        "source_identifier": source_id,
                        "expected_amount": shift["amount"],
                        "employee_id": shift["employee_id"],
                        "pos_device_id": shift["pos_device_id"],
                    }
                )

        # Save to database
        if assignments:
            created_assignments = CashBagAssignment.create_batch(assignments)
            self.logger.info(f"Created {len(created_assignments)} cash bag assignments")
            return created_assignments

        self.logger.warning("No cash bag assignments created (no data in date range)")
        return []

    def verify_cash_bag(self, bag_id, counted_amount, counted_by, notes=None):
        """
        Record verification of a cash bag (blind count).

        Args:
            bag_id: The bag identifier (e.g., BAG-K7M3P9XQ)
            counted_amount: The actual counted amount
            counted_by: Name/ID of person who counted
            notes: Optional notes about the count

        Returns:
            CashBagVerification instance with calculated variance
        """
        self.logger.info(f"Verifying cash bag {bag_id}")

        verification = CashBagVerification.create(
            bag_id=bag_id,
            counted_amount=counted_amount,
            counted_by=counted_by,
            notes=notes,
        )

        self.logger.info(
            f"Cash bag {bag_id} verified. Variance: {verification.variance}"
        )
        return verification

    def get_card_audit_report(self, start_date=None, end_date=None):
        """
        Get card payment audit report for display.

        Args:
            start_date: Start date (YYYY-MM-DD), defaults to 30 days ago
            end_date: End date (YYYY-MM-DD), defaults to today

        Returns:
            Dict with summary stats and detailed records
        """
        if not start_date:
            start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
        if not end_date:
            end_date = datetime.now().strftime("%Y-%m-%d")

        audits = CardPaymentAudit.get_by_date_range(start_date, end_date)

        if not audits:
            return {
                "summary": {
                    "total_days": 0,
                    "days_with_variance": 0,
                    "total_variance": 0.0,
                    "largest_variance": 0.0,
                },
                "records": [],
            }

        # Calculate summary stats
        variances = [abs(float(a.variance)) for a in audits]
        days_with_variance = sum(1 for v in variances if v > 0.01)  # > 1 cent

        summary = {
            "total_days": len(audits),
            "days_with_variance": days_with_variance,
            "total_variance": sum(variances),
            "largest_variance": max(variances) if variances else 0.0,
            "average_variance": sum(variances) / len(variances) if variances else 0.0,
        }

        records = [a.to_dict() for a in audits]

        return {"summary": summary, "records": records}

    def get_pending_cash_bags(self):
        """
        Get all cash bags awaiting verification.

        Returns:
            List of CashBagAssignment dicts (not yet verified)
        """
        unverified = CashBagAssignment.get_unverified()
        return [bag.to_dict() for bag in unverified]

    def get_cash_audit_report(self):
        """
        Get cash audit report showing verified vs expected amounts.

        Returns:
            Dict with summary and detailed verification records
        """
        verifications = CashBagVerification.get_all_with_assignments()

        if not verifications:
            return {
                "summary": {
                    "total_bags_verified": 0,
                    "bags_with_variance": 0,
                    "total_variance": 0.0,
                    "largest_variance": 0.0,
                },
                "records": [],
            }

        variances = [abs(float(v["verification"]["variance"])) for v in verifications]
        bags_with_variance = sum(1 for v in variances if v > 0.01)  # > 1 cent

        summary = {
            "total_bags_verified": len(verifications),
            "bags_with_variance": bags_with_variance,
            "total_variance": sum(variances),
            "largest_variance": max(variances) if variances else 0.0,
            "average_variance": sum(variances) / len(variances) if variances else 0.0,
        }

        return {"summary": summary, "records": verifications}

    def get_cash_bag_details(self, bag_id):
        """
        Get complete details for a specific cash bag (assignment + verification if exists).

        Args:
            bag_id: The bag identifier

        Returns:
            Dict with assignment and verification data (verification may be None)
        """
        assignment = CashBagAssignment.get_by_bag_id(bag_id)
        if not assignment:
            return None

        verification = CashBagVerification.get_by_bag_id(bag_id)

        return {
            "assignment": assignment.to_dict(),
            "verification": verification.to_dict() if verification else None,
        }
