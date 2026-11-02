import pytest  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _purge_test_groups():
    """Groups the DB tests made (migration 028) and whose bookings were deleted by raw SQL."""
    yield
    try:
        from src.models import booking_group

        booking_group.delete_empty(prefix="TEST ")
    except Exception:  # noqa: BLE001 - no database, nothing to purge
        pass
