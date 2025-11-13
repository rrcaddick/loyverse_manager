from config.constants import GAZEBOS


def get_gazebo_by_quicket_name(quicket_name):
    """Get gazebo by Quicket ticket name."""
    return next((g for g in GAZEBOS if g["quicket_name"] == quicket_name), None)


def get_gazebo_by_loyverse_name(loyverse_name):
    """Get gazebo by Loyverse ticket name."""
    return next((g for g in GAZEBOS if g["loyverse_name"] == loyverse_name), None)


def get_gazebo_by_loyverse_id(loyverse_id):
    """Get gazebo by Loyverse ID."""
    return next((g for g in GAZEBOS if g["loyverse_id"] == loyverse_id), None)
