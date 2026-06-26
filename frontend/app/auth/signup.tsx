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
import { Link } from "expo-router";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ApiError, useAuth } from "@/src/state/auth";
import { colors, radii, spacing } from "@/src/theme";

export default function SignUp() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!email.includes("@")) return setErr("Enter a valid email.");
    if (password.length < 6) return setErr("Password must be at least 6 chars.");
    if (name.trim().length < 2) return setErr("Enter your name.");
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return setErr("Username must be 3-24 chars (a-z, 0-9, _).");
    setLoading(true);
    try {
      await signUp({ email: email.trim().toLowerCase(), password, name: name.trim(), username });
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Could not sign up");
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
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>Plan trips, split bills, share memories.</Text>

          <Text style={styles.label}>Full name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Alex Carter"
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="words"
            testID="signup-name"
          />
          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={(t) => setUsername(t.toLowerCase().replace(/\s+/g, ""))}
            placeholder="alex_c"
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            testID="signup-username"
          />
          <Text style={styles.helper}>Friends will invite you using @{username || "username"}</Text>

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
            testID="signup-email"
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="At least 6 characters"
            placeholderTextColor={colors.textSubtle}
            secureTextEntry
            testID="signup-password"
          />

          {err ? <Text style={styles.err}>{err}</Text> : null}

          <TouchableOpacity style={styles.cta} disabled={loading} onPress={submit} testID="signup-submit">
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Create account</Text>}
          </TouchableOpacity>

          <View style={styles.bottomLinkRow}>
            <Text style={styles.bottomLink}>Already have an account?</Text>
            <Link href="/auth/signin" asChild>
              <TouchableOpacity testID="signup-go-signin">
                <Text style={styles.bottomLinkBold}>Sign in</Text>
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
  title: { fontSize: 28, fontWeight: "800", color: colors.textMain, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 4, marginBottom: spacing.lg },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMain, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 15, color: colors.textMain },
  helper: { fontSize: 11, color: colors.textSubtle, marginTop: 4 },
  err: { color: "#dc2626", marginTop: spacing.md, fontSize: 13 },
  cta: { marginTop: spacing.lg, backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  bottomLinkRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: spacing.xl },
  bottomLink: { color: colors.textMuted, fontSize: 13 },
  bottomLinkBold: { color: colors.primary, fontSize: 13, fontWeight: "700" },
});