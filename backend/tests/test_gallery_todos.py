"""Backend tests for Outy Gallery and To-do modules.

Covers:
- Gallery: create, list (newest first), delete, validation (empty image_b64), unknown outing 404, unknown id 404
- Todos: create, list ordering (open first then done; preserves creation order in bucket),
  partial update via PUT, title validation (empty/whitespace), delete,
  unknown id 404 on PUT and DELETE
- Response sanity: ensures `_id` never appears
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"

SMALL_PNG_B64 = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lE"
    "QVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _unique(prefix):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:8]}"


def _assert_no_mongo_id(payload):
    """Recursively ensure no '_id' field appears anywhere in JSON response."""
    if isinstance(payload, dict):
        assert "_id" not in payload, f"_id found in response: keys={list(payload.keys())}"
        for v in payload.values():
            _assert_no_mongo_id(v)
    elif isinstance(payload, list):
        for v in payload:
            _assert_no_mongo_id(v)


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user(api):
    uname = _unique("gallerytodo")
    r = api.post(f"{BASE_URL}/profile", json={"name": "Gallery Tester", "username": uname})
    assert r.status_code == 200, r.text
    body = r.json()
    _assert_no_mongo_id(body)
    assert body.get("id")
    return body


@pytest.fixture(scope="module")
def outing(api, user):
    payload = {
        "name": _unique("trip"),
        "destination": "Goa",
        "description": "Test trip",
        "start_date": "2030-01-01",
        "end_date": "2030-01-05",
        "created_by": user["id"],
        "creator_name": user["name"],
    }
    r = api.post(f"{BASE_URL}/outings", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    _assert_no_mongo_id(body)
    assert body.get("id")
    return body


# ---------- Gallery tests ----------
class TestGallery:
    def test_gallery_upload_list_delete_flow(self, api, outing, user):
        # Upload
        upload_payload = {
            "image_b64": SMALL_PNG_B64,
            "uploaded_by": user["id"],
            "uploaded_by_name": user["name"],
            "caption": "first shot",
        }
        r = api.post(f"{BASE_URL}/outings/{outing['id']}/gallery", json=upload_payload)
        assert r.status_code == 200, r.text
        item = r.json()
        _assert_no_mongo_id(item)
        assert item.get("id")
        assert item["outing_id"] == outing["id"]
        assert item["image_b64"] == SMALL_PNG_B64
        assert item["uploaded_by"] == user["id"]
        assert item["uploaded_by_name"] == user["name"]
        assert item["caption"] == "first shot"
        assert item.get("created_at")
        item_id = item["id"]

        # List shows it
        r = api.get(f"{BASE_URL}/outings/{outing['id']}/gallery")
        assert r.status_code == 200, r.text
        items = r.json()
        _assert_no_mongo_id(items)
        ids = [x["id"] for x in items]
        assert item_id in ids

        # Delete
        r = api.delete(f"{BASE_URL}/gallery/{item_id}")
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}

        # List empty (for that specific id)
        r = api.get(f"{BASE_URL}/outings/{outing['id']}/gallery")
        assert r.status_code == 200
        remaining_ids = [x["id"] for x in r.json()]
        assert item_id not in remaining_ids

    def test_gallery_newest_first(self, api, outing, user):
        ids_in_order = []
        for cap in ["one", "two", "three"]:
            r = api.post(
                f"{BASE_URL}/outings/{outing['id']}/gallery",
                json={
                    "image_b64": SMALL_PNG_B64,
                    "uploaded_by": user["id"],
                    "uploaded_by_name": user["name"],
                    "caption": cap,
                },
            )
            assert r.status_code == 200
            ids_in_order.append(r.json()["id"])
            time.sleep(0.02)  # ensure created_at differs

        r = api.get(f"{BASE_URL}/outings/{outing['id']}/gallery")
        assert r.status_code == 200
        listed = r.json()
        _assert_no_mongo_id(listed)
        listed_ids = [x["id"] for x in listed if x["id"] in ids_in_order]
        # newest first => reverse of creation order
        assert listed_ids == list(reversed(ids_in_order)), f"Got {listed_ids}, expected {list(reversed(ids_in_order))}"

        # Cleanup
        for i in ids_in_order:
            api.delete(f"{BASE_URL}/gallery/{i}")

    def test_gallery_empty_image_b64_returns_400(self, api, outing, user):
        r = api.post(
            f"{BASE_URL}/outings/{outing['id']}/gallery",
            json={
                "image_b64": "",
                "uploaded_by": user["id"],
                "uploaded_by_name": user["name"],
            },
        )
        assert r.status_code == 400, r.text

    def test_gallery_unknown_outing_returns_404(self, api, user):
        r = api.post(
            f"{BASE_URL}/outings/does-not-exist-{uuid.uuid4().hex[:6]}/gallery",
            json={
                "image_b64": SMALL_PNG_B64,
                "uploaded_by": user["id"],
                "uploaded_by_name": user["name"],
            },
        )
        assert r.status_code == 404, r.text

    def test_gallery_delete_unknown_returns_404(self, api):
        r = api.delete(f"{BASE_URL}/gallery/missing-{uuid.uuid4().hex[:6]}")
        assert r.status_code == 404, r.text


# ---------- Todo tests ----------
class TestTodos:
    def test_todo_full_flow(self, api, outing, user):
        outing_id = outing["id"]

        # 1) Add 3 todos (mix assigned/unassigned)
        t1 = api.post(
            f"{BASE_URL}/outings/{outing_id}/todos",
            json={
                "title": "Book hotel",
                "created_by": user["id"],
                "created_by_name": user["name"],
            },
        )
        assert t1.status_code == 200, t1.text
        time.sleep(0.02)
        t2 = api.post(
            f"{BASE_URL}/outings/{outing_id}/todos",
            json={
                "title": "Pack bags",
                "created_by": user["id"],
                "created_by_name": user["name"],
                "assigned_to": user["id"],
                "assigned_to_name": user["name"],
            },
        )
        assert t2.status_code == 200, t2.text
        time.sleep(0.02)
        t3 = api.post(
            f"{BASE_URL}/outings/{outing_id}/todos",
            json={
                "title": "Buy snacks",
                "created_by": user["id"],
                "created_by_name": user["name"],
            },
        )
        assert t3.status_code == 200, t3.text

        b1, b2, b3 = t1.json(), t2.json(), t3.json()
        for b in (b1, b2, b3):
            _assert_no_mongo_id(b)
            assert b.get("id")
            assert b["done"] is False
            assert b["outing_id"] == outing_id
        assert b2["assigned_to"] == user["id"]
        assert b1["assigned_to"] is None

        # List length == 3 with done False for all
        r = api.get(f"{BASE_URL}/outings/{outing_id}/todos")
        assert r.status_code == 200
        listed = r.json()
        _assert_no_mongo_id(listed)
        our_ids = {b1["id"], b2["id"], b3["id"]}
        ours = [x for x in listed if x["id"] in our_ids]
        assert len(ours) == 3
        assert all(x["done"] is False for x in ours)

        # 2) Toggle t2 to done; list order: open first preserving creation order, completed last
        r = api.put(f"{BASE_URL}/todos/{b2['id']}", json={"done": True})
        assert r.status_code == 200, r.text
        updated = r.json()
        _assert_no_mongo_id(updated)
        assert updated["done"] is True
        assert updated["title"] == "Pack bags"  # unchanged
        assert updated["id"] == b2["id"]

        r = api.get(f"{BASE_URL}/outings/{outing_id}/todos")
        assert r.status_code == 200
        listed = r.json()
        ours = [x for x in listed if x["id"] in our_ids]
        order_ids = [x["id"] for x in ours]
        # open todos first in creation order: b1, b3 ; then done: b2
        assert order_ids == [b1["id"], b3["id"], b2["id"]], f"Unexpected order: {order_ids}"

        # 3) Update only title on b2; done must remain True
        r = api.put(f"{BASE_URL}/todos/{b2['id']}", json={"title": "Pack bags carefully"})
        assert r.status_code == 200
        updated = r.json()
        _assert_no_mongo_id(updated)
        assert updated["title"] == "Pack bags carefully"
        assert updated["done"] is True
        assert updated["assigned_to"] == user["id"]  # not changed

        # 4) Empty title -> 400
        r = api.post(
            f"{BASE_URL}/outings/{outing_id}/todos",
            json={"title": "", "created_by": user["id"], "created_by_name": user["name"]},
        )
        assert r.status_code == 400, r.text
        # whitespace only
        r = api.post(
            f"{BASE_URL}/outings/{outing_id}/todos",
            json={"title": "   ", "created_by": user["id"], "created_by_name": user["name"]},
        )
        assert r.status_code == 400, r.text

        # 5) Delete b3; list length should be 2 (out of our test todos)
        r = api.delete(f"{BASE_URL}/todos/{b3['id']}")
        assert r.status_code == 200
        assert r.json() == {"ok": True}

        r = api.get(f"{BASE_URL}/outings/{outing_id}/todos")
        assert r.status_code == 200
        listed = r.json()
        ours = [x for x in listed if x["id"] in our_ids]
        assert len(ours) == 2
        remaining_ids = {x["id"] for x in ours}
        assert remaining_ids == {b1["id"], b2["id"]}

        # 6) Unknown PUT/DELETE -> 404
        r = api.put(f"{BASE_URL}/todos/missing-{uuid.uuid4().hex[:6]}", json={"done": True})
        assert r.status_code == 404, r.text
        r = api.delete(f"{BASE_URL}/todos/missing-{uuid.uuid4().hex[:6]}")
        assert r.status_code == 404, r.text

        # Cleanup
        api.delete(f"{BASE_URL}/todos/{b1['id']}")
        api.delete(f"{BASE_URL}/todos/{b2['id']}")

    def test_todo_unknown_outing_returns_404(self, api, user):
        r = api.post(
            f"{BASE_URL}/outings/missing-{uuid.uuid4().hex[:6]}/todos",
            json={
                "title": "anything",
                "created_by": user["id"],
                "created_by_name": user["name"],
            },
        )
        assert r.status_code == 404, r.text
