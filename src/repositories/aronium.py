import sqlite3

from config.settings import ARONIUM_PATH


class AroniumRepository:
    def __init__(self):
        self.db_path = ARONIUM_PATH

    def get_card_payments(self):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()

            query = """
            SELECT 
                DATE(P.Date) AS Date,
                PT.Name AS PaymentType,
                SUM(P.Amount) AS Total
            FROM 
                Payment P
            LEFT JOIN 
                PaymentType PT 
            ON 
                P.PaymentTypeId = PT.Id
            WHERE
                P.PaymentTypeId = 2 AND
                DATE(P.Date) >= '2024-09-01'
            GROUP BY 
                DATE(P.Date), PT.Name
            ORDER BY 
                Date, PT.Name
            """

            try:
                cursor.execute(query)
                results = [
                    {"date": row[0], "amount": row[2]} for row in cursor.fetchall()
                ]
                return results

            except sqlite3.Error as e:
                print(f"An error occurred: {e}")
                return []

    def get_cash_payments(self):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()

            query = """
              SELECT 
                  DATE(P.Date) AS Date,
                  SUM(CASE WHEN DT.Name = 'Sales' THEN Amount ELSE 0 END) AS SalesTotal,
                  SUM(CASE WHEN DT.Name = 'Refund' THEN Amount ELSE 0 END) AS RefundTotal,
                  COUNT(CASE WHEN DT.Name = 'Refund' THEN Amount END) AS RefundCount,
                  SUM(CASE WHEN DT.Name = 'Sales' THEN Amount ELSE 0 END) - SUM(CASE WHEN DT.Name = 'Refund' THEN Amount ELSE 0 END) AS ExpectedCash
              FROM 
                  Payment P
              LEFT JOIN 
                  PaymentType PT ON P.PaymentTypeId = PT.Id
              LEFT JOIN
                  Document D ON P.DocumentId = D.Id
              LEFT JOIN
                  DocumentType DT ON D.DocumentTypeId = DT.Id
              WHERE 
                  P.PaymentTypeId = 1 AND
                  DATE(P.Date) >= '2024-09-01'
              GROUP BY
                  DATE(P.Date)
              ORDER BY
                  Date DESC
            """

            try:
                cursor.execute(query)
                results = [
                    {
                        "date": row[0],
                        "sales_total": row[1],
                        "refund_total": row[2],
                        "refund_count": row[3],
                        "expected_cash": row[4],
                    }
                    for row in cursor.fetchall()
                ]
                return results

            except sqlite3.Error as e:
                print(f"An error occurred: {e}")
                return []
