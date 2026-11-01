const phases = [
  "Etapa 0 · Workspace",
  "Etapa 1 · Diseño y navegación",
  "Etapa 2 · Autenticación y administración",
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-4">
        <p className="text-sm font-semibold tracking-wide text-red-700 uppercase">
          Sistema de brigada
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Brigada Emergencias
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-slate-600">
          Workspace preparado para iniciar el MVP. Todavía no hay módulos funcionales implementados.
        </p>
      </header>

      <section
        aria-labelledby="estado-actual"
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 id="estado-actual" className="text-xl font-semibold text-slate-900">
          Estado actual
        </h2>
        <p className="mt-2 text-slate-600">
          Etapa 0 completada: estructura, dependencias, documentación y pruebas base.
        </p>
        <ul className="mt-4 space-y-2 text-sm text-slate-700">
          {phases.map((phase) => (
            <li key={phase} className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2 rounded-full bg-red-600" />
              {phase}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
