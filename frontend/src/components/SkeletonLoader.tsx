import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, ViewStyle } from "react-native";

function SkeletonBox({ style }: { style?: ViewStyle }) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return <Animated.View style={[styles.bone, style, { opacity }]} />;
}

export function HomeSkeleton() {
  return (
    <View style={styles.container}>
      <SkeletonBox style={{ width: 80, height: 12, borderRadius: 6, marginBottom: 8 }} />
      <SkeletonBox style={{ width: 180, height: 36, borderRadius: 8, marginBottom: 8 }} />
      <SkeletonBox style={{ width: 140, height: 14, borderRadius: 6, marginBottom: 24 }} />
      <SkeletonBox style={{ width: "100%", height: 300, borderRadius: 20, marginBottom: 24 }} />
      <SkeletonBox style={{ width: 120, height: 18, borderRadius: 6, marginBottom: 16 }} />
      {[1, 2, 3].map((i) => (
        <View key={i} style={styles.activityRow}>
          <SkeletonBox style={{ width: 36, height: 36, borderRadius: 18 }} />
          <View style={{ flex: 1, gap: 6 }}>
            <SkeletonBox style={{ width: "80%", height: 13, borderRadius: 6 }} />
            <SkeletonBox style={{ width: "50%", height: 11, borderRadius: 6 }} />
          </View>
        </View>
      ))}
      <SkeletonBox style={{ width: 80, height: 18, borderRadius: 6, marginTop: 24, marginBottom: 16 }} />
      <View style={styles.crewRow}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.crewItem}>
            <SkeletonBox style={{ width: 52, height: 52, borderRadius: 26 }} />
            <SkeletonBox style={{ width: 40, height: 10, borderRadius: 5, marginTop: 6 }} />
          </View>
        ))}
      </View>
      <SkeletonBox style={{ width: 90, height: 18, borderRadius: 6, marginTop: 24, marginBottom: 16 }} />
      <View style={styles.memoriesRow}>
        {[1, 2, 3].map((i) => (
          <SkeletonBox key={i} style={{ width: 140, height: 180, borderRadius: 16 }} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 80 },
  bone: { backgroundColor: "#E5E7EB" },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  crewRow: { flexDirection: "row", gap: 16 },
  crewItem: { alignItems: "center" },
  memoriesRow: { flexDirection: "row", gap: 12 },
});