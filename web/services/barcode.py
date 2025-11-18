import uuid


def generate_barcode():
    """Generate a unique barcode for group bookings"""
    return f"GRP-{uuid.uuid4().hex[:10].upper()}"
