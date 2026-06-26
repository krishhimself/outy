import { useState, useCallback } from "react";
import {
  ActivityIndicator,
  Image,
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
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";

import { api } from "@/src/api/client";
import { useAuth } from "@/src/state/auth";
import { colors, radii, spacing } from "@/src/theme";

const UNSPLASH_KEY = process.env.EXPO_PUBLIC_UNSPLASH_KEY;

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function plusDays(d: number): Date {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return dt;
}

function formatDisplay(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function CreateTab() {
  const router = useRouter();
  const { user: profile } = useAuth();
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState(plusDays(7));
  const [endDate, setEndDate] = useState(plusDays(9));
  const [cover, setCover] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [unsplashResults, setUnsplashResults] = useState<{ id: string; url: string; thumb: string }[]>([]);
  const [searchingPhotos, setSearchingPhotos] = useState(false);
  const [lastSearched, setLastSearched] = useState("");

  const searchUnsplash = useCallback(async (query: string) => {
    if (!query.trim() || query === lastSearched) return;
    setSearchingPhotos(true);
    setLastSearched(query);
    setPhotoErr(null);
    try {
      const res = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape`,
        { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }
      );
      const data = await res.json();
      const photos = (data.results ?? []).map((p: any) => ({
        id: p.id,
        url: p.urls.regular,
        thumb: p.urls.regular,
      }));
      setUnsplashResults(photos);
      if (photos.length > 0 && !cover) setCover(photos[0].url);
      if (photos.length === 0) setPhotoErr("No photos found. Try a different destination name.");
    } catch {
      setPhotoErr("Could not fetch photos. Check your connection and try again.");
    } finally {
      setSearchingPhotos(false);
    }
  }, [lastSearched, cover]);

  const canSubmit =
    name.trim().length >= 2 &&
    destination.trim().length >= 2 &&
    endDate >= startDate;

  const submit = async () => {
    if (!profile || !canSubmit || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const o = await api.createOuting({
        name: name.trim(),
        destination: destination.trim(),
        description: description.trim(),
        cover_url: cover,
        start_date: toISO(startDate),
        end_date: toISO(endDate),
      });
      setName(""); setDestination(""); setDescription("");
      setCover(null); setUnsplashResults([]); setLastSearched("");
      setPhotoErr(null); setStartDate(plusDays(7)); setEndDate(plusDays(9));
      router.push(`/outing/${o.id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Could not create outing");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Create an Outy</Text>
          <Text style={styles.subtitle}>Spin up a new trip and rope your crew in.</Text>

          <Text style={styles.label}>Outing name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Weekend in Goa" placeholderTextColor={colors.textSubtle} testID="create-name-input" />

          <Text style={styles.label}>Destination</Text>
          <View style={styles.destinationRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={destination}
              onChangeText={(text) => { setDestination(text); setPhotoErr(null); setLastSearched(""); }}
              placeholder="Goa, India"
              placeholderTextColor={colors.textSubtle}
              testID="create-destination-input"
            />
            <TouchableOpacity
              style={[styles.searchBtn, (searchingPhotos || destination.trim().length < 2) && styles.searchBtnDisabled]}
              onPress={() => searchUnsplash(destination)}
              disabled={searchingPhotos || destination.trim().length < 2}
            >
              {searchingPhotos ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="image-outline" size={20} color="#fff" />}
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Tap the photo icon to find cover photos for your destination</Text>

          {photoErr ? (
            <View style={styles.photoErrWrap}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.textMuted} />
              <Text style={styles.photoErrText}>{photoErr}</Text>
            </View>
          ) : null}

          {unsplashResults.length > 0 && (
            <View style={styles.photoSection}>
              <Text style={styles.sectionLabel}>Choose a cover photo</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {unsplashResults.map((photo) => {
                  const selected = cover === photo.url;
                  return (
                    <TouchableOpacity key={photo.id} onPress={() => setCover(photo.url)} activeOpacity={0.85} style={[styles.coverThumb, selected && styles.coverSelected]}>
                      <Image source={{ uri: photo.thumb }} style={styles.coverImg} />
                      {selected && <View style={styles.coverCheck}><Ionicons name="checkmark" size={16} color="#fff" /></View>}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {cover && (
            <View style={styles.previewWrap}>
              <Image source={{ uri: cover }} style={styles.previewImg} />
              <TouchableOpacity style={styles.previewRemove} onPress={() => setCover(null)}>
                <Ionicons name="close" size={14} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {/* Date pickers */}
          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Start date</Text>
              <TouchableOpacity style={styles.dateBtn} onPress={() => setShowStartPicker(true)} testID="create-start-date-input">
                <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
                <Text style={styles.dateBtnText}>{formatDisplay(startDate)}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>End date</Text>
              <TouchableOpacity style={styles.dateBtn} onPress={() => setShowEndPicker(true)} testID="create-end-date-input">
                <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
                <Text style={styles.dateBtnText}>{formatDisplay(endDate)}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {endDate < startDate && <Text style={styles.dateErr}>End date can't be before start date.</Text>}

          <Text style={styles.label}>Description (optional)</Text>
          <TextInput
            style={[styles.input, { height: 90, textAlignVertical: "top" }]}
            value={description}
            onChangeText={setDescription}
            placeholder="Beach hopping, sunsets, scooter rides..."
            placeholderTextColor={colors.textSubtle}
            multiline
            testID="create-description-input"
          />

          {err ? <Text style={styles.error}>{err}</Text> : null}

          <TouchableOpacity
            style={[styles.cta, !canSubmit && styles.ctaDisabled]}
            disabled={!canSubmit || loading}
            onPress={submit}
            activeOpacity={0.85}
            testID="create-submit-button"
          >
            {loading ? <ActivityIndicator color="#fff" /> : (
              <><Ionicons name="sparkles" size={18} color="#fff" /><Text style={styles.ctaText}>Create Outy</Text></>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Start date picker modal */}
      <Modal visible={showStartPicker} transparent animationType="slide">
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={() => setShowStartPicker(false)}>
                <Text style={styles.pickerCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.pickerTitle}>Start Date</Text>
              <TouchableOpacity onPress={() => setShowStartPicker(false)}>
                <Text style={styles.pickerDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={startDate}
              mode="date"
              display="spinner"
              minimumDate={new Date()}
              textColor={colors.textMain}
              onChange={(_, date) => {
                if (date) {
                  setStartDate(date);
                  if (date > endDate) setEndDate(date);
                }
              }}
            />
          </View>
        </View>
      </Modal>

      {/* End date picker modal */}
      <Modal visible={showEndPicker} transparent animationType="slide">
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={() => setShowEndPicker(false)}>
                <Text style={styles.pickerCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.pickerTitle}>End Date</Text>
              <TouchableOpacity onPress={() => setShowEndPicker(false)}>
                <Text style={styles.pickerDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={endDate}
              mode="date"
              display="spinner"
              minimumDate={startDate}
              textColor={colors.textMain}
              onChange={(_, date) => {
                if (date) setEndDate(date);
              }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  title: { fontSize: 28, fontWeight: "800", color: colors.textMain, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: spacing.lg },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.textSubtle, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: spacing.sm },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMain, marginTop: spacing.lg, marginBottom: spacing.xs },
  hint: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 15, color: colors.textMain },
  destinationRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  searchBtn: { width: 50, height: 50, borderRadius: radii.lg, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  searchBtnDisabled: { backgroundColor: "#FCA5A5" },
  photoErrWrap: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm, padding: spacing.md, backgroundColor: "#F9FAFB", borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderSoft },
  photoErrText: { fontSize: 12, color: colors.textMuted, flex: 1 },
  photoSection: { marginTop: spacing.lg },
  coverThumb: { width: 180, height: 120, borderRadius: radii.lg, overflow: "hidden", borderWidth: 3, borderColor: "transparent", position: "relative" },
  coverSelected: { borderColor: colors.primary },
  coverImg: { width: "100%", height: "100%", resizeMode: "cover" },
  coverCheck: { position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  previewWrap: { marginTop: spacing.md, borderRadius: radii.lg, overflow: "hidden", height: 160, position: "relative" },
  previewImg: { width: "100%", height: "100%", resizeMode: "cover" },
  previewRemove: { position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  dateRow: { flexDirection: "row", gap: spacing.md },
  dateBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 14 },
  dateBtnText: { fontSize: 14, color: colors.textMain, fontWeight: "600" },
  dateErr: { color: "#dc2626", fontSize: 12, marginTop: 6 },
  error: { color: "#dc2626", marginTop: spacing.md, fontSize: 13 },
  cta: { marginTop: spacing.xl, backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  ctaDisabled: { backgroundColor: "#FCA5A5" },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: spacing.xl },
  pickerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg },
  pickerTitle: { fontSize: 16, fontWeight: "700", color: colors.textMain },
  pickerCancel: { fontSize: 15, color: colors.textMuted, fontWeight: "600" },
  pickerDone: { fontSize: 15, color: colors.primary, fontWeight: "700" },
});