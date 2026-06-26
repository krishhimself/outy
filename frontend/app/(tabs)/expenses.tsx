import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/state/auth";
import { colors, radii, spacing } from "@/src/theme";

type Summary = {
  total: number;
  by_outing: { outing_id: string; outing_name: string; total: number }[];
  recent: {
    id: string;
    outing_id: string;
    outing_name: string;
    title: string;
    amount: number;
    category: string;
    paid_by_name: string;
    created_at: string;
  }[];
};

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  food: "restaurant",
  stay: "bed",
  travel: "car",
  fun: "happy",
  shopping: "bag-handle",
  other: "receipt",
};

const CATEGORY_BG: Record<string, string> = {
  food: "#FEF08A",
  stay: "#E0E7FF",
  travel: "#D1FAE5",
  fun: "#FCE7F3",
  shopping: "#FFEDD5",
  other: "#F1F3F5",
};

export default function ExpensesTab() {
  const router = useRouter();
  const { user: profile } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    try {
      const s = await api.expensesSummary();
      setSummary(s as Summary);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Expense Tracker</Text>
        <Text style={styles.subtitle}>All outy spend in one place 💸</Text>

        {loading ? (
          <View style={styles.center} testID="expenses-loading">
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Total spent across all outies</Text>
              <Text style={styles.totalValue} testID="expenses-total">
                ₹{(summary?.total ?? 0).toLocaleString()}
              </Text>
              <View style={styles.totalRow}>
                <Ionicons name="people-outline" size={14} color="#fff" />
                <Text style={styles.totalSub}>{summary?.by_outing.length ?? 0} outies tracked</Text>
              </View>
            </View>

            {summary && summary.by_outing.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>By outing</Text>
                {summary.by_outing.map((b) => (
                  <TouchableOpacity
                    key={b.outing_id}
                    style={styles.rowCard}
                    onPress={() => router.push(`/outing/${b.outing_id}`)}
                    activeOpacity={0.85}
                    testID={`expense-outing-${b.outing_id}`}
                  >
                    <View style={[styles.iconBubble, { backgroundColor: "#FFEDED" }]}>
                      <Ionicons name="airplane" size={18} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{b.outing_name}</Text>
                      <Text style={styles.rowSub}>Tap to view & add</Text>
                    </View>
                    <Text style={styles.rowAmount}>₹{b.total.toLocaleString()}</Text>
                  </TouchableOpacity>
                ))}
              </>
            ) : null}

            {summary && summary.recent.length > 0 ? (
              <>
                <Text style={styles.sectionLabel}>Recent</Text>
                {summary.recent.map((e) => {
                  const icon = CATEGORY_ICONS[e.category] ?? "receipt";
                  const bg = CATEGORY_BG[e.category] ?? "#F1F3F5";
                  return (
                    <View key={e.id} style={styles.rowCard}>
                      <View style={[styles.iconBubble, { backgroundColor: bg }]}>
                        <Ionicons name={icon} size={18} color={colors.textMain} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{e.title}</Text>
                        <Text style={styles.rowSub}>
                          {e.outing_name} • {e.paid_by_name}
                        </Text>
                      </View>
                      <Text style={styles.rowAmount}>₹{e.amount.toLocaleString()}</Text>
                    </View>
                  );
                })}
              </>
            ) : (
              <View style={styles.empty} testID="expenses-empty-state">
                <View style={styles.emptyBadge}>
                  <Ionicons name="wallet-outline" size={28} color="#854D0E" />
                </View>
                <Text style={styles.emptyTitle}>No expenses yet</Text>
                <Text style={styles.emptySub}>Open any outy and tap “Add expense” to start tracking.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  title: { fontSize: 28, fontWeight: "800", color: colors.textMain, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: spacing.lg },
  center: { alignItems: "center", paddingTop: 60 },
  totalCard: {
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    padding: spacing.lg,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 6,
  },
  totalLabel: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1.2 },
  totalValue: { color: "#fff", fontSize: 40, fontWeight: "800", marginTop: 6, letterSpacing: -1 },
  totalRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  totalSub: { color: "#fff", fontSize: 12, fontWeight: "600" },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.textSubtle, letterSpacing: 1.2, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: spacing.sm },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  iconBubble: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15, fontWeight: "700", color: colors.textMain },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: "700", color: colors.textMain },
  empty: { alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: 40 },
  emptyBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#FEF08A", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.textMain, marginBottom: 4 },
  emptySub: { fontSize: 13, color: colors.textMuted, textAlign: "center", lineHeight: 18 },
});
