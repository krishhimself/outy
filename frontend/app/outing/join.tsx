import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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

import { api } from "@/src/api/client";
import { useAuth } from "@/src/state/auth";
import { colors, radii, spacing } from "@/src/theme";

export default function JoinOuting() {
  const router = useRouter();
  const { user: profile } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!profile) return;
    const clean = code.trim().toUpperCase();
    if (clean.length < 4) {
      setErr("Enter a valid invite code");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const o = await api.joinByCode(clean);
      router.replace(`/outing/${o.id}`);
    } catch {
      setErr("Invalid invite code. Double-check & try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="join-back-button">
          <Ionicons name="chevron-back" size={22} color={colors.textMain} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Join an Outy</Text>
        <View style={{ width: 38 }} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
          <View style={styles.bigIcon}>
            <Ionicons name="ticket" size={36} color={colors.primary} />
          </View>
          <Text style={styles.title}>Got an invite code?</Text>
          <Text style={styles.subtitle}>Paste the 6-character code your friend shared with you.</Text>

          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="ABCD12"
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={10}
            style={styles.input}
            testID="join-code-input"
          />
          {err ? <Text style={styles.error}>{err}</Text> : null}

          <TouchableOpacity
            style={[styles.cta, !code && styles.ctaDisabled]}
            onPress={submit}
            disabled={loading || !code}
            testID="join-submit-button"
          >
            {loading ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="enter" size={18} color="#fff" />
                <Text style={styles.ctaText}>Join the crew</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#F1F3F5", alignItems: "center", justifyContent: "center" },
  topTitle: { fontSize: 16, fontWeight: "700", color: colors.textMain },
  bigIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#FFEDED", alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: spacing.xl },
  title: { fontSize: 26, fontWeight: "800", color: colors.textMain, textAlign: "center", marginTop: spacing.lg },
  subtitle: { fontSize: 14, color: colors.textMuted, textAlign: "center", marginTop: 6, marginBottom: spacing.xl },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 18, fontSize: 26, fontWeight: "800", color: colors.textMain, textAlign: "center", letterSpacing: 8 },
  error: { color: "#dc2626", marginTop: spacing.md, fontSize: 13, textAlign: "center" },
  cta: { marginTop: spacing.xl, backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  ctaDisabled: { backgroundColor: "#FCA5A5" },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
