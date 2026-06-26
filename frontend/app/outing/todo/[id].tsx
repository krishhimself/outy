import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { api, Outing, Todo } from "@/src/api/client";
import { useAuth } from "@/src/state/auth";
import { colors, radii, spacing } from "@/src/theme";

export default function TodoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: profile } = useAuth();
  const [outing, setOuting] = useState<Outing | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const [o, list] = await Promise.all([api.getOuting(id), api.listTodos(id)]);
      setOuting(o);
      setTodos(list);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData]),
  );

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  const progress = useMemo(() => {
    if (todos.length === 0) return 0;
    return Math.round((done.length / todos.length) * 100);
  }, [todos.length, done.length]);

  const toggleDone = async (todo: Todo) => {
    // Optimistic UI flip
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)));
    try {
      await api.updateTodo(todo.id, { done: !todo.done });
    } catch {
      // revert on failure
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, done: todo.done } : t)));
    }
  };

  const removeTodo = async (todo: Todo) => {
    setTodos((prev) => prev.filter((t) => t.id !== todo.id));
    try {
      await api.deleteTodo(todo.id);
    } catch {
      fetchData();
    }
  };

  const submitNew = async () => {
    if (!id || !profile) return;
    const title = newTitle.trim();
    if (!title) return;
    setSubmitting(true);
    try {
      const assignee = outing?.members.find((m) => m.user_id === assignTo);
      const todo = await api.addTodo(id, {
        title,
        assigned_to: assignee?.user_id ?? null,
        assigned_to_name: assignee?.name ?? null,
      });
      setTodos((prev) => [...prev, todo]);
      setNewTitle("");
      setAssignTo(null);
      setAddOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="todo-back">
          <Ionicons name="chevron-back" size={22} color={colors.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle}>To-do list</Text>
          <Text style={styles.topSub}>{done.length} / {todos.length} done · {progress}%</Text>
        </View>
        <TouchableOpacity onPress={() => setAddOpen(true)} style={styles.addBtn} testID="todo-add">
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {todos.length > 0 ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : todos.length === 0 ? (
        <View style={styles.empty} testID="todo-empty">
          <View style={styles.emptyBadge}>
            <Ionicons name="checkmark-done" size={30} color="#065F46" />
          </View>
          <Text style={styles.emptyTitle}>Plan together</Text>
          <Text style={styles.emptySub}>Capture packing items, bookings, things to buy — anything the crew should remember.</Text>
          <TouchableOpacity style={styles.emptyCta} onPress={() => setAddOpen(true)} testID="todo-add-empty">
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.emptyCtaText}>Add your first task</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }} showsVerticalScrollIndicator={false}>
          {open.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Open · {open.length}</Text>
              {open.map((t) => (
                <TodoRow key={t.id} todo={t} onToggle={() => toggleDone(t)} onRemove={() => removeTodo(t)} />
              ))}
            </>
          ) : null}
          {done.length > 0 ? (
            <>
              <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Done · {done.length}</Text>
              {done.map((t) => (
                <TodoRow key={t.id} todo={t} onToggle={() => toggleDone(t)} onRemove={() => removeTodo(t)} />
              ))}
            </>
          ) : null}
        </ScrollView>
      )}

      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>New task</Text>
              <TextInput
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="Book scooter rental"
                placeholderTextColor={colors.textSubtle}
                style={styles.input}
                autoFocus
                testID="todo-title-input"
              />
              <Text style={styles.label}>Assign to (optional)</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  onPress={() => setAssignTo(null)}
                  style={[styles.chip, assignTo === null && styles.chipSelected]}
                  testID="todo-assign-none"
                >
                  <Text style={[styles.chipText, assignTo === null && styles.chipTextSelected]}>Anyone</Text>
                </TouchableOpacity>
                {outing?.members.map((m) => {
                  const sel = m.user_id === assignTo;
                  return (
                    <TouchableOpacity
                      key={m.user_id}
                      onPress={() => setAssignTo(m.user_id)}
                      style={[styles.chip, sel && styles.chipSelected]}
                      testID={`todo-assign-${m.user_id}`}
                    >
                      <Text style={[styles.chipText, sel && styles.chipTextSelected]}>{m.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                style={[styles.cta, !newTitle.trim() && styles.ctaDisabled]}
                onPress={submitNew}
                disabled={submitting || !newTitle.trim()}
                testID="todo-submit"
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Add task</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAddOpen(false)} style={{ alignItems: "center", padding: 12 }}>
                <Text style={{ color: colors.textMuted, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function TodoRow({ todo, onToggle, onRemove }: { todo: Todo; onToggle: () => void; onRemove: () => void }) {
  return (
    <View style={[styles.row, todo.done && styles.rowDone]} testID={`todo-row-${todo.id}`}>
      <TouchableOpacity onPress={onToggle} style={styles.checkbox} testID={`todo-toggle-${todo.id}`}>
        {todo.done ? (
          <View style={styles.checkboxOn}><Ionicons name="checkmark" size={14} color="#fff" /></View>
        ) : (
          <View style={styles.checkboxOff} />
        )}
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, todo.done && styles.rowTitleDone]}>{todo.title}</Text>
        <Text style={styles.rowSub}>
          {todo.assigned_to_name ? `For ${todo.assigned_to_name}` : "Open to anyone"} · added by {todo.created_by_name}
        </Text>
      </View>
      <TouchableOpacity onPress={onRemove} style={styles.removeBtn} testID={`todo-delete-${todo.id}`}>
        <Ionicons name="close" size={16} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#F1F3F5", alignItems: "center", justifyContent: "center" },
  topTitle: { fontSize: 18, fontWeight: "800", color: colors.textMain },
  topSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  addBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  progressTrack: { height: 6, backgroundColor: "#F1F3F5", marginHorizontal: spacing.lg, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#10B981", borderRadius: 3 },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: colors.textSubtle, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.borderSoft, marginBottom: 8 },
  rowDone: { backgroundColor: "#F8FAFC" },
  checkbox: { padding: 4 },
  checkboxOff: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#CBD5E1" },
  checkboxOn: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#10B981", alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 14, fontWeight: "700", color: colors.textMain },
  rowTitleDone: { textDecorationLine: "line-through", color: colors.textMuted },
  rowSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  removeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#F1F3F5", alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: 80 },
  emptyBadge: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#D1FAE5", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.textMain, marginBottom: spacing.xs },
  emptySub: { fontSize: 14, color: colors.textMuted, textAlign: "center", lineHeight: 20 },
  emptyCta: { marginTop: spacing.lg, backgroundColor: colors.primary, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 6 },
  emptyCtaText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.textMain, marginBottom: spacing.md },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 15, color: colors.textMain },
  label: { fontSize: 13, fontWeight: "700", color: colors.textMain, marginTop: spacing.md, marginBottom: spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontWeight: "700", color: colors.textMain, fontSize: 12 },
  chipTextSelected: { color: "#fff" },
  cta: { marginTop: spacing.md, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  ctaDisabled: { backgroundColor: "#FCA5A5" },
  ctaText: { color: "#fff", fontWeight: "700" },
});
