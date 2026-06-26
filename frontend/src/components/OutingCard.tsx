import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { Outing } from "@/src/api/client";
import { colors, radii, spacing } from "@/src/theme";

const PASTELS = [
  { bg: "#D1FAE5", text: "#065F46" },
  { bg: "#E0E7FF", text: "#3730A3" },
  { bg: "#FEF08A", text: "#854D0E" },
  { bg: "#FFEDD5", text: "#9A3412" },
  { bg: "#FCE7F3", text: "#9D174D" },
];

function formatDateRange(start: string, end: string): string {
  const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return `${start} – ${end}`;
  const sStr = s.toLocaleDateString(undefined, opt);
  const eStr = e.toLocaleDateString(undefined, opt);
  return sStr === eStr ? sStr : `${sStr} – ${eStr}`;
}

export function daysUntil(start: string): number {
  const s = new Date(start);
  if (isNaN(s.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  s.setHours(0, 0, 0, 0);
  return Math.round((s.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

type Props = {
  outing: Outing;
  onPress?: () => void;
  variant?: "upcoming" | "past";
  index?: number;
};

export default function OutingCard({ outing, onPress, variant = "upcoming", index = 0 }: Props) {
  const pastel = PASTELS[index % PASTELS.length];
  const d = daysUntil(outing.start_date);
  let countdown = "";
  if (variant === "past") {
    countdown = "✨ Memory";
  } else if (d < 0) {
    countdown = "🔥 Ongoing";
  } else if (d === 0) {
    countdown = "🎉 Today";
  } else if (d === 1) {
    countdown = "⏰ Tomorrow";
  } else {
    countdown = `${d} days away`;
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.92}
      style={styles.card}
      testID={`outing-card-${outing.id}`}
    >
      {/* Full bleed image */}
      <View style={styles.imageWrap}>
        {outing.cover_url ? (
          <Image source={{ uri: outing.cover_url }} style={styles.image} />
        ) : (
          <View style={[styles.imageFallback, { backgroundColor: pastel.bg }]}>
            <Ionicons name="airplane" size={48} color={pastel.text} />
          </View>
        )}

        {/* Gradient overlay */}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.25)", "rgba(0,0,0,0.75)"]}
          style={styles.gradient}
        />

        {/* Countdown pill - top left */}
        <View style={styles.datePill}>
          <Text style={styles.datePillText}>{countdown}</Text>
        </View>

        {/* Member avatars - top right */}
        <View style={styles.avatarsTop}>
          {outing.members.slice(0, 3).map((m, idx) => (
            <View key={m.user_id} style={[styles.avatar, { marginLeft: idx === 0 ? 0 : -8 }]}>
              {m.avatar_url ? (
                <Image source={{ uri: m.avatar_url }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarInitial}>{m.name?.[0]?.toUpperCase() ?? "?"}</Text>
              )}
            </View>
          ))}
          {outing.members.length > 3 && (
            <View style={[styles.avatar, styles.avatarMore, { marginLeft: -8 }]}>
              <Text style={styles.avatarMoreText}>+{outing.members.length - 3}</Text>
            </View>
          )}
        </View>

        {/* Trip info - bottom of image */}
        <View style={styles.infoOverlay}>
          <Text style={styles.name} numberOfLines={1}>{outing.name}</Text>
          <View style={styles.row}>
            <Ionicons name="location" size={13} color="rgba(255,255,255,0.85)" />
            <Text style={styles.destination} numberOfLines={1}>{outing.destination}</Text>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.dates}>{formatDateRange(outing.start_date, outing.end_date)}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    marginBottom: spacing.md,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 6,
  },
  imageWrap: {
    borderRadius: radii.xl,
    overflow: "hidden",
    height: 200,
    backgroundColor: colors.borderSoft,
    position: "relative",
  },
  image: { width: "100%", height: "100%", resizeMode: "cover" },
  imageFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  gradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "100%",
  },
  datePill: {
    position: "absolute",
    top: 14,
    left: 14,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  datePillText: { fontSize: 12, fontWeight: "700", color: colors.textMain },
  avatarsTop: {
    position: "absolute",
    top: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarInitial: { fontSize: 11, fontWeight: "800", color: "#fff" },
  avatarMore: { backgroundColor: colors.textMain },
  avatarMoreText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  infoOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    gap: 4,
  },
  name: { fontSize: 20, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  destination: { fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: "500" },
  dot: { fontSize: 13, color: "rgba(255,255,255,0.5)" },
  dates: { fontSize: 13, color: "rgba(255,255,255,0.85)", fontWeight: "500" },
});