import { useCallback, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  ActivityIndicator,
  Image,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { api, Outing } from "@/src/api/client";
import { useAuth } from "@/src/state/auth";
import { colors, radii, spacing } from "@/src/theme";

export default function ProfileTab() {
  const router = useRouter();
  const { user: profile, updateProfile, signOut } = useAuth();
  const [outings, setOutings] = useState<Outing[]>([]);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAvatar, setEditAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchOutings = useCallback(async () => {
    if (!profile) return;
    try {
      const list = await api.listOutings("all");
      setOutings(list);
    } catch {}
  }, [profile]);

  useFocusEffect(useCallback(() => { fetchOutings(); }, [fetchOutings]));

  const openEdit = () => {
    if (!profile) return;
    setEditName(profile.name);
    setEditAvatar(profile.avatar_url ?? null);
    setEditing(true);
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    if (!asset.base64) return;
    const mime = asset.mimeType ?? "image/jpeg";
    setEditAvatar(`data:${mime};base64,${asset.base64}`);
  };

  const saveEdit = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await updateProfile({ name: editName.trim(), avatar_url: editAvatar });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await signOut();
    router.replace("/auth/signin");
  };

  const totalCoTravelers = new Set(
    outings.flatMap((o) => o.members.map((m) => m.user_id)).filter((id) => id !== profile?.id)
  ).size;

  if (!profile) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>

        {/* Dark header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>

        {/* Avatar + name section */}
        <View style={styles.profileSection}>
          <TouchableOpacity style={styles.avatarWrap} onPress={openEdit} activeOpacity={0.85}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>{profile.name[0]?.toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.cameraBtn}>
              <Ionicons name="camera" size={14} color="#fff" />
            </View>
          </TouchableOpacity>

          <Text style={styles.name} testID="profile-name">{profile.name}</Text>
          <Text style={styles.username}>@{profile.username}</Text>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{outings.length}</Text>
              <Text style={styles.statLabel}>Outies</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{totalCoTravelers}</Text>
              <Text style={styles.statLabel}>Co-travelers</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.editBtn} onPress={openEdit} testID="profile-edit-button">
            <Ionicons name="create-outline" size={15} color={colors.textMain} />
            <Text style={styles.editBtnText}>Edit profile</Text>
          </TouchableOpacity>
        </View>

        {/* Sign out */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.logoutBtn} onPress={logout} testID="profile-logout">
            <Ionicons name="log-out-outline" size={18} color="#dc2626" />
            <Text style={styles.logoutText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        {/* All outings */}
        {outings.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your outings</Text>
            {outings.map((o) => (
              <TouchableOpacity
                key={o.id}
                style={styles.outingRow}
                onPress={() => router.push(`/outing/${o.id}`)}
                activeOpacity={0.85}
              >
                {o.cover_url ? (
                  <Image source={{ uri: o.cover_url }} style={styles.outingThumb} />
                ) : (
                  <View style={[styles.outingThumb, styles.outingThumbFallback]}>
                    <Ionicons name="airplane" size={16} color="rgba(255,255,255,0.6)" />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.outingName} numberOfLines={1}>{o.name}</Text>
                  <Text style={styles.outingMeta}>{o.destination} · {o.members.length} crew</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}

      </ScrollView>

      {/* Edit Profile Bottom Sheet */}
      <Modal visible={editing} transparent animationType="slide" onRequestClose={() => setEditing(false)}>
        <View style={styles.sheetBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Edit profile</Text>

              {/* Upload photo */}
              <TouchableOpacity style={styles.uploadBtn} onPress={pickAvatar}>
                <Ionicons name="camera-outline" size={20} color={colors.textMain} />
                <Text style={styles.uploadBtnText}>Upload your own photo</Text>
                {editAvatar && editAvatar.startsWith("data:") && (
                  <Image source={{ uri: editAvatar }} style={styles.uploadPreview} />
                )}
              </TouchableOpacity>

              {/* Name input */}
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={editName}
                onChangeText={setEditName}
                placeholder="Your name"
                placeholderTextColor={colors.textSubtle}
                testID="edit-name-input"
              />

              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
                <TouchableOpacity style={[styles.outlineBtn, { flex: 1 }]} onPress={() => setEditing(false)}>
                  <Text style={styles.outlineBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.cta, { flex: 1 }]}
                  onPress={saveEdit}
                  disabled={saving || editName.trim().length < 2}
                  testID="edit-save-button"
                >
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Save</Text>}
                </TouchableOpacity>
              </View>
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
  header: {
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { fontSize: 30, fontWeight: "900", color: colors.textMain, letterSpacing: -1.5 },
  profileSection: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  avatarWrap: { position: "relative", marginBottom: spacing.md },
  avatar: { width: 100, height: 100, borderRadius: 50 },
  avatarFallback: { backgroundColor: "#1C1E21", alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 36, fontWeight: "900", color: "#fff" },
  cameraBtn: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.bg,
  },
  name: { fontSize: 24, fontWeight: "900", color: colors.textMain, letterSpacing: -0.5 },
  username: { fontSize: 14, color: colors.textMuted, marginTop: 4, fontWeight: "500" },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    gap: spacing.xl,
  },
  statBox: { alignItems: "center" },
  statDivider: { width: 1, height: 32, backgroundColor: colors.borderSoft },
  statValue: { fontSize: 24, fontWeight: "900", color: colors.textMain },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2, textTransform: "uppercase", letterSpacing: 1 },
  editBtn: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#F1F3F5",
  },
  editBtnText: { fontSize: 13, fontWeight: "700", color: colors.textMain },
  section: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: colors.textMain, marginBottom: spacing.md, letterSpacing: -0.5 },
  outingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  outingThumb: { width: 44, height: 44, borderRadius: 10, resizeMode: "cover" },
  outingThumbFallback: { backgroundColor: "#1C1E21", alignItems: "center", justifyContent: "center" },
  outingName: { fontSize: 14, fontWeight: "700", color: colors.textMain },
  outingMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: "#FEE2E2",
  },
  logoutText: { color: "#dc2626", fontSize: 14, fontWeight: "700" },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.textMain, marginBottom: spacing.md },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: "#F1F3F5",
    marginBottom: spacing.md,
  },
  uploadBtnText: { fontSize: 14, fontWeight: "700", color: colors.textMain, flex: 1 },
  uploadPreview: { width: 36, height: 36, borderRadius: 18 },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMain, marginBottom: spacing.sm },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 15, color: colors.textMain },
  outlineBtn: { paddingVertical: 14, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "#F1F3F5" },
  outlineBtnText: { fontWeight: "700", color: colors.textMain },
  cta: { paddingVertical: 14, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  ctaText: { color: "#fff", fontWeight: "700" },
});