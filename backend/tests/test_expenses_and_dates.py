"""Money maths: balances always add up, and the settlement plan really settles everyone."""

import os
import random
import uuid

import pytest
import requests

BASE_URL = os.environ.get("OUTY_API_URL", "http://localhost:8000").rstrip("/") + "/api"


def _split_like_the_app(amount: float, n: int) -> list:
    """Same equal split the app does: whole paise, extras handed out one by one."""
    paise = round(amount * 100)
    base, extra = divmod(paise, n)
    return [(base + (1 if i < extra else 0)) / 100 for i in range(n)]


def _random_trip(rng: random.Random):
    members = [{"user_id": f"u{i}", "name": f"Member {i}"} for i in range(rng.randint(2, 12))]
    expenses = []
    for _ in range(rng.randint(1, 40)):
        amount = round(rng.choice([rng.uniform(1, 500), rng.uniform(500, 50000), rng.randint(1, 5000)]), 2)
        people = rng.sample(members, rng.randint(1, len(members)))
        if rng.random() < 0.7:
            shares = _split_like_the_app(amount, len(people))
        else:  # custom split: random weights, last person takes the remainder
            weights = [rng.random() + 0.01 for _ in people]
            shares = [round(amount * w / sum(weights), 2) for w in weights[:-1]]
            shares.append(round(amount - sum(shares), 2))
        expenses.append({
            "amount": amount,
            "paid_by": rng.choice(members)["user_id"],
            "shares": [{"user_id": p["user_id"], "share_amount": s} for p, s in zip(people, shares)],
        })
    return members, expenses


@pytest.mark.parametrize("seed", range(300))
def test_settlement_plan_settles_everyone(in_process, seed):
    from app.routers.expenses import _compute_balances, _optimize_settlements

    members, expenses = _random_trip(random.Random(seed))
    balances = _compute_balances(expenses, members)

    # money is neither created nor destroyed
    assert abs(sum(b["net_balance"] for b in balances)) <= 0.01 * len(members)

    plan = _optimize_settlements(balances)
    left = {b["user_id"]: b["net_balance"] for b in balances}
    for tx in plan:
        assert tx["amount"] > 0
        assert tx["from_user_id"] != tx["to_user_id"]
        assert left[tx["from_user_id"]] < 0 < left[tx["to_user_id"]], "payments only go from people who owe to people who are owed"
        left[tx["from_user_id"]] = round(left[tx["from_user_id"]] + tx["amount"], 2)
        left[tx["to_user_id"]] = round(left[tx["to_user_id"]] - tx["amount"], 2)

    # after following the plan nobody owes or is owed more than a rounding paisa or two
    assert all(abs(v) <= 0.02 for v in left.values()), left
    # and the plan is short: never more payments than people minus one
    assert len(plan) <= max(len(members) - 1, 0)


def test_nothing_to_settle_when_everyone_is_even(in_process):
    from app.routers.expenses import _compute_balances, _optimize_settlements

    members = [{"user_id": "a", "name": "A"}, {"user_id": "b", "name": "B"}]
    expenses = [
        {"amount": 100, "paid_by": "a", "shares": [{"user_id": "a", "share_amount": 50}, {"user_id": "b", "share_amount": 50}]},
        {"amount": 100, "paid_by": "b", "shares": [{"user_id": "a", "share_amount": 50}, {"user_id": "b", "share_amount": 50}]},
    ]
    assert _optimize_settlements(_compute_balances(expenses, members)) == []


@pytest.mark.parametrize("amount,people", [(100, 3), (0.01, 3), (999.99, 7), (1000, 6), (33.33, 2), (1, 3)])
def test_api_accepts_the_apps_equal_split(amount, people):
    """Rs 100 between three people is 33.34 + 33.33 + 33.33; the API must take that."""
    users = []
    for i in range(people):
        tag = uuid.uuid4().hex[:8]
        r = requests.post(f"{BASE_URL}/auth/signup", json={
            "email": f"split_{tag}@outytest.com", "password": "hunter2222", "name": f"S{i}", "username": f"split_{tag}"}, timeout=15)
        assert r.status_code == 200, r.text
        users.append({"id": r.json()["user"]["id"], "h": {"Authorization": f"Bearer {r.json()['token']}"}})
    r = requests.post(f"{BASE_URL}/outings", headers=users[0]["h"], timeout=15, json={
        "name": "Split test", "destination": "Goa", "start_date": "2030-01-10", "end_date": "2030-01-12"})
    outing = r.json()
    for u in users[1:]:
        assert requests.post(f"{BASE_URL}/outings/join", json={"invite_code": outing["invite_code"]}, headers=u["h"], timeout=15).status_code == 200

    shares = _split_like_the_app(amount, people)
    r = requests.post(f"{BASE_URL}/outings/{outing['id']}/expenses", headers=users[0]["h"], timeout=15, json={
        "title": "Dinner", "amount": amount, "category": "food", "paid_by": users[0]["id"], "paid_by_name": "x",
        "split_type": "equal", "shares": [{"user_id": u["id"], "name": "x", "share_amount": s} for u, s in zip(users, shares)]})
    assert r.status_code == 200, r.text

    r = requests.get(f"{BASE_URL}/outings/{outing['id']}/settlements", headers=users[0]["h"], timeout=15)
    data = r.json()
    assert abs(sum(b["net_balance"] for b in data["balances"])) < 0.005
    owed_to_payer = round(sum(t["amount"] for t in data["transactions"]), 2)
    assert owed_to_payer == round(amount - shares[0], 2)
    assert all(t["to_user_id"] == users[0]["id"] for t in data["transactions"])


def test_upcoming_and_past_follow_the_phones_date():
    """A trip ending on the 15th is still upcoming on the 15th and past on the 16th, by the phone's calendar."""
    tag = uuid.uuid4().hex[:8]
    r = requests.post(f"{BASE_URL}/auth/signup", json={
        "email": f"dates_{tag}@outytest.com", "password": "hunter2222", "name": "Dates", "username": f"dates_{tag}"}, timeout=15)
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    requests.post(f"{BASE_URL}/outings", headers=h, timeout=15, json={
        "name": "Ends on the 15th", "destination": "Goa", "start_date": "2030-01-10", "end_date": "2030-01-15"})

    def count(scope, today):
        return len(requests.get(f"{BASE_URL}/outings?scope={scope}&today={today}", headers=h, timeout=15).json())

    assert (count("upcoming", "2030-01-15"), count("past", "2030-01-15")) == (1, 0)
    assert (count("upcoming", "2030-01-16"), count("past", "2030-01-16")) == (0, 1)
    # a nonsense date falls back to the server's own clock instead of failing
    assert requests.get(f"{BASE_URL}/outings?scope=upcoming&today=garbage", headers=h, timeout=15).status_code == 200
