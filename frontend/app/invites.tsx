import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { api, Invite } from "@/src/api/client";
import { colors, radii, spacing } from "@/src/theme";

function daysUntilExpire(iso: string): number {
  const exp = new Date(iso).getTime();
  return Math.max(0, Math.ceil((exp - Date.now()) / (1000 * 60 * 60 * 24)));
}

export default function InvitesScreen() {
  const router = useRouter();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const list = await api.listInvites();
      setInvites(list);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const accept = async (inv: Invite) => {
    setActingId(inv.id);
    try {
      const outing = await api.acceptInvite(inv.id);
      setInvites((prev) => prev.filter((x) => x.id !== inv.id));
      router.push(`/outing/${outing.id}`);
    } finally {
      setActingId(null);
    }
  };

  const reject = async (inv: Invite) => {
    setActingId(inv.id);
    try {
      await api.rejectInvite(inv.id);
      setInvites((prev) => prev.filter((x) => x.id !== inv.id));
    } finally {
      setActingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="invites-back">
          <Ionicons name="chevron-back" size={22} color={colors.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Invites</Text>
          <Text style={styles.sub}>{invites.length} pending</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.primary} />}
        >
          {invites.length === 0 ? (
            <View style={styles.empty} testID="invites-empty">
              <View style={styles.emptyBadge}>
                <Ionicons name="mail-open-outline" size={28} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>You&apos;re all caught up</Text>
              <Text style={styles.emptySub}>When friends invite you to an outy, it&apos;ll show up here.</Text>
            </View>
          ) : (
            invites.map((inv) => (
              <View key={inv.id} style={styles.card} testID={`invite-${inv.id}`}>
                <View style={styles.cardTop}>
                  {inv.outing_cover_url ? (
                    <Image source={{ uri: inv.outing_cover_url }} style={styles.cover} />
                  ) : (
                    <View style={[styles.cover, { backgroundColor: "#E0E7FF" }]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.outingName}>{inv.outing_name}</Text>
                    <Text style={styles.outingDest}>
                      <Ionicons name="location" size={11} color={colors.textMuted} /> {inv.outing_destination}
                    </Text>
                    <Text style={styles.invitedBy}>
                      <Ionicons name="person" size={11} color={colors.textMuted} /> {inv.invited_by_name}
                    </Text>
                  </View>
                </View>
                <Text style={styles.expiry}>Expires in {daysUntilExpire(inv.expires_at)} day{daysUntilExpire(inv.expires_at) === 1 ? "" : "s"}</Text>
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.rejectBtn}
                    onPress={() => reject(inv)}
                    disabled={actingId === inv.id}
                    testID={`invite-reject-${inv.id}`}
                  >
                    <Ionicons name="close" size={16} color={colors.textMain} />
                    <Text style={styles.rejectText}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.acceptBtn}
                    onPress={() => accept(inv)}
                    disabled={actingId === inv.id}
                    testID={`invite-accept-${inv.id}`}
                  >
                    {actingId === inv.id ? <ActivityIndicator color="#fff" /> : (
                      <>
                        <Ionicons name="checkmark" size={16} color="#fff" />
                        <Text style={styles.acceptText}>Accept</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#F1F3F5", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "800", color: colors.textMain },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  empty: { alignItems: "center", paddingTop: 80 },
  emptyBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#FFEDED", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.textMain, marginBottom: spacing.xs },
  emptySub: { fontSize: 14, color: colors.textMuted, textAlign: "center", lineHeight: 20, paddingHorizontal: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.borderSoft, marginBottom: spacing.md },
  cardTop: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  cover: { width: 64, height: 64, borderRadius: radii.md },
  outingName: { fontSize: 16, fontWeight: "800", color: colors.textMain },
  outingDest: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  invitedBy: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  expiry: { fontSize: 11, color: colors.textSubtle, fontWeight: "700", marginTop: spacing.sm },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  rejectBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 999, backgroundColor: "#F1F3F5" },
  rejectText: { fontWeight: "700", color: colors.textMain, fontSize: 13 },
  acceptBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 999, backgroundColor: colors.primary },
  acceptText: { fontWeight: "700", color: "#fff", fontSize: 13 },
});
