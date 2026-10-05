// /dev has no page of its own, the dashboard is the entry point.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DevIndexPage() {
  redirect("/dev/dashboard");
}
