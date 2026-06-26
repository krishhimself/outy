import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useFonts, Inter_900Black } from "@expo-google-fonts/inter";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { api, Outing } from "@/src/api/client";
import OutingCard, { daysUntil } from "@/src/components/OutingCard";
import { HomeSkeleton } from "@/src/components/SkeletonLoader";
import { useAuth } from "@/src/state/auth";
import { colors, spacing, radii } from "@/src/theme";

function useCountdown(targetDate: string) {
  const calc = () => {
    const diff = new Date(targetDate).getTime() - Date.now();
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    return { days, hours, minutes, seconds };
  };
  const [countdown, setCountdown] = useState(calc);
  useEffect(() => {
    const interval = setInterval(() => setCountdown(calc()), 1000);
    return () => clearInterval(interval);
  }, [targetDate]);
  return countdown;
}

type ActivityItem = { id: string; text: string; time: string; icon: string; outingName: string };

export default function HomeTab() {
  const router = useRouter();
  const { user: profile } = useAuth();
  const [upcoming, setUpcoming] = useState<Outing[]>([]);
  const [past, setPast] = useState<Outing[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [crew, setCrew] = useState<{ user_id: string; name: string; avatar_url?: string | null }[]>([]);
  const [inviteCount, setInviteCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fontsLoaded] = useFonts({ Inter_900Black });

  const fetchData = useCallback(async () => {
    if (!profile) return;
    try {
      const [upcomingList, pastList, invites] = await Promise.all([
        api.listOutings("upcoming"),
        api.listOutings("past"),
        api.listInvites(),
      ]);
      setUpcoming(upcomingList);
      setPast(pastList);
      setInviteCount(invites.length);

      const allOutings = [...upcomingList, ...pastList];
      const activityItems: ActivityItem[] = [];
      const crewMap = new Map<string, { user_id: string; name: string; avatar_url?: string | null }>();

      await Promise.all(
        allOutings.slice(0, 5).map(async (outing) => {
          try {
            const msgs = await api.listMessages(outing.id);
            msgs.slice(0, 3).forEach((m) => {
              activityItems.push({
                id: m.id,
                text: m.text,
                time: m.created_at,
                icon: m.type === "system" ? "notifications-outline" : "chatbubble-outline",
                outingName: outing.name,
              });
            });
            outing.members.forEach((m) => {
              if (m.user_id !== profile.id) crewMap.set(m.user_id, m);
            });
          } catch {}
        })
      );

      activityItems.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      setActivity(activityItems.slice(0, 6));
      setCrew(Array.from(crewMap.values()).slice(0, 6));
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const invites = await api.listInvites();
        setInviteCount(invites.length);
      } catch {}
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const hero = upcoming[0];
  const rest = upcoming.slice(1);
  const countdown = useCountdown(hero?.start_date ?? "");

  const topBar = (
    <View style={styles.topBar}>
      <Text style={styles.wordmark}>outy</Text>
      <View style={styles.topBarActions}>
        <View style={{ position: "relative" }}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push("/invites")} testID="home-invites-button">
            <Ionicons name="mail-outline" size={20} color={colors.textMain} />
          </TouchableOpacity>
          {inviteCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{inviteCount > 9 ? "9+" : inviteCount}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.push("/outing/join")} testID="home-join-button">
          <Ionicons name="enter-outline" size={20} color={colors.textMain} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const greetingSection = (
    <View style={styles.header}>
      <Text style={styles.greetingSmall}>{greeting()}</Text>
      <Text style={styles.greeting}>{profile?.name?.split(" ")[0] ?? "friend"}.</Text>
      <Text style={styles.subtitle}>
        {upcoming.length === 0
          ? "No upcoming trips yet."
          : `${upcoming.length} trip${upcoming.length === 1 ? "" : "s"} coming up.`}
      </Text>
    </View>
  );

  const heroCard = hero ? (
    <TouchableOpacity style={styles.heroCard} activeOpacity={0.92} onPress={() => router.push(`/outing/${hero.id}`)}>
      {hero.cover_url ? (
        <Image source={{ uri: hero.cover_url }} style={styles.heroImage} />
      ) : (
        <View style={[styles.heroImage, { backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center" }]}>
          <Ionicons name="airplane" size={48} color={colors.textMuted} />
        </View>
      )}
      <LinearGradient colors={["transparent", "rgba(0,0,0,0.3)", "rgba(0,0,0,0.88)"]} style={styles.heroGradient} />
      <View style={styles.countdownRow}>
        {[
          { value: countdown.days, label: "days" },
          { value: countdown.hours, label: "hrs" },
          { value: countdown.minutes, label: "min" },
          { value: countdown.seconds, label: "sec" },
        ].map(({ value, label }) => (
          <View key={label} style={styles.countdownBox}>
            <Text style={styles.countdownNum}>{String(value).padStart(2, "0")}</Text>
            <Text style={styles.countdownLabel}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.heroInfo}>
        <Text style={styles.heroLabel}>NEXT TRIP</Text>
        <Text style={styles.heroName}>{hero.name}</Text>
        <View style={styles.heroRow}>
          <Ionicons name="location" size={13} color="rgba(255,255,255,0.8)" />
          <Text style={styles.heroDestination}>{hero.destination}</Text>
          <Text style={styles.heroDot}>·</Text>
          <Text style={styles.heroDestination}>
            {new Date(hero.start_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </Text>
        </View>
        <View style={styles.heroAvatars}>
          {hero.members.slice(0, 4).map((m, idx) => (
            <View key={m.user_id} style={[styles.heroAvatar, { marginLeft: idx === 0 ? 0 : -8 }]}>
              {m.avatar_url ? (
                <Image source={{ uri: m.avatar_url }} style={{ width: "100%", height: "100%" }} />
              ) : (
                <Text style={styles.heroAvatarText}>{m.name?.[0]?.toUpperCase()}</Text>
              )}
            </View>
          ))}
          <Text style={styles.crewCount}>{hero.members.length} going</Text>
        </View>
      </View>
    </TouchableOpacity>
  ) : null;

  const activityFeed = activity.length > 0 ? (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Recent activity</Text>
      {activity.map((item) => (
        <View key={item.id} style={styles.activityItem}>
          <View style={styles.activityIcon}>
            <Ionicons name={item.icon as any} size={16} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.activityText} numberOfLines={2}>{item.text}</Text>
            <Text style={styles.activityMeta}>{item.outingName} · {timeAgo(item.time)}</Text>
          </View>
        </View>
      ))}
    </View>
  ) : null;

  const crewSection = crew.length > 0 ? (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Your crew</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {crew.map((m) => (
          <View key={m.user_id} style={styles.crewMember}>
            <View style={styles.crewAvatar}>
              {m.avatar_url ? (
                <Image source={{ uri: m.avatar_url }} style={{ width: "100%", height: "100%" }} />
              ) : (
                <Text style={styles.crewAvatarText}>{m.name?.[0]?.toUpperCase()}</Text>
              )}
            </View>
            <Text style={styles.crewName} numberOfLines={1}>{m.name.split(" ")[0]}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  ) : null;

  const memoriesRow = past.length > 0 ? (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Memories</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.memoriesScroll}>
        {past.map((outing) => (
          <TouchableOpacity key={outing.id} style={styles.memoryCard} onPress={() => router.push(`/outing/${outing.id}`)} activeOpacity={0.88}>
            {outing.cover_url ? (
              <Image source={{ uri: outing.cover_url }} style={styles.memoryImage} />
            ) : (
              <View style={[styles.memoryImage, { backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center" }]}>
                <Ionicons name="airplane" size={24} color={colors.textMuted} />
              </View>
            )}
            <LinearGradient colors={["transparent", "rgba(0,0,0,0.7)"]} style={StyleSheet.absoluteFillObject} />
            <View style={styles.memoryInfo}>
              <Text style={styles.memoryName} numberOfLines={1}>{outing.name}</Text>
              <Text style={styles.memoryDate}>
                {new Date(outing.start_date).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  ) : null;

  const listHeader = (
    <View>
      {topBar}
      {greetingSection}
      {heroCard}
      {rest.length > 0 && <Text style={styles.sectionTitle}>Also coming up</Text>}
    </View>
  );

  const listFooter = (
    <View>
      {activityFeed}
      {crewSection}
      {memoriesRow}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {loading ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          <HomeSkeleton />
        </ScrollView>
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          renderItem={({ item, index }) => (
            <OutingCard outing={item} index={index + 1} onPress={() => router.push(`/outing/${item.id}`)} />
          )}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          ListEmptyComponent={
            !hero ? (
              <View style={styles.empty} testID="home-empty-state">
                <View style={styles.emptyBadge}>
                  <Ionicons name="map" size={32} color={colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>No outings yet</Text>
                <Text style={styles.emptySub}>
                  Plan a trip with your crew. Hit the + button to create your first Outy.
                </Text>
                <TouchableOpacity style={styles.emptyCta} onPress={() => router.push("/(tabs)/create")} testID="empty-create-button">
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text style={styles.emptyCtaText}>Create an Outy</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Hey there";
  return "Good evening";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.bg,
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  wordmark: { fontSize: 32, fontWeight: "900", color: colors.textMain, letterSpacing: -1.5, lineHeight: 36 },
  topBarActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -4, right: -4, backgroundColor: colors.primary, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#1C1E21" },
  badgeText: { fontSize: 10, fontWeight: "800", color: "#fff" },
  header: { marginBottom: spacing.lg, gap: 2 },
  greetingSmall: { fontSize: 13, fontWeight: "500", color: colors.textMuted, letterSpacing: 0.5, textTransform: "uppercase" },
  greeting: { fontSize: 36, fontWeight: "900", color: colors.textMain, letterSpacing: -1.5, lineHeight: 40 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 6, fontWeight: "500" },
  heroCard: { height: 300, borderRadius: radii.xl, overflow: "hidden", marginBottom: spacing.lg, shadowColor: "#000", shadowOpacity: 0.2, shadowOffset: { width: 0, height: 10 }, shadowRadius: 24, elevation: 8 },
  heroImage: { width: "100%", height: "100%", resizeMode: "cover" },
  heroGradient: { position: "absolute", left: 0, right: 0, bottom: 0, height: "100%" },
  countdownRow: { position: "absolute", top: 16, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 8 },
  countdownBox: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, minWidth: 52 },
  countdownNum: { fontSize: 22, fontWeight: "900", color: "#fff", letterSpacing: -0.5 },
  countdownLabel: { fontSize: 10, fontWeight: "600", color: "rgba(255,255,255,0.7)", marginTop: 2, textTransform: "uppercase" },
  heroInfo: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, gap: 4 },
  heroLabel: { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.7)", letterSpacing: 1.5 },
  heroName: { fontSize: 28, fontWeight: "900", color: "#fff", letterSpacing: -0.5 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  heroDestination: { fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: "500" },
  heroDot: { color: "rgba(255,255,255,0.5)", fontSize: 13 },
  heroAvatars: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 6 },
  heroAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, borderWidth: 2, borderColor: "rgba(255,255,255,0.5)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  heroAvatarText: { fontSize: 11, fontWeight: "800", color: "#fff" },
  crewCount: { fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: "600", marginLeft: 4 },
  section: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: colors.textMain, letterSpacing: -0.5, marginBottom: spacing.md },
  activityItem: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  activityIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#FFF0F0", alignItems: "center", justifyContent: "center" },
  activityText: { fontSize: 13, color: colors.textMain, fontWeight: "500", lineHeight: 18 },
  activityMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  crewMember: { alignItems: "center", marginRight: spacing.md, width: 56 },
  crewAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 6 },
  crewAvatarText: { fontSize: 18, fontWeight: "800", color: "#fff" },
  crewName: { fontSize: 11, fontWeight: "600", color: colors.textMuted, textAlign: "center" },
  memoriesScroll: { marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg },
  memoryCard: { width: 140, height: 180, borderRadius: radii.lg, overflow: "hidden", marginRight: spacing.md, backgroundColor: colors.borderSoft },
  memoryImage: { width: "100%", height: "100%", resizeMode: "cover" },
  memoryInfo: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 12 },
  memoryName: { fontSize: 13, fontWeight: "800", color: "#fff" },
  memoryDate: { fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: "500", marginTop: 2 },
  empty: { alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: 60 },
  emptyBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#FFEDED", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.textMain, marginBottom: spacing.xs },
  emptySub: { fontSize: 14, color: colors.textMuted, textAlign: "center", lineHeight: 20 },
  emptyCta: { marginTop: spacing.lg, backgroundColor: colors.primary, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 6 },
  emptyCtaText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  joinBtnText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
});