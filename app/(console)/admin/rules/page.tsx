import { redirect } from "next/navigation";

// Decision rules now live on the Settings page.
export default function Rules() {
  redirect("/admin/settings");
}
