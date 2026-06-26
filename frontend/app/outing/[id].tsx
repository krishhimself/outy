import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { api, Expense, Outing, Todo } from "@/src/api/client";
import { useAuth } from "@/src/state/auth";
import { colors, radii, spacing } from "@/src/theme";

const formatMoney = (n: number) =>
  `₹${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function OutingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: profile } = useAuth();
  const [outing, setOuting] = useState<Outing | null>(null);
  const [galleryCount, setGalleryCount] = useState(0);
  const [todoStats, setTodoStats] = useState<{ total: number; done: number }>({ total: 0, done: 0 });
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading] = useState(true);

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDestination, setEditDestination] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    try {
      const [o, e, g, t] = await Promise.all([
        api.getOuting(id),
        api.listExpenses(id),
        api.listGallery(id),
        api.listTodos(id),
      ]);
      setOuting(o);
      setTotalSpent(e.reduce((acc: number, x: Expense) => acc + x.amount, 0));
      setGalleryCount(g.length);
      setTodoStats({ total: t.length, done: t.filter((x: Todo) => x.done).length });
    } catch {
      setOuting(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { fetchAll(); }, [fetchAll]));

  const shareCode = async () => {
    if (!outing) return;
    try { await Share.share({ message: `Join "${outing.name}" on Outy! Invite code: ${outing.invite_code}` }); } catch {}
  };

  const submitInvite = async () => {
    if (!outing || !inviteUsername.trim()) return;
    setInviteLoading(true); setInviteErr(null);
    try {
      await api.inviteByUsername(outing.id, inviteUsername.trim().toLowerCase());
      setInviteUsername(""); setInviteOpen(false);
    } catch (e: any) {
      setInviteErr(e?.message ?? "Could not invite.");
    } finally {
      setInviteLoading(false);
    }
  };

  const openEdit = () => {
    if (!outing) return;
    setEditName(outing.name);
    setEditDestination(outing.destination);
    setEditDescription(outing.description ?? "");
    setEditStartDate(outing.start_date);
    setEditEndDate(outing.end_date);
    setEditErr(null);
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!outing) return;
    if (editName.trim().length < 2) return setEditErr("Name must be at least 2 characters.");
    if (editDestination.trim().length < 2) return setEditErr("Destination required.");
    if (editEndDate < editStartDate) return setEditErr("End date can't be before start date.");
    setEditLoading(true); setEditErr(null);
    try {
      await api.updateOuting(outing.id, {
        name: editName.trim(),
        destination: editDestination.trim(),
        description: editDescription.trim(),
        start_date: editStartDate,
        end_date: editEndDate,
      });
      setEditOpen(false);
      fetchAll();
    } catch (e: any) {
      setEditErr(e?.message ?? "Could not update outing.");
    } finally {
      setEditLoading(false);
    }
  };

  const removeOuting = async () => {
    if (!outing) return;
    await api.deleteOuting(outing.id);
    router.back();
  };

  if (loading) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
    </SafeAreaView>
  );

  if (!outing) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Text style={{ color: colors.textMuted }}>Outing not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.smallBtn, { marginTop: 12 }]}>
          <Text style={styles.smallBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  const isOwner = profile?.id === outing.created_by;

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>

        {/* Hero */}
        <View style={styles.heroWrap}>
          {outing.cover_url ? (
            <Image source={{ uri: outing.cover_url }} style={styles.heroImg} />
          ) : (
            <View style={[styles.heroImg, { backgroundColor: "#1C1E21" }]} />
          )}
          <LinearGradient colors={["rgba(0,0,0,0.2)", "rgba(0,0,0,0.85)"]} style={styles.heroGradient} />
          <SafeAreaView edges={["top"]} style={styles.heroTopBar}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()} testID="detail-back-button">
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </TouchableOpacity>
            {isOwner ? (
              <View style={styles.topBtns}>
                <TouchableOpacity style={styles.iconBtn} onPress={openEdit} testID="detail-edit-button">
                  <Ionicons name="create-outline" size={20} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconBtn} onPress={removeOuting} testID="detail-delete-button">
                  <Ionicons name="trash-outline" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : <View style={{ width: 38 }} />}
          </SafeAreaView>
          <View style={styles.heroContent}>
            <Text style={styles.heroName}>{outing.name}</Text>
            <View style={styles.heroRow}>
              <Ionicons name="location" size={13} color="rgba(255,255,255,0.8)" />
              <Text style={styles.heroSub}>{outing.destination}</Text>
              <Text style={styles.heroDot}>·</Text>
              <Text style={styles.heroSub}>{outing.start_date} → {outing.end_date}</Text>
            </View>
          </View>
        </View>

        <View style={styles.body}>

          {/* Description */}
          {outing.description ? (
            <View style={styles.descCard}>
              <Text style={styles.descText}>{outing.description}</Text>
            </View>
          ) : null}

          {/* Crew */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Crew · {outing.members.length}</Text>
            <TouchableOpacity onPress={() => setInviteOpen(true)} style={styles.smallBtn} testID="detail-invite-button">
              <Ionicons name="person-add" size={14} color={colors.primary} />
              <Text style={styles.smallBtnText}>Invite</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {outing.members.map((m) => (
              <View key={m.user_id} style={styles.memberCard} testID={`member-${m.user_id}`}>
                <View style={styles.memberAvatarWrap}>
                  {m.avatar_url ? (
                    <Image source={{ uri: m.avatar_url }} style={styles.memberAvatar} />
                  ) : (
                    <View style={[styles.memberAvatar, styles.memberAvatarFallback]}>
                      <Text style={styles.memberAvatarText}>{m.name[0]?.toUpperCase()}</Text>
                    </View>
                  )}
                  {m.user_id === outing.created_by && (
                    <View style={styles.hostBadge}>
                      <Ionicons name="star" size={8} color="#fff" />
                    </View>
                  )}
                </View>
                <Text style={styles.memberName} numberOfLines={1}>{m.name.split(" ")[0]}</Text>
                {m.user_id === outing.created_by ? <Text style={styles.ownerTag}>Host</Text> : null}
              </View>
            ))}
          </ScrollView>

          {/* Invite code */}
          <TouchableOpacity style={styles.codeRow} onPress={shareCode} activeOpacity={0.85} testID="detail-share-code">
            <View style={{ flex: 1 }}>
              <Text style={styles.codeRowLabel}>Invite code</Text>
              <Text style={styles.codeRowValue}>{outing.invite_code}</Text>
            </View>
            <View style={styles.shareIcon}>
              <Ionicons name="share-outline" size={18} color="#fff" />
            </View>
          </TouchableOpacity>

          {/* 2x2 Quick actions */}
          <View style={styles.quickGrid}>
            <TouchableOpacity style={styles.quickCard} onPress={() => router.push(`/outing/gallery/${outing.id}`)} activeOpacity={0.85} testID="quick-gallery">
              <View style={styles.quickIconWrap}>
                <Ionicons name="images-outline" size={20} color={colors.textMain} />
              </View>
              <Text style={styles.quickTitle}>Gallery</Text>
              <Text style={styles.quickSub}>{galleryCount} {galleryCount === 1 ? "photo" : "photos"}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.quickCard} onPress={() => router.push(`/outing/todo/${outing.id}`)} activeOpacity={0.85} testID="quick-todo">
              <View style={styles.quickIconWrap}>
                <Ionicons name="checkbox-outline" size={20} color={colors.textMain} />
              </View>
              <Text style={styles.quickTitle}>To-do</Text>
              <Text style={styles.quickSub}>{todoStats.total === 0 ? "Add tasks" : `${todoStats.done}/${todoStats.total} done`}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.quickCard} onPress={() => router.push(`/outing/chat/${outing.id}`)} activeOpacity={0.85} testID="quick-chat">
              <View style={styles.quickIconWrap}>
                <Ionicons name="chatbubbles-outline" size={20} color={colors.textMain} />
              </View>
              <Text style={styles.quickTitle}>Chat</Text>
              <Text style={styles.quickSub}>Crew DMs</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.quickCard} onPress={() => router.push(`/outing/expenses/${outing.id}`)} activeOpacity={0.85} testID="quick-expenses">
              <View style={styles.quickIconWrap}>
                <Ionicons name="wallet-outline" size={20} color={colors.textMain} />
              </View>
              <Text style={styles.quickTitle}>Expenses</Text>
              <Text style={styles.quickSub}>{formatMoney(totalSpent)}</Text>
            </TouchableOpacity>
          </View>

        </View>
      </ScrollView>

      {/* Invite Modal */}
      <Modal visible={inviteOpen} transparent animationType="slide" onRequestClose={() => setInviteOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Invite to {outing.name}</Text>
              <Text style={styles.sheetSub}>Search by username, or share the invite code.</Text>
              <TextInput
                value={inviteUsername}
                onChangeText={setInviteUsername}
                placeholder="alex_c"
                placeholderTextColor={colors.textSubtle}
                autoCapitalize="none"
                style={styles.input}
                testID="invite-username-input"
              />
              {inviteErr ? <Text style={styles.error}>{inviteErr}</Text> : null}
              <TouchableOpacity style={styles.cta} onPress={submitInvite} disabled={inviteLoading} testID="invite-submit-button">
                {inviteLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Send invite</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.outlineBtn} onPress={shareCode}>
                <Ionicons name="share-outline" size={16} color={colors.textMain} />
                <Text style={styles.outlineBtnText}>Share code · {outing.invite_code}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setInviteOpen(false)} style={{ alignItems: "center", padding: 12 }}>
                <Text style={{ color: colors.textMuted, fontWeight: "600" }}>Close</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Edit Modal */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <View style={[styles.sheet, { maxHeight: "90%" }]}>
              <View style={styles.sheetHandle} />
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={styles.sheetTitle}>Edit outing</Text>

                <Text style={styles.label}>Outing name</Text>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Weekend in Goa"
                  placeholderTextColor={colors.textSubtle}
                  style={styles.input}
                />

                <Text style={styles.label}>Destination</Text>
                <TextInput
                  value={editDestination}
                  onChangeText={setEditDestination}
                  placeholder="Goa, India"
                  placeholderTextColor={colors.textSubtle}
                  style={styles.input}
                />

                <Text style={styles.label}>Description (optional)</Text>
                <TextInput
                  value={editDescription}
                  onChangeText={setEditDescription}
                  placeholder="Beach hopping, sunsets..."
                  placeholderTextColor={colors.textSubtle}
                  style={[styles.input, { height: 80, textAlignVertical: "top" }]}
                  multiline
                />

                <View style={{ flexDirection: "row", gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Start date</Text>
                    <TextInput
                      value={editStartDate}
                      onChangeText={setEditStartDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textSubtle}
                      autoCapitalize="none"
                      style={styles.input}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>End date</Text>
                    <TextInput
                      value={editEndDate}
                      onChangeText={setEditEndDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.textSubtle}
                      autoCapitalize="none"
                      style={styles.input}
                    />
                  </View>
                </View>

                {editErr ? <Text style={styles.error}>{editErr}</Text> : null}

                <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
                  <TouchableOpacity style={[styles.outlineBtn, { flex: 1 }]} onPress={() => setEditOpen(false)}>
                    <Text style={styles.outlineBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.cta, { flex: 1 }]} onPress={submitEdit} disabled={editLoading}>
                    {editLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Save changes</Text>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  heroWrap: { height: 280, position: "relative" },
  heroImg: { width: "100%", height: "100%", resizeMode: "cover" },
  heroGradient: { ...StyleSheet.absoluteFillObject },
  heroTopBar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  topBtns: { flexDirection: "row", gap: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  heroContent: { position: "absolute", bottom: 20, left: 20, right: 20 },
  heroName: { fontSize: 30, fontWeight: "900", color: "#fff", letterSpacing: -0.5, marginBottom: 6 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroSub: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "600" },
  heroDot: { color: "rgba(255,255,255,0.5)", fontSize: 13 },
  body: { padding: spacing.lg, gap: spacing.lg },
  descCard: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderSoft },
  descText: { color: colors.textMain, fontSize: 14, lineHeight: 20 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: colors.textMain },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FFEDED", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  smallBtnText: { color: colors.primary, fontWeight: "700", fontSize: 12 },
  memberCard: { width: 72, alignItems: "center" },
  memberAvatarWrap: { position: "relative" },
  memberAvatar: { width: 52, height: 52, borderRadius: 26 },
  memberAvatarFallback: { backgroundColor: "#1C1E21", alignItems: "center", justifyContent: "center" },
  memberAvatarText: { color: "#fff", fontWeight: "800", fontSize: 18 },
  hostBadge: { position: "absolute", bottom: 0, right: 0, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.bg },
  memberName: { fontSize: 11, fontWeight: "700", color: colors.textMain, marginTop: 6, textAlign: "center" },
  ownerTag: { fontSize: 10, color: colors.primary, fontWeight: "700", marginTop: 2 },
  codeRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFF5F5", padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: "#FFDDDD" },
  codeRowLabel: { fontSize: 11, color: colors.primary, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 },
  codeRowValue: { fontSize: 24, fontWeight: "900", color: colors.textMain, letterSpacing: 6, marginTop: 4 },
  shareIcon: { marginLeft: "auto", width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  quickCard: { width: "47%", backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.lg, alignItems: "flex-start", gap: 6, borderWidth: 1, borderColor: colors.borderSoft, shadowColor: "#000", shadowOpacity: 0.06, shadowOffset: { width: 0, height: 3 }, shadowRadius: 9, elevation: 3 },
  quickIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.borderSoft, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  quickTitle: { fontSize: 13, fontWeight: "800", color: colors.textMain },
  quickSub: { fontSize: 11, color: colors.textMuted, fontWeight: "500" },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.textMain },
  sheetSub: { fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMain, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 15, color: colors.textMain },
  error: { color: "#dc2626", marginTop: spacing.sm, fontSize: 13 },
  cta: { marginTop: spacing.md, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  ctaText: { color: "#fff", fontWeight: "700" },
  outlineBtn: { marginTop: spacing.sm, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 14, borderRadius: 999, backgroundColor: "#F1F3F5" },
  outlineBtnText: { color: colors.textMain, fontWeight: "700" },
});