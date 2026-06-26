// Outy API client — every request can attach a Bearer token via setToken().
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const res = await fetch(`${BASE}/api${path}`, { ...options, headers, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let message = res.statusText;
      try {
        const parsed = JSON.parse(body);
        if (parsed?.detail) message = typeof parsed.detail === "string" ? parsed.detail : message;
      } catch {}
      throw new ApiError(res.status, body, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new ApiError(0, "", "Request timed out. Please try again.");
    throw err;
  }
}
// ---------- Types ----------
export type User = {
  id: string;
  email: string;
  name: string;
  username: string;
  avatar_url?: string | null;
  auth_provider: "password" | "google";
  invite_code: string;
  created_at: string;
};

export type AuthResponse = { token: string; user: User; needs_username: boolean };

export type Member = { user_id: string; name: string; avatar_url?: string | null };

export type Outing = {
  id: string;
  name: string;
  destination: string;
  description?: string;
  cover_url?: string | null;
  start_date: string;
  end_date: string;
  created_by: string;
  members: Member[];
  invite_code: string;
  created_at: string;
};

export type ExpenseShare = { user_id: string; name: string; share_amount: number };
export type Expense = {
  id: string;
  outing_id: string;
  title: string;
  amount: number;
  category: string;
  paid_by: string;
  paid_by_name: string;
  split_type: "equal" | "custom";
  shares: ExpenseShare[];
  created_at: string;
};
export type Balance = { user_id: string; name: string; total_paid: number; total_owed: number; net_balance: number };
export type SettlementTx = { from_user_id: string; from_name: string; to_user_id: string; to_name: string; amount: number };

export type GalleryItem = {
  id: string;
  outing_id: string;
  image_b64: string;
  uploaded_by: string;
  uploaded_by_name: string;
  caption?: string;
  created_at: string;
};

export type Todo = {
  id: string;
  outing_id: string;
  title: string;
  done: boolean;
  created_by: string;
  created_by_name: string;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  created_at: string;
};

export type Invite = {
  id: string;
  outing_id: string;
  outing_name: string;
  outing_destination: string;
  outing_cover_url?: string | null;
  invited_user_id: string;
  invited_username: string;
  invited_by_user_id: string;
  invited_by_name: string;
  status: "pending" | "accepted" | "rejected" | "expired";
  created_at: string;
  expires_at: string;
};

export type Message = {
  id: string;
  outing_id: string;
  sender_id: string;
  sender_name: string;
  sender_avatar?: string | null;
  type: "text" | "system";
  text: string;
  created_at: string;
};

export const api = {
  // Auth
  signup: (body: { email: string; password: string; name: string; username: string }) =>
    request<AuthResponse>("/auth/signup", { method: "POST", body: JSON.stringify(body) }),
  signin: (body: { email: string; password: string }) =>
    request<AuthResponse>("/auth/signin", { method: "POST", body: JSON.stringify(body) }),
  googleSession: (sessionToken: string) =>
    request<AuthResponse>("/auth/google/session", { method: "POST", body: JSON.stringify({ session_token: sessionToken }) }),
  claimUsername: (username: string) =>
    request<{ user: User }>("/auth/username", { method: "POST", body: JSON.stringify({ username }) }),
  me: () => request<{ user: User }>("/auth/me"),
  updateMe: (body: { name?: string; avatar_url?: string | null }) =>
    request<{ user: User }>("/auth/me", { method: "PUT", body: JSON.stringify(body) }),
  forgotPassword: (email: string) =>
  request<{ ok: boolean }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  }),

resetPassword: (email: string, otp: string, new_password: string) =>
  request<{ ok: boolean }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ email, otp, new_password }),
  }),

  // Outings
  listOutings: (scope: "upcoming" | "past" | "all" = "all") => request<Outing[]>(`/outings?scope=${scope}`),
  createOuting: (body: { name: string; destination: string; description?: string; cover_url?: string | null; start_date: string; end_date: string }) =>
    request<Outing>("/outings", { method: "POST", body: JSON.stringify(body) }),
  getOuting: (id: string) => request<Outing>(`/outings/${id}`),
  deleteOuting: (id: string) => request<{ ok: boolean }>(`/outings/${id}`, { method: "DELETE" }),
  updateOuting: (id: string, body: { name?: string; destination?: string; description?: string; cover_url?: string | null; start_date?: string; end_date?: string }) =>
    request<Outing>(`/outings/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  inviteByUsername: (outingId: string, username: string) =>
    request<Invite>(`/outings/${outingId}/invite`, { method: "POST", body: JSON.stringify({ username }) }),
  joinByCode: (invite_code: string) =>
    request<Outing>("/outings/join", { method: "POST", body: JSON.stringify({ invite_code }) }),

  // Invites
  listInvites: () => request<Invite[]>("/invites"),
  acceptInvite: (id: string) => request<Outing>(`/invites/${id}/accept`, { method: "POST" }),
  rejectInvite: (id: string) => request<{ ok: boolean }>(`/invites/${id}/reject`, { method: "POST" }),

  // Expenses
  listExpenses: (outingId: string) => request<Expense[]>(`/outings/${outingId}/expenses`),
  addExpense: (outingId: string, body: { title: string; amount: number; category: string; paid_by: string; paid_by_name: string; split_type: "equal" | "custom"; shares: ExpenseShare[] }) =>
    request<Expense>(`/outings/${outingId}/expenses`, { method: "POST", body: JSON.stringify(body) }),
  outingSettlements: (outingId: string) =>
    request<{ balances: Balance[]; transactions: SettlementTx[] }>(`/outings/${outingId}/settlements`),
  expensesSummary: () => request<{ total: number; by_outing: { outing_id: string; outing_name: string; total: number }[]; recent: (Expense & { outing_name: string })[] }>("/expenses/summary"),

  // Gallery
  listGallery: (outingId: string) => request<GalleryItem[]>(`/outings/${outingId}/gallery`),
  addGalleryItem: (outingId: string, body: { image_b64: string; caption?: string }) =>
    request<GalleryItem>(`/outings/${outingId}/gallery`, { method: "POST", body: JSON.stringify(body) }),
  deleteGalleryItem: (id: string) => request<{ ok: boolean }>(`/gallery/${id}`, { method: "DELETE" }),

  // Todos
  listTodos: (outingId: string) => request<Todo[]>(`/outings/${outingId}/todos`),
  addTodo: (outingId: string, body: { title: string; assigned_to?: string | null; assigned_to_name?: string | null }) =>
    request<Todo>(`/outings/${outingId}/todos`, { method: "POST", body: JSON.stringify(body) }),
  updateTodo: (id: string, body: Partial<Pick<Todo, "title" | "done" | "assigned_to" | "assigned_to_name">>) =>
    request<Todo>(`/todos/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteTodo: (id: string) => request<{ ok: boolean }>(`/todos/${id}`, { method: "DELETE" }),

  // Chat
  listMessages: (outingId: string, since?: string) =>
    request<Message[]>(`/outings/${outingId}/messages${since ? `?since=${encodeURIComponent(since)}` : ""}`),
  sendMessage: (outingId: string, text: string) =>
    request<Message>(`/outings/${outingId}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
};
