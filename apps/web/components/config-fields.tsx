import type {
  ModuleConfigField,
  ModuleConfigValues,
} from "@neosaider/contracts";

type ConfigFieldsProps = {
  fields: ModuleConfigField[];
  values?: ModuleConfigValues;
};

export function ConfigFields({ fields, values = {} }: ConfigFieldsProps) {
  if (!fields.length) {
    return (
      <p className="text-sm text-muted">
        Este módulo no necesita configuración.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => {
        const required = field.required && field.default === undefined;
        return (
          <div key={field.key} className="flex flex-col gap-1">
            <label htmlFor={field.key} className="font-mono text-xs text-ink">
              {field.key}
              {required && <span className="text-danger"> *</span>}
            </label>
            <input
              id={field.key}
              name={field.key}
              type={field.secret ? "password" : "text"}
              required={required && values[field.key] === undefined}
              defaultValue={values[field.key] ?? ""}
              placeholder={field.default}
              autoComplete="off"
              aria-describedby={`${field.key}-help`}
              className="rounded-md border border-rule px-3 py-2 text-sm"
            />
            <p id={`${field.key}-help`} className="text-xs text-soft">
              {field.description}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function readConfig(
  fields: ModuleConfigField[],
  formData: FormData,
): ModuleConfigValues {
  return Object.fromEntries(
    fields
      .map((field) => [field.key, String(formData.get(field.key) ?? "")])
      .filter(([, value]) => value !== ""),
  );
}
