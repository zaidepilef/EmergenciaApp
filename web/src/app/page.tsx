import { redirect } from "next/navigation";
import { hasSession } from "@/lib/api";
import { Dashboard } from "./Dashboard";

export default async function Home() {
  // El detalle se carga desde el navegador vía /bff/state (polling cada 10 s).
  if (!(await hasSession())) redirect("/login");
  return <Dashboard />;
}
