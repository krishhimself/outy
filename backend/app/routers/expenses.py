"""Expenses, balances, and the settlement optimizer."""

from typing import List
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.database import PROJECTION, db
from app.security import (
    get_current_user,
)
from app.utils import now_iso


router = APIRouter()


class ExpenseShare(BaseModel):
    user_id: str
    name: str
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
    created_at: str = Field(default_factory=now_iso)


class ExpenseCreate(BaseModel):
    title: str
    amount: float
    category: str = "other"
    paid_by: str
    paid_by_name: str
    split_type: str = "equal"
    shares: List[ExpenseShare] = []


@router.post("/outings/{outing_id}/expenses", response_model=Expense)
async def add_expense(outing_id: str, payload: ExpenseCreate, current=Depends(get_current_user)):
    outing = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not outing:
        raise HTTPException(status_code=404, detail="Outing not found")
    if not any(m["user_id"] == current["id"] for m in outing.get("members", [])):
        raise HTTPException(status_code=403, detail="Not a crew member")
    if not payload.shares:
        raise HTTPException(status_code=400, detail="At least one participant required")
    member_ids = {m["user_id"] for m in outing.get("members", [])}
    for s in payload.shares:
        if s.user_id not in member_ids:
            raise HTTPException(status_code=400, detail=f"Participant {s.name} is not a crew member")
    total = sum(s.share_amount for s in payload.shares)
    if abs(total - payload.amount) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Shares total {total:.2f} must equal expense amount {payload.amount:.2f}",
        )
    expense = Expense(outing_id=outing_id, **payload.dict())
    await db.expenses.insert_one(expense.dict())
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
    docs = await db.expenses.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    docs.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return [Expense(**d) for d in docs]


@router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, current=Depends(get_current_user)):
    res = await db.expenses.delete_one({"id": expense_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"ok": True}


@router.get("/outings/{outing_id}/balances")
async def outing_balances(outing_id: str, current=Depends(get_current_user)):
    outing = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not outing:
        raise HTTPException(status_code=404, detail="Outing not found")
    expenses = await db.expenses.find({"outing_id": outing_id}, PROJECTION).to_list(2000)
    balances = _compute_balances(expenses, outing.get("members", []))
    total = round(sum(float(e["amount"]) for e in expenses), 2)
    return {"total": total, "balances": balances}


@router.get("/outings/{outing_id}/settlements")
async def outing_settlements(outing_id: str, current=Depends(get_current_user)):
    outing = await db.outings.find_one({"id": outing_id}, PROJECTION)
    if not outing:
        raise HTTPException(status_code=404, detail="Outing not found")
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
