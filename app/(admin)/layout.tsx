// app/(admin)/layout.tsx — everything under (admin) requires a session
import { redirect } from "next/navigation";
import { getSession } from "@/lib/admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <>{children}</>;
}