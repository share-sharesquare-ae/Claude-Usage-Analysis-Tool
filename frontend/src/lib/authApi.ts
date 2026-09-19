export type AdminUser = { id: number; email: string; display_name: string | null };

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ??
  import.meta.env.VITE_API_URL ??
  ""
).replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? "Request failed");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const authApi = {
  me: () => request<AdminUser>("/api/v1/auth/me"),
  session: () => request<AdminUser | null>("/api/v1/auth/session"),
  login: (email: string, password: string) => request<AdminUser>("/api/v1/auth/login", {
    method: "POST", body: JSON.stringify({ email, password }),
  }),
  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),
};
