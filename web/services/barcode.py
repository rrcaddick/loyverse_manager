import random
import time


def calculate_ean13_check_digit(barcode_12_digits):
    """Calculate the check digit for EAN-13 barcode."""
    if len(barcode_12_digits) != 12:
        raise ValueError("Barcode must be exactly 12 digits")

    # EAN-13 check digit algorithm:
    # 1. Multiply odd position digits (1st, 3rd, 5th...) by 1
    # 2. Multiply even position digits (2nd, 4th, 6th...) by 3
    # 3. Sum all results
    # 4. Check digit = (10 - (sum % 10)) % 10

    odd_sum = sum(int(barcode_12_digits[i]) for i in range(0, 12, 2))
    even_sum = sum(int(barcode_12_digits[i]) for i in range(1, 12, 2))
    total = odd_sum + (even_sum * 3)
    check_digit = (10 - (total % 10)) % 10

    return check_digit


def generate_barcode(prefix="200"):
    """
    Generate a unique 13-digit EAN-13 barcode for group bookings.

    Format: [3-digit prefix][9 digits unique][1 check digit]
    Example: "2001234567890"

    Args:
        prefix: 3-digit prefix to identify group bookings (default: "200")

    Returns:
        str: 13-digit EAN-13 barcode
    """
    # Generate 9 unique digits using timestamp + random
    timestamp_part = str(int(time.time() * 1000))[
        -6:
    ]  # Last 6 digits of millisecond timestamp
    random_part = str(random.randint(0, 999)).zfill(3)  # 3 random digits

    # Combine: prefix (3) + timestamp (6) + random (3) = 12 digits
    barcode_without_check = prefix + timestamp_part + random_part

    # Calculate EAN-13 check digit
    check_digit = calculate_ean13_check_digit(barcode_without_check)

    return barcode_without_check + str(check_digit)
