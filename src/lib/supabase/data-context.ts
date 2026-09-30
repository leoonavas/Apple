import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export type DataContext = { client: SupabaseClient; userId: string; user: User | null; privileged: boolean };
const contexts = new AsyncLocalStorage<DataContext>();

export async function withCurrentUser<T>(work: (context: DataContext) => Promise<T>): Promise<T> {
  const existing = contexts.getStore();
  if (existing) return work(existing);
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Sessão expirada. Entre novamente.");
  return contexts.run({ client, userId: data.user.id, user: data.user, privileged: false }, () => work(contexts.getStore()!));
}

export async function withPrivilegedUser<T>(userId: string, work: (context: DataContext) => Promise<T>): Promise<T> {
  const existing = contexts.getStore();
  if (existing) {
    if (existing.userId !== userId) throw new Error("O contexto do trabalho não corresponde ao usuário dono dos dados.");
    return work(existing);
  }
  const client = createAdminClient();
  return contexts.run({ client, userId, user: null, privileged: true }, () => work(contexts.getStore()!));
}

export async function withDataContext<T>(work: (context: DataContext) => Promise<T>): Promise<T> {
  return contexts.getStore() ? work(contexts.getStore()!) : withCurrentUser(work);
}
