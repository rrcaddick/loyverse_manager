"""Self-managed POS staff: roles, employees, PINs, enrolled terminals and the audit trail.

The patched Loyverse terminals (the "bridge") no longer trust Loyverse's employee list.
Each terminal downloads a roster from here, verifies PINs against it on the device (so the
gate keeps working offline), enforces the role's permissions, and reports every login,
failed PIN, lockout, approval, denied action, sale, refund and ticket rewrite back.

How a PIN is protected
    pin_hash     = PBKDF2-HMAC-SHA256(pin, site salt, ITERATIONS)       stored here, never sent
    verifier(d)  = HMAC-SHA256(secret of device d, pin_hash)             sent only to device d
    A terminal computes the same two steps from the digits typed and compares in constant
    time. A roster stolen from one terminal is useless anywhere else, a leaked bridge token
    alone yields nothing, and revoking a device (``PosDevice.set_active``) ends its access.
    Four-digit PINs cannot survive an offline brute force whatever the hash, so the terminal
    keeps its roster encrypted under its hardware keystore and locks the PIN pad after
    repeated failures; the server records every failure for review.

PIN policy
    Digits only, PIN_MIN_LENGTH..PIN_MAX_LENGTH long, no single repeated digit and no straight
    run (1234, 4321). Two employees can never share a PIN: the unique index on pin_hash
    rejects the second one, and ``PinInUseError`` says so without saying whose it is.
"""

import hashlib
import hmac
import json
import secrets
import uuid
from datetime import datetime

import pymysql

from src.models.pos_staff import PosAuthParams, PosDevice, PosEmployee, PosEmployeeEvent, PosRole

ALGORITHM = "pbkdf2-sha256"
ITERATIONS = 50_000
KEY_LENGTH = 32
SALT_BYTES = 16
DEVICE_SECRET_BYTES = 32

PIN_MIN_LENGTH = 4
PIN_MAX_LENGTH = 6

# What a terminal does after wrong PINs: lock the pad for LOCKOUT_SECONDS, doubling each
# further round of MAX_ATTEMPTS failures.
MAX_ATTEMPTS = 5
LOCKOUT_SECONDS = 30

# Loyverse's own employee permissions: the names of the k9.d0$a enum in POS 2.63, which is
# what the app asks for before a restricted action. The terminal answers those checks from
# the employee's role here instead of from Loyverse's employee list. The POS-side ones are:
#   ACCESS_LPOS                          may log in to the POS at all (every role needs it)
#   ACCESS_ACCEPT_PAYMENTS               take payments
#   ACCESS_REFUND                        refund a receipt
#   ACCESS_DISCOUNT                      apply discounts
#   ACCESS_LPOS_CHANGE_TAXES_DURING_SALE change taxes on a sale
#   ACCESS_VIEW_RECEIPTS                 open the receipts list
#   ACCESS_REPRINT_RECEIPTS              reprint receipts
#   ACCESS_NOT_MY_OPENED_RECEIPTS        open tickets saved by other employees
#   ACCESS_DELETE_OPEN_RECEIPT           delete (void) an open ticket
#   ACCESS_VIEW_CURRENT_SHIFT            see the shift report
#   ACCESS_OPEN_CASH_DRAWER              open the drawer without a sale
#   ACCESS_VIEW_COST_POS                 see item costs
#   ACCESS_LPOS_CLIENT_RECALL            look up customers
#   ACCESS_CONNECT_PRINTERS              printer settings
#   ACCESS_LPOS_SUPPORT                  support menu
# The rest are back-office rights Loyverse never checks on the terminal.
LOYVERSE_PERMISSIONS = [
    "ACCESS_ACCEPT_PAYMENTS",
    "ACCESS_BACK_CLIENT_RECALLS",
    "ACCESS_BACK_OFFICE",
    "ACCESS_BACK_OFFICE_SUPPORT",
    "ACCESS_CLIENTS",
    "ACCESS_CONNECT_PRINTERS",
    "ACCESS_DELETE_OPEN_RECEIPT",
    "ACCESS_DISCOUNT",
    "ACCESS_EDIT_LOYALTY",
    "ACCESS_EDIT_PROFILE",
    "ACCESS_EDIT_WARE",
    "ACCESS_FOR_ALL_MERCHANTS",
    "ACCESS_LPOS",
    "ACCESS_LPOS_CHANGE_TAXES_DURING_SALE",
    "ACCESS_LPOS_CLIENT_RECALL",
    "ACCESS_LPOS_SUPPORT",
    "ACCESS_MERCHANTS",
    "ACCESS_NOT_MY_OPENED_RECEIPTS",
    "ACCESS_OPEN_CASH_DRAWER",
    "ACCESS_OUTLETS",
    "ACCESS_REFUND",
    "ACCESS_REPORTS",
    "ACCESS_REPRINT_RECEIPTS",
    "ACCESS_TAXES",
    "ACCESS_VIEW_COST_POS",
    "ACCESS_VIEW_CURRENT_SHIFT",
    "ACCESS_VIEW_RECEIPTS",
    "ACCESS_WARES",
]

# Permissions for the bridge's own features.
BRIDGE_PERMISSIONS = [
    # REPLACE ITEMS on the "ticket already open" screen (rewrites a saved ticket's lines)
    "bridge.replace_ticket_items",
    # type a registration instead of scanning the licence disc
    "bridge.manual_plate",
    # the Settings entry in the terminal's drawer (Loyverse has no permission for it)
    "bridge.settings",
    # the Apps entry in the terminal's drawer
    "bridge.apps",
]

PERMISSIONS = LOYVERSE_PERMISSIONS + BRIDGE_PERMISSIONS

# Starter roles, created the first time the roster is built on an empty pos_roles table.
DEFAULT_ROLES = [
    (
        "Manager",
        "Runs the gate: everything on the terminal, approves cashiers' restricted actions",
        [
            "ACCESS_LPOS",
            "ACCESS_ACCEPT_PAYMENTS",
            "ACCESS_REFUND",
            "ACCESS_DISCOUNT",
            "ACCESS_VIEW_RECEIPTS",
            "ACCESS_REPRINT_RECEIPTS",
            "ACCESS_NOT_MY_OPENED_RECEIPTS",
            "ACCESS_DELETE_OPEN_RECEIPT",
            "ACCESS_VIEW_CURRENT_SHIFT",
            "ACCESS_OPEN_CASH_DRAWER",
            "ACCESS_LPOS_CLIENT_RECALL",
            "ACCESS_CONNECT_PRINTERS",
            "ACCESS_EDIT_WARE",
            "ACCESS_LPOS_SUPPORT",
            "bridge.replace_ticket_items",
            "bridge.manual_plate",
            "bridge.settings",
            "bridge.apps",
        ],
    ),
    (
        "Cashier",
        "Takes payments at the terminal; refunds, discounts and deleting tickets need a manager's PIN",
        [
            "ACCESS_LPOS",
            "ACCESS_ACCEPT_PAYMENTS",
            "ACCESS_VIEW_RECEIPTS",
            "ACCESS_NOT_MY_OPENED_RECEIPTS",
            "ACCESS_VIEW_CURRENT_SHIFT",
            "bridge.manual_plate",
        ],
    ),
    (
        "Marshal",
        "Opens tickets at the gate on a phone; no payments, refunds or discounts",
        ["ACCESS_LPOS", "ACCESS_NOT_MY_OPENED_RECEIPTS", "bridge.manual_plate"],
    ),
]

EVENT_NAMES = {
    "login",
    "logout",
    "login_failed",
    "locked",
    "approval",
    "approval_failed",
    "permission_denied",
    "sale",
    "refund",
    "ticket_saved",
    "ticket_replaced",
    "ticket_printed",
    "ticket_opened",
    "roster_refreshed",
}


class PinPolicyError(ValueError):
    """The PIN does not meet the policy; the message is safe to show."""


class PinInUseError(ValueError):
    """Another employee already has this PIN."""


class DeviceAuthError(Exception):
    """The terminal is unknown, revoked, or presented the wrong secret."""


class PosStaffService:
    def __init__(self, auth_params=None):
        self._params = auth_params

    # ---- PIN hashing ----------------------------------------------------------------------

    def auth_params(self):
        if self._params is None:
            params = PosAuthParams.get()
            if params is None:
                params = PosAuthParams.create(
                    ALGORITHM, secrets.token_bytes(SALT_BYTES).hex(), ITERATIONS, KEY_LENGTH
                )
            self._params = params
        return self._params

    @staticmethod
    def validate_pin(pin):
        if not isinstance(pin, str) or not pin.isdigit() or not pin.isascii():
            raise PinPolicyError("The PIN must be digits only")
        if not PIN_MIN_LENGTH <= len(pin) <= PIN_MAX_LENGTH:
            raise PinPolicyError(f"The PIN must be {PIN_MIN_LENGTH} to {PIN_MAX_LENGTH} digits")
        if len(set(pin)) == 1:
            raise PinPolicyError("The PIN cannot be one repeated digit")
        steps = {int(b) - int(a) for a, b in zip(pin, pin[1:])}
        if steps in ({1}, {-1}):
            raise PinPolicyError("The PIN cannot be a straight run of digits")

    def hash_pin(self, pin):
        """Hex PBKDF2 of a PIN that already passed ``validate_pin``."""
        params = self.auth_params()
        if params["algorithm"] != ALGORITHM:
            raise RuntimeError(f"unsupported PIN hash algorithm {params['algorithm']}")
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            pin.encode("ascii"),
            bytes.fromhex(params["salt_hex"]),
            int(params["iterations"]),
            dklen=int(params["key_length"]),
        )
        return digest.hex()

    @staticmethod
    def verifier(device_secret_hex, pin_hash_hex):
        """What a terminal compares against: HMAC of the stored hash under the device secret."""
        return hmac.new(
            bytes.fromhex(device_secret_hex), bytes.fromhex(pin_hash_hex), hashlib.sha256
        ).hexdigest()

    def check_pin(self, pin):
        """Server-side verification (for the back office's own use); the active employee or None."""
        try:
            self.validate_pin(pin)
        except PinPolicyError:
            return None
        employee = PosEmployee.get_by_pin_hash(self.hash_pin(pin))
        return employee if employee and employee["active"] else None

    # ---- roles and employees --------------------------------------------------------------

    @staticmethod
    def validate_permissions(permissions):
        unknown = sorted(set(permissions) - set(PERMISSIONS))
        if unknown:
            raise ValueError(f"unknown permissions: {', '.join(unknown)}")
        return sorted(set(permissions))

    def create_role(self, name, description, permissions):
        return PosRole.create(name.strip(), description.strip(), self.validate_permissions(permissions))

    def update_role(self, role_id, name=None, description=None, permissions=None):
        if permissions is not None:
            permissions = self.validate_permissions(permissions)
        return PosRole.update(role_id, name=name, description=description, permissions=permissions)

    def ensure_default_roles(self):
        if PosRole.all():
            return
        for name, description, permissions in DEFAULT_ROLES:
            PosRole.create(name, description, permissions)

    def create_employee(self, name, role_id, pin=None, loyverse_merchant_id=None):
        name = name.strip()
        if not name:
            raise ValueError("name required")
        if PosRole.get(role_id) is None:
            raise ValueError("unknown role")
        pin_hash = None
        if pin is not None:
            self.validate_pin(pin)
            pin_hash = self.hash_pin(pin)
        try:
            return PosEmployee.create(name, role_id, pin_hash=pin_hash, loyverse_merchant_id=loyverse_merchant_id)
        except pymysql.err.IntegrityError as e:
            raise PinInUseError("That PIN is already in use") from e

    def set_pin(self, employee_id, pin):
        self.validate_pin(pin)
        try:
            return PosEmployee.set_pin_hash(employee_id, self.hash_pin(pin))
        except pymysql.err.IntegrityError as e:
            raise PinInUseError("That PIN is already in use") from e

    @staticmethod
    def clear_pin(employee_id):
        return PosEmployee.set_pin_hash(employee_id, None)

    @staticmethod
    def set_active(employee_id, active):
        return PosEmployee.update(employee_id, active=active)

    # ---- terminals -------------------------------------------------------------------------

    @staticmethod
    def enrol_device(device_id, note=""):
        """Returns (device row, secret hex). The secret is shown once; it is also the only copy
        a terminal gets, so re-enrolling replaces it."""
        device_id = device_id.strip()
        if not device_id or len(device_id) > 64:
            raise ValueError("device_id must be 1-64 characters")
        secret_hex = secrets.token_bytes(DEVICE_SECRET_BYTES).hex()
        return PosDevice.enrol(device_id, secret_hex, note.strip()), secret_hex

    @staticmethod
    def authenticate_device(device_id, secret_hex):
        """The device row, or DeviceAuthError. Same cost and message whatever went wrong."""
        if not isinstance(device_id, str) or not isinstance(secret_hex, str):
            raise DeviceAuthError("device not authorised")
        device = PosDevice.get_by_device_id(device_id[:64])
        stored = device["secret_hex"] if device else "0" * (DEVICE_SECRET_BYTES * 2)
        matches = hmac.compare_digest(stored.encode("ascii"), secret_hex.strip().lower().encode("ascii"))
        if device is None or not device["active"] or not matches:
            raise DeviceAuthError("device not authorised")
        return device

    # ---- roster ----------------------------------------------------------------------------

    def roster_for_device(self, device):
        """The payload a terminal caches: employees with per-device verifiers, the hash
        parameters and the lockout policy. ``version`` changes whenever anything in it does."""
        self.ensure_default_roles()
        params = self.auth_params()
        employees = []
        for e in PosEmployee.roster():
            employees.append(
                {
                    "id": e["id"],
                    "name": e["name"],
                    "role": e["role_name"],
                    "permissions": e["permissions"],
                    "verifier": self.verifier(device["secret_hex"], e["pin_hash"]),
                }
            )
        body = {
            "auth": {
                "algorithm": params["algorithm"],
                "salt": params["salt_hex"],
                "iterations": int(params["iterations"]),
                "length": int(params["key_length"]),
            },
            "policy": {"max_attempts": MAX_ATTEMPTS, "lockout_seconds": LOCKOUT_SECONDS},
            "employees": employees,
        }
        canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))
        body["version"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        body["generated_at"] = datetime.now().isoformat(timespec="seconds")
        PosDevice.touch(device["device_id"], roster_version=body["version"])
        return body

    # ---- audit trail -------------------------------------------------------------------------

    @staticmethod
    def record_events(device, events):
        """Store the terminal's events; returns (accepted, rejected). Malformed entries are
        rejected individually so one bad event never blocks the batch."""
        accepted = rejected = 0
        received_at = datetime.now()
        for evt in events if isinstance(events, list) else []:
            try:
                event_uuid = str(uuid.UUID(str(evt["uuid"])))
                event = str(evt["event"])
                if event not in EVENT_NAMES:
                    raise ValueError(event)
                occurred_at = datetime.fromtimestamp(int(evt["occurred_at"]) / 1000)
                employee_id = evt.get("employee_id")
                employee_id = int(employee_id) if employee_id not in (None, "") else None
                employee_name = evt.get("employee_name")
                employee_name = str(employee_name)[:100] if employee_name else None
                detail = evt.get("detail")
                if detail is not None and not isinstance(detail, dict):
                    raise ValueError("detail")
            except (KeyError, TypeError, ValueError, OverflowError):
                rejected += 1
                continue
            PosEmployeeEvent.record(
                event_uuid, device["device_id"], employee_id, employee_name, event, detail, occurred_at, received_at
            )
            accepted += 1
        PosDevice.touch(device["device_id"])
        return accepted, rejected
