"""
SANDBOX ONLY. Pretends to be Safaricom and reports a successful STK payment to your own API,
so you can test shipping, delivery, release, refunds and payouts when the Daraja sandbox
does not complete payments.

Usage (API running, venv active, from the zuno-api-fixed folder):
    python scripts\\simulate_payment.py ZNO-20261025-CCDJ22BA
"""
import os
import random
import string
import sys

import MySQLdb
import MySQLdb.cursors
import requests
from dotenv import load_dotenv

load_dotenv()

if os.getenv('MPESA_ENVIRONMENT', 'sandbox') == 'production':
    sys.exit('Refusing to run: MPESA_ENVIRONMENT is production.')
if len(sys.argv) != 2:
    sys.exit('Usage: python scripts\\simulate_payment.py <transaction id>')

txn_id = sys.argv[1].strip()
conn = MySQLdb.connect(host=os.getenv('DB_HOST', 'localhost'), user=os.getenv('DB_USER'),
                       passwd=os.getenv('DB_PASSWORD', ''), db=os.getenv('DB_NAME'),
                       cursorclass=MySQLdb.cursors.DictCursor)
cur = conn.cursor()
cur.execute("SELECT status, buyer_pays, mpesa_checkout_id FROM transactions WHERE id = %s", (txn_id,))
row = cur.fetchone()
if not row:
    sys.exit('No such transaction.')
if row['status'] != 'PENDING':
    sys.exit(f"Transaction is {row['status']}, not PENDING.")
if not row['mpesa_checkout_id']:
    sys.exit('Press Pay on the website first, so a payment request exists.')

receipt = 'SIM' + ''.join(random.choices(string.ascii_uppercase + string.digits, k=7))
body = {'Body': {'stkCallback': {
    'MerchantRequestID': 'sim', 'CheckoutRequestID': row['mpesa_checkout_id'],
    'ResultCode': 0, 'ResultDesc': 'The service request is processed successfully.',
    'CallbackMetadata': {'Item': [
        {'Name': 'Amount', 'Value': int(row['buyer_pays'])},
        {'Name': 'MpesaReceiptNumber', 'Value': receipt},
        {'Name': 'PhoneNumber', 'Value': 254708374149}]}}}}
url = f"http://localhost:5000/api/payments/hook/stk/{os.getenv('MPESA_CALLBACK_SECRET')}"
r = requests.post(url, json=body, timeout=15)
print('Sent. API answered', r.status_code, '- receipt', receipt)
