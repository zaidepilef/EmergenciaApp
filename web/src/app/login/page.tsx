import { redirect } from "next/navigation";
import { hasSession } from "@/lib/api";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  if (await hasSession()) redirect("/");
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted">EmergenciaApp</p>
        <h1 className="font-display text-4xl font-bold">Panel de brigada</h1>
        <p className="mt-1 text-muted">Para coordinadores y administradores. Ingresa con tu RUT.</p>
      </div>
      <LoginForm />
    </main>
  );
}
