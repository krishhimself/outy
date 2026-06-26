import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "@/src/theme";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 12);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#1C1E21",
        tabBarInactiveTintColor: "#9CA3AF",
        tabBarShowLabel: false,
        tabBarStyle: {
          left: 0,
          right: 0,
          bottom: 0,
          height: 80,
          borderRadius: 0,
          borderTopWidth: 1,
          borderTopColor: colors.borderSoft,
          backgroundColor: "#fff",
          elevation: 20,
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowOffset: { width: 0, height: -4 },
          shadowRadius: 12,
        },
        tabBarItemStyle: { height: 80, paddingBottom: 16, paddingTop: 8 },  
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? styles.activeTab : null}>
              <Ionicons name={focused ? "home" : "home-outline"} size={22} color={focused ? "#1C1E21" : "#9CA3AF"} />
            </View>
          ),
          tabBarButtonTestID: "nav-home",
        }}
      />
      <Tabs.Screen
        name="memory"
        options={{
          title: "Memory",
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? styles.activeTab : null}>
              <Ionicons name={focused ? "albums" : "albums-outline"} size={22} color={focused ? "#1C1E21" : "#9CA3AF"} />
            </View>
          ),
          tabBarButtonTestID: "nav-memory",
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: "Create",
          tabBarIcon: ({ focused }) => (
            <View style={[styles.fab, focused && styles.fabFocused]}>
              <Ionicons name="add" size={26} color="#fff" />
            </View>
          ),
          tabBarButtonTestID: "nav-create",
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: "Expenses",
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? styles.activeTab : null}>
              <Ionicons name={focused ? "wallet" : "wallet-outline"} size={22} color={focused ? "#1C1E21" : "#9CA3AF"} />
            </View>
          ),
          tabBarButtonTestID: "nav-expenses",
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? styles.activeTab : null}>
              <Ionicons name={focused ? "person" : "person-outline"} size={22} color={focused ? "#1C1E21" : "#9CA3AF"} />
            </View>
          ),
          tabBarButtonTestID: "nav-profile",
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  activeTab: {
    backgroundColor: "#F0F0F0",
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#1C1E21",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 8,
    marginTop: -8,
  },
  fabFocused: {
    backgroundColor: colors.primary,
  },
}); 