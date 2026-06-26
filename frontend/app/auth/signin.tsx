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
import { Link } from "expo-router";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ApiError, useAuth } from "@/src/state/auth";
import { colors, radii, spacing } from "@/src/theme";

export default function SignIn() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!email || !password) return setErr("Enter your email and password.");
    setLoading(true);
    try {
      await signIn({ email: email.trim().toLowerCase(), password });
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Could not sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.logoRow}>
            <View style={styles.logoBadge}><Ionicons name="airplane" size={22} color="#fff" /></View>
            <Text style={styles.logoText}>Outy</Text>
          </View>
          <Text style={styles.title}>Welcome back ✈️</Text>
          <Text style={styles.subtitle}>Sign in to plan your next outy.</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@email.com"
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            testID="signin-email"
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.textSubtle}
            secureTextEntry
            testID="signin-password"
          />
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <TouchableOpacity style={styles.cta} disabled={loading} onPress={submit} testID="signin-submit">
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Sign in</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push("/auth/forgot-password")} style={{ alignSelf: "center", marginTop: 6 }}>
          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>Forgot password?</Text>
          </TouchableOpacity>

          <View style={styles.bottomLinkRow}>
            <Text style={styles.bottomLink}>New here?</Text>
            <Link href="/auth/signup" asChild>
              <TouchableOpacity testID="signin-go-signup">
                <Text style={styles.bottomLinkBold}>Create account</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingTop: spacing.xl },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg },
  logoBadge: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  logoText: { fontSize: 22, fontWeight: "800", color: colors.textMain, letterSpacing: -0.5 },
  title: { fontSize: 30, fontWeight: "800", color: colors.textMain, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 4, marginBottom: spacing.lg },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMain, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 15, color: colors.textMain },
  err: { color: "#dc2626", marginTop: spacing.md, fontSize: 13 },
  cta: { marginTop: spacing.lg, backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  bottomLinkRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: spacing.xl },
  bottomLink: { color: colors.textMuted, fontSize: 13 },
  bottomLinkBold: { color: colors.primary, fontSize: 13, fontWeight: "700" },
});