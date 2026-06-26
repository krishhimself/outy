import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { api, Message } from "@/src/api/client";
import { useAuth } from "@/src/state/auth";
import { colors, radii, spacing } from "@/src/theme";

const POLL_MS = 2000;

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const lastTsRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    try {
      const list = await api.listMessages(id);
      setMessages(list);
      if (list.length) lastTsRef.current = list[list.length - 1].created_at;
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchSince = useCallback(async () => {
    if (!id || !lastTsRef.current) return;
    try {
      const incoming = await api.listMessages(id, lastTsRef.current);
      if (incoming.length) {
        setMessages((prev) => [...prev, ...incoming]);
        lastTsRef.current = incoming[incoming.length - 1].created_at;
      }
    } catch {}
  }, [id]);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchSince, POLL_MS);
    return () => clearInterval(t);
  }, [fetchAll, fetchSince]);

  useEffect(() => {
    // scroll to bottom when new messages arrive
    if (messages.length === 0) return;
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  }, [messages.length]);

  const send = async () => {
    if (!id || !text.trim() || sending) return;
    setSending(true);
    const draft = text.trim();
    setText("");
    try {
      const msg = await api.sendMessage(id, draft);
      setMessages((prev) => [...prev, msg]);
      lastTsRef.current = msg.created_at;
    } catch {
      setText(draft);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="chat-back">
          <Ionicons name="chevron-back" size={22} color={colors.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle}>Crew chat</Text>
          <Text style={styles.topSub}>{messages.length} {messages.length === 1 ? "message" : "messages"}</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={80}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <MessageBubble msg={item} mine={item.sender_id === user?.id} />}
            contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.lg, gap: 8 }}
            ListEmptyComponent={
              <View style={styles.empty} testID="chat-empty">
                <Text style={styles.emptyTitle}>Say hi to the crew 👋</Text>
                <Text style={styles.emptySub}>Plan, joke, share. Notifications about new photos & tasks land here too.</Text>
              </View>
            }
          />
        )}

        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            value={text}
            onChangeText={setText}
            placeholder="Message your crew"
            placeholderTextColor={colors.textSubtle}
            multiline
            testID="chat-input"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
            onPress={send}
            disabled={!text.trim() || sending}
            testID="chat-send"
          >
            {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({ msg, mine }: { msg: Message; mine: boolean }) {
  if (msg.type === "system") {
    return (
      <View style={styles.systemRow} testID={`message-${msg.id}`}>
        <Text style={styles.systemText}>{msg.text}</Text>
        <Text style={styles.systemTime}>{formatTime(msg.created_at)}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]} testID={`message-${msg.id}`}>
      {!mine ? (
        msg.sender_avatar ? (
          <Image source={{ uri: msg.sender_avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{msg.sender_name[0]?.toUpperCase()}</Text>
          </View>
        )
      ) : null}
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
        {!mine ? <Text style={styles.senderName}>{msg.sender_name}</Text> : null}
        <Text style={[styles.bubbleText, mine && { color: "#fff" }]}>{msg.text}</Text>
        <Text style={[styles.bubbleTime, mine && { color: "rgba(255,255,255,0.7)" }]}>{formatTime(msg.created_at)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#F1F3F5", alignItems: "center", justifyContent: "center" },
  topTitle: { fontSize: 16, fontWeight: "800", color: colors.textMain },
  topSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  empty: { alignItems: "center", paddingTop: 80 },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.textMain, marginBottom: 4 },
  emptySub: { fontSize: 13, color: colors.textMuted, textAlign: "center", paddingHorizontal: spacing.lg },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 6, maxWidth: "85%" },
  rowMine: { alignSelf: "flex-end" },
  rowOther: { alignSelf: "flex-start" },
  avatar: { width: 24, height: 24, borderRadius: 12 },
  avatarFallback: { backgroundColor: "#FFEDED", alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 10, fontWeight: "800", color: colors.primary },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.lg, maxWidth: "100%" },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft, borderBottomLeftRadius: 4 },
  senderName: { fontSize: 11, fontWeight: "800", color: colors.primary, marginBottom: 2 },
  bubbleText: { fontSize: 14, color: colors.textMain },
  bubbleTime: { fontSize: 10, color: colors.textSubtle, marginTop: 4, alignSelf: "flex-end" },
  systemRow: { alignItems: "center", paddingVertical: 4 },
  systemText: { fontSize: 12, color: colors.textMuted, backgroundColor: "#F1F3F5", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  systemTime: { fontSize: 10, color: colors.textSubtle, marginTop: 2 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
  composerInput: { flex: 1, maxHeight: 120, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 14, color: colors.textMain },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  sendBtnDisabled: { backgroundColor: "#FCA5A5" },
});
