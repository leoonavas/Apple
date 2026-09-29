import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!(await hasValidSession())) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
