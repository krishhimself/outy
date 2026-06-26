import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ZoomableView } from "react-native-zoom-toolkit";

import { api, GalleryItem } from "@/src/api/client";
import { useAuth } from "@/src/state/auth";
import { colors, radii, spacing } from "@/src/theme";

const SCREEN_W = Math.min(Dimensions.get("window").width, 430);
const GRID_GAP = 6;
const COLUMNS = 3;
const TILE_SIZE = Math.floor((SCREEN_W - spacing.lg * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS);

export default function GalleryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: profile } = useAuth();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<GalleryItem | null>(null);

  const fetchItems = useCallback(async () => {
    if (!id) return;
    try {
      const list = await api.listGallery(id);
      setItems(list);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { fetchItems(); }, [fetchItems]));

  const pickImage = async () => {
    if (!id || !profile) return;
    setPermError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPermError(
        perm.canAskAgain
          ? "Allow photo access to upload to the gallery."
          : "Photo access is blocked. Open Settings → Outy → Photos to enable.",
      );
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
      allowsMultipleSelection: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    if (!asset.base64) return;
    const mime = asset.mimeType ?? "image/jpeg";
    const dataUri = `data:${mime};base64,${asset.base64}`;
    setUploading(true);
    try {
      const created = await api.addGalleryItem(id, {
        image_b64: dataUri,
        uploaded_by: profile.id,
        uploaded_by_name: profile.name,
      });
      setItems((prev) => [created, ...prev]);
    } finally {
      setUploading(false);
    }
  };

  const removeItem = async (item: GalleryItem) => {
    setViewer(null);
    await api.deleteGalleryItem(item.id);
    setItems((prev) => prev.filter((x) => x.id !== item.id));
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="gallery-back">
          <Ionicons name="chevron-back" size={22} color={colors.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle}>Gallery</Text>
          <Text style={styles.topSub}>{items.length} {items.length === 1 ? "photo" : "photos"}</Text>
        </View>
        <TouchableOpacity onPress={pickImage} style={styles.addBtn} disabled={uploading} testID="gallery-upload">
          {uploading ? <ActivityIndicator color="#fff" /> : <Ionicons name="add" size={20} color="#fff" />}
        </TouchableOpacity>
      </View>

      {permError ? <Text style={styles.permErr}>{permError}</Text> : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : items.length === 0 ? (
        <View style={styles.empty} testID="gallery-empty">
          <View style={styles.emptyBadge}>
            <Ionicons name="images" size={32} color="#3730A3" />
          </View>
          <Text style={styles.emptyTitle}>No memories yet</Text>
          <Text style={styles.emptySub}>Tap + to upload the first picture from this outing.</Text>
          <TouchableOpacity style={styles.emptyCta} onPress={pickImage} testID="gallery-upload-empty">
            <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
            <Text style={styles.emptyCtaText}>Upload a photo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          numColumns={COLUMNS}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
          columnWrapperStyle={{ gap: GRID_GAP, marginBottom: GRID_GAP }}
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setViewer(item)}
              style={styles.tile}
              testID={`gallery-item-${item.id}`}
            >
              <Image source={{ uri: item.image_b64 }} style={styles.tileImg} />
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewerBackdrop}>
          <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1 }}>
            <View style={styles.viewerTopBar}>
              <TouchableOpacity
                onPress={() => setViewer(null)}
                style={styles.viewerBtn}
                hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
                testID="gallery-close"
              >
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>

              <Text style={styles.viewerName} numberOfLines={1}>
                {viewer?.uploaded_by_name}
              </Text>

              {viewer && profile?.id === viewer.uploaded_by ? (
                <TouchableOpacity
                  onPress={() => viewer && removeItem(viewer)}
                  style={styles.viewerBtn}
                  hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
                  testID="gallery-delete"
                >
                  <Ionicons name="trash-outline" size={20} color="#fff" />
                </TouchableOpacity>
              ) : <View style={{ width: 48 }} />}
            </View>

            {viewer ? (
              <ZoomableView style={styles.viewerContent}>
                <Image
                  source={{ uri: viewer.image_b64 }}
                  style={styles.viewerImg}
                  resizeMode="contain"
                />
              </ZoomableView>
            ) : null}
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#F1F3F5", alignItems: "center", justifyContent: "center" },
  topTitle: { fontSize: 18, fontWeight: "800", color: colors.textMain },
  topSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  addBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  permErr: { color: "#dc2626", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, fontSize: 13 },
  tile: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: radii.md, overflow: "hidden", backgroundColor: colors.borderSoft },
  tileImg: { width: "100%", height: "100%" },
  empty: { alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: 80 },
  emptyBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#E0E7FF", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.textMain, marginBottom: spacing.xs },
  emptySub: { fontSize: 14, color: colors.textMuted, textAlign: "center", lineHeight: 20 },
  emptyCta: { marginTop: spacing.lg, backgroundColor: colors.primary, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 6 },
  emptyCtaText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  viewerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)" },
  viewerTopBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  viewerBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerName: {
    flex: 1,
    textAlign: "center",
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    fontWeight: "600",
    marginHorizontal: spacing.sm,
  },
  viewerContent: { flex: 1, alignItems: "center", justifyContent: "center" },
  viewerImg: { width: "100%", flex: 1 },
});