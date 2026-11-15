"""Security tests: each one plays an attacker and checks the API refuses.

"mallory" is a signed-in user who is NOT in the outing. "bob" is a crew member
who is not the owner. "alice" owns the outing.
"""

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("OUTY_API_URL", "http://localhost:8000").rstrip("/") + "/api"
ROOT_URL = BASE_URL[: -len("/api")]

TINY_PNG = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def _signup(name: str, password: str = "hunter2222"):
    tag = uuid.uuid4().hex[:6]
    payload = {
        "email": f"sec_{name}_{tag}@outytest.com",
        "password": password,
        "name": name.capitalize(),
        "username": f"sec_{name}_{tag}",
    }
    r = requests.post(f"{BASE_URL}/auth/signup", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    return {**payload, "token": data["token"], "user": data["user"], "h": {"Authorization": f"Bearer {data['token']}"}}


def _outing_payload(**over):
    body = {"name": "Goa trip", "destination": "Goa", "description": "",
            "start_date": "2030-01-10", "end_date": "2030-01-15"}
    body.update(over)
    return body


@pytest.fixture(scope="module")
def alice():
    return _signup("alice")


@pytest.fixture(scope="module")
def bob():
    return _signup("bob")


@pytest.fixture(scope="module")
def mallory():
    return _signup("mallory")


@pytest.fixture(scope="module")
def outing(alice, bob):
    r = requests.post(f"{BASE_URL}/outings", json=_outing_payload(), headers=alice["h"], timeout=15)
    assert r.status_code == 200, r.text
    o = r.json()
    r = requests.post(f"{BASE_URL}/outings/join", json={"invite_code": o["invite_code"]}, headers=bob["h"], timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def expense(alice, bob, outing):
    body = {
        "title": "Dinner", "amount": 100, "category": "food",
        "paid_by": alice["user"]["id"], "paid_by_name": "Alice", "split_type": "equal",
        "shares": [
            {"user_id": alice["user"]["id"], "name": "Alice", "share_amount": 50},
            {"user_id": bob["user"]["id"], "name": "Bob", "share_amount": 50},
        ],
    }
    r = requests.post(f"{BASE_URL}/outings/{outing['id']}/expenses", json=body, headers=alice["h"], timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def todo(alice, outing):
    r = requests.post(f"{BASE_URL}/outings/{outing['id']}/todos", json={"title": "Book hotel"}, headers=alice["h"], timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def photo(alice, outing):
    r = requests.post(f"{BASE_URL}/outings/{outing['id']}/gallery", json={"image_b64": TINY_PNG}, headers=alice["h"], timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Outsiders cannot read or change another crew's outing ----------
class TestOutsiderAccess:
    @pytest.mark.parametrize("path", [
        "", "/expenses", "/balances", "/settlements", "/gallery", "/gallery/count", "/todos", "/messages",
    ])
    def test_outsider_cannot_read(self, mallory, outing, expense, todo, photo, path):
        r = requests.get(f"{BASE_URL}/outings/{outing['id']}{path}", headers=mallory["h"], timeout=15)
        assert r.status_code in (403, 404), f"outsider read {path or '/'}: {r.status_code}"

    def test_member_can_still_read(self, bob, outing, expense, todo, photo):
        for path in ["", "/expenses", "/balances", "/settlements", "/gallery", "/todos", "/messages"]:
            r = requests.get(f"{BASE_URL}/outings/{outing['id']}{path}", headers=bob["h"], timeout=15)
            assert r.status_code == 200, f"{path}: {r.status_code} {r.text}"

    def test_outsider_cannot_edit_outing(self, mallory, alice, outing):
        r = requests.put(f"{BASE_URL}/outings/{outing['id']}", json={"name": "Hacked"}, headers=mallory["h"], timeout=15)
        assert r.status_code in (403, 404)
        r = requests.get(f"{BASE_URL}/outings/{outing['id']}", headers=alice["h"], timeout=15)
        assert r.json()["name"] == "Goa trip"

    def test_non_owner_member_cannot_edit_outing(self, bob, outing):
        r = requests.put(f"{BASE_URL}/outings/{outing['id']}", json={"name": "Bob's trip"}, headers=bob["h"], timeout=15)
        assert r.status_code == 403

    def test_owner_can_edit_outing(self, alice, outing):
        r = requests.put(f"{BASE_URL}/outings/{outing['id']}", json={"description": "Beach week"}, headers=alice["h"], timeout=15)
        assert r.status_code == 200 and r.json()["description"] == "Beach week"

    def test_outsider_cannot_delete_expense(self, mallory, alice, outing, expense):
        r = requests.delete(f"{BASE_URL}/expenses/{expense['id']}", headers=mallory["h"], timeout=15)
        assert r.status_code in (403, 404)
        r = requests.get(f"{BASE_URL}/outings/{outing['id']}/expenses", headers=alice["h"], timeout=15)
        assert any(e["id"] == expense["id"] for e in r.json())

    def test_outsider_cannot_change_or_delete_todo(self, mallory, alice, outing, todo):
        r = requests.put(f"{BASE_URL}/todos/{todo['id']}", json={"title": "Hacked", "done": True}, headers=mallory["h"], timeout=15)
        assert r.status_code in (403, 404)
        r = requests.delete(f"{BASE_URL}/todos/{todo['id']}", headers=mallory["h"], timeout=15)
        assert r.status_code in (403, 404)
        r = requests.get(f"{BASE_URL}/outings/{outing['id']}/todos", headers=alice["h"], timeout=15)
        saved = next(t for t in r.json() if t["id"] == todo["id"])
        assert saved["title"] == "Book hotel" and saved["done"] is False

    def test_member_can_update_todo(self, bob, todo):
        r = requests.put(f"{BASE_URL}/todos/{todo['id']}", json={"done": True}, headers=bob["h"], timeout=15)
        assert r.status_code == 200 and r.json()["done"] is True

    def test_outsider_cannot_delete_photo(self, mallory, photo):
        r = requests.delete(f"{BASE_URL}/gallery/{photo['id']}", headers=mallory["h"], timeout=15)
        assert r.status_code in (403, 404)


# ---------- Input validation ----------
class TestValidation:
    def _expense(self, alice, bob, **over):
        body = {
            "title": "Cab", "amount": 100, "category": "transport",
            "paid_by": alice["user"]["id"], "paid_by_name": "Alice", "split_type": "equal",
            "shares": [
                {"user_id": alice["user"]["id"], "name": "Alice", "share_amount": 50},
                {"user_id": bob["user"]["id"], "name": "Bob", "share_amount": 50},
            ],
        }
        body.update(over)
        return body

    def test_negative_expense_rejected(self, alice, bob, outing):
        body = self._expense(alice, bob, amount=-100)
        body["shares"][0]["share_amount"] = -50
        body["shares"][1]["share_amount"] = -50
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/expenses", json=body, headers=alice["h"], timeout=15)
        assert r.status_code in (400, 422)

    def test_negative_share_rejected(self, alice, bob, outing):
        body = self._expense(alice, bob)
        body["shares"][0]["share_amount"] = 1000100
        body["shares"][1]["share_amount"] = -1000000
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/expenses", json=body, headers=alice["h"], timeout=15)
        assert r.status_code in (400, 422)

    def test_payer_must_be_crew_member(self, alice, bob, mallory, outing):
        body = self._expense(alice, bob, paid_by=mallory["user"]["id"], paid_by_name="Mallory")
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/expenses", json=body, headers=alice["h"], timeout=15)
        assert r.status_code in (400, 422)

    def test_expense_names_come_from_the_server(self, alice, bob, outing):
        body = self._expense(alice, bob, paid_by_name="Somebody Else")
        body["shares"][1]["name"] = "Fake Name"
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/expenses", json=body, headers=alice["h"], timeout=15)
        assert r.status_code == 200, r.text
        saved = r.json()
        assert saved["paid_by_name"] == "Alice"
        assert {s["name"] for s in saved["shares"]} == {"Alice", "Bob"}

    def test_expense_payer_can_delete(self, alice, bob, outing):
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/expenses", json=self._expense(alice, bob), headers=alice["h"], timeout=15)
        r = requests.delete(f"{BASE_URL}/expenses/{r.json()['id']}", headers=alice["h"], timeout=15)
        assert r.status_code == 200

    def test_gallery_rejects_non_image(self, alice, outing):
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/gallery",
                          json={"image_b64": "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="},
                          headers=alice["h"], timeout=15)
        assert r.status_code in (400, 422)

    def test_gallery_rejects_oversized_image(self, alice, outing):
        huge = "data:image/jpeg;base64," + "A" * 11_000_000
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/gallery", json={"image_b64": huge}, headers=alice["h"], timeout=60)
        assert r.status_code in (400, 413, 422)

    def test_gallery_count(self, alice, outing, photo):
        r = requests.get(f"{BASE_URL}/outings/{outing['id']}/gallery/count", headers=alice["h"], timeout=15)
        assert r.status_code == 200 and r.json()["count"] >= 1

    def test_chat_message_length_capped(self, alice, outing):
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/messages", json={"text": "x" * 5000}, headers=alice["h"], timeout=15)
        assert r.status_code in (400, 422)

    def test_outing_dates_validated(self, alice):
        r = requests.post(f"{BASE_URL}/outings", json=_outing_payload(start_date="not-a-date"), headers=alice["h"], timeout=15)
        assert r.status_code in (400, 422)
        r = requests.post(f"{BASE_URL}/outings", json=_outing_payload(start_date="2030-02-10", end_date="2030-02-01"), headers=alice["h"], timeout=15)
        assert r.status_code in (400, 422)

    def test_cover_url_must_be_http(self, alice):
        r = requests.post(f"{BASE_URL}/outings", json=_outing_payload(cover_url="javascript:alert(1)"), headers=alice["h"], timeout=15)
        assert r.status_code in (400, 422)

    def test_todo_assignee_must_be_crew_member(self, alice, mallory, outing):
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/todos",
                          json={"title": "Pack", "assigned_to": mallory["user"]["id"], "assigned_to_name": "Mallory"},
                          headers=alice["h"], timeout=15)
        assert r.status_code in (400, 422)

    def test_weak_password_rejected(self):
        tag = uuid.uuid4().hex[:6]
        r = requests.post(f"{BASE_URL}/auth/signup", json={
            "email": f"weak_{tag}@outytest.com", "password": "abc1234", "name": "Weak", "username": f"weak_{tag}"}, timeout=15)
        assert r.status_code in (400, 422)

    def test_profile_name_change_updates_crew_lists(self, outing):
        carol = _signup("carol")
        requests.post(f"{BASE_URL}/outings/join", json={"invite_code": outing["invite_code"]}, headers=carol["h"], timeout=15)
        r = requests.put(f"{BASE_URL}/auth/me", json={"name": "Caroline"}, headers=carol["h"], timeout=15)
        assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/outings/{outing['id']}", headers=carol["h"], timeout=15)
        me = next(m for m in r.json()["members"] if m["user_id"] == carol["user"]["id"])
        assert me["name"] == "Caroline"


# ---------- Chat paging ----------
class TestChatPaging:
    def test_first_load_returns_the_newest_messages(self, alice):
        r = requests.post(f"{BASE_URL}/outings", json=_outing_payload(name="Busy chat"), headers=alice["h"], timeout=15)
        oid = r.json()["id"]
        for i in range(12):
            requests.post(f"{BASE_URL}/outings/{oid}/messages", json={"text": f"m{i}"}, headers=alice["h"], timeout=15)
        r = requests.get(f"{BASE_URL}/outings/{oid}/messages?limit=5", headers=alice["h"], timeout=15)
        assert [m["text"] for m in r.json()] == ["m7", "m8", "m9", "m10", "m11"]


# ---------- Health check ----------
class TestHealth:
    def test_health_answers_get_and_head(self):
        assert requests.get(f"{ROOT_URL}/health", timeout=15).status_code == 200
        assert requests.head(f"{ROOT_URL}/health", timeout=15).status_code == 200


# ---------- Password reset ----------
class TestPasswordReset:
    def test_code_cannot_be_brute_forced(self, outbox):
        victim = _signup("victim")
        requests.post(f"{BASE_URL}/auth/forgot-password", json={"email": victim["email"]}, timeout=15)
        real = outbox.last_code()
        wrong = "000000" if real != "000000" else "111111"
        for _ in range(5):
            r = requests.post(f"{BASE_URL}/auth/reset-password",
                              json={"email": victim["email"], "otp": wrong, "new_password": "attacker-pw-1"}, timeout=15)
            assert r.status_code == 400
        # After five wrong guesses even the right code must be dead.
        r = requests.post(f"{BASE_URL}/auth/reset-password",
                          json={"email": victim["email"], "otp": real, "new_password": "attacker-pw-1"}, timeout=15)
        assert r.status_code == 400
        r = requests.post(f"{BASE_URL}/auth/signin", json={"email": victim["email"], "password": victim["password"]}, timeout=15)
        assert r.status_code == 200

    def test_reset_works_and_signs_out_old_sessions(self, outbox):
        user = _signup("resetter")
        requests.post(f"{BASE_URL}/auth/forgot-password", json={"email": user["email"]}, timeout=15)
        code = outbox.last_code()
        r = requests.post(f"{BASE_URL}/auth/reset-password",
                          json={"email": user["email"], "otp": code, "new_password": "brand-new-pw-9"}, timeout=15)
        assert r.status_code == 200, r.text
        # the old session (possibly a thief's) no longer works
        assert requests.get(f"{BASE_URL}/auth/me", headers=user["h"], timeout=15).status_code == 401
        # old password is dead, new one works
        assert requests.post(f"{BASE_URL}/auth/signin", json={"email": user["email"], "password": user["password"]}, timeout=15).status_code == 401
        assert requests.post(f"{BASE_URL}/auth/signin", json={"email": user["email"], "password": "brand-new-pw-9"}, timeout=15).status_code == 200
        # a code works once
        r = requests.post(f"{BASE_URL}/auth/reset-password",
                          json={"email": user["email"], "otp": code, "new_password": "another-pw-10"}, timeout=15)
        assert r.status_code == 400

    def test_code_is_not_stored_in_plain_text(self, outbox):
        import asyncio
        from app.database import db
        user = _signup("plain")
        requests.post(f"{BASE_URL}/auth/forgot-password", json={"email": user["email"]}, timeout=15)
        code = outbox.last_code()
        record = asyncio.run(db.password_resets.find_one({"email": user["email"]}))
        assert code not in str(record)

    def test_repeat_requests_do_not_spam_email(self, outbox):
        user = _signup("spam")
        for _ in range(3):
            assert requests.post(f"{BASE_URL}/auth/forgot-password", json={"email": user["email"]}, timeout=15).status_code == 200
        assert len(outbox.emails) == 1

    def test_unknown_email_gets_the_same_answer(self, outbox):
        r = requests.post(f"{BASE_URL}/auth/forgot-password", json={"email": f"nobody_{uuid.uuid4().hex[:6]}@outytest.com"}, timeout=15)
        assert r.status_code == 200 and r.json() == {"ok": True}
        assert outbox.emails == []


# ---------- Sessions ----------
class TestSessions:
    def test_session_tokens_are_hashed_in_the_database(self, in_process):
        import asyncio
        from app.database import db
        user = _signup("hashcheck")
        stored = asyncio.run(db.user_sessions.find_one({"session_token": user["token"]}))
        assert stored is None, "raw session token found in the database"
        assert requests.get(f"{BASE_URL}/auth/me", headers=user["h"], timeout=15).status_code == 200

    def test_google_sign_in_is_off_by_default(self):
        r = requests.post(f"{BASE_URL}/auth/google/session", json={"session_token": "anything"}, timeout=15)
        assert r.status_code == 404


# ---------- Rate limits ----------
class TestRateLimits:
    def test_password_guessing_is_locked_out(self, rate_limits):
        victim = _signup("locked")
        codes = [
            requests.post(f"{BASE_URL}/auth/signin", json={"email": victim["email"], "password": f"guess-{i}"}, timeout=15).status_code
            for i in range(12)
        ]
        assert 429 in codes, codes
        # even the right password is refused while the lock is on
        r = requests.post(f"{BASE_URL}/auth/signin", json={"email": victim["email"], "password": victim["password"]}, timeout=15)
        assert r.status_code == 429

    def test_invite_code_guessing_is_limited(self, rate_limits):
        guesser = _signup("guesser")
        codes = [
            requests.post(f"{BASE_URL}/outings/join", json={"invite_code": f"ZZZ{i:03d}"}, headers=guesser["h"], timeout=15).status_code
            for i in range(25)
        ]
        assert 429 in codes, codes
