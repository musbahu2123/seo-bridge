import { redirect } from "next/navigation";

// / -> the admin dashboard (the (admin) layout guards the session)
export default function RootPage() {
  redirect("/dashboard");
}