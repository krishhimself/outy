import { ActivityIndicator, StyleSheet, View } from "react-native";

import { colors } from "@/src/theme";

// AuthProvider in _layout.tsx routes us to /auth/signin or /(tabs); this is just a splash.
export default function BootIndex() {
  return (
    <View style={styles.container} testID="boot-screen">
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
});
