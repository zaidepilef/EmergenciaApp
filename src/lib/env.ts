type PublicEnvKey = "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY";

export type PublicEnv = Record<PublicEnvKey, string>;

export function readPublicEnv(source: Record<string, string | undefined> = process.env): PublicEnv {
  const url = source.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = source.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  const missing: PublicEnvKey[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (!url || !anonKey) {
    throw new Error(
      `Faltan variables de entorno públicas: ${missing.join(", ")}. Copiá .env.example a .env.local.`,
    );
  }

  return {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  };
}
