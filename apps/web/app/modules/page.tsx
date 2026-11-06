import { ModulesManager } from "@/components/modules-manager";

export default function ModulesPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-4xl">Módulos</h1>
        <p className="mt-1 text-muted">
          Los módulos instalados desde la tienda viven en su propio contenedor y
          volumen. Los externos se registraron a mano por URL.
        </p>
      </header>
      <ModulesManager />
    </div>
  );
}
