"""Pytest suite for Outy auth + invites + chat (iteration 3).

Covers:
  * /auth/signup, /auth/signin, /auth/me, /auth/username, PUT /auth/me, /auth/logout
  * /auth/google/session (bogus token only -> 401)
  * Invite by-username flow: accept, reject, re-invite, errors
  * Chat messages + system messages on gallery / todo events
"""

import os
import time
import uuid
import datetime as dt

import pytest
import requests


BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://outy-trips.preview.emergentagent.com").rstrip("/") + "/api"


def _u(prefix: str) -> str:
    """Build a unique lowercase username (3-24 chars, [a-z0-9_])."""
    return f"test_{prefix}_{uuid.uuid4().hex[:6]}"


def _email(prefix: str) -> str:
    return f"test_{prefix}_{uuid.uuid4().hex[:6]}@outytest.com"


def _signup(name: str):
    payload = {
        "email": _email(name),
        "password": "hunter22",
        "name": name.capitalize(),
        "username": _u(name),
    }
    r = requests.post(f"{BASE_URL}/auth/signup", json=payload, timeout=15)
    assert r.status_code == 200, f"signup {name} failed: {r.status_code} {r.text}"
    data = r.json()
    return {**payload, "token": data["token"], "user": data["user"]}


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _assert_no_forbidden_keys(obj):
    """Recursively assert that `_id` and `password_hash` never appear."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            assert k != "_id", f"`_id` leaked in payload: keys={list(obj.keys())}"
            assert k != "password_hash", "password_hash leaked"
            _assert_no_forbidden_keys(v)
    elif isinstance(obj, list):
        for item in obj:
            _assert_no_forbidden_keys(item)


# ---------- module-scoped shared fixtures ----------
@pytest.fixture(scope="module")
def krish():
    return _signup("krish")


@pytest.fixture(scope="module")
def rahul():
    return _signup("rahul")


@pytest.fixture(scope="module")
def arjun():
    return _signup("arjun")


@pytest.fixture(scope="module")
def outing(krish):
    payload = {
        "name": "TEST_Goa_Trip",
        "destination": "Goa",
        "description": "iteration 3 test",
        "start_date": "2026-02-01",
        "end_date": "2026-02-05",
    }
    r = requests.post(f"{BASE_URL}/outings", json=payload, headers=_hdr(krish["token"]), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Auth ----------
class TestAuth:

    def test_signup_returns_token_and_user(self, krish):
        assert "token" in krish and krish["token"]
        u = krish["user"]
        assert u["email"] == krish["email"].lower()
        assert u["username"] == krish["username"]
        assert "password_hash" not in u
        assert "_id" not in u
        _assert_no_forbidden_keys(krish["user"])

    def test_signup_password_too_short(self):
        r = requests.post(f"{BASE_URL}/auth/signup", json={
            "email": _email("short"), "password": "abc", "name": "X", "username": _u("p"),
        }, timeout=15)
        assert r.status_code == 400, r.text

    def test_signup_bad_username(self):
        r = requests.post(f"{BASE_URL}/auth/signup", json={
            "email": _email("bad"), "password": "hunter22", "name": "X", "username": "AB!",
        }, timeout=15)
        assert r.status_code == 400, r.text

    def test_signup_duplicate_email(self, krish):
        r = requests.post(f"{BASE_URL}/auth/signup", json={
            "email": krish["email"], "password": "hunter22", "name": "Krish2", "username": _u("dup"),
        }, timeout=15)
        assert r.status_code == 409, r.text

    def test_signup_duplicate_username_case_insensitive(self, krish):
        r = requests.post(f"{BASE_URL}/auth/signup", json={
            "email": _email("ci"), "password": "hunter22", "name": "Krish2",
            "username": krish["username"].upper(),  # server should normalize
        }, timeout=15)
        assert r.status_code == 409, r.text

    def test_signin_success_returns_new_token(self, krish):
        r = requests.post(f"{BASE_URL}/auth/signin", json={
            "email": krish["email"], "password": krish["password"],
        }, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["token"]
        assert body["user"]["email"] == krish["email"].lower()
        _assert_no_forbidden_keys(body)

    def test_signin_wrong_password(self, krish):
        r = requests.post(f"{BASE_URL}/auth/signin", json={
            "email": krish["email"], "password": "wrongpass",
        }, timeout=15)
        assert r.status_code == 401, r.text

    def test_signin_unknown_email(self):
        r = requests.post(f"{BASE_URL}/auth/signin", json={
            "email": "nonexistent_" + uuid.uuid4().hex[:6] + "@x.com", "password": "hunter22",
        }, timeout=15)
        assert r.status_code == 401, r.text

    def test_me_without_token_is_401(self):
        r = requests.get(f"{BASE_URL}/auth/me", timeout=15)
        assert r.status_code == 401, r.text

    def test_me_with_bogus_token_is_401(self):
        r = requests.get(f"{BASE_URL}/auth/me", headers={"Authorization": "Bearer not-a-real-token-xyz"}, timeout=15)
        assert r.status_code == 401, r.text

    def test_me_returns_user(self, krish):
        r = requests.get(f"{BASE_URL}/auth/me", headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["id"] == krish["user"]["id"]
        _assert_no_forbidden_keys(body)

    def test_claim_username_taken(self, krish, rahul):
        # Krish tries to claim Rahul's username
        r = requests.post(f"{BASE_URL}/auth/username",
                          json={"username": rahul["username"]},
                          headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 409, r.text

    def test_claim_username_bad_pattern(self, krish):
        r = requests.post(f"{BASE_URL}/auth/username",
                          json={"username": "AB"},  # too short + uppercase
                          headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 400, r.text

    def test_claim_username_success(self, krish):
        new = _u("claim")
        r = requests.post(f"{BASE_URL}/auth/username",
                          json={"username": new},
                          headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["username"] == new
        # update fixture for downstream tests
        krish["username"] = new

    def test_put_me_updates_name(self, krish):
        r = requests.put(f"{BASE_URL}/auth/me",
                         json={"name": "Krish Updated"},
                         headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["name"] == "Krish Updated"

    def test_logout_invalidates_token(self):
        # create a fresh user so we don't kill krish's session
        ephem = _signup("ephem")
        r1 = requests.get(f"{BASE_URL}/auth/me", headers=_hdr(ephem["token"]), timeout=15)
        assert r1.status_code == 200
        r2 = requests.post(f"{BASE_URL}/auth/logout", headers=_hdr(ephem["token"]), timeout=15)
        assert r2.status_code == 200, r2.text
        r3 = requests.get(f"{BASE_URL}/auth/me", headers=_hdr(ephem["token"]), timeout=15)
        assert r3.status_code == 401, r3.text

    def test_google_session_bogus_token_returns_401(self):
        r = requests.post(f"{BASE_URL}/auth/google/session",
                          json={"session_token": "obviously-bogus-" + uuid.uuid4().hex},
                          timeout=15)
        # Must NOT be 500. Could be 401 (rejected by Emergent) or 502 if upstream down.
        assert r.status_code in (401, 502), f"Expected 401/502 got {r.status_code}: {r.text}"


# ---------- Invites ----------
class TestInvites:

    def test_invite_outing_not_found(self, krish):
        r = requests.post(f"{BASE_URL}/outings/nonexistent-id/invite",
                          json={"username": "anything"},
                          headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 404, r.text

    def test_invite_unknown_username(self, krish, outing):
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/invite",
                          json={"username": "no_such_user_" + uuid.uuid4().hex[:6]},
                          headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 404, r.text

    def test_non_member_cannot_invite(self, rahul, outing):
        # rahul not yet member
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/invite",
                          json={"username": "anything"},
                          headers=_hdr(rahul["token"]), timeout=15)
        assert r.status_code == 403, r.text

    def test_invite_rahul_success_and_idempotent(self, krish, rahul, outing):
        r1 = requests.post(f"{BASE_URL}/outings/{outing['id']}/invite",
                           json={"username": rahul["username"]},
                           headers=_hdr(krish["token"]), timeout=15)
        assert r1.status_code == 200, r1.text
        inv1 = r1.json()
        assert inv1["status"] == "pending"
        assert inv1["invited_user_id"] == rahul["user"]["id"]
        # expires_at ~ 7 days away
        exp = dt.datetime.fromisoformat(inv1["expires_at"])
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=dt.timezone.utc)
        diff_days = (exp - dt.datetime.now(dt.timezone.utc)).total_seconds() / 86400
        assert 6.5 < diff_days < 7.5, f"expires_at should be ~7d away, got {diff_days}d"
        _assert_no_forbidden_keys(inv1)

        # second invite same user -> idempotent (same id)
        r2 = requests.post(f"{BASE_URL}/outings/{outing['id']}/invite",
                           json={"username": rahul["username"]},
                           headers=_hdr(krish["token"]), timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["id"] == inv1["id"]
        # save the invite id for later
        pytest.rahul_invite_id = inv1["id"]

    def test_list_invites_rahul_sees_it(self, rahul):
        r = requests.get(f"{BASE_URL}/invites", headers=_hdr(rahul["token"]), timeout=15)
        assert r.status_code == 200, r.text
        invites = r.json()
        assert len(invites) >= 1
        assert any(i["id"] == pytest.rahul_invite_id for i in invites)
        _assert_no_forbidden_keys(invites)

    def test_accept_someone_elses_invite_is_404(self, arjun):
        # arjun tries to accept rahul's invite
        r = requests.post(f"{BASE_URL}/invites/{pytest.rahul_invite_id}/accept",
                          headers=_hdr(arjun["token"]), timeout=15)
        assert r.status_code == 404, r.text

    def test_rahul_accepts_invite(self, rahul, outing):
        r = requests.post(f"{BASE_URL}/invites/{pytest.rahul_invite_id}/accept",
                          headers=_hdr(rahul["token"]), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        member_ids = [m["user_id"] for m in body["members"]]
        assert rahul["user"]["id"] in member_ids
        _assert_no_forbidden_keys(body)

        # invites list now empty
        r2 = requests.get(f"{BASE_URL}/invites", headers=_hdr(rahul["token"]), timeout=15)
        assert r2.status_code == 200
        assert all(i["id"] != pytest.rahul_invite_id for i in r2.json())

    def test_accept_twice_returns_400(self, rahul):
        r = requests.post(f"{BASE_URL}/invites/{pytest.rahul_invite_id}/accept",
                          headers=_hdr(rahul["token"]), timeout=15)
        assert r.status_code == 400, r.text
        assert "already" in r.json().get("detail", "").lower()

    def test_invite_already_member_returns_409(self, krish, rahul, outing):
        # rahul is now a member
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/invite",
                          json={"username": rahul["username"]},
                          headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 409, r.text

    def test_arjun_reject_then_reinvite(self, krish, arjun, outing):
        # invite arjun
        r1 = requests.post(f"{BASE_URL}/outings/{outing['id']}/invite",
                           json={"username": arjun["username"]},
                           headers=_hdr(krish["token"]), timeout=15)
        assert r1.status_code == 200, r1.text
        arjun_invite_id = r1.json()["id"]

        # arjun rejects
        r2 = requests.post(f"{BASE_URL}/invites/{arjun_invite_id}/reject",
                           headers=_hdr(arjun["token"]), timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("ok") is True

        # arjun /invites is empty for that invite
        r3 = requests.get(f"{BASE_URL}/invites", headers=_hdr(arjun["token"]), timeout=15)
        assert r3.status_code == 200
        assert all(i["id"] != arjun_invite_id for i in r3.json())

        # arjun NOT in outing members
        ro = requests.get(f"{BASE_URL}/outings/{outing['id']}", headers=_hdr(krish["token"]), timeout=15)
        assert ro.status_code == 200
        member_ids = [m["user_id"] for m in ro.json()["members"]]
        assert arjun["user"]["id"] not in member_ids

        # host re-invites -> new pending invite
        r4 = requests.post(f"{BASE_URL}/outings/{outing['id']}/invite",
                           json={"username": arjun["username"]},
                           headers=_hdr(krish["token"]), timeout=15)
        assert r4.status_code == 200, r4.text
        new_inv = r4.json()
        assert new_inv["id"] != arjun_invite_id
        assert new_inv["status"] == "pending"


# ---------- Chat ----------
class TestChat:

    def test_post_message_member_success(self, krish, outing):
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/messages",
                          json={"text": "Hello crew!"},
                          headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg["type"] == "text"
        assert msg["text"] == "Hello crew!"
        assert msg["sender_id"] == krish["user"]["id"]
        _assert_no_forbidden_keys(msg)

    def test_post_empty_message_400(self, krish, outing):
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/messages",
                          json={"text": "   "},
                          headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 400, r.text

    def test_non_member_cannot_post(self, arjun, outing):
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/messages",
                          json={"text": "sneaky"},
                          headers=_hdr(arjun["token"]), timeout=15)
        assert r.status_code == 403, r.text

    def test_non_member_cannot_read(self, arjun, outing):
        r = requests.get(f"{BASE_URL}/outings/{outing['id']}/messages",
                         headers=_hdr(arjun["token"]), timeout=15)
        assert r.status_code == 403, r.text

    def test_post_to_missing_outing_404(self, krish):
        r = requests.post(f"{BASE_URL}/outings/no-such-outing/messages",
                          json={"text": "hi"},
                          headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 404, r.text

    def test_list_messages_sorted_and_has_join_system_msg(self, krish, rahul, outing):
        r = requests.get(f"{BASE_URL}/outings/{outing['id']}/messages",
                         headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 200, r.text
        msgs = r.json()
        # oldest-first ordering
        created = [m["created_at"] for m in msgs]
        assert created == sorted(created), "messages must be oldest first"
        # system message from rahul joining
        sys_msgs = [m for m in msgs if m["sender_id"] == "system" and m["type"] == "system"]
        assert any("joined the crew" in m["text"] for m in sys_msgs), \
            f"No 'joined the crew' system msg. system msgs={[m['text'] for m in sys_msgs]}"
        _assert_no_forbidden_keys(msgs)

    def test_since_filter(self, krish, outing):
        # post msg A
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/messages",
                          json={"text": "marker A"},
                          headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 200
        marker_ts = r.json()["created_at"]
        time.sleep(0.1)
        # post msg B
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/messages",
                          json={"text": "marker B"},
                          headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 200
        # since marker_ts -> should NOT include A, should include B
        r2 = requests.get(f"{BASE_URL}/outings/{outing['id']}/messages",
                          params={"since": marker_ts},
                          headers=_hdr(krish["token"]), timeout=15)
        assert r2.status_code == 200
        texts = [m["text"] for m in r2.json()]
        assert "marker A" not in texts
        assert "marker B" in texts

    def test_gallery_upload_creates_system_message(self, krish, outing):
        tiny_png = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAS"
                    "sJTYQAAAAASUVORK5CYII=")
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/gallery",
                          json={"image_b64": tiny_png, "caption": "test"},
                          headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 200, r.text
        # fetch messages
        r2 = requests.get(f"{BASE_URL}/outings/{outing['id']}/messages",
                          headers=_hdr(krish["token"]), timeout=15)
        msgs = r2.json()
        photo_sys = [m for m in msgs
                     if m["sender_id"] == "system" and "added a new photo" in m["text"]]
        assert photo_sys, f"No photo system message. recent texts={[m['text'] for m in msgs[-5:]]}"

    def test_todo_add_creates_system_message(self, krish, outing):
        todo_title = f"TEST_pack_snacks_{uuid.uuid4().hex[:4]}"
        r = requests.post(f"{BASE_URL}/outings/{outing['id']}/todos",
                          json={"title": todo_title},
                          headers=_hdr(krish["token"]), timeout=15)
        assert r.status_code == 200, r.text
        r2 = requests.get(f"{BASE_URL}/outings/{outing['id']}/messages",
                          headers=_hdr(krish["token"]), timeout=15)
        msgs = r2.json()
        todo_sys = [m for m in msgs
                    if m["sender_id"] == "system"
                    and "added" in m["text"] and todo_title in m["text"]]
        assert todo_sys, f"No todo system message. recent texts={[m['text'] for m in msgs[-5:]]}"


# ---------- Cross-cutting: protected endpoints require Bearer ----------
class TestAuthProtection:

    @pytest.mark.parametrize("method,path", [
        ("GET", "/outings"),
        ("POST", "/outings"),
        ("GET", "/invites"),
        ("GET", "/expenses/summary"),
        ("POST", "/auth/username"),
        ("PUT", "/auth/me"),
    ])
    def test_protected_endpoint_no_token_is_401(self, method, path):
        r = requests.request(method, f"{BASE_URL}{path}", json={}, timeout=15)
        assert r.status_code == 401, f"{method} {path} -> {r.status_code} (expected 401): {r.text}"

    @pytest.mark.parametrize("method,path", [
        ("GET", "/outings"),
        ("GET", "/invites"),
    ])
    def test_protected_endpoint_bogus_token_is_401(self, method, path):
        r = requests.request(method, f"{BASE_URL}{path}",
                             headers={"Authorization": "Bearer total-garbage-xxx"}, timeout=15)
        assert r.status_code == 401, f"{method} {path} -> {r.status_code} (expected 401)"
