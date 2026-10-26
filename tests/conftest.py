# Test harness: needs a local MySQL/MariaDB (root, no password, or DB_* env vars).
# Run:  pytest -q          (creates and wipes database `zuno_test`)
import os, re, sys, subprocess
os.environ.update({
    'DB_NAME': os.getenv('TEST_DB_NAME', 'zuno_test'),
    'SECRET_KEY': 'test-secret-key-0123456789',
    'JWT_SECRET_KEY': 'test-jwt-secret-0123456789-0123456789',
    'LINK_SIGNING_SECRET': 'test-link-secret-0123456789',
    'MPESA_CALLBACK_SECRET': 'test-callback-secret-0123456789',
    'FRONTEND_URL': 'http://localhost:3000',
})
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
import MySQLdb

ROOT = os.path.dirname(os.path.dirname(__file__))


def _admin_conn(db=None):
    kw = dict(host=os.getenv('DB_HOST', 'localhost'), user=os.getenv('DB_USER', 'root'),
              passwd=os.getenv('DB_PASSWORD', ''), autocommit=True)
    if db:
        kw['db'] = db
    return MySQLdb.connect(**kw)


@pytest.fixture(scope='session')
def app():
    name = os.environ['DB_NAME']
    c = _admin_conn()
    cur = c.cursor()
    cur.execute(f"DROP DATABASE IF EXISTS {name}")
    cur.execute(f"CREATE DATABASE {name} CHARACTER SET utf8mb4")
    c.close()
    c = _admin_conn(name)
    cur = c.cursor()
    sql = re.sub(r'--[^\n]*', '', open(os.path.join(ROOT, 'db', 'schema.sql')).read())
    for stmt in sql.split(';'):
        if stmt.strip():
            cur.execute(stmt)
    c.close()

    from app import create_app
    import app.services.sms as sms_mod

    class FakeSMS:
        sent = []
        @staticmethod
        def send(message, recipients, sender_id=None):
            FakeSMS.sent.append((recipients[0], message))
            return {'ok': True}
    sms_mod.sms = FakeSMS

    application = create_app(run_scheduler=False)
    application.config['TESTING'] = True
    application.fake_sms = FakeSMS
    return application


@pytest.fixture(autouse=True)
def clean(app):
    from app.utils import security
    security._request_log.clear()
    app.fake_sms.sent.clear()
    c = _admin_conn(os.environ['DB_NAME'])
    cur = c.cursor()
    cur.execute("SET FOREIGN_KEY_CHECKS=0")
    for t in ('payouts', 'disputes', 'dispute_evidence', 'negotiation_messages', 'transaction_logs',
              'transactions', 'deal_contracts', 'ratings', 'mpesa_events', 'otp_verifications',
              'seller_reputation', 'security_logs', 'notifications', 'users'):
        cur.execute(f"TRUNCATE TABLE {t}")
    cur.execute("SET FOREIGN_KEY_CHECKS=1")
    c.close()
    yield


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def db():
    c = _admin_conn(os.environ['DB_NAME'])
    cur = c.cursor(MySQLdb.cursors.DictCursor)
    class D:
        def q(self, sql, args=()):
            cur.execute(sql, args)
            return cur.fetchall()
        def one(self, sql, args=()):
            r = self.q(sql, args)
            return r[0] if r else None
        def x(self, sql, args=()):
            cur.execute(sql, args)
    yield D()
    c.close()


class Helpers:
    def __init__(self, client, app):
        self.client, self.app = client, app
        self.n = 0

    def last_otp(self, phone):
        for to, msg in reversed(self.app.fake_sms.sent):
            if to == phone:
                m = re.search(r'code is: (\d{6})', msg)
                if m:
                    return m.group(1)

    def make_user(self, role='seller', phone=None, password='Passw0rd!x', tier=None, verified_kyc=False):
        """Register + verify phone through the real endpoints; returns dict(token,id,phone,h)."""
        self.n += 1
        phone = phone or f"07{10000000 + self.n}"
        r = self.client.post('/api/auth/register', json={
            'full_name': f'{role.title()} {self.n}', 'phone_number': phone,
            'password': password, 'role': role})
        assert r.status_code == 201, r.get_json()
        e164 = '+254' + phone[1:]
        otp = self.last_otp(e164)
        r = self.client.post('/api/auth/verify-otp', json={'phone_number': phone, 'otp_code': otp})
        assert r.status_code == 200, r.get_json()
        body = r.get_json()
        u = {'id': body['user']['id'], 'phone': e164, 'token': body['token'],
             'h': {'Authorization': f"Bearer {body['token']}"}, 'password': password}
        if tier is not None or verified_kyc:
            c = _admin_conn(os.environ['DB_NAME'])
            c.cursor().execute("UPDATE users SET is_verified=TRUE, verification_status='VERIFIED', "
                               "seller_tier=%s WHERE id=%s", (tier if tier is not None else 1, u['id']))
            c.close()
        return u

    def make_admin(self):
        u = self.make_user('buyer')
        c = _admin_conn(os.environ['DB_NAME'])
        c.cursor().execute("UPDATE users SET role='admin' WHERE id=%s", (u['id'],))
        c.close()
        return u

    def make_txn(self, seller, buyer, status='FUNDED', amount=1000, txn_id=None):
        """Insert a transaction directly (as the contract flow would). Fees: 2.5%, split 50/50."""
        from app.utils.helpers import calculate_fees
        f = calculate_fees(amount)
        self.n += 1
        txn_id = txn_id or f"ZNO-TEST-{self.n:08d}"
        c = _admin_conn(os.environ['DB_NAME'])
        c.cursor().execute("""
            INSERT INTO transactions (id, contract_id, seller_id, buyer_user_id, buyer_phone, buyer_name,
                item_name, amount, platform_fee, buyer_fee_share, seller_fee_share, buyer_pays,
                seller_receives, delivery_method, status, funded_at)
            VALUES (%s,%s,%s,%s,%s,'Buyer','Test item',%s,%s,%s,%s,%s,%s,'PLATFORM_COURIER',%s,NOW())
        """, (txn_id, self.n, seller['id'], buyer['id'], buyer['phone'], amount,
              f['total_fee'], f['buyer_fee_share'], f['seller_fee_share'],
              f['buyer_pays'], f['seller_receives'], status))
        c.close()
        return txn_id


@pytest.fixture
def H(client, app):
    return Helpers(client, app)
