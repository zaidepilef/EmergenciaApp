import { redirect } from "next/navigation";
import { hasSession } from "@/lib/api";
import { PasswordForm } from "./PasswordForm";

export default async function ChangePasswordPage() {
  if (!(await hasSession())) redirect("/login");
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-muted">EmergenciaApp</p>
        <h1 className="font-display text-4xl font-bold">Crea tu contraseña</h1>
        <p className="mt-1 text-muted">
          Ingresaste con una contraseña provisoria. Antes de continuar, elige una propia: al menos 10 caracteres y sin tu RUT.
        </p>
      </div>
      <PasswordForm />
    </main>
  );
}
