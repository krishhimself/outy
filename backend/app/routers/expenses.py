"""Expenses, balances, and the settlement optimizer."""

import math
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.access import is_member, member_name, require_member
from app.database import PROJECTION, db
from app.security import get_current_user
from app.utils import now_iso


router = APIRouter()

MAX_AMOUNT = 100_000_000
MAX_PARTICIPANTS = 200


class ExpenseShare(BaseModel):
    user_id: str = Field(max_length=64)
    name: str = Field(default="", max_length=200)
    share_amount: float


class Expense(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    outing_id: str
    title: str
    amount: float
    category: str = "other"
    paid_by: str
    paid_by_name: str
    split_type: str = "equal"
    shares: List[ExpenseShare] = []
    created_by: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class ExpenseCreate(BaseModel):
    title: str = Field(max_length=100)
    amount: float
    category: str = Field(default="other", max_length=30)
    paid_by: str = Field(max_length=64)
    paid_by_name: str = Field(default="", max_length=200)
    split_type: str = Field(default="equal", max_length=10)
    shares: List[ExpenseShare] = Field(default=[], max_length=MAX_PARTICIPANTS)


def _money(value: float, label: str, minimum: float) -> float:
    if not math.isfinite(value) or value < minimum or value > MAX_AMOUNT:
        raise HTTPException(status_code=400, detail=f"{label} is not a valid amount")
    return round(value, 2)


@router.post("/outings/{outing_id}/expenses", response_model=Expense)
async def add_expense(outing_id: str, payload: ExpenseCreate, current=Depends(get_current_user)):
    outing = await require_member(outing_id, current)
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title required")
    if payload.split_type not in ("equal", "custom"):
        raise HTTPException(status_code=400, detail="Unknown split type")
    amount = _money(payload.amount, "Amount", minimum=0.01)
    if not payload.shares:
        raise HTTPException(status_code=400, detail="At least one participant required")
    if not is_member(outing, payload.paid_by):
        raise HTTPException(status_code=400, detail="The payer is not a crew member")

    # Names are taken from the crew list, never from the request, so nobody can
    # record an expense under a made-up name.
    shares = []
    seen = set()
    for s in payload.shares:
        name = member_name(outing, s.user_id)
        if name is None:
            raise HTTPException(status_code=400, detail="A participant is not a crew member")
        if s.user_id in seen:
            raise HTTPException(status_code=400, detail="A participant is listed twice")
        seen.add(s.user_id)
        shares.append({"user_id": s.user_id, "name": name,
                       "share_amount": _money(s.share_amount, "Share", minimum=0)})
    total = sum(s["share_amount"] for s in shares)
    if abs(total - amount) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Shares total {total:.2f} must equal expense amount {amount:.2f}",
        )
    expense = Expense(
        outing_id=outing_id,
        title=title,
        amount=amount,
        category=payload.category.strip() or "other",
        paid_by=payload.paid_by,
        paid_by_name=member_name(outing, payload.paid_by),
        split_type=payload.split_type,
        shares=shares,
        created_by=current["id"],
    )
    await db.expenses.insert_one(expense.model_dump())
    return expense


def _compute_balances(expenses, members):
    name_map = {m["user_id"]: m["name"] for m in members}
    paid: dict = {m["user_id"]: 0.0 for m in members}
    owed: dict = {m["user_id"]: 0.0 for m in members}
    for e in expenses:
        paid[e["paid_by"]] = paid.get(e["paid_by"], 0.0) + float(e["amount"])
        for s in e.get("shares", []):
            owed[s["user_id"]] = owed.get(s["user_id"], 0.0) + float(s["share_amount"])
    rows = []
    for uid in {**paid, **owed}:
        rows.append({
            "user_id": uid,
            "name": name_map.get(uid, "Unknown"),
            "total_paid": round(paid.get(uid, 0.0), 2),
            "total_owed": round(owed.get(uid, 0.0), 2),
            "net_balance": round(paid.get(uid, 0.0) - owed.get(uid, 0.0), 2),
        })
    rows.sort(key=lambda r: r["net_balance"], reverse=True)
    return rows


def _optimize_settlements(balances):
    creditors = [{"user_id": b["user_id"], "name": b["name"], "amount": b["net_balance"]}
                 for b in balances if b["net_balance"] > 0.01]
    debtors = [{"user_id": b["user_id"], "name": b["name"], "amount": -b["net_balance"]}
               for b in balances if b["net_balance"] < -0.01]
    creditors.sort(key=lambda x: x["amount"], reverse=True)
    debtors.sort(key=lambda x: x["amount"], reverse=True)
    txs = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        pay = round(min(debtors[i]["amount"], creditors[j]["amount"]), 2)
        if pay > 0.01:
            txs.append({
                "from_user_id": debtors[i]["user_id"], "from_name": debtors[i]["name"],
                "to_user_id": creditors[j]["user_id"], "to_name": creditors[j]["name"],
                "amount": pay,
            })
        debtors[i]["amount"] = round(debtors[i]["amount"] - pay, 2)
        creditors[j]["amount"] = round(creditors[j]["amount"] - pay, 2)
        if debtors[i]["amount"] <= 0.01:
            i += 1
        if creditors[j]["amount"] <= 0.01:
            j += 1
    return txs


@router.get("/outings/{outing_id}/expenses", response_model=List[Expense])
async def list_outing_expenses(outing_id: str, current=Depends(get_current_user)):
    await require_member(outing_id, current)
    docs = await db.expenses.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    docs.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return [Expense(**d) for d in docs]


@router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, current=Depends(get_current_user)):
    expense = await db.expenses.find_one({"id": expense_id}, PROJECTION)
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    outing = await require_member(expense["outing_id"], current)
    allowed = {expense.get("paid_by"), expense.get("created_by"), outing["created_by"]}
    if current["id"] not in allowed:
        raise HTTPException(status_code=403, detail="Only the payer or the outing's creator can delete this")
    await db.expenses.delete_one({"id": expense_id})
    return {"ok": True}


@router.get("/outings/{outing_id}/balances")
async def outing_balances(outing_id: str, current=Depends(get_current_user)):
    outing = await require_member(outing_id, current)
    expenses = await db.expenses.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    balances = _compute_balances(expenses, outing.get("members", []))
    total = round(sum(float(e["amount"]) for e in expenses), 2)
    return {"total": total, "balances": balances}


@router.get("/outings/{outing_id}/settlements")
async def outing_settlements(outing_id: str, current=Depends(get_current_user)):
    outing = await require_member(outing_id, current)
    expenses = await db.expenses.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    balances = _compute_balances(expenses, outing.get("members", []))
    return {"balances": balances, "transactions": _optimize_settlements(balances)}


@router.get("/expenses/summary")
async def expenses_summary(current=Depends(get_current_user)):
    outings = await db.outings.find({"members.user_id": current["id"]}, PROJECTION).to_list(1000)
    outing_ids = [o["id"] for o in outings]
    if not outing_ids:
        return {"total": 0, "by_outing": [], "recent": []}
    expenses = await db.expenses.find({"outing_id": {"$in": outing_ids}}, PROJECTION).to_list(2000)
    total = round(sum(float(e["amount"]) for e in expenses), 2)
    name_map = {o["id"]: o["name"] for o in outings}
    by_outing_map: dict = {}
    for e in expenses:
        by_outing_map[e["outing_id"]] = by_outing_map.get(e["outing_id"], 0.0) + float(e["amount"])
    by_outing = [{"outing_id": k, "outing_name": name_map.get(k, ""), "total": round(v, 2)}
                 for k, v in by_outing_map.items()]
    by_outing.sort(key=lambda x: x["total"], reverse=True)
    expenses.sort(key=lambda e: e.get("created_at", ""), reverse=True)
    recent = []
    for e in expenses[:20]:
        recent.append({**{k: v for k, v in e.items() if k != "_id"}, "outing_name": name_map.get(e["outing_id"], "")})
    return {"total": total, "by_outing": by_outing, "recent": recent}
