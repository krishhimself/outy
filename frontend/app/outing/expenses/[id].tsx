import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { api, Balance, Expense, Outing, SettlementTx } from "@/src/api/client";
import { useAuth } from "@/src/state/auth";
import { colors, radii, spacing } from "@/src/theme";

const CATEGORIES: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; bg: string }[] = [
  { key: "food", label: "Food", icon: "restaurant", bg: "#FEF08A" },
  { key: "stay", label: "Stay", icon: "bed", bg: "#E0E7FF" },
  { key: "travel", label: "Travel", icon: "car", bg: "#D1FAE5" },
  { key: "fun", label: "Fun", icon: "happy", bg: "#FCE7F3" },
  { key: "shopping", label: "Shop", icon: "bag-handle", bg: "#FFEDD5" },
  { key: "other", label: "Other", icon: "receipt", bg: "#F1F3F5" },
];

const formatMoney = (n: number) =>
  `₹${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function equalSplit(amount: number, n: number): number[] {
  if (n <= 0) return [];
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / n);
  const extra = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

export default function ExpensesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: profile } = useAuth();
  const [outing, setOuting] = useState<Outing | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [transactions, setTransactions] = useState<SettlementTx[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading] = useState(true);

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expTitle, setExpTitle] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expCategory, setExpCategory] = useState("food");
  const [expPaidBy, setExpPaidBy] = useState<string | null>(null);
  const [expParticipants, setExpParticipants] = useState<string[]>([]);
  const [expSplitType, setExpSplitType] = useState<"equal" | "custom">("equal");
  const [expCustomShares, setExpCustomShares] = useState<Record<string, string>>({});
  const [expLoading, setExpLoading] = useState(false);
  const [expErr, setExpErr] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    try {
      const [o, e, s] = await Promise.all([
        api.getOuting(id),
        api.listExpenses(id),
        api.outingSettlements(id),
      ]);
      setOuting(o);
      setExpenses(e);
      setBalances(s.balances);
      setTransactions(s.transactions);
      setTotalSpent(e.reduce((acc, x) => acc + x.amount, 0));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));

  const openExpense = () => {
    if (!outing || !profile) return;
    setExpTitle(""); setExpAmount(""); setExpCategory("food");
    setExpPaidBy(profile.id);
    setExpParticipants(outing.members.map((m) => m.user_id));
    setExpSplitType("equal"); setExpCustomShares({}); setExpErr(null);
    setExpenseOpen(true);
  };

  const toggleParticipant = (uid: string) => {
    setExpParticipants((prev) => prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]);
  };

  const amountNum = useMemo(() => { const n = parseFloat(expAmount); return isNaN(n) ? 0 : n; }, [expAmount]);

  const equalShares = useMemo(() => {
    if (expSplitType !== "equal") return [];
    return equalSplit(amountNum, expParticipants.length);
  }, [expSplitType, amountNum, expParticipants.length]);

  const customSharesTotal = useMemo(() => {
    return expParticipants.reduce((s, uid) => {
      const v = parseFloat(expCustomShares[uid] ?? "");
      return s + (isNaN(v) ? 0 : v);
    }, 0);
  }, [expParticipants, expCustomShares]);

  const submitExpense = async () => {
    if (!outing || !profile) return;
    setExpErr(null);
    if (!expTitle.trim()) return setExpErr("Add a title.");
    if (amountNum <= 0) return setExpErr("Enter a valid amount.");
    if (!expPaidBy) return setExpErr("Choose who paid.");
    if (expParticipants.length === 0) return setExpErr("Pick at least one participant.");
    const memberMap = new Map(outing.members.map((m) => [m.user_id, m]));
    let shares: { user_id: string; name: string; share_amount: number }[] = [];
    if (expSplitType === "equal") {
      const split = equalSplit(amountNum, expParticipants.length);
      shares = expParticipants.map((uid, i) => ({
        user_id: uid,
        name: memberMap.get(uid)?.name ?? "Member",
        share_amount: split[i],
      }));
    } else {
      shares = expParticipants.map((uid) => {
        const v = parseFloat(expCustomShares[uid] ?? "0");
        return { user_id: uid, name: memberMap.get(uid)?.name ?? "Member", share_amount: isNaN(v) ? 0 : Math.round(v * 100) / 100 };
      });
      const sum = shares.reduce((s, x) => s + x.share_amount, 0);
      if (Math.abs(sum - amountNum) > 0.01) return setExpErr(`Shares total ${formatMoney(sum)} must equal ${formatMoney(amountNum)}.`);
    }
    setExpLoading(true);
    try {
      const paidByName = memberMap.get(expPaidBy)?.name ?? profile.name;
      await api.addExpense(outing.id, {
        title: expTitle.trim(), amount: amountNum, category: expCategory,
        paid_by: expPaidBy, paid_by_name: paidByName, split_type: expSplitType, shares,
      });
      setExpenseOpen(false);
      fetchAll();
    } catch (e: any) {
      setExpErr(e?.message ?? "Could not add expense");
    } finally {
      setExpLoading(false);
    }
  };

  const deleteExpense = async (expenseId: string) => {
    await api.deleteExpense(expenseId);
    fetchAll();
  };

  if (loading) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={colors.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle}>Expenses</Text>
          <Text style={styles.topSub}>{outing?.name}</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openExpense}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        {/* Total card */}
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Total trip expense</Text>
          <Text style={styles.totalValue}>{formatMoney(totalSpent)}</Text>
          <Text style={styles.totalSub}>{expenses.length} {expenses.length === 1 ? "expense" : "expenses"}</Text>
        </View>

        {/* Settle up */}
        {balances.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Settle up</Text>
            <View style={styles.balanceCard}>
              {balances.map((b) => (
                <View key={b.user_id} style={styles.balanceRow}>
                  <View style={styles.balanceLeft}>
                    <Text style={styles.balanceName}>{b.name}</Text>
                    <Text style={styles.balanceSub}>paid {formatMoney(b.total_paid)} · owes {formatMoney(b.total_owed)}</Text>
                  </View>
                  <View style={[styles.netPill, b.net_balance > 0.01 ? styles.netPositive : b.net_balance < -0.01 ? styles.netNegative : styles.netZero]}>
                    <Text style={[styles.netText, b.net_balance > 0.01 ? styles.netPositiveText : b.net_balance < -0.01 ? styles.netNegativeText : styles.netZeroText]}>
                      {b.net_balance > 0.01 ? "gets " : b.net_balance < -0.01 ? "owes " : "settled"}
                      {Math.abs(b.net_balance) > 0.01 ? formatMoney(Math.abs(b.net_balance)) : ""}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <Text style={styles.subSectionTitle}>Who pays whom</Text>
            {transactions.length === 0 ? (
              <View style={styles.emptyMini}><Text style={styles.emptyMiniText}>Everyone is settled up! 🎉</Text></View>
            ) : (
              transactions.map((t, idx) => (
                <View key={idx} style={styles.txRow}>
                  <View style={styles.txIcon}><Ionicons name="arrow-forward" size={14} color="#fff" /></View>
                  <Text style={styles.txText}><Text style={styles.txBold}>{t.from_name}</Text> pays <Text style={styles.txBold}>{t.to_name}</Text></Text>
                  <Text style={styles.txAmount}>{formatMoney(t.amount)}</Text>
                </View>
              ))
            )}
          </>
        )}

        {/* Expenses list */}
        <Text style={styles.sectionTitle}>Expenses</Text>
        {expenses.length === 0 ? (
          <View style={styles.emptyMini}>
            <Ionicons name="receipt-outline" size={32} color={colors.textMuted} style={{ marginBottom: 8 }} />
            <Text style={styles.emptyMiniText}>No expenses logged yet.</Text>
            <TouchableOpacity style={styles.emptyCta} onPress={openExpense}>
              <Text style={styles.emptyCtaText}>Add first expense</Text>
            </TouchableOpacity>
          </View>
        ) : (
          expenses.map((e) => {
            const cat = CATEGORIES.find((c) => c.key === e.category) ?? CATEGORIES[5];
            return (
              <View key={e.id} style={styles.expenseRow}>
                <View style={[styles.expIcon, { backgroundColor: cat.bg }]}>
                  <Ionicons name={cat.icon} size={18} color={colors.textMain} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.expTitle}>{e.title}</Text>
                  <Text style={styles.expSub}>Paid by {e.paid_by_name} · {e.shares.length} participants</Text>
                </View>
                <Text style={styles.expAmount}>{formatMoney(e.amount)}</Text>
                {profile?.id === e.paid_by && (
                  <TouchableOpacity onPress={() => deleteExpense(e.id)} style={styles.deleteBtn}>
                    <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Add Expense Modal */}
      <Modal visible={expenseOpen} transparent animationType="slide" onRequestClose={() => setExpenseOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <View style={[styles.sheet, { maxHeight: "92%" }]}>
              <View style={styles.sheetHandle} />
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={styles.sheetTitle}>Add expense</Text>
                <TextInput value={expTitle} onChangeText={setExpTitle} placeholder="Dinner at Curlies" placeholderTextColor={colors.textSubtle} style={[styles.input, { marginTop: spacing.md }]} />
                <TextInput value={expAmount} onChangeText={setExpAmount} placeholder="Amount (₹)" placeholderTextColor={colors.textSubtle} keyboardType="decimal-pad" style={[styles.input, { marginTop: 10 }]} />
                <Text style={styles.label}>Category</Text>
                <View style={styles.catRow}>
                  {CATEGORIES.map((c) => {
                    const selected = c.key === expCategory;
                    return (
                      <TouchableOpacity key={c.key} onPress={() => setExpCategory(c.key)} style={[styles.catChip, { backgroundColor: c.bg }, selected && styles.catChipSelected]}>
                        <Ionicons name={c.icon} size={14} color={colors.textMain} />
                        <Text style={styles.catChipText}>{c.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.label}>Paid by</Text>
                <View style={styles.catRow}>
                  {outing?.members.map((m) => {
                    const selected = m.user_id === expPaidBy;
                    return (
                      <TouchableOpacity key={m.user_id} onPress={() => setExpPaidBy(m.user_id)} style={[styles.memberChip, selected && styles.memberChipSelected]}>
                        <Text style={[styles.memberChipText, selected && { color: "#fff" }]}>{m.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.md }}>
                  <Text style={[styles.label, { marginTop: 0 }]}>Participants · {expParticipants.length}</Text>
                  <TouchableOpacity onPress={() => setExpParticipants(outing?.members.map((m) => m.user_id) ?? [])}>
                    <Text style={styles.linkBtn}>Select all</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.catRow}>
                  {outing?.members.map((m) => {
                    const selected = expParticipants.includes(m.user_id);
                    return (
                      <TouchableOpacity key={m.user_id} onPress={() => toggleParticipant(m.user_id)} style={[styles.memberChip, selected && styles.memberChipSelectedAlt]}>
                        {selected ? <Ionicons name="checkmark" size={12} color={colors.primary} /> : null}
                        <Text style={[styles.memberChipText, selected && { color: colors.primary }]}>{m.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.label}>Split type</Text>
                <View style={styles.segment}>
                  {(["equal", "custom"] as const).map((t) => {
                    const active = expSplitType === t;
                    return (
                      <TouchableOpacity key={t} onPress={() => setExpSplitType(t)} style={[styles.segItem, active && styles.segItemActive]}>
                        <Text style={[styles.segText, active && styles.segTextActive]}>{t === "equal" ? "Equal" : "Custom"}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {expSplitType === "equal" ? (
                  <View style={styles.equalPreview}>
                    {expParticipants.length === 0 ? <Text style={styles.previewSub}>Pick at least one participant.</Text> : (
                      expParticipants.map((uid, idx) => {
                        const m = outing?.members.find((x) => x.user_id === uid);
                        return (
                          <View key={uid} style={styles.previewRow}>
                            <Text style={styles.previewName}>{m?.name ?? "Member"}</Text>
                            <Text style={styles.previewAmount}>{formatMoney(equalShares[idx] ?? 0)}</Text>
                          </View>
                        );
                      })
                    )}
                  </View>
                ) : (
                  <View style={styles.equalPreview}>
                    {expParticipants.length === 0 ? <Text style={styles.previewSub}>Pick at least one participant.</Text> : (
                      <>
                        {expParticipants.map((uid) => {
                          const m = outing?.members.find((x) => x.user_id === uid);
                          return (
                            <View key={uid} style={styles.previewRow}>
                              <Text style={[styles.previewName, { flex: 1 }]}>{m?.name ?? "Member"}</Text>
                              <TextInput value={expCustomShares[uid] ?? ""} onChangeText={(t) => setExpCustomShares((s) => ({ ...s, [uid]: t }))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textSubtle} style={styles.shareInput} />
                            </View>
                          );
                        })}
                        <View style={styles.customTotalRow}>
                          <Text style={styles.previewSub}>Total entered</Text>
                          <Text style={[styles.previewAmount, { color: Math.abs(customSharesTotal - amountNum) < 0.01 ? "#065F46" : "#dc2626" }]}>
                            {formatMoney(customSharesTotal)} / {formatMoney(amountNum)}
                          </Text>
                        </View>
                      </>
                    )}
                  </View>
                )}
                {expErr ? <Text style={styles.error}>{expErr}</Text> : null}
                <TouchableOpacity style={styles.cta} onPress={submitExpense} disabled={expLoading}>
                  {expLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Add expense</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setExpenseOpen(false)} style={{ alignItems: "center", padding: 12 }}>
                  <Text style={{ color: colors.textMuted, fontWeight: "600" }}>Cancel</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#F1F3F5", alignItems: "center", justifyContent: "center" },
  topTitle: { fontSize: 18, fontWeight: "800", color: colors.textMain },
  topSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  totalCard: { backgroundColor: "#1C1E21", borderRadius: radii.xl, padding: spacing.lg, marginBottom: spacing.lg },
  totalLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 },
  totalValue: { color: "#fff", fontSize: 36, fontWeight: "900", marginTop: 4, letterSpacing: -1 },
  totalSub: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "600", marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: colors.textMain, marginBottom: spacing.md },
  subSectionTitle: { fontSize: 14, fontWeight: "700", color: colors.textMuted, marginTop: spacing.sm, marginBottom: 4 },
  balanceCard: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderSoft, overflow: "hidden", marginBottom: spacing.md },
  balanceRow: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  balanceLeft: { flex: 1 },
  balanceName: { fontSize: 14, fontWeight: "700", color: colors.textMain },
  balanceSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  netPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  netPositive: { backgroundColor: "#D1FAE5" },
  netPositiveText: { color: "#065F46" },
  netNegative: { backgroundColor: "#FEE2E2" },
  netNegativeText: { color: "#991B1B" },
  netZero: { backgroundColor: "#F1F3F5" },
  netZeroText: { color: colors.textMuted },
  netText: { fontWeight: "700", fontSize: 12 },
  txRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderSoft, marginBottom: 8 },
  txIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  txText: { flex: 1, fontSize: 13, color: colors.textMain },
  txBold: { fontWeight: "800" },
  txAmount: { fontWeight: "800", color: colors.textMain },
  emptyMini: { padding: spacing.xl, alignItems: "center", borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderStyle: "dashed", marginBottom: spacing.md },
  emptyMiniText: { color: colors.textMuted, fontSize: 13 },
  emptyCta: { marginTop: spacing.md, backgroundColor: colors.primary, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 999 },
  emptyCtaText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  expenseRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderSoft, marginBottom: 8 },
  expIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  expTitle: { fontSize: 14, fontWeight: "700", color: colors.textMain },
  expSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  expAmount: { fontSize: 15, fontWeight: "800", color: colors.textMain },
  deleteBtn: { padding: 6 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.textMain },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 15, color: colors.textMain },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMain, marginTop: spacing.md, marginBottom: spacing.sm },
  linkBtn: { color: colors.primary, fontWeight: "700", fontSize: 12 },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 2, borderColor: "transparent" },
  catChipSelected: { borderColor: colors.primary },
  catChipText: { fontWeight: "700", color: colors.textMain, fontSize: 12 },
  memberChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  memberChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  memberChipSelectedAlt: { borderColor: colors.primary, backgroundColor: "#FFEDED" },
  memberChipText: { fontWeight: "700", color: colors.textMain, fontSize: 12 },
  segment: { flexDirection: "row", backgroundColor: "#F1F3F5", borderRadius: 999, padding: 4 },
  segItem: { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: "center" },
  segItemActive: { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.06, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4, elevation: 2 },
  segText: { fontWeight: "700", color: colors.textMuted, fontSize: 13 },
  segTextActive: { color: colors.textMain },
  equalPreview: { marginTop: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderSoft },
  previewRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  previewName: { fontSize: 13, fontWeight: "600", color: colors.textMain },
  previewAmount: { fontSize: 13, fontWeight: "700", color: colors.textMain },
  previewSub: { fontSize: 12, color: colors.textMuted },
  shareInput: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13, color: colors.textMain, minWidth: 80, textAlign: "right" },
  customTotalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  error: { color: "#dc2626", marginTop: spacing.sm, fontSize: 13 },
  cta: { marginTop: spacing.md, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  ctaText: { color: "#fff", fontWeight: "700" },
  outlineBtn: { marginTop: spacing.sm, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 14, borderRadius: 999, backgroundColor: "#F1F3F5" },
  outlineBtnText: { color: colors.textMain, fontWeight: "700" },
});