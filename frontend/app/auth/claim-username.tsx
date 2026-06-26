import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ApiError, useAuth } from "@/src/state/auth";
import { colors, radii, spacing } from "@/src/theme";

export default function ClaimUsername() {
  const { user, claimUsername } = useAuth();
  const [username, setUsername] = useState(user?.username ?? "");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    const u = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(u)) return setErr("Username must be 3-24 chars (a-z, 0-9, _).");
    setLoading(true);
    try {
      await claimUsername(u);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Could not save username");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.body}>
          <View style={styles.iconBadge}><Ionicons name="at" size={28} color="#fff" /></View>
          <Text style={styles.title}>Pick a username</Text>
          <Text style={styles.subtitle}>
            Friends will invite you using this — it has to be unique.
          </Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={(t) => setUsername(t.toLowerCase().replace(/\s+/g, ""))}
            placeholder="alex_c"
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            testID="claim-username-input"
          />
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <TouchableOpacity style={styles.cta} disabled={loading} onPress={submit} testID="claim-username-submit">
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Save & continue</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, padding: spacing.lg, paddingTop: spacing.xxl },
  iconBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  title: { fontSize: 26, fontWeight: "800", color: colors.textMain, textAlign: "center", marginTop: spacing.lg },
  subtitle: { fontSize: 14, color: colors.textMuted, textAlign: "center", marginTop: 6, marginBottom: spacing.xl },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 18, color: colors.textMain, textAlign: "center" },
  err: { color: "#dc2626", marginTop: spacing.md, fontSize: 13, textAlign: "center" },
  cta: { marginTop: spacing.lg, backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
