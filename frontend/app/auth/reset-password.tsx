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
import { useRouter, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { api } from "@/src/api/client";
import { colors, radii, spacing } from "@/src/theme";

export default function ResetPassword() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    setErr(null);
    if (!otp.trim()) return setErr("Enter the code we sent you.");
    if (!password) return setErr("Enter a new password.");
    if (password.length < 6) return setErr("Password must be at least 6 characters.");
    if (password !== confirmPassword) return setErr("Passwords don't match.");
    setLoading(true);
    try {
      await api.resetPassword(email, otp.trim(), password);
      setSuccess(true);
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.successContainer}>
          <View style={styles.successBadge}>
            <Ionicons name="checkmark" size={40} color="#fff" />
          </View>
          <Text style={styles.successTitle}>Password reset!</Text>
          <Text style={styles.successSub}>You can now sign in with your new password.</Text>
          <TouchableOpacity style={styles.cta} onPress={() => router.replace("/auth/signin")}>
            <Text style={styles.ctaText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.textMain} />
          </TouchableOpacity>

          <View style={styles.logoRow}>
            <View style={styles.logoBadge}><Ionicons name="key" size={22} color="#fff" /></View>
            <Text style={styles.logoText}>Outy</Text>
          </View>

          <Text style={styles.title}>Enter your code</Text>
          <Text style={styles.subtitle}>We sent a 6-digit code to {email}. Enter it below with your new password.</Text>

          <Text style={styles.label}>Reset code</Text>
          <TextInput
            style={[styles.input, styles.otpInput]}
            value={otp}
            onChangeText={setOtp}
            placeholder="000000"
            placeholderTextColor={colors.textSubtle}
            keyboardType="number-pad"
            maxLength={6}
          />

          <Text style={styles.label}>New password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.textSubtle}
            secureTextEntry
          />

          <Text style={styles.label}>Confirm password</Text>
          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.textSubtle}
            secureTextEntry
          />

          {err ? <Text style={styles.err}>{err}</Text> : null}

          <TouchableOpacity style={styles.cta} disabled={loading} onPress={submit}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Reset password</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingTop: spacing.xl },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#F1F3F5", alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg },
  logoBadge: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  logoText: { fontSize: 22, fontWeight: "800", color: colors.textMain, letterSpacing: -0.5 },
  title: { fontSize: 30, fontWeight: "800", color: colors.textMain, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 4, marginBottom: spacing.lg },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMain, marginTop: spacing.md, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 15, color: colors.textMain },
  otpInput: { fontSize: 28, fontWeight: "800", letterSpacing: 8, textAlign: "center" },
  err: { color: "#dc2626", marginTop: spacing.md, fontSize: 13 },
  cta: { marginTop: spacing.lg, backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  successContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  successBadge: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#22c55e", alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  successTitle: { fontSize: 28, fontWeight: "800", color: colors.textMain, marginBottom: spacing.sm },
  successSub: { fontSize: 14, color: colors.textMuted, textAlign: "center", marginBottom: spacing.xl },
});