import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { api, Outing } from "@/src/api/client";
import { useAuth } from "@/src/state/auth";
import { colors, radii, spacing } from "@/src/theme";

const SCREEN_W = Math.min(Dimensions.get("window").width, 430);

export default function MemoryTab() {
  const router = useRouter();
  const { user: profile } = useAuth();
  const [outings, setOutings] = useState<Outing[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    try {
      const list = await api.listOutings("past");
      list.sort((a, b) => (a.end_date < b.end_date ? 1 : -1));
      setOutings(list);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const formatDate = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${s.toLocaleDateString(undefined, opt)} – ${e.toLocaleDateString(undefined, opt)}`;
  };

  const renderMemory = ({ item, index }: { item: Outing; index: number }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/outing/${item.id}`)}
      activeOpacity={0.92}
    >
      {item.cover_url ? (
        <Image source={{ uri: item.cover_url }} style={styles.cardImage} />
      ) : (
        <View style={[styles.cardImage, styles.cardImageFallback]}>
          <Ionicons name="airplane" size={40} color="rgba(255,255,255,0.4)" />
        </View>
      )}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.3)", "rgba(0,0,0,0.85)"]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Memory badge */}
      <View style={styles.memoryBadge}>
        <Ionicons name="sparkles" size={12} color={colors.primary} />
        <Text style={styles.memoryBadgeText}>Memory</Text>
      </View>

      {/* Crew avatars */}
      <View style={styles.avatarsTop}>
        {item.members.slice(0, 4).map((m, idx) => (
          <View key={m.user_id} style={[styles.avatar, { marginLeft: idx === 0 ? 0 : -8 }]}>
            {m.avatar_url ? (
              <Image source={{ uri: m.avatar_url }} style={{ width: "100%", height: "100%" }} />
            ) : (
              <Text style={styles.avatarText}>{m.name?.[0]?.toUpperCase()}</Text>
            )}
          </View>
        ))}
        {item.members.length > 4 && (
          <View style={[styles.avatar, styles.avatarMore, { marginLeft: -8 }]}>
            <Text style={styles.avatarMoreText}>+{item.members.length - 4}</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.cardInfo}>
        <Text style={styles.cardName}>{item.name}</Text>
        <View style={styles.cardRow}>
          <Ionicons name="location" size={12} color="rgba(255,255,255,0.8)" />
          <Text style={styles.cardMeta}>{item.destination}</Text>
          <Text style={styles.cardDot}>·</Text>
          <Ionicons name="calendar-outline" size={12} color="rgba(255,255,255,0.8)" />
          <Text style={styles.cardMeta}>{formatDate(item.start_date, item.end_date)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlatList
        data={outings}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.topBar}>
              <Text style={styles.title}>Memories</Text>
              {outings.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{outings.length}</Text>
                </View>
              )}
            </View>
            <Text style={styles.subtitle}>Every outy you've lived ✨</Text>
          </View>
        }
        renderItem={renderMemory}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
        ListEmptyComponent={
          loading ? (
            <View style={styles.center} testID="memory-loading">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <View style={styles.empty} testID="memory-empty-state">
              <View style={styles.emptyBadge}>
                <Text style={styles.emptyEmoji}>✈️</Text>
              </View>
              <Text style={styles.emptyTitle}>No memories yet</Text>
              <Text style={styles.emptySub}>
                Your past trips will show up here. Go make some memories!
              </Text>
            </View>
          )
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  header: { marginBottom: spacing.lg },
  title: { fontSize: 32, fontWeight: "900", color: colors.textMain, letterSpacing: -1 },
  countBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  countText: { fontSize: 12, fontWeight: "800", color: "#fff" },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  // Memory card
  card: {
    height: 220,
    borderRadius: radii.xl,
    overflow: "hidden",
    marginBottom: spacing.md,
    backgroundColor: colors.borderSoft,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 5,
  },
  cardImage: { width: "100%", height: "100%", resizeMode: "cover" },
  cardImageFallback: { backgroundColor: "#1C1E21", alignItems: "center", justifyContent: "center" },
  memoryBadge: {
    position: "absolute",
    top: 14,
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  memoryBadgeText: { fontSize: 11, fontWeight: "700", color: colors.textMain },
  avatarsTop: {
    position: "absolute",
    top: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarText: { fontSize: 11, fontWeight: "800", color: "#fff" },
  avatarMore: { backgroundColor: "#1C1E21" },
  avatarMoreText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  cardInfo: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    gap: 6,
  },
  cardName: { fontSize: 22, fontWeight: "900", color: "#fff", letterSpacing: -0.3 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardMeta: { fontSize: 12, color: "rgba(255,255,255,0.85)", fontWeight: "500" },
  cardDot: { color: "rgba(255,255,255,0.5)", fontSize: 12 },
  // Empty
  center: { alignItems: "center", justifyContent: "center", paddingTop: 80 },
  empty: { alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: 80 },
  emptyBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.borderSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  emptyEmoji: { fontSize: 36 },
  emptyTitle: { fontSize: 20, fontWeight: "800", color: colors.textMain, marginBottom: spacing.xs },
  emptySub: { fontSize: 14, color: colors.textMuted, textAlign: "center", lineHeight: 22 },
});