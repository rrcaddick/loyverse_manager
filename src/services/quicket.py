from collections import Counter
from datetime import datetime


class QuicketService:
    def __init__(self, quicket_client, store_id, target_date, gazebo_map):
        self.client = quicket_client
        self.store_id = store_id
        self.target_date = target_date
        self.gazebo_map = gazebo_map

    def get_event_id(self):
        events = self.client.get("users/me/events")["results"]
        for event in events:
            for schedule in event.get("schedules", []):
                schedule_date = datetime.fromisoformat(schedule["startDate"]).date()
                if schedule_date == self.target_date:
                    return event["id"]
        return None

    def get_guest_list(self, event_id):
        return self.client.get(f"events/{event_id}/guests")

    def get_tickets(self, guest_data):
        results = guest_data.get("results", [])
        return [
            ticket
            for ticket in results
            if "TicketInformation" in ticket
            and "EventDate" in ticket["TicketInformation"]
            and datetime.fromisoformat(ticket["TicketInformation"]["EventDate"]).date()
            == self.target_date
        ]

    def get_ticket_orders(self, tickets):
        order_counts = Counter(
            ticket["OrderId"]
            for ticket in tickets
            if "visitor" in ticket["TicketInformation"]["Ticket Type"].lower()
        )
        return [
            {"order_id": order_id, "ticket_count": count}
            for order_id, count in order_counts.items()
        ]

    def get_gazebo_inventory_map(self, tickets):
        gaezbo_orders = [
            ticket["TicketInformation"]["Ticket Type"]
            for ticket in tickets
            if "gazebo" in ticket["TicketInformation"]["Ticket Type"].lower()
        ]

        return [
            {
                "variant_id": self.gazebo_map[gazebo],
                "store_id": self.store_id,
                "stock_after": 0,
            }
            for gazebo in gaezbo_orders
        ]

    def get_ticket_purchaser(self, tickets):
        for ticket in tickets:
            if ticket["TicketInformation"]["First name"] == "":
                continue

            first_name = ticket["TicketInformation"]["First name"].title()
            surname = ticket["TicketInformation"]["Surname"].title()
            cellphone = ticket["TicketInformation"]["Cellphone"].replace("+27", "0")

            return {
                "first_name": first_name,
                "surname": surname,
                "cellphone": cellphone,
            }

    def get_event_url(self, event_id: str) -> str:
        """Construct the URL for the given event ID."""
        return f"https://www.quicket.co.za/app/#/account/event/{event_id}/details"
