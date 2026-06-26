"""Backend tests for Outy expense tracking module.

Covers:
- Profile + Outing + Invite flow
- Equal split balance calculation
- Custom split balance calculation
- Settlement optimization (minimum transactions)
- Validation: mismatched shares, non-member shares, empty shares
- Idempotency: balances sorted desc, total = sum(expenses)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://outy-trips.preview.emergentagent.com").rstrip("/") + "/api"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _unique(prefix):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def users(api):
    """Create 4 users: Krish, Rahul, Arjun, Priya"""
    created = {}
    for name in ["Krish", "Rahul", "Arjun", "Priya"]:
        uname = _unique(name.lower())
        r = api.post(f"{BASE_URL}/profile", json={"name": name, "username": uname})
        assert r.status_code == 200, f"Profile create failed for {name}: {r.text}"
        body = r.json()
        assert body.get("id") and body.get("username") == uname
        created[name] = body
    return created


@pytest.fixture(scope="module")
def outing(api, users):
    """Krish creates outing, invites others by username."""
    krish = users["Krish"]
    payload = {
        "name": "TEST_Goa_Trip",
        "destination": "Goa",
        "start_date": "2026-02-01",
        "end_date": "2026-02-05",
        "created_by": krish["id"],
        "creator_name": krish["name"],
    }
    r = api.post(f"{BASE_URL}/outings", json=payload)
    assert r.status_code == 200, r.text
    outing = r.json()
    assert outing["id"]
    assert len(outing["members"]) == 1
    assert outing["members"][0]["user_id"] == krish["id"]

    for name in ["Rahul", "Arjun", "Priya"]:
        r = api.post(
            f"{BASE_URL}/outings/{outing['id']}/invite",
            json={"username": users[name]["username"]},
        )
        assert r.status_code == 200, f"Invite {name} failed: {r.text}"
        outing = r.json()

    assert len(outing["members"]) == 4
    return outing


def _by_name(balances, name):
    for b in balances:
        if b["name"] == name:
            return b
    raise AssertionError(f"{name} not in balances")


# ---- Scenario 1: Equal split ----
class TestEqualSplit:
    @pytest.fixture(scope="class")
    def outing_with_dinner(self, api, users, outing):
        krish = users["Krish"]
        shares = [
            {"user_id": users[n]["id"], "name": n, "share_amount": 500.0}
            for n in ["Krish", "Rahul", "Arjun", "Priya"]
        ]
        payload = {
            "title": "Dinner",
            "amount": 2000.0,
            "category": "food",
            "paid_by": krish["id"],
            "paid_by_name": krish["name"],
            "split_type": "equal",
            "shares": shares,
        }
        r = api.post(f"{BASE_URL}/outings/{outing['id']}/expenses", json=payload)
        assert r.status_code == 200, r.text
        exp = r.json()
        assert exp["amount"] == 2000.0
        assert len(exp["shares"]) == 4
        return outing

    def test_balances_equal_split(self, api, outing_with_dinner):
        r = api.get(f"{BASE_URL}/outings/{outing_with_dinner['id']}/balances")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] == 2000.0
        balances = data["balances"]
        assert len(balances) == 4
        # sorted desc
        nets = [b["net_balance"] for b in balances]
        assert nets == sorted(nets, reverse=True)
        krish = _by_name(balances, "Krish")
        assert krish["total_paid"] == 2000.0
        assert krish["total_owed"] == 500.0
        assert krish["net_balance"] == 1500.0
        for name in ["Rahul", "Arjun", "Priya"]:
            b = _by_name(balances, name)
            assert b["total_paid"] == 0.0
            assert b["total_owed"] == 500.0
            assert b["net_balance"] == -500.0

    def test_settlements_equal_split(self, api, users, outing_with_dinner):
        r = api.get(f"{BASE_URL}/outings/{outing_with_dinner['id']}/settlements")
        assert r.status_code == 200, r.text
        data = r.json()
        txns = data["transactions"]
        # Exactly 3 transactions, each 500 to Krish
        assert len(txns) == 3, f"Expected 3 transactions, got {len(txns)}: {txns}"
        krish_id = users["Krish"]["id"]
        for t in txns:
            assert t["to_user_id"] == krish_id
            assert t["to_name"] == "Krish"
            assert t["amount"] == 500.0
            assert t["from_user_id"] != krish_id

        # All debtors covered
        from_ids = {t["from_user_id"] for t in txns}
        expected = {users[n]["id"] for n in ["Rahul", "Arjun", "Priya"]}
        assert from_ids == expected

        # Minimum transactions constraint: ≤ max(creditors, debtors) = max(1, 3) = 3
        creditors = [b for b in data["balances"] if b["net_balance"] > 0.01]
        debtors = [b for b in data["balances"] if b["net_balance"] < -0.01]
        assert len(txns) <= max(len(creditors), len(debtors))


# ---- Scenario 2: Custom split (isolated outing) ----
@pytest.fixture(scope="module")
def custom_outing(api, users):
    krish = users["Krish"]
    payload = {
        "name": "TEST_Custom_Outing",
        "destination": "Manali",
        "start_date": "2026-03-01",
        "end_date": "2026-03-05",
        "created_by": krish["id"],
        "creator_name": krish["name"],
    }
    r = api.post(f"{BASE_URL}/outings", json=payload)
    assert r.status_code == 200
    o = r.json()
    for name in ["Rahul", "Arjun", "Priya"]:
        r = api.post(
            f"{BASE_URL}/outings/{o['id']}/invite",
            json={"username": users[name]["username"]},
        )
        assert r.status_code == 200
        o = r.json()
    return o


class TestCustomSplit:
    """Arjun pays ₹1500 with shares Krish=0, Priya=200, Rahul=200, Arjun=1100.
    Expected: Arjun +400, Krish 0, Rahul -200, Priya -200.
    Settlement: 2 txns Rahul→Arjun 200, Priya→Arjun 200.
    """

    def test_add_custom_expense(self, api, users, custom_outing):
        arjun = users["Arjun"]
        shares = [
            {"user_id": users["Krish"]["id"], "name": "Krish", "share_amount": 0.0},
            {"user_id": users["Priya"]["id"], "name": "Priya", "share_amount": 200.0},
            {"user_id": users["Rahul"]["id"], "name": "Rahul", "share_amount": 200.0},
            {"user_id": users["Arjun"]["id"], "name": "Arjun", "share_amount": 1100.0},
        ]
        payload = {
            "title": "Hotel",
            "amount": 1500.0,
            "category": "stay",
            "paid_by": arjun["id"],
            "paid_by_name": arjun["name"],
            "split_type": "custom",
            "shares": shares,
        }
        r = api.post(f"{BASE_URL}/outings/{custom_outing['id']}/expenses", json=payload)
        assert r.status_code == 200, r.text

    def test_custom_balances(self, api, custom_outing):
        r = api.get(f"{BASE_URL}/outings/{custom_outing['id']}/balances")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 1500.0
        b = data["balances"]
        assert _by_name(b, "Arjun")["net_balance"] == 400.0
        assert _by_name(b, "Krish")["net_balance"] == 0.0
        assert _by_name(b, "Rahul")["net_balance"] == -200.0
        assert _by_name(b, "Priya")["net_balance"] == -200.0
        # sorted desc
        nets = [x["net_balance"] for x in b]
        assert nets == sorted(nets, reverse=True)

    def test_custom_settlements(self, api, users, custom_outing):
        r = api.get(f"{BASE_URL}/outings/{custom_outing['id']}/settlements")
        assert r.status_code == 200
        data = r.json()
        txns = data["transactions"]
        assert len(txns) == 2, f"Expected 2 txns, got {len(txns)}: {txns}"
        arjun_id = users["Arjun"]["id"]
        for t in txns:
            assert t["to_user_id"] == arjun_id
            assert t["amount"] == 200.0
            assert t["from_user_id"] in {users["Rahul"]["id"], users["Priya"]["id"]}

        # net_balance consistency: for each user, received - paid_out == net
        received_paid = {}
        for t in txns:
            received_paid[t["to_user_id"]] = received_paid.get(t["to_user_id"], 0.0) + t["amount"]
            received_paid[t["from_user_id"]] = received_paid.get(t["from_user_id"], 0.0) - t["amount"]
        for b in data["balances"]:
            if abs(b["net_balance"]) > 0.01:
                assert abs(received_paid.get(b["user_id"], 0.0) - b["net_balance"]) < 0.01

        # All amounts > 0
        for t in txns:
            assert t["amount"] > 0

        # minimum: ≤ max(creditors, debtors)
        creditors = [b for b in data["balances"] if b["net_balance"] > 0.01]
        debtors = [b for b in data["balances"] if b["net_balance"] < -0.01]
        assert len(txns) <= max(len(creditors), len(debtors))


# ---- Scenario 3: Validation tests ----
class TestValidation:
    def test_mismatched_shares_total(self, api, users, custom_outing):
        krish = users["Krish"]
        shares = [
            {"user_id": users[n]["id"], "name": n, "share_amount": 100.0}
            for n in ["Krish", "Rahul", "Arjun", "Priya"]
        ]  # sum=400, amount=1000
        payload = {
            "title": "Bad",
            "amount": 1000.0,
            "category": "food",
            "paid_by": krish["id"],
            "paid_by_name": krish["name"],
            "split_type": "custom",
            "shares": shares,
        }
        r = api.post(f"{BASE_URL}/outings/{custom_outing['id']}/expenses", json=payload)
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "").lower()
        assert "share" in detail or "amount" in detail or "equal" in detail or "total" in detail

    def test_non_member_share(self, api, users, custom_outing):
        krish = users["Krish"]
        fake_id = str(uuid.uuid4())
        shares = [
            {"user_id": krish["id"], "name": "Krish", "share_amount": 500.0},
            {"user_id": fake_id, "name": "Ghost", "share_amount": 500.0},
        ]
        payload = {
            "title": "Bad Ghost",
            "amount": 1000.0,
            "category": "food",
            "paid_by": krish["id"],
            "paid_by_name": krish["name"],
            "split_type": "custom",
            "shares": shares,
        }
        r = api.post(f"{BASE_URL}/outings/{custom_outing['id']}/expenses", json=payload)
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"

    def test_empty_shares(self, api, users, custom_outing):
        krish = users["Krish"]
        payload = {
            "title": "No participants",
            "amount": 100.0,
            "category": "food",
            "paid_by": krish["id"],
            "paid_by_name": krish["name"],
            "split_type": "equal",
            "shares": [],
        }
        r = api.post(f"{BASE_URL}/outings/{custom_outing['id']}/expenses", json=payload)
        assert r.status_code == 400


# ---- Scenario 4: Multi-expense complex settlement ----
@pytest.fixture(scope="module")
def complex_outing(api, users):
    krish = users["Krish"]
    payload = {
        "name": "TEST_Complex",
        "destination": "Delhi",
        "start_date": "2026-04-01",
        "end_date": "2026-04-05",
        "created_by": krish["id"],
        "creator_name": krish["name"],
    }
    r = api.post(f"{BASE_URL}/outings", json=payload)
    assert r.status_code == 200
    o = r.json()
    for name in ["Rahul", "Arjun", "Priya"]:
        r = api.post(
            f"{BASE_URL}/outings/{o['id']}/invite",
            json={"username": users[name]["username"]},
        )
        o = r.json()
    return o


class TestComplexSettlement:
    """Multiple expenses, verify min transactions and conservation."""

    def test_complex_flow(self, api, users, complex_outing):
        # Expense 1: Krish pays 2000 equal => Krish +1500, others -500 each
        r = api.post(
            f"{BASE_URL}/outings/{complex_outing['id']}/expenses",
            json={
                "title": "E1",
                "amount": 2000.0,
                "category": "food",
                "paid_by": users["Krish"]["id"],
                "paid_by_name": "Krish",
                "split_type": "equal",
                "shares": [
                    {"user_id": users[n]["id"], "name": n, "share_amount": 500.0}
                    for n in ["Krish", "Rahul", "Arjun", "Priya"]
                ],
            },
        )
        assert r.status_code == 200, r.text

        # Expense 2: Priya pays 800 equal => Priya +600 net change (paid 800, owed 200)
        r = api.post(
            f"{BASE_URL}/outings/{complex_outing['id']}/expenses",
            json={
                "title": "E2",
                "amount": 800.0,
                "category": "fuel",
                "paid_by": users["Priya"]["id"],
                "paid_by_name": "Priya",
                "split_type": "equal",
                "shares": [
                    {"user_id": users[n]["id"], "name": n, "share_amount": 200.0}
                    for n in ["Krish", "Rahul", "Arjun", "Priya"]
                ],
            },
        )
        assert r.status_code == 200, r.text

        # Balances: Krish 2000-700=1300, Rahul 0-700=-700, Arjun 0-700=-700, Priya 800-700=100
        r = api.get(f"{BASE_URL}/outings/{complex_outing['id']}/balances")
        data = r.json()
        assert data["total"] == 2800.0
        assert _by_name(data["balances"], "Krish")["net_balance"] == 1300.0
        assert _by_name(data["balances"], "Priya")["net_balance"] == 100.0
        assert _by_name(data["balances"], "Rahul")["net_balance"] == -700.0
        assert _by_name(data["balances"], "Arjun")["net_balance"] == -700.0
        # sum of net_balances ~ 0
        assert abs(sum(b["net_balance"] for b in data["balances"])) < 0.01

        # Settlements
        r = api.get(f"{BASE_URL}/outings/{complex_outing['id']}/settlements")
        data = r.json()
        txns = data["transactions"]
        creditors = [b for b in data["balances"] if b["net_balance"] > 0.01]
        debtors = [b for b in data["balances"] if b["net_balance"] < -0.01]
        # min transactions: <= max(creditors, debtors) = max(2, 2) = 2 (ideal)
        # But greedy may produce up to creditors+debtors-1=3
        assert len(txns) <= max(len(creditors), len(debtors)) + 1
        for t in txns:
            assert t["amount"] > 0

        # Conservation per user
        flow = {}
        for t in txns:
            flow[t["to_user_id"]] = flow.get(t["to_user_id"], 0.0) + t["amount"]
            flow[t["from_user_id"]] = flow.get(t["from_user_id"], 0.0) - t["amount"]
        for b in data["balances"]:
            if abs(b["net_balance"]) > 0.01:
                assert abs(flow.get(b["user_id"], 0.0) - b["net_balance"]) < 0.01, (
                    f"Conservation failed for {b['name']}: flow={flow.get(b['user_id'])}, net={b['net_balance']}"
                )
