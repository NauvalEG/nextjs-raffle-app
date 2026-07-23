import { redirect } from "next/navigation";

// The dashboard is the default landing surface (E1-01 Feature B). Middleware
// bounces unauthenticated visitors to /login.
export default function Home() {
  redirect("/raffles");
}
