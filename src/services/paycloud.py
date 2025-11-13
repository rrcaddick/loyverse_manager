import json
from datetime import datetime, timedelta

from config.constants import (
    ADD_PAY_TERMINALS,
    TODAY,
)
from config.settings import (
    ADD_PAY_APP_ID,
    ADD_PAY_MERCHANT_NO,
    PAYCLOUD_APP_PRIVATE_KEY,
    PAYCLOUD_GATEWAY_PUBLIC_KEY,
)
from src.clients.paycloud import PayCloudClient


class PayCloudService:
    def __init__(self):
        BASE_URL = "https://open.paycloud.africa/api/entry/"
        self.client = PayCloudClient(
            ADD_PAY_APP_ID,
            PAYCLOUD_APP_PRIVATE_KEY,
            PAYCLOUD_GATEWAY_PUBLIC_KEY,
            BASE_URL,
        )

    def get_terminal_transactions(self, terminal_sn, start_date=None, end_date=None):
        # Set end_date default to today
        end_date = end_date if end_date else str(TODAY)
        time_end = f"{end_date} 23:59:59"

        # Set start_date default to 62 days before end_date
        if not start_date:
            end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
            start_date_obj = end_date_obj - timedelta(days=61)
            start_date = start_date_obj.strftime("%Y-%m-%d")

        time_start = f"{start_date} 00:00:00"

        all_transactions = []
        page_num = 1

        while True:
            payload = {
                "merchant_no": ADD_PAY_MERCHANT_NO,
                "terminal_sn": terminal_sn,
                "price_currency": "ZAR",
                "time_start": time_start,
                "time_end": time_end,
                "page_num": page_num,
                "page_size": 200,
            }

            try:
                response = self.client.send_request(
                    self, "reconcile.trans.details", payload
                )
                transactions = json.loads(response["data"])["list"]

                # If no transactions returned, break the loop
                if not transactions:
                    break

                # Adjust the trans_end_time to UTC+2
                for tran in transactions:
                    original_time = datetime.strptime(
                        tran["trans_end_time"], "%Y-%m-%d %H:%M:%S"
                    )
                    adjusted_time = original_time + timedelta(hours=2)
                    tran["trans_end_time"] = adjusted_time.strftime("%Y-%m-%d %H:%M:%S")

                all_transactions.extend(transactions)
                page_num += 1

            except Exception as e:
                print(f"Error on page {page_num}:", str(e))
                break

        return all_transactions

    def get_transactions(self, start_date=None, end_date=None):
        transactions = []
        for terminal_sn in ADD_PAY_TERMINALS:
            terminal_transactions = self.get_terminal_transactions(
                terminal_sn, start_date, end_date
            )
            transactions.extend(terminal_transactions)

        return transactions

    def get_daily_card_payments(self):
        transactions = self.get_transactions()
        daily_totals = {}

        for tran in transactions:
            date = tran["trans_end_time"].split(" ")[0]
            daily_totals[date] = daily_totals.get(date, 0) + tran["trans_amount"]

        return [
            {"date": date, "amount": amount} for date, amount in daily_totals.items()
        ]
