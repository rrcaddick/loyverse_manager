from flask import Blueprint, flash, render_template

from config.constants import CATEGORIES, GAZEBO_MAP, LOYVERSE_STORE_ID
from config.settings import LOYVERSE_API_KEY
from src.clients.loyverse import LoyverseClient
from src.repositories.aronium import AroniumRepository
from src.services.audit import AuditService
from src.services.loyverse import LoyverseService
from src.services.paycloud import PayCloudService
from src.utils.logging import setup_logger

# Setup logging
logger = setup_logger(__name__)

# Create blueprint
audit_bp = Blueprint("audit", __name__, url_prefix="/audit")


def get_audit_service():
    """Initialize and return audit service with all dependencies."""
    paycloud_service = PayCloudService()

    # Initialize Loyverse service - adjust parameters as needed
    loyverse_service = LoyverseService(
        loyverse_client=LoyverseClient(LOYVERSE_API_KEY),
        store_id=LOYVERSE_STORE_ID,
        categories=CATEGORIES,
        gazebo_map=GAZEBO_MAP,
    )

    # Initialize Aronium repository - adjust path as needed
    aronium_repository = AroniumRepository()

    audit_service = AuditService(
        logger=logger,
        paycloud_service=paycloud_service,
        loyverse_service=loyverse_service,
        aronium_repository=aronium_repository,
    )

    return audit_service


@audit_bp.route("/history")
def audit_history():
    """Display card payment audit history."""
    print("Trying to get audit history")
    try:
        audit_service = get_audit_service()

        # Get audit report (default: last 30 days)
        report = audit_service.get_card_audit_report()

        return render_template(
            "audit_history.html", summary=report["summary"], records=report["records"]
        )

    except Exception as e:
        logger.error(f"Error loading audit history: {str(e)}")
        flash(f"Error loading audit data: {str(e)}", "error")
        return render_template(
            "audit_history.html",
            summary={
                "total_days": 0,
                "days_with_variance": 0,
                "total_variance": 0.0,
                "largest_variance": 0.0,
            },
            records=[],
        )


@audit_bp.route("/run", methods=["POST"])
def run_audit():
    """Trigger audit creation for recent data."""
    try:
        audit_service = get_audit_service()

        # Run card payment audit (defaults to fetching recent data)
        audits = audit_service.create_card_payment_audit()

        return {
            "success": True,
            "message": f"Audit completed! Created {len(audits)} audit records.",
        }

    except Exception as e:
        logger.error(f"Error running audit: {str(e)}")
        return {"success": False, "error": str(e)}, 500
